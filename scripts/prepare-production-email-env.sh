#!/bin/sh
set -eu

deploy_dir=${1:-/opt/hgt}
cd "$deploy_dir"

test -f .env
test -f .env.mail-upload
test -f docker-compose.yml.next

stamp=$(date +%Y%m%d_%H%M%S)
cp -p .env ".env.backup.$stamp"
docker inspect hgt-app --format '{{range .Config.Env}}{{println .}}{{end}}' > .env.container-current
chmod 600 .env.container-current

managed_keys='WEB_ORIGIN|PUBLIC_SITE_URL|COOKIE_DOMAIN|DEEPSEEK_API_KEY_FILE|RUN_DB_MIGRATIONS|EMAIL_VERIFICATION_SECRET|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|SMTP_FROM|SMTP_REPLY_TO'
runtime_keys='WEB_ORIGIN|PUBLIC_SITE_URL|COOKIE_DOMAIN|DEEPSEEK_API_KEY_FILE|RUN_DB_MIGRATIONS'
mail_keys='EMAIL_VERIFICATION_SECRET|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|SMTP_FROM|SMTP_REPLY_TO'

grep -Ev "^(${managed_keys})=" .env > .env.next
grep -E "^(${runtime_keys})=" .env.container-current >> .env.next || true
grep -E "^(${mail_keys})=" .env.mail-upload >> .env.next

chmod 600 .env.next
mv .env.next .env
mv docker-compose.yml.next docker-compose.yml
chmod 600 .env

docker compose --env-file "$deploy_dir/.env" config --quiet

required_keys='WEB_ORIGIN|PUBLIC_SITE_URL|EMAIL_VERIFICATION_SECRET|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|SMTP_FROM'
grep -E "^(${required_keys})=" .env \
  | sed -E 's/^([^=]+)=.+$/\1=<present:true>/; s/^([^=]+)=$/\1=<present:false>/'

rm -f .env.mail-upload .env.container-current
echo "configuration=valid"
