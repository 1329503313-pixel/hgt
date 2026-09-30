import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import express from "express";
import type mysql from "mysql2/promise";
import { registerRetiredVoiceRoutes, retireLegacyVoiceRooms } from "./onlineSoupRetirement.js";
import { parseOnlineSoupAiHonors } from "./onlineSoupHonors.js";
import { settleOnlineSoupRound } from "./shellCurrency.js";

test("retired voice APIs cannot issue tickets or bypass retirement via room operations", async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const reads: string[] = [];
  registerRetiredVoiceRoutes(router, { query: async (_sql: string, values: string[]) => {
    reads.push(values[0]);
    return [[{ communication_mode: values[0] === "old-voice" ? "voice" : "text" }]];
  } } as unknown as mysql.Pool);
  router.post("/rooms", (_req, res) => { res.json({ created: true }); });
  router.all("/rooms/:roomId/*", (_req, res) => { res.json({ allowed: true }); });
  router.all("/rooms/:roomId", (_req, res) => { res.json({ allowed: true }); });
  app.use("/api/online-soup", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api/online-soup`;
  try {
    const capability = await fetch(`${base}/voice/capabilities`);
    assert.equal(capability.headers.get("cache-control"), "no-store");
    assert.deepEqual(await capability.json(), { enabled: false, retired: true, version: "1" });
    for (const body of [{ communicationMode: "voice" }, { hostMode: "voice" }]) {
      const result = await fetch(`${base}/rooms`, { method: "POST", headers: { "Content-Type": "application/json", "X-HGT-Voice-Version": "1" }, body: JSON.stringify(body) });
      assert.equal(result.status, 410);
    }
    assert.deepEqual(reads, [], "creating retired rooms must not reach the database");
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      for (const suffix of ["", "/join", "/heartbeat", "/invite-preview", "/invite-status", "/messages", "/host-mode", "/voice/session", "/voice/heartbeat", "/voice/mvp-candidates"]) {
        const response = await fetch(`${base}/rooms/old-voice${suffix}`, { method });
        assert.equal(response.status, 410, `${method} ${suffix}`);
        assert.equal((await response.json()).code, "ROOM_CLOSED");
      }
    }
    for (const suffix of ["session", "heartbeat", "leave", "mvp-candidates"]) {
      assert.equal((await fetch(`${base}/rooms/text/voice/${suffix}`, { method: "POST" })).status, 410);
    }
    for (const body of [{}, { hostMode: "human" }, { hostMode: "ai", communicationMode: "text" }]) {
      assert.equal((await fetch(`${base}/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 200);
    }
    assert.equal((await fetch(`${base}/rooms/text/join`, { method: "POST" })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("retirement rolls back member and room changes together on failure", async () => {
  const calls: string[] = [];
  await assert.rejects(retireLegacyVoiceRooms({
    beginTransaction: async () => { calls.push("begin"); },
    query: async () => { calls.push("query"); if (calls.length === 3) throw new Error("fixture failure"); },
    commit: async () => { calls.push("commit"); },
    rollback: async () => { calls.push("rollback"); },
  } as unknown as mysql.PoolConnection), /fixture failure/);
  assert.deepEqual(calls, ["begin", "query", "query", "rollback"]);
});

test("archived voice honors remain readable and old rounds cannot acquire text rewards", async () => {
  const honors = { version: 2, communicationMode: "voice", mvp: { userId: "p1", nickname: "玩家", avatar: null, progressContribution: 0 }, bestQuestion: null };
  assert.deepEqual(parseOnlineSoupAiHonors(JSON.stringify(honors)), honors);
  let queries = 0;
  const result = await settleOnlineSoupRound({ query: async () => {
    assert.equal(++queries, 1, "must not write rewards");
    return [[{ communication_mode: "voice", started_at: new Date(0), ended_at: new Date() }]];
  } } as never, "archived-voice-round");
  assert.equal(result.eligible, false);
  assert.equal(result.completed, false);
});
