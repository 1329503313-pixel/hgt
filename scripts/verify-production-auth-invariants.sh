#!/bin/sh
set -eu

deploy_dir=${1:-/opt/hgt}
container=${2:-hgt-app}
current_env=$(mktemp)
trap 'rm -f "$current_env"' EXIT

docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$current_env"

for key in JWT_SECRET COOKIE_DOMAIN COOKIE_SECURE; do
  persisted=$(grep "^${key}=" "$deploy_dir/.env")
  running=$(grep "^${key}=" "$current_env")
  if [ "$persisted" != "$running" ]; then
    echo "auth_invariant_mismatch=${key}"
    exit 1
  fi
done

[ "$(grep '^COOKIE_DOMAIN=' "$current_env")" = "COOKIE_DOMAIN=.caqis.com" ]
[ "$(grep '^COOKIE_SECURE=' "$current_env")" = "COOKIE_SECURE=false" ]

echo "auth_invariants=verified"
