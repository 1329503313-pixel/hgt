import express from "express";
import cors from "cors";

const corsOrigins = ["https://hgt.caqis.com", "https://app.caqis.com"];
const app = express();
app.use(cors({ origin: [...new Set(corsOrigins)], credentials: true }));
app.get("/api/soups", (_req, res) => res.json({ ok: true }));
app.options("/api/auth/login", (_req, res) => res.sendStatus(204));

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unexpected listen address");
  const base = `http://127.0.0.1:${address.port}`;
  for (const origin of corsOrigins) {
    const response = await fetch(`${base}/api/soups`, { headers: { Origin: origin } });
    if (response.status !== 200) throw new Error(`${origin}: GET status ${response.status}`);
    if (response.headers.get("access-control-allow-origin") !== origin) {
      throw new Error(`${origin}: incorrect allow-origin`);
    }
    if (response.headers.get("access-control-allow-credentials") !== "true") {
      throw new Error(`${origin}: credentials not allowed`);
    }
  }

  const preflight = await fetch(`${base}/api/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://app.caqis.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });
  if (preflight.status !== 204) throw new Error(`Preflight status ${preflight.status}`);
  if (preflight.headers.get("access-control-allow-origin") !== "https://app.caqis.com") {
    throw new Error("Preflight incorrect allow-origin");
  }
  console.log("cors_patch=verified");
} finally {
  server.close();
}
