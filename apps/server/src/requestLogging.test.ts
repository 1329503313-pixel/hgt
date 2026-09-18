import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import express from "express";
import { request } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequestLogging, logThreshold, startRuntimeLogging } from "./requestLogging.js";
import { RequestLogWriter, pruneRequestLogs, requestLogFile, type RequestLogRecord } from "./requestLogWriter.js";
import { parseNginxRequestLog } from "./nginxRequestLog.js";

async function fixture(t: TestContext, slowMs = 25, overdueMs = 70) {
  const records: RequestLogRecord[] = [];
  const app = express();
  app.use(createRequestLogging({ write: (record) => records.push(record) }, { slowMs, overdueMs }));
  app.get("/fast", (_req, res) => res.end("ok"));
  app.get("/slow", (_req, res) => { setTimeout(() => res.end("ok"), 45); });
  app.get("/overdue", (_req, res) => { setTimeout(() => res.end("ok"), 130); });
  app.get("/hang", (_req, _res) => {});
  app.get("/error", (_req, res) => { res.status(503).end(); });
  app.get("/timeout", (_req, res) => { res.status(504).end(); });
  app.get("/stream", (_req, res) => { res.type("text/event-stream"); res.flushHeaders(); });
  app.get("/slow-stream", (_req, res) => { setTimeout(() => { res.type("text/event-stream"); res.flushHeaders(); }, 45); });
  app.use(express.json());
  app.post("/body", (_req, res) => res.end());
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).end(); });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return { records, url };
}

test("fast requests get a stable ID without noise; invalid IDs are replaced", async (t) => {
  const { records, url } = await fixture(t, 1000);
  const id = "a".repeat(32);
  const response = await fetch(`${url}/fast?token=SECRET`, { headers: { "X-Request-Id": id } });
  assert.equal(response.headers.get("X-Request-Id"), id);
  const invalid = await fetch(`${url}/fast`, { headers: { "X-Request-Id": "untrusted value" } });
  assert.match(invalid.headers.get("X-Request-Id")!, /^[a-f0-9]{32}$/);
  assert.equal(records.length, 0);
});

test("slow requests exclude query, authorization, cookie and body; log once", async (t) => {
  const { records, url } = await fixture(t);
  await fetch(`${url}/slow?token=SECRET`, { headers: { Authorization: "Bearer SECRET", Cookie: "token=SECRET" } });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "slow_request");
  assert.equal(records[0].path, "/slow");
  assert.equal(records[0].complete, true);
  assert.equal(JSON.stringify(records).includes("SECRET"), false);
  assert.ok(Number(records[0].firstByteMs) >= 25);
});

test("unfinished requests log before completion, without terminating the response", async (t) => {
  const { records, url } = await fixture(t);
  const pending = fetch(`${url}/overdue`);
  await delay(100);
  assert.equal(records[0]?.kind, "response_overdue");
  assert.equal(records[0]?.status, null);
  assert.equal(records[0]?.complete, false);
  assert.equal((await pending).status, 200);
  assert.deepEqual(records.map((r) => r.kind), ["response_overdue", "overdue_request_completed"]);
  assert.equal(records[0].requestId, records[1].requestId);
});

test("abort, fast 5xx and explicit timeout are captured", async (t) => {
  const { records, url } = await fixture(t, 1000, 1000);
  const req = request(`${url}/hang`);
  req.on("error", () => {});
  req.end();
  await delay(40);
  req.destroy();
  await delay(30);
  await fetch(`${url}/error`);
  await fetch(`${url}/timeout`);
  assert.deepEqual(records.map((r) => r.kind), ["request_aborted", "request_error", "response_timeout"]);
});

test("JSON parser failures are observed before the body parser", async (t) => {
  const { records, url } = await fixture(t);
  await fetch(`${url}/body`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "SECRET{" });
  assert.equal(records[0]?.kind, "request_error");
  assert.equal(JSON.stringify(records).includes("SECRET"), false);
});

test("established SSE lifetime and disconnect do not generate slow/timeout noise", async (t) => {
  const { records, url } = await fixture(t);
  const controller = new AbortController();
  await fetch(`${url}/stream`, { signal: controller.signal });
  await delay(100);
  controller.abort();
  await delay(30);
  assert.equal(records.length, 0);
});

