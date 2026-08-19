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

echo 'PRODUCTION_PREFLIGHT=ok'
echo 'CONTAINER_RUNNING=true'
echo 'PERSISTED_JWT_MATCHED=true'
echo 'COOKIE_ENVIRONMENT_MATCHED=true'
