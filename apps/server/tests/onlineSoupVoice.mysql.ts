// Uses schema-only copies in loopback MySQL. All application queries target disposable prefixed tables.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import express from "express";
import "express-async-errors";
import { config } from "../src/config.js";
import { canViewOnlineSoupMessage, initOnlineSoupHistory, initOnlineSoupHistorySchema } from "../src/onlineSoupHistory.js";

assert.ok(["localhost", "127.0.0.1", "::1"].includes(config.db.host), "Loopback MySQL required");
const prefix = `vr_${process.pid}_${Date.now().toString(36)}_`;
assert.match(prefix, /^vr_\d+_[a-z0-9]+_$/);
const admin = await mysql.createConnection({ ...config.db, timezone: "Z" });
let pool: mysql.Pool | undefined;
let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
const created = new Set<string>();
try {
  const [source] = await admin.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [config.db.database]
  );
  const newTables = ["online_soup_voice_sessions","online_soup_round_history", "online_soup_round_viewers", "game_records", "game_record_users", "game_record_impostor_steps", "game_record_starts"];
  const sourceNames = source.map(row => String(row.TABLE_NAME)).filter(name => !/^(bt_|rh_|vr_)/.test(name) && !newTables.includes(name));
  const names = [...sourceNames, ...newTables];
  for (const name of names) { assert.match(name, /^[a-zA-Z0-9_]+$/); assert.ok((prefix + name).length <= 64); }
  for (const name of sourceNames) {
    await admin.query(`CREATE TABLE \`${prefix}${name}\` LIKE \`${name}\``);
    created.add(prefix + name);
  }
  ({ pool } = await import("../src/db.js"));
  const tokens = new RegExp(`\\b(${names.join("|")}|fk_[a-zA-Z0-9_]+)\\b`, "g");
  const rewrite = (sql: string) => sql.replace(tokens, name => prefix + name);
  const query = pool.query.bind(pool);
  pool.query = ((sql: string, values?: unknown) => query(rewrite(sql), values as any)) as typeof pool.query;
  const lease = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const connection = await lease();
    return new Proxy(connection, { get(target, key) {
      if (key === "query") return (sql: string, values?: unknown) => target.query(rewrite(sql), values as any);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  for (const name of newTables) created.add(prefix + name);
  await initOnlineSoupHistorySchema(pool);
  const { initGameRecordSchema } = await import('../src/gameRecords.js');
  await initGameRecordSchema(pool);
  for (const table of ["online_soup_rooms", "online_soup_rounds"]) {
    const [cols] = await pool.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE 'communication_mode'`);
    if (!cols.length) await pool.query(`ALTER TABLE ${table} ADD communication_mode ENUM('text','voice') NOT NULL DEFAULT 'text'`);
  }
  const [cols] = await pool.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM online_soup_members LIKE 'voice_seat'");
  if (!cols.length) await pool.query("ALTER TABLE online_soup_members ADD voice_seat TINYINT UNSIGNED NULL");
  await pool.query(`CREATE TABLE online_soup_voice_sessions (id VARCHAR(64) PRIMARY KEY,user_id VARCHAR(64),room_id VARCHAR(64),rtc_user_id VARCHAR(32),can_publish BOOLEAN,revoked BOOLEAN DEFAULT 0,ticket_expires_at DATETIME(3),last_seen_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3))`);
  const { Client } = await import("tencentcloud-sdk-nodejs-trtc/tencentcloud/services/trtc/v20190722/trtc_client.js");
  const removed: string[] = [];
  Client.prototype.RemoveUserByStrRoomId = async (req) => { removed.push(...req.UserIds); return { RequestId: "offline" }; };
  const { default: router } = await import("../src/onlineSoup.js");

  for (const id of ["host",...Array.from({length:12},(_,i)=>"p"+i)]) await pool.query("INSERT INTO users (id,username,password,nickname,role) VALUES (?,?,'unused',?,?)",[id,id,id,id==='host'?'super_admin':'user']);
  await pool.query(`INSERT INTO soups (id,title,author,type,surface,bottom,supplemental_surfaces,supplemental_bottoms,host_manual,creator_id,creator_name,is_bottom_public,review_status) VALUES ('soup','语音测试','host','本格清汤','汤面','汤底','[]','[]','手册','host','host',1,'approved')`);
  const app=express();app.use(express.json());app.use(async(req,_res,next)=>{const [[user]]=await pool!.query<mysql.RowDataPacket[]>("SELECT id,nickname,role FROM users WHERE id=?",[req.header('x-test-user')??'']);(req as any).user=user;next();});app.use('/api/online-soup',router);app.use((e:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({error:e.message}));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));const origin=`http://127.0.0.1:${(server.address() as any).port}/api/online-soup`;
  async function request(path:string,user='host',method='GET',body?:unknown,status=200,version='1'):Promise<any>{const response=await fetch(origin+path,{method,headers:{'x-test-user':user,'Content-Type':'application/json','X-HGT-Voice-Version':version},...(body==null?{}:{body:JSON.stringify(body)})});const data=await response.json();assert.equal(response.status,status,method+' '+path+': '+JSON.stringify(data));return data;}
  config.voice.enabled=false;
  await request('/rooms','host','POST',{name:'语音测试',type:'public',communicationMode:'voice'},503);
  const text=await request('/rooms','host','POST',{name:'文字测试',type:'public'},201);
  Object.assign(config.voice,{enabled:true,advancedPermission:true,sdkAppId:123,sdkSecret:'offline-secret',secretId:'offline-id',secretKey:'offline-key'});
  await request('/rooms','host','POST',{name:'非法模式',type:'public',hostMode:'ai',communicationMode:'voice'},400);
  const room=await request('/rooms','host','POST',{name:'语音测试',type:'public',communicationMode:'voice'},201);const path='/rooms/'+room.roomId;
  await request(path+'/join','p0','POST',{role:'spectator'},400);
  await request(path+'/join-auto','p0','POST',{},426,'');
  await Promise.all(Array.from({length:10},(_,i)=>request(path+'/join-auto','p'+i,'POST',{})));
  await request(path+'/join-auto','p10','POST',{},409);
  const snapshot=await request(path);assert.equal(snapshot.room.communicationMode,'voice');assert.equal(snapshot.members.length,11);
  const seats=snapshot.members.filter((m:any)=>m.role==='player').map((m:any)=>m.voiceSeat);assert.equal(new Set(seats).size,10);assert.ok(seats.every((seat:number)=>seat>=1&&seat<=10));
  await request(path+'/messages','p0','POST',{type:'discussion',content:'不允许文字'},409);
  await request(path+'/host-mode','host','PATCH',{hostMode:'ai'},409);
  await request(path+'/voice/session','p10','POST',{},403);
  const ticket=await request(path+'/voice/session','p0','POST',{});assert.equal(ticket.canPublish,true);assert.equal(ticket.strRoomId,'hgt_'+room.roomId);
  await request(path+'/voice/session','p0','POST',{},409);
  await request(path+'/voice/heartbeat','p1','POST',{sessionId:ticket.sessionId},403);
  await request(path+'/members/p0/mute','host','POST',{durationMinutes:1});
  await request(path+'/voice/heartbeat','p0','POST',{sessionId:ticket.sessionId},403);
  const listen=await request(path+'/voice/session','p0','POST',{});assert.equal(listen.canPublish,false);
  await request(path+'/voice/leave','p0','POST',{sessionId:listen.sessionId});
  await request(path+'/select-soup','host','POST',{soupId:'soup'});
  await request(path+'/start','host','POST',{});
  const candidates=await request(path+'/voice/mvp-candidates');assert.equal(candidates.candidates.length,10);
  await request(path+'/publish-bottom','host','POST',{mvpUserId:'host'},400);
  await request(path+'/publish-bottom','host','POST',{mvpUserId:'p1',bestQuestionMessageId:'fake'},400);
  await request(path+'/publish-bottom','host','POST',{mvpUserId:'p1'});
  const [[record]]=await pool.query<mysql.RowDataPacket[]>("SELECT subtype,summary_json FROM game_records WHERE room_id=?",[room.roomId]);assert.equal(record.subtype,'voice');const summary=typeof record.summary_json==='string'?JSON.parse(record.summary_json):record.summary_json;assert.equal(summary.honors.mvp.userId,'p1');assert.equal(summary.honors.bestQuestion,null);
  const [[rewards]]=await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM shell_transactions");assert.equal(Number(rewards.total),0);
  await request(path+'/members/p1/transfer-host','host','POST',{});const transferred=await request(path,'p1');assert.equal(transferred.members.find((m:any)=>m.id==='p1').role,'host');assert.equal(transferred.members.find((m:any)=>m.id==='p1').voiceSeat,null);assert.ok(transferred.members.find((m:any)=>m.id==='host').voiceSeat);
  await request('/rooms/'+text.roomId+'/join','p11','POST',{role:'spectator'});await request('/rooms/'+text.roomId+'/messages','host','POST',{type:'discussion',content:'文字房仍可发言'},201);
  console.log('PASS voice MySQL/API: disabled gate, old clients, no spectators/text, 10 concurrent seats, credentials, one device, mute, MVP-only archive, no rewards, host transfer, text compatibility');
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const name of created) { assert.ok(name.startsWith(prefix)); await admin.query(`DROP TABLE IF EXISTS \`${name}\``); }
  await admin.end();
}