test("hourly retention handles UTC midnight, restart and unrelated files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hgt-logs-"));
  try {
    const now = Date.parse("2026-09-19T00:30:00Z");
    await writeFile(join(directory, "requests-2026-09-17T23.jsonl"), "old");
    await writeFile(join(directory, "requests-2026-09-18T00.jsonl"), "keep overlapping hour");
    await writeFile(join(directory, "requests-2026-09-18T01.jsonl"), "keep");
    await writeFile(join(directory, "other.jsonl"), "keep");
    await pruneRequestLogs(directory, now);
    assert.deepEqual((await readdir(directory)).sort(), ["other.jsonl", "requests-2026-09-18T00.jsonl", "requests-2026-09-18T01.jsonl"]);
    await pruneRequestLogs(directory, Date.parse("2026-09-19T01:00:00Z"));
    assert.deepEqual((await readdir(directory)).sort(), ["other.jsonl", "requests-2026-09-18T01.jsonl"]);
    assert.equal(requestLogFile(now), "requests-2026-09-19T00.jsonl");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("slow SSE headers are logged while the stream is still open", async (t) => {
  const { records, url } = await fixture(t);
  const controller = new AbortController();
  await fetch(`${url}/slow-stream`, { signal: controller.signal });
  assert.deepEqual(records.map((r) => r.kind), ["slow_stream_start"]);
  controller.abort();
  await delay(30);
  assert.equal(records.length, 1);
});

test("two writers append valid lines to the same hourly host file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hgt-logs-"));
  const app = new RequestLogWriter(directory);
  const nginx = new RequestLogWriter(directory);
  try {
    for (let i = 0; i < 100; i++) {
      app.write({ source: "server", requestId: String(i) });
      nginx.write({ source: "nginx", requestId: String(i) });
    }
    await Promise.all([app.close(), nginx.close()]);
    const lines = (await readFile(join(directory, requestLogFile(Date.now())), "utf8")).trim().split("\n").map((s) => JSON.parse(s));
    assert.equal(lines.length, 200);
    assert.equal(lines.filter((r) => r.source === "server").length, 100);
    assert.equal(lines.filter((r) => r.source === "nginx").length, 100);
  } finally { await Promise.all([app.close(), nginx.close()]); await rm(directory, { recursive: true, force: true }); }
});

test("disk errors and queue overflow do not reject application work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hgt-logs-"));
  const file = join(directory, "not-directory");
  await writeFile(file, "x");
  const writer = new RequestLogWriter(file, 256);
  writer.write({ source: "server", kind: "request_error" });
  writer.write({ large: "x".repeat(1000) });
  await writer.close();
  await rm(directory, { recursive: true, force: true });
});

const packet = (override: Record<string, unknown> = {}) => "<190>Sep 18 01:00:00 hgt_access: " + JSON.stringify({
  requestId: "b".repeat(32), method: "GET", path: "/api/soups?token=SECRET", status: "200", requestTime: "1.500",
  upstreamConnectTime: "0.001", upstreamHeaderTime: "1.400", upstreamResponseTime: "1.450", upstreamStatus: "200",
  contentType: "application/json", ...override,
});

test("Nginx timings, retries, 499/502/504 and redaction", () => {
  const slow = parseNginxRequestLog(packet({ upstreamConnectTime: "0.001, 0.002" }))!;
  assert.equal(slow.durationMs, 1500);
  assert.equal(slow.upstreamConnectSeconds, "0.001, 0.002");
  assert.equal(slow.path, "/api/soups");
  assert.equal(parseNginxRequestLog(packet({ status: "504", requestTime: "0.01" }))?.kind, "proxy_timeout");
  assert.equal(parseNginxRequestLog(packet({ status: "502", requestTime: "0.01" }))?.kind, "proxy_error");
  assert.equal(parseNginxRequestLog(packet({ status: "499", requestTime: "0.01" }))?.kind, "client_closed");
  assert.equal(parseNginxRequestLog(packet({ requestTime: "0.01" })), null);
  assert.equal(parseNginxRequestLog(packet({ contentType: "text/event-stream", upstreamHeaderTime: "0.001", requestTime: "3600" })), null);
  assert.equal(parseNginxRequestLog(packet({ status: "101", upstreamHeaderTime: "0.001", requestTime: "3600" })), null);
  assert.equal(parseNginxRequestLog("invalid syslog SECRET"), null);
  assert.equal(parseNginxRequestLog("hgt_access: null"), null);
  assert.equal(parseNginxRequestLog(packet({ requestId: "bad" })), null);
  assert.equal(parseNginxRequestLog(packet({ requestTime: "NaN" })), null);
});

test("invalid thresholds fall back, runtime monitor can be stopped", () => {
  for (const value of [undefined, "", "no", "-1", "Infinity", "0", "999999999"]) assert.equal(logThreshold(value, 500), 500);
  assert.equal(logThreshold("1000", 500), 1000);
  startRuntimeLogging({ write() {} })();
});
