import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const index = readFileSync(resolve(root, "apps/server/src/index.ts"), "utf8");
const cookies = readFileSync(resolve(root, "apps/server/src/authCookies.ts"), "utf8");
const required = [
  [cookies, 'export const AUTH_COOKIE_NAME = "hgt_token";', "permanent cookie name"],
  [cookies, 'export const LEGACY_AUTH_COOKIE_NAME = "hgt_session";', "migration cookie compatibility"],
  [index, "httpOnly: true", "httpOnly"],
  [index, 'sameSite: "lax" as const', "sameSite"],
  [index, 'path: "/"', "path"],
  [index, "secure: config.cookieSecure", "secure configuration"],
  [index, "maxAge: 1000 * 60 * 60 * 24 * 30", "30-day lifetime"],
  [index, "domain: config.cookieDomain || undefined", "cookie domain configuration"]
];
for (const [source, fragment, label] of required) {
  if (!source.includes(fragment)) throw new Error(`Production auth contract changed: ${label}`);
}
process.stdout.write("Production auth source contract passed\n");
