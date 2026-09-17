// Loopback MySQL only. Application queries are redirected to disposable schema-only fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import express from "express";
import "express-async-errors";
import { config } from "../src/config.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "Loopback MySQL required");
const prefix = `rk_${process.pid}_${Date.now().toString(36)}_`;
const tables = ["asset_packs", "asset_pack_cards", "notifications", "users", "asset_cards", "asset_card_battle_tiers", "asset_card_battle_effects", "user_asset_cards", "collectibles", "user_card_battle_decks", "card_battle_ranking_entries", "card_battle_ranking_challenges", "online_soup_rooms", "online_soup_members", "online_card_battle_seats", "online_card_battles", "soups", "online_soup_rounds", "online_soup_messages", "mystery_stories", "mystery_runs", "online_soup_background_music"];
const db = await mysql.createConnection({ ...config.db, timezone: "Z" });
let pool: mysql.Pool | undefined;
let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
const created: string[] = [];
try {
  for (const table of tables) {
    await db.query(`CREATE TABLE \`${prefix}${table}\` LIKE \`${table}\``);
    created.push(prefix + table);
  }
  const fresh = ["game_records", "game_record_users", "game_record_impostor_steps", "game_record_starts"];
  tables.push(...fresh);
  created.push(...fresh.map(table => prefix + table));
  tables.push("card_battle_ranking_lock");
  await db.query(`CREATE TABLE \`${prefix}card_battle_ranking_lock\` (id TINYINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB`);
  created.push(prefix + "card_battle_ranking_lock");
  ({ pool } = await import("../src/db.js"));
  const rewrite = (sql: string) => sql.replace(new RegExp(`\\b(${tables.join("|")})\\b`, "g"), name => prefix + name);
  const query = pool.query.bind(pool);
  pool.query = ((sql: string, values?: unknown) => query(rewrite(sql), values as any)) as typeof pool.query;
  const lease = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const connection = await lease();
    return new Proxy(connection, { get(target, key) {
      if (key === "query") return (sql: string, values?: unknown) => target.query(rewrite(sql), values as any);
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  await (await import("../src/gameRecords.js")).initGameRecordSchema(pool);
  const migration = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
  const ensure = async (table: string, name: string, definition: string) => {
    const [columns] = await pool!.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, [name]);
    if (!columns.length) await pool!.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  };
  for (const match of migration.matchAll(/ensureColumn\("([a-z_]+)", "([a-z_]+)", "([^"]+)"\)/g)) {
    if (tables.includes(match[1])) await ensure(match[1], match[2], match[3]);
  }
  for (const table of ["online_card_battle_seats", "user_card_battle_decks", "card_battle_ranking_entries"]) await ensure(table, "collectible_bindings_json", "collectible_bindings_json JSON NULL");
  await ensure("user_card_battle_decks", "mode", "mode ENUM('1v1','boss') NOT NULL DEFAULT '1v1'");
  await ensure("online_soup_rooms", "card_battle_mode", "card_battle_mode ENUM('1v1','boss') NOT NULL DEFAULT '1v1'");
  await pool.query("INSERT INTO card_battle_ranking_lock VALUES (1)");
  for (let i = 0; i < 115; i++) await pool.query("INSERT INTO users (id,username,password,nickname,role) VALUES (?,?,'unused',?,'user')", [`u${i}`,`rk-u${i}`,`测试${i}`]);
  const cardIds = [1,2,3,4,5].map(i => `card${i}`);
  for (const [index, id] of cardIds.entries()) {
    await pool.query("INSERT INTO asset_cards (id,card_no,name,rarity,image_url,battle_role,status) VALUES (?,?,?,'epic','/fixture','damage','active')", [id,`${index+1}`,`测试卡${index+1}`]);
    await pool.query("INSERT INTO asset_card_battle_tiers (card_id,star_level,max_hp,attack_value,defense_value,speed_value,energy_required) VALUES (?,0,100,10,10,100,40)", [id]);
    for (let i = 0; i < 115; i++) await pool.query("INSERT INTO user_asset_cards (user_id,card_id,star_level) VALUES (?,?,0)", [`u${i}`,id]);
  }
  const ranking = await import("../src/cardBattleRanking.js");
  const { reconcileCardBattleRanking } = await import("../src/cardBattleRankingState.js");
  const room = await import("../src/cardBattleRoom.js");
  const { simulateCardBattle } = await import("../src/cardBattle.js");
  const { default: router, setOnlineSoupEventEmitter } = await import("../src/onlineSoup.js");
  const events: Array<{roomId: string; payload: any}> = [];
  setOnlineSoupEventEmitter((roomId, _event, payload) => events.push({roomId,payload}));
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.header("x-fixture-user"); (req as any).user = id ? {id,role:'user'} : null; next(); });
  app.use("/api/online-soup", router);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({error:error.message}));
  server = app.listen(0,"127.0.0.1"); await new Promise<void>(resolve => server!.once("listening",resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}/api/online-soup`;
  async function post(path: string, body: unknown, expected=201, user="u0") {
    const response = await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(user?{'x-fixture-user':user}:{})},body:JSON.stringify(body)});
    const json:any = await response.json(); assert.equal(response.status,expected,JSON.stringify(json)); return json;
  }
  const board = async () => (await pool!.query<mysql.RowDataPacket[]>("SELECT rank_position,user_id,lineup_json,achieved_at FROM card_battle_ranking_entries ORDER BY rank_position"))[0];
  const insert = async (rank: number,userId: string) => pool!.query("INSERT INTO card_battle_ranking_entries (rank_position,user_id,lineup_json,total_power) VALUES (?,?,?,500)",[rank,userId,JSON.stringify(cardIds)]);
  for (const rank of [1,2,3,5,8]) await insert(rank,`u${rank}`);
  const before = await board();
  await reconcileCardBattleRanking(); await reconcileCardBattleRanking();
  assert.deepEqual((await board()).map(row=>[row.rank_position,row.user_id]),[[1,'u1'],[2,'u2'],[3,'u3'],[4,'u5'],[5,'u8']]);
  assert.equal(new Date((await board())[4].achieved_at).getTime(),new Date(before[4].achieved_at).getTime());
  const {deck} = await post('/card-battle/decks',{name:'默认卡组',cardIds});
  await post('/card-battle/decks',{name:'未登录',cardIds},401,'');
  await post('/card-battle/decks',{name:'重复',cardIds:Array(5).fill(cardIds[0])},409);
  await post('/card-battle/decks',{name:'未拥有',cardIds:[...cardIds.slice(0,4),'unknown']},409);
  const claimed = await post('/card-battle-rankings/100/claim',{deckId:deck.id});
  assert.equal(claimed.entry.rank,6);
  const decks = new Map<string,string>([['u0',deck.id]]);
  async function deckFor(user: string) { if (!decks.has(user)) decks.set(user,(await room.createSavedCardBattleDeck(user,'默认卡组',cardIds)).id); return decks.get(user)!; }
  let sequence = 0;
  async function battle(user: string, winner: 1|2|null, endReason='elimination', state='playing', targetRank=1) {
    const challenge = await ranking.createCardBattleRankingChallenge(user,targetRank,await deckFor(user));
    const defender = String((await board()).find(row => row.rank_position === targetRank)!.user_id);
    const inputs = [await room.buildCardBattlePlayerInput(user,user,1,cardIds,pool!),await room.buildCardBattlePlayerInput(defender,'守榜',2,cardIds,pool!)];
    const result = {...simulateCardBattle(inputs,`fixture-${sequence}`),winnerSeat:winner,endReason};
    const gameId = `game${++sequence}`;
    await pool!.query("INSERT INTO online_card_battles (id,room_id,game_number,status,random_seed,lineup_snapshot_json,result_json,started_at,playback_ends_at) VALUES (?,?,1,?,'fixture',?,?,NOW(3)-INTERVAL 1 DAY,NOW(3)-INTERVAL 1 SECOND)",[gameId,challenge.roomId,state,JSON.stringify(inputs),JSON.stringify(result)]);
    await pool!.query("UPDATE online_soup_rooms SET status='playing' WHERE id=?",[challenge.roomId]);
    return {...challenge,gameId};
  }
  const gamesOf = async (roomId: string) => (await pool!.query<mysql.RowDataPacket[]>("SELECT * FROM online_card_battles WHERE room_id=? ORDER BY game_number", [roomId]))[0];
  const winsOf = async (roomId: string) => Number((await pool!.query<mysql.RowDataPacket[]>("SELECT consecutive_wins FROM card_battle_ranking_challenges WHERE room_id=?", [roomId]))[0][0]!.consecutive_wins);
  async function finishSecond(roomId: string, winner: 1|2|null = 1) {
    const games = await gamesOf(roomId); const last = games.at(-1)!;
    assert.equal(last.status, 'playing');
    const result = typeof last.result_json === 'string' ? JSON.parse(last.result_json) : last.result_json;
    result.winnerSeat = winner; result.endReason = winner ? 'elimination' : 'round_limit';
    await pool!.query("UPDATE online_card_battles SET result_json=?,started_at=NOW(3)-INTERVAL 1 DAY,playback_ends_at=NOW(3)-INTERVAL 1 SECOND WHERE id=?", [JSON.stringify(result),last.id]);
    await room.finalizeCardBattleIfDue(roomId);
  }
  const defeated = await battle('u7',2);
  // Editing the saved deck/seats after the battle must not change the fallback lineup.
  await pool.query("UPDATE online_card_battle_seats SET lineup_json=JSON_ARRAY() WHERE room_id=? AND user_id='u7'",[defeated.roomId]);
  assert.equal(await room.finalizeCardBattleIfDue(defeated.roomId),true);
  assert.equal(await room.finalizeCardBattleIfDue(defeated.roomId),false);
  assert.equal(await ranking.cardBattleRankingOwnRank('u7'),7);
  const savedLineup = (await board())[6].lineup_json;
  assert.deepEqual(typeof savedLineup === 'string' ? JSON.parse(savedLineup) : savedLineup,cardIds);
  const [[fallback]] = await pool.query<mysql.RowDataPacket[]>("SELECT ranking_fallback_rank FROM online_card_battles WHERE id=?",[defeated.gameId]);
  assert.equal(fallback.ranking_fallback_rank,7);
  const rankedLoss = await battle('u3',2); await room.finalizeCardBattleIfDue(rankedLoss.roomId);
  assert.equal(await ranking.cardBattleRankingOwnRank('u3'),3);
  for (const [user,winner,reason,status] of [['u9',null,'round_limit','playing'],['u10',2,'surrender','playing'],['u11',2,'elimination','aborted']] as const) {
    const game = await battle(user,winner,reason,status); await room.finalizeCardBattleIfDue(game.roomId);
    assert.equal(await ranking.cardBattleRankingOwnRank(user),null);
  }
  const won = await battle('u4',1); await room.finalizeCardBattleIfDue(won.roomId);
  assert.equal(await ranking.cardBattleRankingOwnRank('u4'),null);
  assert.equal(await winsOf(won.roomId),1);
  await assert.rejects(ranking.confirmCardBattleRankingWin(won.roomId,'u4'),/连续赢两局/);
  const roundGames = await gamesOf(won.roomId);
  assert.equal(roundGames.length,2);
  assert.equal(roundGames[1]!.status,'playing');
  const json = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
  assert.deepEqual(json(roundGames[1]!.lineup_snapshot_json),json(roundGames[0]!.lineup_snapshot_json));
  assert.notEqual(roundGames[1]!.random_seed,roundGames[0]!.random_seed);
  assert.equal(new Date(roundGames[1]!.started_at).getTime(),new Date(roundGames[0]!.playback_ends_at).getTime());
  assert.ok(json(roundGames[1]!.result_json).initialStates.every((card:any)=>card.hp===card.maxHp && card.energy===0));
  const [firstRecords] = await pool.query<mysql.RowDataPacket[]>("SELECT rank_state FROM game_record_users WHERE record_id=?",['card_battle:'+won.gameId]);
  assert.ok(firstRecords.length===2 && firstRecords.every(row=>row.rank_state==='known'));
  await finishSecond(won.roomId);
  assert.equal(await winsOf(won.roomId),2);
  const completedConnection = await pool.getConnection();
  try {
    await completedConnection.beginTransaction();
    await completedConnection.query("UPDATE online_card_battle_seats SET is_ready=1 WHERE room_id=?",[won.roomId]);
    await assert.rejects(room.startCardBattle(won.roomId,'u4',completedConnection),/已达成两连胜/);
    await completedConnection.rollback();
  } finally { completedConnection.release(); }
  assert.equal((await ranking.confirmCardBattleRankingWin(won.roomId,'u4')).rank,1);
  assert.deepEqual((await board()).map(row=>row.rank_position),[1,2,3,4,5,6,7,8]);
  const secondLoss = await battle('u19',1);
  await Promise.all([room.finalizeCardBattleIfDue(secondLoss.roomId),room.finalizeCardBattleIfDue(secondLoss.roomId)]);
  assert.equal((await gamesOf(secondLoss.roomId)).length,2,'并发结算仅自动创建一局');
  await finishSecond(secondLoss.roomId,2);
  assert.equal(await winsOf(secondLoss.roomId),0);
  assert.equal((await gamesOf(secondLoss.roomId)).length,2,'第二局失败不自动第三局');
  assert.ok(await ranking.cardBattleRankingOwnRank('u19'),'第二局正常失败仍为未上榜用户补位');
  await assert.rejects(ranking.confirmCardBattleRankingWin(secondLoss.roomId,'u19'),/连续赢两局/);
  const retryConnection = await pool.getConnection();
  try {
    await retryConnection.beginTransaction();
    await retryConnection.query("UPDATE online_card_battle_seats SET is_ready=1 WHERE room_id=?",[secondLoss.roomId]);
    await room.startCardBattle(secondLoss.roomId,'u19',retryConnection);
    await retryConnection.commit();
  } finally { retryConnection.release(); }
  assert.equal(await winsOf(secondLoss.roomId),0,'重新挑战从零开始');
  await finishSecond(secondLoss.roomId,1);
  assert.equal(await winsOf(secondLoss.roomId),1,'上次挑战首胜不带入新挑战');
  assert.equal((await gamesOf(secondLoss.roomId)).length,4);
  const secondDraw = await battle('u26',1); await room.finalizeCardBattleIfDue(secondDraw.roomId); await finishSecond(secondDraw.roomId,null);
  assert.equal(await winsOf(secondDraw.roomId),0); assert.equal((await gamesOf(secondDraw.roomId)).length,2);
  assert.equal(await ranking.cardBattleRankingOwnRank('u26'),null,'平局不补位');
  // Multiple writers cannot produce duplicate users/ranks, even from an empty board.
  await pool.query("DELETE FROM card_battle_ranking_entries");
  await Promise.all([20,21,22,23,24,25].map(async i => ranking.claimEmptyCardBattleRank(`u${i}`,100,await deckFor(`u${i}`))));
  assert.deepEqual((await board()).map(row=>row.rank_position),[1,2,3,4,5,6]);
  // Restore defender first and fill all 100 positions: a loss cannot displace anyone.
  await pool.query("DELETE FROM card_battle_ranking_entries");
  for (let i=1;i<=100;i++) await insert(i,`u${i}`);
  const full = await battle('u101',2); await room.finalizeCardBattleIfDue(full.roomId);
  assert.equal(await ranking.cardBattleRankingOwnRank('u101'),null);
  assert.equal((await board()).length,100);
  const [[fullGame]] = await pool.query<mysql.RowDataPacket[]>("SELECT ranking_fallback_full FROM online_card_battles WHERE id=?",[full.gameId]);
  assert.equal(fullGame.ranking_fallback_full,1);
  // Several challenges can coexist. Confirmation invalidates the winner's other rooms
  // and changed target positions atomically, without closing them before acknowledgment.
  await pool.query("DELETE FROM card_battle_ranking_entries");
  for (const [index,user] of ['u1','u2','u3','u5','u8'].entries()) await insert(index+1,user);
  const winning = await battle('u12',1,'elimination','playing',3);
  const sameUser = await battle('u12',2);
  const preparing = await ranking.createCardBattleRankingChallenge('u12',2,await deckFor('u12'));
  const sameTarget = await battle('u13',1,'elimination','playing',3);
  const shiftedTarget = await battle('u15',2,'elimination','playing',4);
  const unaffected = await battle('u14',1);
  await room.finalizeCardBattleIfDue(winning.roomId);
  await finishSecond(winning.roomId);
  assert.equal((await post(`/rooms/${winning.roomId}/card-battle/ranking/confirm-win`,{},200,'u12')).rank,3);
  const stateOf = async (roomId: string) => (await pool!.query<mysql.RowDataPacket[]>(
    `SELECT challenges.status AS challenge_status, rooms.status AS room_status,
      members.is_active, games.status AS game_status
     FROM card_battle_ranking_challenges challenges
     JOIN online_soup_rooms rooms ON rooms.id=challenges.room_id
     JOIN online_soup_members members ON members.room_id=rooms.id AND members.user_id=challenges.challenger_id
     LEFT JOIN online_card_battles games ON games.room_id=rooms.id WHERE rooms.id=?`,[roomId]))[0][0];
  for (const affected of [sameUser,preparing,sameTarget,shiftedTarget]) {
    const state = await stateOf(affected.roomId);
    assert.equal(state.challenge_status,'stale'); assert.equal(state.room_status,'ended'); assert.equal(state.is_active,1);
    if ('gameId' in affected) assert.equal(state.game_status,'aborted');
    assert.ok(events.some(event => event.roomId===affected.roomId && event.payload.reason==='card_battle_ranking_changed'));
    assert.equal(await room.finalizeCardBattleIfDue(affected.roomId),false);
  }
  assert.equal((await stateOf(unaffected.roomId)).challenge_status,'active');
  assert.equal((await stateOf(unaffected.roomId)).game_status,'playing');
  assert.equal(await ranking.cardBattleRankingOwnRank('u15'),null,'Canceled losses must not auto-occupy a rank');
  const refreshed = await room.cardBattleClientState(sameTarget.roomId,'u13');
  assert.equal(refreshed.rankingChallenge?.status,'stale'); assert.equal(refreshed.phase,'aborted'); assert.equal(refreshed.game?.settlement,null);
  const staleError = (error: unknown) => error instanceof Error && 'code' in error && error.code==='RANK_CHANGED';
  await assert.rejects(ranking.confirmCardBattleRankingWin(sameTarget.roomId,'u13'),staleError);
  await post(`/rooms/${sameTarget.roomId}/card-battle/ready`,{ready:true},409,'u13');
  const staleConnection = await pool.getConnection();
  try {
    await staleConnection.beginTransaction();
    await assert.rejects(room.startCardBattle(sameTarget.roomId,'u13',staleConnection),staleError);
    await assert.rejects(room.saveCardBattleLineup(sameTarget.roomId,'u13',cardIds,staleConnection),staleError);
    await staleConnection.rollback();
  } finally { staleConnection.release(); }
  const ackPath = `/rooms/${sameTarget.roomId}/card-battle/ranking/acknowledge-change`;
  await post(ackPath,{},401,''); await post(ackPath,{},409,'u14');
  assert.equal((await stateOf(sameTarget.roomId)).room_status,'ended');
  await post(ackPath,{},200,'u13'); await post(ackPath,{},200,'u13');
  assert.equal((await stateOf(sameTarget.roomId)).room_status,'closed');
  assert.equal((await stateOf(sameTarget.roomId)).is_active,0);
  await post(`/rooms/${preparing.roomId}/leave`,{},200,'u12');
  assert.equal((await stateOf(preparing.roomId)).room_status,'closed');
  await ranking.createCardBattleRankingChallenge('u12',1,await deckFor('u12'));
  // Simultaneous wins, both from the same user and from competing users, serialize.
  // The losing confirmation must not overwrite the first committed board.
  for (const users of [['u16','u16'],['u17','u18']]) {
    for (const user of new Set(users)) await deckFor(user);
    const games = await Promise.all(users.map(user => battle(user,1)));
    await Promise.all(games.map(game => room.finalizeCardBattleIfDue(game.roomId)));
    await Promise.all(games.map(game => finishSecond(game.roomId)));
    const results = await Promise.allSettled(games.map((game,index) => ranking.confirmCardBattleRankingWin(game.roomId,users[index])));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    const rejection = results.find(result=>result.status==='rejected') as PromiseRejectedResult;
    assert.ok(staleError(rejection.reason));
    const rows = await board();
    assert.equal(new Set(rows.map(row=>row.user_id)).size,rows.length);
    assert.deepEqual(rows.map(row=>row.rank_position),rows.map((_row,index)=>index+1));
  }
  console.log('PASS: ranking gaps, default decks, fallback boundaries, parallel rooms, atomic invalidation/events, refresh persistence, acknowledgment ownership/idempotency, stale-room rejection and concurrent wins.');
} finally {
  await new Promise<void>(resolve => server ? server.close(()=>resolve()) : resolve());
  await pool?.end();
  for (const name of created.reverse()) { assert.ok(name.startsWith(prefix)); await db.query(`DROP TABLE \`${name}\``); }
  await db.end();
}
