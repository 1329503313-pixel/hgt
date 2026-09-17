// Disposable prefixed tables in loopback MySQL only; never initializes or changes application data.
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import express from 'express';
import { config } from '../src/config.js';
import { initGameRecordSchema, initGameRecords, archiveSoupRecord, archiveImpostorRecord, archiveBattleRecord, appendImpostorRecordStep, startGameRecord, freezeBattleRecordRanks, recallGameRecordMessage } from '../src/gameRecords.js';
import { createImpostorGame } from '../src/impostorGame.js';
import { simulateCardBattle, type CardBattlePlayerInput } from '../src/cardBattle.js';
import { registerGameRecordRoutes } from '../src/gameRecordRoutes.js';

assert.ok(['localhost','127.0.0.1','::1'].includes(config.db.host),'Loopback database required');
const prefix=`gr_${process.pid}_${Date.now().toString(36)}_`;
const source=['users','soups','online_soup_rooms','online_soup_rounds','online_soup_members','online_soup_completions','online_soup_messages','sticker_products','online_impostor_games','online_card_battles','card_battle_boss_participants','card_battle_ranking_challenges','card_battle_ranking_entries','app_data_migrations'];
const fresh=['game_records','game_record_users','game_record_impostor_steps','game_record_starts'];
const raw=mysql.createPool({...config.db,timezone:'Z'});
const created:string[]=[];
let server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
const tokens=new RegExp(`\\b(${[...source,...fresh].join('|')})\\b`,'g');
const rewrite=(sql:string)=>sql.replace(tokens,name=>prefix+name);
const db=new Proxy(raw,{get(target,key){if(key==='query')return(sql:string,values?:unknown)=>target.query(rewrite(sql),values as any);if(key==='getConnection')return async()=>{const connection=await raw.getConnection();return new Proxy(connection,{get(target,key){if(key==='query')return(sql:string,values?:unknown)=>target.query(rewrite(sql),values as any);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
try {
  for(const table of source){await raw.query(`CREATE TABLE ${prefix}${table} LIKE ${table}`);created.push(prefix+table);}
  const [winColumn]=await db.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM card_battle_ranking_challenges LIKE 'consecutive_wins'");
  if(!winColumn.length)await db.query("ALTER TABLE card_battle_ranking_challenges ADD COLUMN consecutive_wins TINYINT UNSIGNED NOT NULL DEFAULT 0");
  created.push(...fresh.map(table=>prefix+table));await initGameRecordSchema(db);
  for(const id of ['host','stay','late','left','watch','outsider'])await db.query("INSERT INTO users(id,username,password,nickname,role) VALUES(?,?,'unused',?,'user')",[id,id,id]);
  await db.query("INSERT INTO soups(id,title,author,type,surface,bottom,creator_id,creator_name,supplemental_bottoms) VALUES('s','测试汤','host','本格清汤','汤面','汤底','host','host','[]')");
  await db.query("INSERT INTO online_soup_rooms(id,room_code,name,host_id,status,current_soup_id) VALUES('r','GR1234','测试房','host','ended','s')");
  for(const [id,role,join,left] of [['host','host','09:00:00',null],['stay','player','09:00:00',null],['late','player','10:30:00',null],['left','player','09:00:00','10:40:00'],['watch','spectator','09:00:00',null]]) {
    await db.query("INSERT INTO online_soup_members(room_id,user_id,member_role,is_active,joined_at,left_at) VALUES('r',?,?,?,?,?)",[id,role,left?0:1,`2026-09-01 ${join}`,left?`2026-09-01 ${left}`:null]);
  }
  const honors={version:1,mvp:{userId:'stay',nickname:'stay',avatar:null,progressContribution:0},bestQuestion:{messageId:'q',questionNumber:1,userId:'stay',nickname:'stay',avatar:null,question:'问题',answer:'yes',progressDelta:0}};
  async function round(id:string,number:number,honor=true,published='[0]') {
    await db.query("INSERT INTO online_soup_rounds(id,room_id,soup_id,round_number,status,published_bottom_indices,started_at,ended_at) VALUES(?,'r','s',?,'ended',?,'2026-09-01 10:00:00','2026-09-01 11:00:00')",[id,number,published]);
    await startGameRecord(db,id,'r');
    for(let i=0;i<105;i++)await db.query("INSERT INTO online_soup_messages(id,room_id,round_id,sender_id,message_type,content,created_at) VALUES(?,'r',?,'stay','discussion',?,'2026-09-01 10:01:00')",[`${id}-m${i}`,id,`第${i}条消息`]);
    if(honor)await db.query("INSERT INTO online_soup_messages(id,room_id,round_id,message_type,content,created_at) VALUES(?,'r',?,'ai_honor',?,'2026-09-01 11:00:00')",[`${id}-honor`,id,JSON.stringify(honors)]);
    await archiveSoupRecord(db,id);
  }
  await round('one',1);
  await archiveSoupRecord(db,'one');
  await round('incomplete',2,true,'[]');await round('no-honor',3,false);
  const [[count]]=await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM game_records");assert.equal(Number(count.n),1);
  const [owners]=await db.query<mysql.RowDataPacket[]>("SELECT user_id FROM game_record_users WHERE record_id='soup:one' ORDER BY user_id");
  assert.deepEqual(owners.map(x=>x.user_id),['host','late','stay']);
  await db.query("UPDATE online_soup_members SET is_active=0,left_at='2026-09-02 12:00:00' WHERE room_id='r'");
  await archiveSoupRecord(db,'one');
  const [[preserved]]=await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM game_record_users WHERE record_id='soup:one'");assert.equal(Number(preserved.n),3);
  console.log('PASS soup: completion gate, late join, early departure, spectator exclusion, immutable ownership, idempotency');

  const state=createImpostorGame(['host','stay','late','left'],1,new Date('2026-09-01T10:00:00Z'),()=>0);
  state.phase='ended';state.winner='good';state.endReason='好人获胜';
  await db.query("INSERT INTO online_impostor_games(id,room_id,game_number,status,state_json,started_at,ended_at) VALUES('i','r',1,'ended',?,'2026-09-01 10:00:00','2026-09-01 11:00:00')",[JSON.stringify(state)]);
  await db.query("INSERT INTO online_soup_messages(id,room_id,message_type,content,impostor_game_number,impostor_event_json,created_at) VALUES('i-end','r','system','好人胜利',1,?, '2026-09-01 11:00:00')",[JSON.stringify({kind:'settlement'})]);
  await appendImpostorRecordStep(db,'i',state);await archiveImpostorRecord(db,'i',true);
  const [[imp]]=await db.query<mysql.RowDataPacket[]>("SELECT detail_json FROM game_records WHERE id='impostor:i'");
  const impDetail=typeof imp.detail_json==='string'?JSON.parse(imp.detail_json):imp.detail_json;
  assert.equal(impDetail.state.players.filter((p:any)=>p.role==='impostor').length,1);
  assert.equal(impDetail.steps.length,1);
  console.log('PASS impostor: ended-only archive and full roles/state');

  const players:CardBattlePlayerInput[]=[1,2].map(seat=>({userId:seat===1?'stay':'outsider',nickname:seat===1?'我方':'对方',seat:seat as 1|2,cards:[1,2,3,4,5].map(slot=>({cardId:`${seat}-${slot}`,instanceId:`${seat}-${slot}`,slot:slot as 1|2|3|4|5,name:`卡${slot}`,rarity:'epic' as const,starLevel:0,imageUrl:'',tier:{starLevel:0,maxHp:100,attack:100,defense:10,speed:seat===1?100:50,energyRequired:100,canAttackRear:false,critRate:0,critDamage:150,skillName:'',skillDescription:'',effects:[]}}))}));
  const result=simulateCardBattle(players,'game-record-test');
  await db.query("INSERT INTO card_battle_ranking_challenges(id,room_id,challenger_id,defender_id,target_rank,defender_lineup_json,defender_snapshot_json,consecutive_wins) VALUES('c','r','stay','outsider',5,'[]','[]',2)");
  await db.query("INSERT INTO online_card_battles(id,room_id,game_number,status,random_seed,lineup_snapshot_json,result_json,started_at,playback_ends_at,ended_at) VALUES('b','r',1,'ended','test',?,?,'2026-09-01 10:00:00','2026-09-01 11:00:00','2026-09-01 11:00:00')",[JSON.stringify(players),JSON.stringify(result)]);
  await archiveBattleRecord(db,'b');
  await db.query("INSERT INTO card_battle_ranking_entries(rank_position,user_id,lineup_json,total_power) VALUES(5,'stay','[]',100),(6,'outsider','[]',100)");
  await freezeBattleRecordRanks(db,'b');
  await db.query("UPDATE card_battle_ranking_entries SET rank_position=7 WHERE user_id='outsider'");
  const [[rank]]=await db.query<mysql.RowDataPacket[]>("SELECT final_rank FROM game_record_users WHERE record_id='card_battle:b' AND user_id='outsider'");assert.equal(rank.final_rank,6);
  console.log('PASS ranking: defender included, frozen lineup power and final ranks');

  const app=express();app.use((req,_res,next)=>{(req as any).user=req.headers['x-user']?{id:String(req.headers['x-user'])}:null;next();});
  const router=express.Router();registerGameRecordRoutes(router,db);app.use(router);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));
  const address=server.address() as {port:number};
  const get=(path:string,user='stay')=>fetch(`http://127.0.0.1:${address.port}${path}`,{headers:user?{'x-user':user}:{}});
  assert.equal((await get('/game-records','')).status,401);
  assert.equal((await get('/game-records/soup%3Aone','watch')).status,404);
  assert.equal((await get('/game-records/soup%3Aone','left')).status,404);
  const first=await(await get('/game-records/soup%3Aone')).json();assert.equal(first.messages.length,100);assert.equal(first.hasMore,true);
  const rest=await(await get(`/game-records/soup%3Aone?after=${first.nextCursor}`)).json();assert.equal(rest.messages.length,6);assert.equal(rest.hasMore,false);
  assert.equal(rest.messages.at(-1).type,'ai_honor');
  for(let i=0;i<12;i++)await db.query("INSERT INTO game_records SELECT ?,kind,subtype,?,room_id,ended_at,summary_json,detail_json FROM game_records WHERE id='soup:one'",[`soup:copy${i}`,`copy${i}`]);
  await db.query("INSERT INTO game_record_users SELECT id,'stay','player',NULL,'unknown',ended_at FROM game_records WHERE id LIKE 'soup:copy%'");
  const page1=await(await get('/game-records?kind=soup')).json();const page2=await(await get('/game-records?kind=soup&page=2')).json();
  assert.equal(page1.records.length,10);assert.equal(page2.records.length,3);assert.equal(new Set([...page1.records,...page2.records].map((r:any)=>r.id)).size,13);
  const replay=await(await get('/game-records/card_battle%3Ab','outsider')).json();assert.ok(replay.replay.result.events.length);assert.equal(replay.replay.lineups.length,2);
  assert.equal((await get('/game-records/card_battle%3Ab','watch')).status,404);
  console.log('PASS API: owner authorization, ten-row pagination, complete conversation paging and defender replay');

  await db.query("UPDATE online_soup_messages SET recalled_at=NOW(),content='' WHERE id='one-m0'");
  const concurrentRecall=await(await get('/game-records/soup%3Aone')).json();assert.equal(concurrentRecall.messages[0].content,'消息已撤回');
  await recallGameRecordMessage(db,'r','one-m0');
  await db.query("DELETE FROM online_soup_messages WHERE id='one-m0'");
  const deletedRecall=await(await get('/game-records/soup%3Aone')).json();assert.equal(deletedRecall.messages[0].recalled,true);

  await db.query("UPDATE online_soup_members SET left_at='2026-09-01 10:40:00' WHERE user_id='left'");
  await db.query("UPDATE online_soup_members SET joined_at='2026-09-02 09:00:00' WHERE user_id='late'");
  await db.query("INSERT INTO online_soup_rounds(id,room_id,soup_id,round_number,status,host_mode,published_bottom_indices,ai_soup_snapshot,started_at,ended_at) VALUES('legacy-ai','r','s',4,'ended','ai','[0]',?, '2026-09-01 12:00:00','2026-09-01 13:00:00')",[JSON.stringify({supplementalBottoms:[]})]);
  await db.query("INSERT INTO online_soup_messages(id,room_id,round_id,message_type,content,created_at) VALUES('old-start','r','legacy-ai','system','新一轮推理开始','2026-09-01 12:00:00'),('old-end','r','legacy-ai','ai_honor',?,'2026-09-01 13:00:00')",[JSON.stringify(honors)]);
  await db.query("INSERT INTO online_soup_completions(round_id,user_id,soup_id) VALUES('legacy-ai','late','s')");
  await db.query("INSERT INTO online_card_battles(id,room_id,game_number,status,random_seed,lineup_snapshot_json,result_json,started_at,playback_ends_at,ended_at) VALUES('aborted','r',2,'aborted','seed',?,?,'2026-09-01 14:00:00','2026-09-01 15:00:00','2026-09-01 15:00:00')",[JSON.stringify(players),JSON.stringify(result)]);
  await initGameRecords(db);await initGameRecords(db);
  const legacy=await(await get('/game-records/soup%3Alegacy-ai','late')).json();assert.equal(legacy.record.subtype,'ai');assert.equal(legacy.record.role,'player');assert.deepEqual(legacy.messages.map((m:any)=>m.id),['old-start','old-end']);
  assert.equal((await get('/game-records/soup%3Alegacy-ai','left')).status,404);
  assert.equal((await get('/game-records/card_battle%3Aaborted')).status,404);
  const [[markers]]=await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM app_data_migrations WHERE migration_key='game-records-v1'");assert.equal(Number(markers.n),1);
  console.log('PASS backfill: repeatable migration, AI player role, proven past participation, exact round messages, aborted exclusion and recall persistence');
} finally {
  if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  for(const table of created.reverse()){assert.ok(table.startsWith(prefix));await raw.query(`DROP TABLE IF EXISTS ${table}`);}
  await raw.end();
  const {pool}=await import('../src/db.js');await pool.end();
}
