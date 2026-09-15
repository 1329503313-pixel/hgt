#!/bin/sh
set -eu

current=hgt-app
env_file=$(mktemp)
chmod 600 "$env_file"
cleanup() {
  rm -f "$env_file"
}
trap cleanup EXIT INT TERM

test "$(docker inspect -f '{{.State.Running}}' "$current")" = true
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$current" > "$env_file"
test "$(grep -c '^JWT_SECRET=' "$env_file")" -eq 1
jwt=$(sed -n 's/^JWT_SECRET=//p' "$env_file")
test -n "$jwt"
container_hash=$(printf %s "$jwt" | sha256sum | cut -d ' ' -f1)

test -f /opt/hgt/.env
persisted_jwt=$(sed -n 's/^JWT_SECRET=//p' /opt/hgt/.env)
test -n "$persisted_jwt"
persisted_hash=$(printf %s "$persisted_jwt" | sha256sum | cut -d ' ' -f1)
test "$persisted_hash" = "$container_hash"

test "$(grep -c '^COOKIE_DOMAIN=' "$env_file")" -eq 1
test "$(grep -c '^COOKIE_SECURE=' "$env_file")" -eq 1
test "$(sed -n 's/^COOKIE_DOMAIN=//p' "$env_file")" = .caqis.com
test "$(sed -n 's/^COOKIE_SECURE=//p' "$env_file")" = false

# Inspect the running artifact as well as its environment. Never import the
# server entrypoint: this audit must not start another server or background job.
docker exec -i "$current" node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const entry = readFileSync('/app/server/dist/index.js', 'utf8');
const cookies = readFileSync('/app/server/dist/authCookies.js', 'utf8');
const base = entry.match(/const authCookieBaseOptions = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const setter = entry.match(/function setAuthCookie\(res, token\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
for (const fragment of ['httpOnly: true', 'sameSite: "lax"', 'secure: config.cookieSecure', 'path: "/"']) {
  assert.ok(base.includes(fragment), 'Production cookie base contract mismatch');
}
for (const fragment of ['res.cookie(AUTH_COOKIE_NAME, token,', '...authCookieBaseOptions', 'maxAge: 1000 * 60 * 60 * 24 * 30', 'domain: config.cookieDomain || undefined']) {
  assert.ok(setter.includes(fragment), 'Production cookie setter contract mismatch');
}
assert.ok(cookies.includes('export const AUTH_COOKIE_NAME = "hgt_token";'), 'Production cookie name mismatch');
assert.equal(process.env.COOKIE_DOMAIN, '.caqis.com');
assert.equal(process.env.COOKIE_SECURE, 'false');
console.log('COOKIE_RUNTIME_CONTRACT=ok');
NODE

echo 'PRODUCTION_PREFLIGHT=ok'
echo 'CONTAINER_RUNNING=true'
echo 'PERSISTED_JWT_MATCHED=true'
echo 'COOKIE_ENVIRONMENT_MATCHED=true'
