import type { RequestLogRecord } from "./requestLogWriter.js";

// Nginx syslog access records only. Raw error_log text can contain tokens and
// query strings; retain the original error log separately rather than copy it.
export function parseNginxRequestLog(packet: string, slowMs = 500): RequestLogRecord | null {
  const marker = "hgt_access: ";
  const start = packet.indexOf(marker);
  if (start < 0 || packet.length > 8192) return null;
  let data: Record<string, unknown>;
  try { data = JSON.parse(packet.slice(start + marker.length)); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const status = Number(data.status);
  const durationMs = Number(data.requestTime) * 1000;
  const requestId = String(data.requestId ?? "");
  if (!/^[a-f0-9]{32}$/.test(requestId) || !Number.isFinite(durationMs) || durationMs < 0 ||
      !Number.isInteger(status) || status < 100 || status > 599) return null;
  const streaming = status === 101 || String(data.contentType).startsWith("text/event-stream");
  // Upstream can retry; keep every timing/status value rather than silently
  // converting "0.001, 0.002" to an invalid number or losing the first attempt.
  const timing = (value: unknown) => {
    const text = String(value ?? "-");
    return /^[\d., :\-]{1,128}$/.test(text) ? text : "-";
  };
  const slowFirstByte = String(data.upstreamHeaderTime ?? "-").split(/[,:]/).some((part) => {
    const seconds = Number(part.trim());
    return Number.isFinite(seconds) && seconds * 1000 >= slowMs;
  });
  const slow = streaming ? slowFirstByte : durationMs >= slowMs;
  const failure = status >= 500 || status === 408 || status === 499;
  if (!failure && !slow) return null;
  return {
    source: "nginx", kind: status === 408 || status === 504 ? "proxy_timeout" :
      status === 499 ? "client_closed" : status >= 500 ? "proxy_error" : "slow_request",
    requestId, status, durationMs: Math.round(durationMs), streaming,
    method: String(data.method ?? "").replace(/[^A-Z]/g, "").slice(0, 16),
    path: String(data.path ?? "").split(/[?#]/, 1)[0].slice(0, 512),
    nginxTimestamp: /^\d{4}-\d{2}-\d{2}T[\d:+-]+$/.test(String(data.time)) ? data.time : undefined,
    upstreamConnectSeconds: timing(data.upstreamConnectTime),
    upstreamHeaderSeconds: timing(data.upstreamHeaderTime),
    upstreamResponseSeconds: timing(data.upstreamResponseTime),
    upstreamStatus: timing(data.upstreamStatus),
    // Instance/connection identifiers aid matching an existing Nginx error log.
    connection: /^\d{1,20}$/.test(String(data.connection)) ? String(data.connection) : undefined,
    connectionRequests: /^\d{1,20}$/.test(String(data.connectionRequests)) ? String(data.connectionRequests) : undefined,
  };
}
