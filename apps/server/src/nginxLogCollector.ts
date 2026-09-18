import dgram from "node:dgram";
import { RequestLogWriter } from "./requestLogWriter.js";
import { parseNginxRequestLog } from "./nginxRequestLog.js";
import { logThreshold } from "./requestLogging.js";

// Independent container: no application config, database or credentials loaded.
const writer = new RequestLogWriter(process.env.REQUEST_LOG_DIR || "/app/logs/requests");
const slowMs = logThreshold(process.env.REQUEST_LOG_SLOW_MS, 500);
const socket = dgram.createSocket("udp4");
socket.on("message", (packet) => {
  const record = parseNginxRequestLog(packet.toString("utf8"), slowMs);
  if (record) writer.write(record);
});
socket.on("error", (error: NodeJS.ErrnoException) => {
  console.error(JSON.stringify({ source: "nginx_collector", kind: "socket_error", code: error.code }));
  process.exitCode = 1;
  socket.close();
  void writer.close();
});
socket.bind(15140, "0.0.0.0", () => {
  console.log("Nginx request log collector listening on UDP 15140 (publish to host loopback only)");
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { socket.close(); void writer.close(); });
}
