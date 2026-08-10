#!/bin/sh
set -eu

stage=/opt/hgt/maintenance/cors-app-origin-20260810
container=hgt-app
expected_id=625675fc36bd2972477a88376c68ec04da62dd1bcf8ec08a64d201c10028b824
patch_config=c246da77e02e667b65b04f7ee6ebcf6122dbd4ce1acee0a32ccb114d0808dfc6
patch_index=b3d8b8c91e7016b629c26c717c4047a6687c8fb2cda5257a4ba2d020f6fa5cb1
base_config=664e72dbfc6fc57d7d5570eb4cdcde1c1804f04efcdf303e350695c3644ba9de
base_index=19c122901835144d8b0f130c056a127baa3d765b3684391c2866397f1fbaee48

test "$(docker inspect --format '{{.Id}}' "$container")" = "$expected_id"
test "$(docker inspect --format '{{.State.Status}}' "$container")" = 'running'
test "$(docker exec "$container" sha256sum /app/server/dist/config.js | awk '{print $1}')" = "$base_config"
test "$(docker exec "$container" sha256sum /app/server/dist/index.js | awk '{print $1}')" = "$base_index"
test "$(sha256sum "$stage/context/config.js" | awk '{print $1}')" = "$patch_config"
test "$(sha256sum "$stage/context/index.js" | awk '{print $1}')" = "$patch_index"

rollback_needed=false
deployment_succeeded=false
rollback() {
  echo 'rollback=started'
  docker cp "$stage/base/config.js" "$container:/app/server/dist/config.js"
  docker cp "$stage/base/index.js" "$container:/app/server/dist/index.js"
  docker restart "$container" >/dev/null
  echo 'rollback=completed'
}
on_exit() {
  status=$?
  if [ "$rollback_needed" = true ] && [ "$deployment_succeeded" != true ]; then
    rollback || true
  fi
  exit "$status"
}
trap on_exit EXIT

docker cp "$stage/context/config.js" "$container:/app/server/dist/config.js.cors-next"
docker cp "$stage/context/index.js" "$container:/app/server/dist/index.js.cors-next"
test "$(docker exec "$container" sha256sum /app/server/dist/config.js.cors-next | awk '{print $1}')" = "$patch_config"
test "$(docker exec "$container" sha256sum /app/server/dist/index.js.cors-next | awk '{print $1}')" = "$patch_index"

rollback_needed=true
docker exec "$container" mv /app/server/dist/config.js.cors-next /app/server/dist/config.js
docker exec "$container" mv /app/server/dist/index.js.cors-next /app/server/dist/index.js
test "$(docker exec "$container" sha256sum /app/server/dist/config.js | awk '{print $1}')" = "$patch_config"
test "$(docker exec "$container" sha256sum /app/server/dist/index.js | awk '{print $1}')" = "$patch_index"

docker restart "$container" >/dev/null
attempt=0
while [ "$attempt" -lt 50 ]; do
  if [ "$(docker inspect --format '{{.State.Status}}' "$container")" = 'running' ] \
    && curl -fsS --max-time 2 http://127.0.0.1:4000/health >/dev/null 2>&1; then
    deployment_succeeded=true
    rollback_needed=false
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
test "$deployment_succeeded" = true

trap - EXIT
echo 'deployment=completed'
printf 'container_id='
docker inspect --format '{{.Id}}' "$container"
printf 'started_at='
docker inspect --format '{{.State.StartedAt}}' "$container"
printf 'config_sha256='
docker exec "$container" sha256sum /app/server/dist/config.js | awk '{print $1}'
printf 'index_sha256='
docker exec "$container" sha256sum /app/server/dist/index.js | awk '{print $1}'
