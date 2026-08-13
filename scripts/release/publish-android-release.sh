#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ "$1" != publish-hgt-android-release ]; then
  echo "explicit publish confirmation is required" >&2
  exit 2
fi

remote_publisher=/tmp/hgt-publish-android-release.mjs
remote_descriptor=/tmp/hgt-android-release.json
container_publisher=/tmp/hgt-publish-android-release.mjs
container_descriptor=/tmp/hgt-android-release.json

test -f "$remote_publisher"
test -f "$remote_descriptor"
cleanup() {
  docker exec hgt-app rm -f "$container_publisher" "$container_descriptor" >/dev/null 2>&1 || true
  rm -f "$remote_publisher" "$remote_descriptor" "$0"
}
trap cleanup EXIT INT TERM

docker cp "$remote_publisher" "hgt-app:$container_publisher"
docker cp "$remote_descriptor" "hgt-app:$container_descriptor"
docker exec hgt-app node "$container_publisher" --confirm-publish --descriptor "$container_descriptor"
