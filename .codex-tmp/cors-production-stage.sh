#!/bin/sh
set -eu

container=hgt-app
stage=/opt/hgt/maintenance/cors-app-origin-20260810
expected_config=664e72dbfc6fc57d7d5570eb4cdcde1c1804f04efcdf303e350695c3644ba9de
expected_index=19c122901835144d8b0f130c056a127baa3d765b3684391c2866397f1fbaee48
expected_bing=0f54d9c09f40485642578a9facb935a037903bd76eedda5ef731de3f3bb0b0e9

case "$stage" in
  /opt/hgt/maintenance/cors-app-origin-20260810) ;;
  *) echo 'invalid_stage_path'; exit 1 ;;
esac
if [ -e "$stage" ]; then
  echo 'stage_already_exists'
  exit 1
fi

install -d -m 700 "$stage/base" "$stage/context"
docker cp "$container:/app/server/dist/config.js" "$stage/base/config.js"
docker cp "$container:/app/server/dist/index.js" "$stage/base/index.js"
docker cp "$container:/app/apps/web/dist/BingSiteAuth.xml" "$stage/base/BingSiteAuth.xml"

actual_config=$(sha256sum "$stage/base/config.js" | cut -d' ' -f1)
actual_index=$(sha256sum "$stage/base/index.js" | cut -d' ' -f1)
actual_bing=$(sha256sum "$stage/base/BingSiteAuth.xml" | cut -d' ' -f1)
test "$actual_config" = "$expected_config"
test "$actual_index" = "$expected_index"
test "$actual_bing" = "$expected_bing"

printf 'stage=%s\n' "$stage"
printf 'config_sha256=%s\n' "$actual_config"
printf 'index_sha256=%s\n' "$actual_index"
printf 'bing_sha256=%s\n' "$actual_bing"
