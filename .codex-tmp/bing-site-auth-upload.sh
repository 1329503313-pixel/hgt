#!/bin/sh
set -eu

container=hgt-app
upload=/root/BingSiteAuth.xml.upload-20260810
target=/app/apps/web/dist/BingSiteAuth.xml
expected_hash=0f54d9c09f40485642578a9facb935a037903bd76eedda5ef731de3f3bb0b0e9
response=$(mktemp)
trap 'rm -f "$response" "$upload"' EXIT

test "$(sha256sum "$upload" | cut -d' ' -f1)" = "$expected_hash"
test "$(docker inspect -f '{{.State.Status}}' "$container")" = running
docker exec "$container" test ! -e "$target"

before_id=$(docker inspect -f '{{.Id}}' "$container")
before_started=$(docker inspect -f '{{.State.StartedAt}}' "$container")
before_env_hash=$(docker inspect -f '{{json .Config.Env}}' "$container" | sha256sum | cut -d' ' -f1)
before_jwt_hash=$(docker exec "$container" node -e '
  const crypto = require("node:crypto");
  process.stdout.write(crypto.createHash("sha256").update(process.env.JWT_SECRET || "").digest("hex"));
')

docker cp "$upload" "$container:$target"
test "$(docker exec "$container" sha256sum "$target" | cut -d' ' -f1)" = "$expected_hash"

after_id=$(docker inspect -f '{{.Id}}' "$container")
after_started=$(docker inspect -f '{{.State.StartedAt}}' "$container")
after_env_hash=$(docker inspect -f '{{json .Config.Env}}' "$container" | sha256sum | cut -d' ' -f1)
after_jwt_hash=$(docker exec "$container" node -e '
  const crypto = require("node:crypto");
  process.stdout.write(crypto.createHash("sha256").update(process.env.JWT_SECRET || "").digest("hex"));
')

test "$before_id" = "$after_id"
test "$before_started" = "$after_started"
test "$before_env_hash" = "$after_env_hash"
test "$before_jwt_hash" = "$after_jwt_hash"

status=$(curl -sS -o "$response" -w '%{http_code}' https://hgt.caqis.com/BingSiteAuth.xml)
content_type=$(curl -sSI https://hgt.caqis.com/BingSiteAuth.xml | tr -d '\r' | sed -n 's/^Content-Type: //Ip' | head -1)
health=$(curl -sS -o /dev/null -w '%{http_code}' https://hgt.caqis.com/api/health)
test "$status" = 200
test "$(sha256sum "$response" | cut -d' ' -f1)" = "$expected_hash"
test "$health" = 200

echo "upload_status=complete"
echo "container_id_unchanged=true"
echo "container_started_at_unchanged=true"
echo "environment_hash_unchanged=$after_env_hash"
echo "jwt_sha256_unchanged=$after_jwt_hash"
echo "verification_url_status=$status"
echo "verification_url_content_type=$content_type"
echo "verification_file_sha256=$expected_hash"
echo "health_status=$health"
