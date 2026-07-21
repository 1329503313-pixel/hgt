import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();
const token = jwt.sign(
  { id: "admin", tokenVersion: 0 },
  process.env.JWT_SECRET || "dev-jwt-fallback-not-for-production",
  { expiresIn: "5m" }
);
const headers = { Authorization: `Bearer ${token}` };

async function measure(path) {
  const startedAt = performance.now();
  const response = await fetch(`http://localhost:4000${path}`, { headers });
  const firstByteAt = performance.now();
  const body = await response.arrayBuffer();
  const finishedAt = performance.now();
  console.log(JSON.stringify({
    path,
    status: response.status,
    responseMs: Math.round(firstByteAt - startedAt),
    totalMs: Math.round(finishedAt - startedAt),
    bytes: body.byteLength
  }));
  return { response, body };
}

const paths = [
  "/api/auth/me",
  "/api/messages/unread-counts",
  "/api/notifications",
  "/api/me/stats",
  "/api/me/shells",
  "/api/asset-store/packs",
  "/api/me/card-cabinet",
  "/api/me/card-cabinet?compact=true",
  "/api/rankings",
  "/api/asset-rankings",
  "/api/online-soup/rooms"
];

for (const path of paths) await measure(path);
const packsResponse = await fetch("http://localhost:4000/api/asset-store/packs", { headers });
const packsPayload = await packsResponse.json();
if (packsPayload.packs?.[0]?.id) await measure(`/api/asset-store/packs/${encodeURIComponent(packsPayload.packs[0].id)}`);
