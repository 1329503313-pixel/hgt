import type mysql from "mysql2/promise";
import { applyBattleCollectibleStats } from "@hgt/shared";
import { calculateCardBattlePower } from "./cardBattle.js";
import type { CardBattlePlayerInput, CardBattleResult } from "./cardBattle.js";
import type { ImpostorGameState } from "./impostorGame.js";
import { parseOnlineSoupAiHonors } from "./onlineSoupHonors.js";
import { publicOssUrl } from "./ossStorage.js";

type DB = mysql.Pool | mysql.PoolConnection;
type Row = mysql.RowDataPacket;
export const recordJson = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
const iso = (value: unknown) => new Date(value as string | Date).toISOString();

export async function initGameRecordSchema(db: DB) {
  // No room/soup foreign keys: an archived game outlives its source content.
  await db.query(`CREATE TABLE IF NOT EXISTS game_records (
    id VARCHAR(96) PRIMARY KEY, kind VARCHAR(20) NOT NULL, subtype VARCHAR(20) NOT NULL,
    source_id VARCHAR(64) NOT NULL, room_id VARCHAR(64) NOT NULL,
    ended_at DATETIME(3) NOT NULL, summary_json JSON NOT NULL, detail_json JSON NOT NULL,
    INDEX idx_game_records_kind_time (kind, ended_at, id), INDEX idx_game_records_room(room_id,ended_at),
    UNIQUE KEY uq_game_record_source(kind, source_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS game_record_users (
    record_id VARCHAR(96) NOT NULL, user_id VARCHAR(64) NOT NULL, role VARCHAR(16) NOT NULL,
    final_rank INT NULL, rank_state VARCHAR(16) NOT NULL DEFAULT 'unknown', ended_at DATETIME(3) NOT NULL,
    PRIMARY KEY(record_id,user_id), INDEX idx_game_record_user_time(user_id,ended_at,record_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS game_record_impostor_steps (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, game_id VARCHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), state_json JSON NOT NULL,
    INDEX idx_record_impostor_steps(game_id,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS game_record_starts (
    source_id VARCHAR(64) PRIMARY KEY, after_sequence BIGINT UNSIGNED NOT NULL,
    title VARCHAR(255) NOT NULL, host_id VARCHAR(64) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

export async function startGameRecord(db: DB, sourceId: string, roomId: string) {
  await db.query(`INSERT IGNORE INTO game_record_starts(source_id,after_sequence,title,host_id)
    SELECT ?,COALESCE((SELECT MAX(message_sequence) FROM online_soup_messages WHERE room_id=rooms.id),0),
      COALESCE(s.title,rooms.name),rooms.host_id FROM online_soup_rooms rooms
    LEFT JOIN soups s ON s.id=rooms.current_soup_id WHERE rooms.id=?`,[sourceId,roomId]);
}

async function exists(db: DB, id: string) {
  const [[row]] = await db.query<Row[]>("SELECT id FROM game_records WHERE id = ?", [id]);
  return Boolean(row);
}

async function persist(db: DB, kind: string, subtype: string, row: Row, summary: object, detail: object,
  users: Array<{ userId: string; role: string }>) {
  const id = `${kind}:${row.id}`;
  await db.query(`INSERT IGNORE INTO game_records (id,kind,subtype,source_id,room_id,ended_at,summary_json,detail_json)
    VALUES (?,?,?,?,?,?,?,?)`, [id,kind,subtype,row.id,row.room_id,row.ended_at,JSON.stringify(summary),JSON.stringify(detail)]);
  for (const user of users) await db.query(`INSERT IGNORE INTO game_record_users (record_id,user_id,role,ended_at)
    VALUES (?,?,?,?)`, [id,user.userId,user.role,row.ended_at]);
}

async function messages(db: DB, row: Row, through: string) {
  const [[start]] = await db.query<Row[]>("SELECT after_sequence FROM game_record_starts WHERE source_id=?",[row.id]);
  // Legacy rooms have no start snapshot. Use their own start notice where available,
  // rather than leaking another round's messages written in the same second.
  const [[legacyStart]] = start ? [[]] : await db.query<Row[]>(`SELECT MIN(message_sequence) AS seq
    FROM online_soup_messages WHERE room_id=? AND created_at>=? AND message_sequence<=?
      AND message_type='system' AND (
        (round_id=? AND (content LIKE '新一轮推理开始%' OR content LIKE '游戏开始%')) OR content=?)`,
    [row.room_id,row.started_at,through,row.id,`“谁是伪人”第 ${row.game_number ?? 0} 局开始，身份已秘密发放`]);
  const after = start?.after_sequence ?? (legacyStart?.seq ? (BigInt(legacyStart.seq)-1n).toString():0);
  const [rows] = await db.query<Row[]>(`SELECT m.*, u.nickname AS sender_name,
    sticker.name AS sticker_name, sticker.deleted_at AS sticker_deleted
    FROM online_soup_messages m LEFT JOIN users u ON u.id=m.sender_id
    LEFT JOIN sticker_products sticker ON sticker.id=m.sticker_id
    WHERE m.room_id=? AND (? OR m.created_at>=?) AND m.message_sequence<=? AND m.message_sequence>?
    ORDER BY m.message_sequence`, [row.room_id,Boolean(start),row.started_at,through,after]);
  // Explicit public fields only. Recalled text and internal AI diagnostics never enter the archive.
  return rows.map(m=>({id:String(m.id),sequence:String(m.message_sequence),type:String(m.message_type),
    senderId:m.sender_id ? String(m.sender_id):null,senderName:m.sender_name ?? null,
    content:m.recalled_at ? "消息已撤回":String(m.content),recalled:Boolean(m.recalled_at),
    createdAt:iso(m.created_at),answer:m.recalled_at?null:m.answer,questionNumber:m.question_number,
    remainingQuestionCountAfter:m.remaining_question_count_after,progress:m.ai_progress_after,
    replyId:m.reply_to_message_id,stickerName:m.sticker_deleted?"表情已下架":m.sticker_name,
    stickerUrl:!m.recalled_at && m.sticker_id && !m.sticker_deleted ? `/api/media/stickers/${encodeURIComponent(String(m.sticker_id))}/static`:null,
  }));
}

export async function recallGameRecordMessage(db: DB, roomId:string, messageId:string) {
  const [rows] = await db.query<Row[]>(`SELECT id,detail_json FROM game_records
    WHERE room_id=? AND JSON_CONTAINS(detail_json,JSON_OBJECT('id',?), '$.messages') FOR UPDATE`,[roomId,messageId]);
  for (const row of rows) {
    const detail=recordJson<{messages:Array<{id:string;content:string;recalled:boolean;answer:unknown;stickerUrl:unknown}>}>(row.detail_json);
    for(const message of detail.messages)if(message.id===messageId)Object.assign(message,{content:'消息已撤回',recalled:true,answer:null,stickerUrl:null});
    await db.query('UPDATE game_records SET detail_json=? WHERE id=?',[JSON.stringify(detail),row.id]);
  }
}

/** At settlement use current membership; backfill requires a provable interval spanning the end. */
export async function recordParticipants(db: DB, row: Row, historical: boolean) {
  const [rows] = await db.query<Row[]>(`SELECT user_id,member_role FROM online_soup_members
    WHERE room_id=? AND member_role IN ('host','player') AND joined_at<=?
    AND ${historical ? "(left_at IS NULL OR left_at>=?)" : "is_active=1"}`,
    historical ? [row.room_id,row.ended_at,row.ended_at] : [row.room_id,row.ended_at]);
  return rows.map(m=>({userId:String(m.user_id),role:String(m.member_role)}));
}

export async function archiveSoupRecord(db: DB, roundId: string, historical = false) {
  if (await exists(db,`soup:${roundId}`)) return;
  const [[row]] = await db.query<Row[]>(`SELECT r.*,s.title,s.cover_image,s.supplemental_bottoms,
    rooms.host_id FROM online_soup_rounds r JOIN soups s ON s.id=r.soup_id
    JOIN online_soup_rooms rooms ON rooms.id=r.room_id WHERE r.id=? AND r.status='ended'`,[roundId]);
  if (!row?.ended_at || !row.started_at) return;
  const [[honor]] = await db.query<Row[]>(`SELECT content,message_sequence FROM online_soup_messages
    WHERE round_id=? AND message_type='ai_honor' AND recalled_at IS NULL ORDER BY message_sequence DESC LIMIT 1`,[roundId]);
  const honors = parseOnlineSoupAiHonors(honor?.content);
  const snapshot = row.ai_soup_snapshot ? recordJson<{title?:string;supplementalBottoms?: string[]}>(row.ai_soup_snapshot) : null;
  const count = 1+(snapshot?.supplementalBottoms ?? recordJson<string[]>(row.supplemental_bottoms) ?? []).length;
  const published = new Set(recordJson<number[]>(row.published_bottom_indices) ?? []);
  if (!honors || !Array.from({length:count},(_,i)=>i).every(i=>published.has(i))) return;
  const participants = await recordParticipants(db,row,historical);
  if(historical) {
    const [completions] = await db.query<Row[]>("SELECT user_id FROM online_soup_completions WHERE round_id=?",[roundId]);
    for(const p of completions)if(!participants.some(u=>u.userId===String(p.user_id)))participants.push({userId:String(p.user_id),role:'player'});
  }
  const [[start]] = await db.query<Row[]>("SELECT title,host_id FROM game_record_starts WHERE source_id=?",[roundId]);
  // AI room owners are players; a real human host is shown as host.
  const users = participants.map(p=>({...p,role:row.host_mode==='ai'?'player':p.role}));
  await persist(db,'soup',row.communication_mode === 'voice' ? 'voice' : String(row.host_mode),row,
    {title:snapshot?.title ?? start?.title ?? row.title,coverUrl:publicOssUrl(row.cover_image),
      honors,startedAt:iso(row.started_at),hostId:start?.host_id ?? row.host_id},
    {messages:await messages(db,row,String(honor.message_sequence))},users);
}

export type ImpostorRecordAction = { kind:string; label:string; targets?:string[]; content?:string|null; attempt?:number };
export async function appendImpostorRecordStep(db: DB, id: string, state: ImpostorGameState,
  action?:ImpostorRecordAction & {userId:string;day:number}) {
  // The accepted input survives transitions that clear the deciding ballot or mission choice.
  await db.query("INSERT INTO game_record_impostor_steps(game_id,state_json) VALUES (?,?)",
    [id,JSON.stringify({...state,...(action?{recordAction:action}:{})})]);
}

export async function archiveImpostorRecord(db: DB, gameId: string, historical = false) {
  if (await exists(db,`impostor:${gameId}`)) return;
  const [[row]] = await db.query<Row[]>(`SELECT g.*,rooms.name FROM online_impostor_games g
    JOIN online_soup_rooms rooms ON rooms.id=g.room_id WHERE g.id=? AND g.status='ended'`,[gameId]);
  if (!row?.ended_at) return;
  const state = recordJson<ImpostorGameState>(row.state_json);
  if (!state || !['good','impostor'].includes(state.winner ?? '')) return;
  const [[last]] = await db.query<Row[]>(`SELECT MAX(message_sequence) AS seq FROM online_soup_messages
    WHERE room_id=? AND impostor_game_number=? AND JSON_UNQUOTE(JSON_EXTRACT(impostor_event_json,'$.kind'))='settlement'`,[row.room_id,row.game_number]);
  if (!last?.seq) return;
  const [names] = await db.query<Row[]>(`SELECT id,nickname FROM users WHERE id IN (${state.players.map(()=>'?').join(',')})`,state.players.map(p=>p.userId));
  const players = state.players.map(p=>({...p,nickname:names.find(n=>n.id===p.userId)?.nickname ?? '已注销用户'}));
  const users = (await recordParticipants(db,row,historical)).filter(p=>state.players.some(s=>s.userId===p.userId));
  const [steps] = await db.query<Row[]>("SELECT created_at,state_json FROM game_record_impostor_steps WHERE game_id=? ORDER BY id",[gameId]);
  await persist(db,'impostor','impostor',row,{title:row.name,players,winner:state.winner,startedAt:iso(row.started_at)},
    {messages:await messages(db,row,String(last.seq)),state,
      steps:steps.map(s=>({at:iso(s.created_at),state:recordJson(s.state_json)})),legacy:historical && !steps.length},users);
}

export async function archiveBattleRecord(db: DB, gameId: string, historical = false) {
  if (await exists(db,`card_battle:${gameId}`)) return;
  const [[row]] = await db.query<Row[]>(`SELECT g.*,rooms.name,rooms.card_battle_mode,
    c.challenger_id,c.defender_id,c.status AS challenge_status,c.target_rank,c.confirmed_at,c.consecutive_wins,
    (SELECT MAX(latest.game_number) FROM online_card_battles latest WHERE latest.room_id=g.room_id) AS latest_game_number
    FROM online_card_battles g JOIN online_soup_rooms rooms ON rooms.id=g.room_id
    LEFT JOIN card_battle_ranking_challenges c ON c.room_id=g.room_id WHERE g.id=? AND g.status='ended'`,[gameId]);
  if (!row?.ended_at || row.mode==='tower' || row.card_battle_mode==='tower') return;
  const players = recordJson<CardBattlePlayerInput[]>(row.lineup_snapshot_json);
  const result = recordJson<CardBattleResult>(row.result_json);
  if (!Array.isArray(players) || !result?.version) return;
  const subtype = row.challenger_id ? 'ranking' : row.mode==='boss' ? 'boss':'room';
  const participantIds = subtype==='boss' ? players.filter(p=>p.seat===1).map(p=>p.userId) : players.map(p=>p.userId);
  const [forfeits] = subtype==='boss' ? await db.query<Row[]>("SELECT user_id FROM card_battle_boss_participants WHERE game_id=? AND forfeited_at IS NOT NULL",[gameId]) : [[]];
  const users = participantIds.filter(id=>!forfeits.some(p=>p.user_id===id)).map(userId=>({userId,role:'player'}));
  await persist(db,'card_battle',subtype,row,{title:row.boss_name_snapshot ?? row.name,gameNumber:Number(row.game_number),
    players:players.map(p=>({userId:p.userId,nickname:p.nickname,seat:p.seat,playerSeat:p.playerSeat,
      power:p.cards.reduce((sum,c)=>sum+calculateCardBattlePower(applyBattleCollectibleStats(c.tier,c.collectible)),0)})),
    winnerSeat:result.winnerSeat,endReason:result.endReason,startedAt:iso(row.started_at)},
    {lineups:players,result},users);
  if(subtype==='ranking' && !historical) {
    await freezeBattleRecordRanks(db,gameId);
    const challenger = players.find(p=>p.userId===String(row.challenger_id));
    if(challenger?.seat===result.winnerSeat && Number(row.consecutive_wins ?? 0)>=2) await db.query("UPDATE game_record_users SET rank_state='pending' WHERE record_id=?",[`card_battle:${gameId}`]);
  }
  // Old current leaderboard positions are never substituted for historical ranks.
  if(subtype==='ranking' && historical && row.ranking_fallback_rank) await db.query(
    "UPDATE game_record_users SET final_rank=?,rank_state='known' WHERE record_id=? AND user_id=?",[row.ranking_fallback_rank,`card_battle:${gameId}`,row.challenger_id]);
  if(subtype==='ranking' && historical && row.challenge_status==='won' && row.confirmed_at
    && Number(row.game_number)===Number(row.latest_game_number)
    && players.find(p=>p.userId===String(row.challenger_id))?.seat===result.winnerSeat) {
    // Confirmation records the exact occupied rank for the last game in this challenge.
    await db.query("UPDATE game_record_users SET final_rank=?,rank_state='known' WHERE record_id=? AND user_id=?",
      [Number(row.target_rank),`card_battle:${gameId}`,row.challenger_id]);
    await db.query("UPDATE game_record_users SET final_rank=?,rank_state='known' WHERE record_id=? AND user_id=?",
      [Number(row.target_rank)<100?Number(row.target_rank)+1:null,`card_battle:${gameId}`,row.defender_id]);
  }
}

export async function freezeBattleRecordRanks(db: DB, gameId: string) {
  await db.query(`UPDATE game_record_users owners LEFT JOIN card_battle_ranking_entries ranks ON ranks.user_id=owners.user_id
    SET owners.final_rank=ranks.rank_position,owners.rank_state='known' WHERE owners.record_id=?`,[`card_battle:${gameId}`]);
}

export async function initGameRecords(pool: mysql.Pool) {
  await initGameRecordSchema(pool);
  const db = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await db.query<Row[]>("SELECT GET_LOCK('hgt:game-records-v1',60) AS acquired");
    if(Number(lock?.acquired)!==1) throw new Error('游戏记录迁移锁获取失败');
    locked=true;
    const [[done]] = await db.query<Row[]>("SELECT migration_key FROM app_data_migrations WHERE migration_key='game-records-v1'");
    if(done)return;
    for(const [table,archive] of [
      ['online_soup_rounds',archiveSoupRecord],['online_impostor_games',archiveImpostorRecord],['online_card_battles',archiveBattleRecord],
    ] as const) {
      let cursor='';
      while(true) {
        const [rows] = await db.query<Row[]>(`SELECT id FROM ${table} WHERE status='ended' AND id>? ORDER BY id LIMIT 100`,[cursor]);
        if(!rows.length)break;
        for(const row of rows) {
          await db.beginTransaction();
          try {await archive(db,String(row.id),true);await db.commit();}
          catch(error){await db.rollback();throw error;}
        }
        cursor=String(rows.at(-1)!.id);
      }
    }
    await db.query("INSERT INTO app_data_migrations(migration_key) VALUES ('game-records-v1')");
  } finally {
    if(locked)await db.query("SELECT RELEASE_LOCK('hgt:game-records-v1')");
    db.release();
  }
}
