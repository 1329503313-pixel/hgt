// Local Linux/container integration test; never connects to production or DB.
// Requires nginx, compiled apps/server/dist and the existing Node dependencies.
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import { RequestLogWriter } from "../../apps/server/dist/requestLogWriter.js";
import { createRequestLogging } from "../../apps/server/dist/requestLogging.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(join(tmpdir(), "hgt-request-log-smoke-"));
const logs = join(root, "logs");
const writer = new RequestLogWriter(logs);
const app = express();
app.use(createRequestLogging(writer, { slowMs: 25, overdueMs: 200 }));
app.get("/fast", (_req, res) => res.end("ok"));
app.get("/slow", (_req, res) => setTimeout(() => res.end("ok"), 80));
app.get("/hang", (_req, _res) => {});
app.get("/stream", (_req, res) => { res.type("text/event-stream"); res.flushHeaders(); });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const appPort = server.address().port;
let collector;
let nginx;
let collectorOutput = "";
let nginxOutput = "";
try {
  collector = spawn(process.execPath, [resolve(here, "../../apps/server/dist/nginxLogCollector.js")], {
    env: { ...process.env, REQUEST_LOG_DIR: logs, REQUEST_LOG_SLOW_MS: "25" }, stdio: ["ignore", "pipe", "pipe"],
  });
  collector.stdout.on("data", (chunk) => { collectorOutput += chunk; });
  collector.stderr.on("data", (chunk) => { collectorOutput += chunk; });
  for (let i = 0; i < 100 && !collectorOutput.includes("listening"); i++) await delay(20);
  assert.match(collectorOutput, /listening/);
  const httpConfig = await readFile(join(here, "nginx-http.conf"), "utf8");
  const serverConfig = await readFile(join(here, "nginx-server.conf"), "utf8");
  const proxyConfig = await readFile(join(here, "nginx-proxy.conf"), "utf8");
  const configPath = join(root, "nginx.conf");
  await mkdir(join(root, "client"));
  await writeFile(configPath, `daemon off;
pid ${root}/nginx.pid;
error_log ${root}/error.log;
events { worker_connections 128; }
http {
  access_log off;
  client_body_temp_path ${root}/client;
  ${httpConfig}
  server {
    listen 127.0.0.1:18089;
    ${serverConfig}
    location / {
      proxy_pass http://127.0.0.1:${appPort};
      proxy_read_timeout 400ms;
      proxy_buffering off;
      ${proxyConfig}
    }
  }
}`);
  const configCheck = spawnSync("nginx", ["-t", "-p", root, "-c", configPath], { encoding: "utf8" });
  assert.equal(configCheck.status, 0, configCheck.stderr);
  nginx = spawn("nginx", ["-p", root, "-c", configPath], { stdio: ["ignore", "pipe", "pipe"] });
  nginx.stderr.on("data", (chunk) => { nginxOutput += chunk; });
  const url = "http://127.0.0.1:18089";
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${url}/fast`); ready = true; break; } catch { await delay(20); }
  }
  assert.ok(ready, nginxOutput);
  const slow = await fetch(`${url}/slow?token=SMOKE_SECRET`, { headers: { "X-Request-Id": "f".repeat(32), Cookie: "secret=SMOKE_SECRET" } });
  const id = slow.headers.get("x-request-id");
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.notEqual(id, "f".repeat(32), "proxy must overwrite client ID");
  const timeout = await fetch(`${url}/hang`);
  assert.equal(timeout.status, 504);
  const timeoutId = timeout.headers.get("x-request-id");
  const abort = new AbortController();
  const stream = await fetch(`${url}/stream`, { signal: abort.signal });
  const streamId = stream.headers.get("x-request-id");
  await delay(260);
  abort.abort();
  await delay(40);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  const unavailable = await fetch(`${url}/fast`);
  assert.equal(unavailable.status, 502);
  const unavailableId = unavailable.headers.get("x-request-id");
  await writer.close();
  await delay(100);
  collector.kill("SIGTERM");
  await once(collector, "exit");
  const files = (await readdir(logs)).filter((name) => name.endsWith(".jsonl"));
  const content = (await Promise.all(files.map((name) => readFile(join(logs, name), "utf8")))).join("");
  const records = content.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(content.includes("SMOKE_SECRET"), false);
  assert.deepEqual(new Set(records.filter((r) => r.requestId === id).map((r) => r.source)), new Set(["server", "nginx"]));
  const proxy = records.find((r) => r.requestId === id && r.source === "nginx");
  assert.ok(Number(proxy.upstreamHeaderSeconds) >= 0.025);
  assert.ok(records.some((r) => r.requestId === timeoutId && r.kind === "response_overdue"));
  assert.ok(records.some((r) => r.requestId === timeoutId && r.kind === "proxy_timeout"));
  assert.ok(records.some((r) => r.requestId === unavailableId && r.kind === "proxy_error"));
  assert.equal(records.some((r) => r.requestId === streamId), false);
  console.log(`PASS: nginx -t; correlated slow request; 504 + overdue; independent 502; SSE; redaction; ${records.length} valid merged records`);
} finally {
  if (nginx && nginx.exitCode === null) { nginx.kill("SIGTERM"); await once(nginx, "exit"); }
  if (collector && collector.exitCode === null) { collector.kill("SIGTERM"); await once(collector, "exit"); }
  server.closeAllConnections();
  server.close();
  await writer.close();
  // Only remove the verified mkdtemp directory created by this test.
  if (root.startsWith(join(tmpdir(), "hgt-request-log-smoke-"))) await rm(root, { recursive: true, force: true });
}
