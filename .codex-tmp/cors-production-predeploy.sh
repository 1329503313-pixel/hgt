#!/bin/sh
set -eu

stage=/opt/hgt/maintenance/cors-app-origin-20260810
container=hgt-app

actual_container_id=$(docker inspect --format '{{.Id}}' "$container")
echo "container_id=$actual_container_id"
test "$actual_container_id" = '625675fc36bd2972477a88376c68ec04da62dd1bcf8ec08a64d201c10028b824'
actual_status=$(docker inspect --format '{{.State.Status}}' "$container")
echo "container_status=$actual_status"
test "$actual_status" = 'running'
actual_base_config=$(docker exec "$container" sha256sum /app/server/dist/config.js | awk '{print $1}')
echo "base_config_sha256=$actual_base_config"
test "$actual_base_config" = '664e72dbfc6fc57d7d5570eb4cdcde1c1804f04efcdf303e350695c3644ba9de'
actual_base_index=$(docker exec "$container" sha256sum /app/server/dist/index.js | awk '{print $1}')
echo "base_index_sha256=$actual_base_index"
test "$actual_base_index" = '19c122901835144d8b0f130c056a127baa3d765b3684391c2866397f1fbaee48'
actual_patch_config=$(sha256sum "$stage/context/config.js" | awk '{print $1}')
echo "patch_config_sha256=$actual_patch_config"
test "$actual_patch_config" = 'c246da77e02e667b65b04f7ee6ebcf6122dbd4ce1acee0a32ccb114d0808dfc6'
actual_patch_index=$(sha256sum "$stage/context/index.js" | awk '{print $1}')
echo "patch_index_sha256=$actual_patch_index"
test "$actual_patch_index" = 'b3d8b8c91e7016b629c26c717c4047a6687c8fb2cda5257a4ba2d020f6fa5cb1'

actual_env_hash=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sort | sha256sum | awk '{print $1}')
echo "env_sha256=$actual_env_hash"
test "$actual_env_hash" = 'c27a08eb7c667c3d02b5dcd291df0eb9a00a56db3217edc1147e9232b09cd1f3'
current_jwt=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sed -n 's/^JWT_SECRET=//p')
echo "jwt_length=${#current_jwt}"
actual_jwt_hash=$(printf '%s' "$current_jwt" | sha256sum | awk '{print $1}')
echo "jwt_sha256=$actual_jwt_hash"
test "$actual_jwt_hash" = '8584bcbaf0c8f5ae8f2dbec178c3a81d36d008f7573d6fa7d58fdae24f7742e4'
test "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sed -n 's/^COOKIE_DOMAIN=//p')" = '.caqis.com'
test "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sed -n 's/^COOKIE_SECURE=//p')" = 'false'

echo 'preconditions=verified'
echo 'config_diff='
diff -u "$stage/base/config.js" "$stage/context/config.js" || test "$?" -eq 1
echo 'index_diff='
diff -u "$stage/base/index.js" "$stage/context/index.js" || test "$?" -eq 1
