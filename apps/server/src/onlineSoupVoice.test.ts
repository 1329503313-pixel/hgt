import assert from "node:assert/strict";
import test from "node:test";
import { Api } from "tls-sig-api-v2";
import { inflateSync } from "node:zlib";
import { assignVoiceSeats, voiceAvailable, voicePrivileges } from "./onlineSoupVoicePolicy.js";
import { parseOnlineSoupAiHonors } from "./onlineSoupHonors.js";
import { settleOnlineSoupRound } from "./shellCurrency.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { Router } from "express";
import { reconcileVoiceSessions, registerVoiceRoutes } from "./onlineSoupVoice.js";

test("release candidates never start voice cleanup or mutate shared sessions", async (t) => {
  const previous = config.releaseCandidate;
  config.releaseCandidate = true;
  t.after(() => { config.releaseCandidate = previous; });
  t.mock.method(pool, "query", () => { assert.fail("Candidate must not query or write voice sessions"); });
  t.mock.method(globalThis, "setInterval", () => { assert.fail("Candidate must not start voice cleanup timers"); });
  registerVoiceRoutes(Router(), () => null);
  await reconcileVoiceSessions();
});

test("voice requires explicit switch, room permission verification and complete provider config", () => {
  const complete = { enabled: true, advancedPermission: true, sdkAppId: 123, sdkSecret: "test", secretId: "test", secretKey: "test" };
  assert.equal(voiceAvailable(complete), true);
  for (const key of ["enabled", "advancedPermission", "sdkSecret", "secretId", "secretKey", "sdkAppId"] as const) assert.equal(voiceAvailable({ ...complete, [key]: false }), false);
});
test("voice grants audio only; muted members cannot publish", () => {
  assert.equal(voicePrivileges(false), 15); assert.equal(voicePrivileges(true), 11);
  const signature = new Api(123, "offline-fixture-secret").genPrivateMapKeyWithStringRoomID("user_1", 60, "room_test", voicePrivileges(true));
  const decoded = JSON.parse(inflateSync(Buffer.from(signature.replace(/\*/g, "+").replace(/-/g, "/").replace(/_/g, "="), "base64")).toString());
  const buffer = Buffer.from(decoded["TLS.userbuf"], "base64");
  assert.equal(buffer[0], 1); assert.equal(buffer.subarray(-9).toString(), "room_test");
  assert.equal(buffer.readUInt32BE(3 + "user_1".length + 12), 11);
  assert.equal(decoded["TLS.expire"], 60);
});
test("voice seats remain stable across departures and host transfer", () => {
  const members = [{ id: "newHost", role: "host", seat: 3 }, { id: "p1", role: "player", seat: 1 }, { id: "p2", role: "player", seat: 7 }, { id: "oldHost", role: "player", seat: null }];
  const seats = assignVoiceSeats(members);
  assert.equal(seats[0].seat, null); assert.equal(seats[1].seat, 1); assert.equal(seats[2].seat, 7);
  assert.equal(new Set(seats.filter(s=>s.seat).map(s=>s.seat)).size, 3);
  const full = assignVoiceSeats(Array.from({ length: 11 }, (_,i)=>({id:String(i),role:"player",seat:null})));
  assert.equal(full[10].seat, null); assert.equal(full[9].seat, 10);
});
test("voice MVP parses without a best question, malformed v1 still rejected", () => {
  const honors = { version: 2, communicationMode: "voice", mvp: { userId: "p1", nickname: "玩家", avatar: null, progressContribution: 0 }, bestQuestion: null };
  assert.deepEqual(parseOnlineSoupAiHonors(JSON.stringify(honors)), honors);
  assert.equal(parseOnlineSoupAiHonors({ ...honors, version: 1 }), null);
  assert.equal(parseOnlineSoupAiHonors({ ...honors, communicationMode: "text" }), null);
});
test("voice settlement performs no reward writes or question-dependent calculations", async () => {
  let queries = 0;
  const db = { query: async () => { queries++; assert.equal(queries, 1); return [[{ communication_mode: "voice", started_at: new Date(0), ended_at: new Date() }]]; } };
  const result = await settleOnlineSoupRound(db as never, "voice-round");
  assert.deepEqual(result, { eligible: false, completed: false, awardedUsers: [] }); assert.equal(queries, 1);
});
