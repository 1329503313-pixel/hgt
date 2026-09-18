import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";
import type { RequestLogRecord } from "./requestLogWriter.js";

type Sink = { write(record: RequestLogRecord): void };
export function logThreshold(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 3_600_000 ? number : fallback;
}

export function createRequestLogging(sink: Sink, options: { slowMs: number; overdueMs: number }): RequestHandler {
  return (req, res, next) => {
    const start = performance.now();
    const startedAt = new Date().toISOString();
    const incoming = req.get("X-Request-Id");
    const requestId = incoming && /^[a-f0-9]{32}$/.test(incoming) ? incoming : randomBytes(16).toString("hex");
    res.setHeader("X-Request-Id", requestId);
    let firstByteMs: number | undefined;
    let streamStartLogged = false;
    let overdue = false;
    let ended = false;
    const elapsed = () => Math.round((performance.now() - start) * 100) / 100;
    const streaming = () => res.headersSent && String(res.getHeader("Content-Type") ?? "").startsWith("text/event-stream");
    const write = (kind: string, complete: boolean) => sink.write({
      source: "server", kind, requestId, startedAt, method: req.method,
      path: (req.originalUrl || req.url).split(/[?#]/, 1)[0].slice(0, 512),
      route: typeof req.route?.path === "string" ? `${req.baseUrl}${req.route.path}` : undefined,
      status: res.headersSent ? res.statusCode : null,
      durationMs: elapsed(), firstByteMs, complete, headersSent: res.headersSent,
      requestBodyComplete: req.complete, streaming: streaming(), pid: process.pid,
    });
    const writeHead = res.writeHead;
    res.writeHead = function (this: typeof res, ...args: Parameters<typeof writeHead>) {
      firstByteMs ??= elapsed();
      const result = writeHead.apply(this, args);
      if (streaming() && firstByteMs >= options.slowMs && !streamStartLogged) {
        streamStartLogged = true;
        write("slow_stream_start", false);
      }
      return result;
    } as typeof writeHead;
    const timer = setTimeout(() => {
      if (ended || streaming()) return;
      overdue = true;
      write("response_overdue", false);
    }, options.overdueMs);
    timer.unref();
    const finish = (complete: boolean) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      res.off("finish", onFinish);
      res.off("close", onClose);
      req.off("aborted", onAborted);
      const duration = streaming() ? (firstByteMs ?? elapsed()) : elapsed();
      if ([408, 504].includes(res.statusCode)) write("response_timeout", complete);
      else if (res.statusCode >= 500) write("request_error", complete);
      else if (!complete && !streaming()) write("request_aborted", false);
      else if (overdue) write("overdue_request_completed", complete);
      else if (duration >= options.slowMs && !streamStartLogged) write("slow_request", complete);
    };
    const onFinish = () => finish(true);
    const onClose = () => finish(res.writableFinished);
    const onAborted = () => finish(false);
    res.once("finish", onFinish);
    res.once("close", onClose);
    req.once("aborted", onAborted);
    next();
  };
}

export function startRuntimeLogging(sink: Sink, lagThresholdMs = 200): () => void {
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const lagMs = Math.max(0, now - previous - 1000);
    previous = now;
    if (lagMs >= lagThresholdMs) sink.write({ source: "runtime", kind: "event_loop_stall",
      lagMs: Math.round(lagMs), rssMb: Math.round(process.memoryUsage().rss / 1048576), pid: process.pid });
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
