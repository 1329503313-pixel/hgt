import { mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const HOUR = 3_600_000;
const FILE = /^requests-(\d{4}-\d{2}-\d{2}T\d{2})\.jsonl$/;
export type RequestLogRecord = Record<string, unknown>;

export function requestLogFile(now: number): string {
  return `requests-${new Date(now).toISOString().slice(0, 13)}.jsonl`;
}

// Keep every bucket overlapping the last 24 hours, so hourly cleanup never
// discards part of that window. At most 25 files (current + 24 completed hours).
// No traffic is needed for expiry; both processes run cleanup independently.
export async function pruneRequestLogs(directory: string, now = Date.now()): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const cutoff = now - 24 * HOUR;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const match = FILE.exec(entry.name);
    if (!entry.isFile() || !match) continue;
    if (Date.parse(`${match[1]}:00:00.000Z`) + HOUR <= cutoff) {
      await unlink(join(directory, entry.name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

export class RequestLogWriter {
  private queue: { line: Buffer; time: number }[] = [];
  private queuedBytes = 0;
  private running: Promise<void> | undefined;
  private timer: NodeJS.Timeout;
  private lastWarning = -Infinity;
  private closed = false;

  constructor(readonly directory: string, private readonly maxQueueBytes = 4 * 1024 * 1024) {
    void this.cleanup();
    this.timer = setInterval(() => void this.cleanup(), 60_000);
    this.timer.unref();
  }

  private warn(reason: string, error?: unknown) {
    if (Date.now() - this.lastWarning < 60_000) return;
    this.lastWarning = Date.now();
    // Never print an exception message: it may contain request data or paths.
    console.error(JSON.stringify({ source: "request_logger", kind: reason,
      code: String((error as NodeJS.ErrnoException)?.code ?? "").slice(0, 32) }));
  }

  private async cleanup() {
    try { await pruneRequestLogs(this.directory); }
    catch (error) { this.warn("log_cleanup_failed", error); }
  }

  write(record: RequestLogRecord): void {
    if (this.closed) return;
    const time = Date.now();
    const line = Buffer.from(JSON.stringify({ ...record, timestamp: new Date(time).toISOString() }) + "\n");
    if (line.length > 8192 || this.queuedBytes + line.length > this.maxQueueBytes) {
      this.warn("log_queue_overflow");
      return;
    }
    this.queue.push({ line, time });
    this.queuedBytes += line.length;
    this.startDrain();
  }

  private startDrain() {
    this.running ??= this.drain().finally(() => {
      this.running = undefined;
      if (this.queue.length) this.startDrain();
    });
  }

  private async drain() {
    while (this.queue.length) {
      const item = this.queue.shift()!;
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o750 });
        const file = await open(join(this.directory, requestLogFile(item.time)), "a", 0o640);
        try {
          // One O_APPEND write per bounded JSON line permits the two processes
          // to share a local host file without holding it open across rotation.
          const result = await file.write(item.line);
          if (result.bytesWritten !== item.line.length) this.warn("log_short_write");
        } finally { await file.close(); }
      } catch (error) { this.warn("log_write_failed", error); }
      finally { this.queuedBytes -= item.line.length; }
    }
  }

  async flush() { while (this.running) await this.running; }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.flush();
  }
}
