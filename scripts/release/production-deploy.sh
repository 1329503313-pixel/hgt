#!/bin/sh
set -eu

if [ "$#" -ne 5 ]; then
  echo "usage: production-deploy.sh <bundle> <commit> <sha256> <expected-container-id> <confirmation>" >&2
  exit 2
fi

bundle=$1
commit=$2
expected_bundle_hash=$3
expected_container_id=$4
confirmation=$5
current=hgt-app

test "$confirmation" = deploy-hgt-production
case "$commit" in
  *[!0-9a-f]*|'') echo "invalid commit" >&2; exit 2 ;;
esac
test "${#commit}" -eq 40
short=$(printf %.7s "$commit")
image="hgt:$short"
candidate="hgt-app-candidate-$short"
rollback="hgt-app-rollback-$short"
expected_bundle="/opt/hgt-releases/incoming/hgt-production-$short.tar.gz"
release_dir="/opt/hgt-releases/build-$short"
test "$bundle" = "$expected_bundle"
test -f "$bundle"
test "$(sha256sum "$bundle" | cut -d ' ' -f1)" = "$expected_bundle_hash"
test "$(docker inspect -f '{{.Id}}' "$current")" = "$expected_container_id"
test "$(docker inspect -f '{{.State.Running}}' "$current")" = true
test ! -e "$release_dir"
! docker container inspect "$rollback" >/dev/null 2>&1

old_env=$(mktemp)
runtime_env=$(mktemp)
candidate_env=$(mktemp)
candidate_comparable_env=$(mktemp)
final_env=$(mktemp)
old_mounts=$(mktemp)
candidate_mounts=$(mktemp)
final_mounts=$(mktemp)
jwt=''
old_renamed=false
old_stopped=false
deployment_succeeded=false

cleanup() {
  rm -f "$old_env" "$runtime_env" "$candidate_env" "$candidate_comparable_env" "$final_env" \
    "$old_mounts" "$candidate_mounts" "$final_mounts"
  docker rm -f "$candidate" >/dev/null 2>&1 || true
  if [ "$old_renamed" = true ] && [ "$deployment_succeeded" != true ]; then
    docker rm -f "$current" >/dev/null 2>&1 || true
    docker rename "$rollback" "$current" >/dev/null
    docker start "$current" >/dev/null
  elif [ "$old_stopped" = true ] && [ "$deployment_succeeded" != true ]; then
    docker start "$current" >/dev/null
  fi
  if [ -d "$release_dir" ] && [ "$(realpath "$release_dir")" = "$release_dir" ]; then
    rm -rf "$release_dir"
  fi
  rm -f "$bundle"
}
trap cleanup EXIT INT TERM

mkdir -p "$release_dir"
tar -xzf "$bundle" -C "$release_dir"
test ! -e "$release_dir/.env"
test ! -e "$release_dir/.git"

docker build --pull=false -t "$image" "$release_dir"
docker image inspect "$image" >/dev/null
docker run --rm --entrypoint sh "$image" -lc \
  'test ! -e /app/.env; test ! -e /app/apps/server/.env; test ! -e /app/apps/web/.env'

test "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$current")" = mysql-docker_default
test "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$current")" = unless-stopped
test "$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$current")" = '{"4000/tcp":[{"HostIp":"","HostPort":"4000"}]}'

# --volumes-from preserves every named volume and bind mount, including its
# effective read/write permission. Docker may normalize an inherited
# read-only mount from Mode=ro to Mode="", while RW remains false, so compare
# the effective permission rather than that presentation-only Mode field.
docker inspect -f '{{range .Mounts}}{{println .Type "|" .Name "|" .Source "|" .Destination "|" .RW "|" .Propagation}}{{end}}' "$current" | sort > "$old_mounts"
test -s "$old_mounts"

docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$current" | sort > "$old_env"
jwt=$(sed -n 's/^JWT_SECRET=//p' "$old_env")
test "$(grep -c '^JWT_SECRET=' "$old_env")" -eq 1
test -n "$jwt"
jwt_hash=$(printf %s "$jwt" | sha256sum | cut -d ' ' -f1)
test "$(grep -c '^COOKIE_DOMAIN=' "$old_env")" -eq 1
test "$(grep -c '^COOKIE_SECURE=' "$old_env")" -eq 1
test "$(sed -n 's/^COOKIE_DOMAIN=//p' "$old_env")" = .caqis.com
test "$(sed -n 's/^COOKIE_SECURE=//p' "$old_env")" = false
grep -v '^JWT_SECRET=' "$old_env" > "$runtime_env"
chmod 600 "$old_env" "$runtime_env" "$candidate_env" "$candidate_comparable_env" "$final_env" \
  "$old_mounts" "$candidate_mounts" "$final_mounts"
