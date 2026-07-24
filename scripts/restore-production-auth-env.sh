#!/bin/sh
set -eu

deploy_dir=${1:-/opt/hgt}
rollback_container=${2:-hgt-app-rollback-emailfix}
cd "$deploy_dir"

docker inspect "$rollback_container" --format '{{range .Config.Env}}{{println .}}{{end}}' > .env.rollback-auth
chmod 600 .env.rollback-auth

grep -Ev '^(JWT_SECRET|COOKIE_DOMAIN|COOKIE_SECURE)=' .env > .env.auth-next
grep -E '^(JWT_SECRET|COOKIE_DOMAIN|COOKIE_SECURE)=' .env.rollback-auth >> .env.auth-next
grep -q '^COOKIE_SECURE=' .env.auth-next || printf '%s\n' 'COOKIE_SECURE=false' >> .env.auth-next

grep -q '^JWT_SECRET=.' .env.auth-next
grep -q '^COOKIE_DOMAIN=.' .env.auth-next

chmod 600 .env.auth-next
mv .env.auth-next .env
rm -f .env.rollback-auth

docker compose --env-file "$deploy_dir/.env" config --quiet
echo "auth_configuration=restored"
