#!/bin/sh
set -eu

release_dir=/root/hgt-seo-redirect-20260810
current_container=hgt-app
rollback_container=hgt-app-rollback-seo-20260810
base_image=hgt:seo-redirect-base-20260810
release_image=hgt:seo-redirect-20260810

test "$(docker inspect -f '{{.State.Status}}' "$current_container")" = running
test ! -e "$release_dir/deployment-complete"
test ! "$(docker ps -a --format '{{.Names}}' | grep -Fx "$rollback_container" || true)"

current_env=$(mktemp)
trap 'rm -f "$current_env"' EXIT
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$current_container" > "$current_env"
grep -q '^COOKIE_DOMAIN=.caqis.com$' "$current_env"
grep -q '^COOKIE_SECURE=false$' "$current_env"
grep -q '^PUBLIC_SITE_URL=https://hgt.caqis.com$' "$current_env"

before_env_hash=$(docker inspect -f '{{json .Config.Env}}' "$current_container" | sha256sum | cut -d' ' -f1)
before_jwt_hash=$(docker exec "$current_container" node -e '
  const crypto = require("node:crypto");
  process.stdout.write(crypto.createHash("sha256").update(process.env.JWT_SECRET || "").digest("hex"));
')
test "$before_jwt_hash" = 8f480216a3e362bc3581f9605f76b2fdbd1ada641b2f78531a8bb47944c2fb49

docker cp "$current_container:/app/server/dist/index.js" "$release_dir/index.js"
cp "$release_dir/index.js" "$release_dir/index.before.js"
test "$(grep -c 'createLegacyHostRedirect' "$release_dir/index.js" || true)" = 0
test "$(grep -c '^const JWT_SECRET =' "$release_dir/index.js")" = 1
test "$(grep -c '^app.use(cors({ origin: config.webOrigin, credentials: true }));$' "$release_dir/index.js")" = 1

sed -i '/^const JWT_SECRET =/ i import { createLegacyHostRedirect } from "./legacyHostRedirect.js";' "$release_dir/index.js"
sed -i '/^app.use(cors({ origin: config.webOrigin, credentials: true }));$/i app.use(createLegacyHostRedirect(config.nodeEnv, config.publicSiteUrl));' "$release_dir/index.js"

test "$(grep -c 'import { createLegacyHostRedirect }' "$release_dir/index.js")" = 1
test "$(grep -c 'app.use(createLegacyHostRedirect' "$release_dir/index.js")" = 1
test "$(diff -U0 "$release_dir/index.before.js" "$release_dir/index.js" | grep -c '^+[^+]')" = 2

docker commit --pause=false "$current_container" "$base_image" >/dev/null
docker build --pull=false -t "$release_image" "$release_dir"

after_env_hash=$(docker image inspect -f '{{json .Config.Env}}' "$release_image" | sha256sum | cut -d' ' -f1)
test "$before_env_hash" = "$after_env_hash"
image_jwt_hash=$(docker run --rm --entrypoint node "$release_image" -e '
  const crypto = require("node:crypto");
  process.stdout.write(crypto.createHash("sha256").update(process.env.JWT_SECRET || "").digest("hex"));
')
test "$before_jwt_hash" = "$image_jwt_hash"
docker run --rm --entrypoint node "$release_image" --check /app/server/dist/index.js
docker run --rm --entrypoint node "$release_image" --input-type=module -e '
  import { legacyHostRedirectTarget } from "/app/server/dist/legacyHostRedirect.js";
  const actual = legacyHostRedirectTarget("production", "https://hgt.caqis.com", "47.239.5.69:4000", "/soup/check?q=1");
  if (actual !== "https://hgt.caqis.com/soup/check?q=1") process.exit(1);
'

docker stop "$current_container" >/dev/null
docker rename "$current_container" "$rollback_container"

rollback() {
  echo "deployment_status=rolling_back"
  docker logs --tail 80 "$current_container" 2>/dev/null || true
  docker rm -f "$current_container" >/dev/null 2>&1 || true
  docker rename "$rollback_container" "$current_container"
  docker start "$current_container" >/dev/null
  exit 1
}

docker run -d \
  --name "$current_container" \
  --network mysql-docker_default \
  --restart unless-stopped \
  -p 4000:4000 \
  -v /root/hgt-deepseek-key:/run/secrets/deepseek-key:ro \
  "$release_image" >/dev/null

attempt=0
until [ "$attempt" -ge 20 ]; do
  if curl -fsS -H 'Host: hgt.caqis.com' http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
test "$attempt" -lt 20 || rollback

after_runtime_env_hash=$(docker inspect -f '{{json .Config.Env}}' "$current_container" | sha256sum | cut -d' ' -f1)
after_jwt_hash=$(docker exec "$current_container" node -e '
  const crypto = require("node:crypto");
  process.stdout.write(crypto.createHash("sha256").update(process.env.JWT_SECRET || "").digest("hex"));
')
test "$before_env_hash" = "$after_runtime_env_hash" || rollback
test "$before_jwt_hash" = "$after_jwt_hash" || rollback

home_status=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: 47.239.5.69:4000' http://127.0.0.1:4000/)
home_location=$(curl -sSI -H 'Host: 47.239.5.69:4000' http://127.0.0.1:4000/ | tr -d '\r' | sed -n 's/^Location: //p')
path_status=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: 47.239.5.69:4000' 'http://127.0.0.1:4000/soup/seo-check?q=1')
path_location=$(curl -sSI -H 'Host: 47.239.5.69:4000' 'http://127.0.0.1:4000/soup/seo-check?q=1' | tr -d '\r' | sed -n 's/^Location: //p')
test "$home_status" = 301 || rollback
test "$home_location" = 'https://hgt.caqis.com/' || rollback
test "$path_status" = 301 || rollback
test "$path_location" = 'https://hgt.caqis.com/soup/seo-check?q=1' || rollback

touch "$release_dir/deployment-complete"
echo "deployment_status=complete"
echo "environment_hash_preserved=$after_runtime_env_hash"
echo "jwt_sha256_preserved=$after_jwt_hash"
echo "old_home=$home_status $home_location"
echo "old_path=$path_status $path_location"
echo "rollback_container=$rollback_container"