! grep -q '^RELEASE_CANDIDATE=' "$old_env"

docker run -d --name "$candidate" \
  --network mysql-docker_default \
  --restart no \
  -p 127.0.0.1:4001:4000 \
  --env-file "$runtime_env" \
  -e JWT_SECRET="$jwt" \
  -e RELEASE_CANDIDATE=true \
  --volumes-from "$current" \
  "$image" >/dev/null

i=0
until curl -fsS http://127.0.0.1:4001/api/health >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    docker logs --tail 80 "$candidate" >&2
    exit 1
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:4001/ >/dev/null
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$candidate" | sort > "$candidate_env"
test "$(grep -c '^RELEASE_CANDIDATE=true$' "$candidate_env")" -eq 1
grep -v '^RELEASE_CANDIDATE=' "$candidate_env" > "$candidate_comparable_env"
test "$(sha256sum "$candidate_comparable_env" | cut -d ' ' -f1)" = "$(sha256sum "$old_env" | cut -d ' ' -f1)"
test "$(printf %s "$(sed -n 's/^JWT_SECRET=//p' "$candidate_env")" | sha256sum | cut -d ' ' -f1)" = "$jwt_hash"
docker inspect -f '{{range .Mounts}}{{println .Type "|" .Name "|" .Source "|" .Destination "|" .RW "|" .Propagation}}{{end}}' "$candidate" | sort > "$candidate_mounts"
cmp -s "$candidate_mounts" "$old_mounts"
docker rm -f "$candidate" >/dev/null

docker stop -t 20 "$current" >/dev/null
old_stopped=true
docker rename "$current" "$rollback"
old_renamed=true

docker run -d --name "$current" \
  --network mysql-docker_default \
  --restart unless-stopped \
  -p 4000:4000 \
  --env-file "$runtime_env" \
  -e JWT_SECRET="$jwt" \
  --volumes-from "$rollback" \
  "$image" >/dev/null

i=0
until curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    docker logs --tail 80 "$current" >&2
    exit 1
  fi
  sleep 1
done
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$current" | sort > "$final_env"
test "$(sha256sum "$final_env" | cut -d ' ' -f1)" = "$(sha256sum "$old_env" | cut -d ' ' -f1)"
test "$(printf %s "$(sed -n 's/^JWT_SECRET=//p' "$final_env")" | sha256sum | cut -d ' ' -f1)" = "$jwt_hash"
test "$(sed -n 's/^COOKIE_DOMAIN=//p' "$final_env")" = .caqis.com
test "$(sed -n 's/^COOKIE_SECURE=//p' "$final_env")" = false
docker inspect -f '{{range .Mounts}}{{println .Type "|" .Name "|" .Source "|" .Destination "|" .RW "|" .Propagation}}{{end}}' "$current" | sort > "$final_mounts"
cmp -s "$final_mounts" "$old_mounts"

# Keep the rollback armed until public routing and Android credentialed CORS
# have also passed. A failure here still enters the EXIT rollback branch.
curl -fsS https://hgt.caqis.com/api/health >/dev/null
curl -fsS https://hgt.caqis.com/ >/dev/null
cors_headers=$(curl -fsS -D - -o /dev/null -H 'Origin: https://app.caqis.com' 'https://hgt.caqis.com/api/soups?limit=1' | tr -d '\r')
printf '%s\n' "$cors_headers" | grep -qi '^Access-Control-Allow-Origin: https://app.caqis.com$'
printf '%s\n' "$cors_headers" | grep -qi '^Access-Control-Allow-Credentials: true$'

deployment_succeeded=true
echo "DEPLOYMENT=complete"
echo "IMAGE=$image"
echo "CONTAINER_ID=$(docker inspect -f '{{.Id}}' "$current")"
echo "JWT_HASH_UNCHANGED=true"
echo "COOKIE_CONFIG_UNCHANGED=true"
echo "MOUNTS_UNCHANGED=true"
echo "PUBLIC_HEALTH_AND_CORS=ok"
