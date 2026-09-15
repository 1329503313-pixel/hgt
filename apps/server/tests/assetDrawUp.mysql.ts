// Connection-local temporary table only; no persistent rows are changed.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { digitalAssetRules as rules } from "../src/digitalAssets.js";
assert.ok(["127.0.0.1","localhost","::1"].includes(config.db.host), "Loopback MySQL required");
const connection = await mysql.createConnection({...config.db,connectTimeout:5000});
try {
  await connection.query(`CREATE TEMPORARY TABLE user_asset_pack_up_selections (
    user_id VARCHAR(64), pack_id VARCHAR(64), up_card_id VARCHAR(64) NOT NULL,
    epic_guaranteed TINYINT NOT NULL DEFAULT 0, PRIMARY KEY(user_id,pack_id))`);
  const cards=[{id:'a',rarity:'epic'},{id:'b',rarity:'epic'},{id:'c',rarity:'epic'}];
  const pack={enabled:cards} as Parameters<typeof rules.userPackEpicUpState>[2];
  const db=connection as mysql.PoolConnection;
  const owned=new Map<string,number>();
  const load=(lock:boolean)=>rules.userPackEpicUpState('user','pack',pack,db,lock,owned);
  const rows=async()=> (await connection.query<mysql.RowDataPacket[]>('SELECT * FROM user_asset_pack_up_selections'))[0];
  assert.deepEqual(await load(false),{cardId:'a',guaranteed:false});
  assert.equal((await rows()).length,0,'GET must remain read-only');
  await load(true);
  await connection.query('UPDATE user_asset_pack_up_selections SET epic_guaranteed = 1');
  owned.set('a',3);
  assert.deepEqual(await load(false),{cardId:'b',guaranteed:true});
  assert.equal((await rows())[0].up_card_id,'a','GET cannot race by writing stale UP');
  assert.deepEqual(await load(true),{cardId:'b',guaranteed:true});
  assert.equal((await rows())[0].up_card_id,'b');
  owned.set('b',3);owned.set('c',3);
  assert.equal(await load(true),null);
  assert.equal((await rows()).length,0,'all maxed must cancel stored UP');
  owned.delete('c');
  assert.deepEqual(await load(true),{cardId:'c',guaranteed:false});
  console.log('PASS: UP persistence, full-star rotation, read-only details, cancellation and newly available epic; persistent tables unchanged');
} finally { await connection.end(); }
