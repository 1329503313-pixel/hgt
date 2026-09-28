#!/bin/sh
set -eu

if [ "$#" -ne 5 ] && [ "$#" -ne 6 ] && [ "$#" -ne 7 ] && [ "$#" -ne 8 ] && [ "$#" -ne 9 ]; then
  echo "usage: production-deploy.sh <bundle> <commit> <sha256> <expected-container-id> <confirmation>" >&2
  exit 2
fi

bundle=$1
commit=$2
expected_bundle_hash=$3
expected_container_id=$4
confirmation=$5
voice_env=${6:-}
if [ "$voice_env" = - ]; then voice_env=''; fi
image_bundle=${7:-}
image_bundle_hash=${8:-}
sms_env=''
if [ "$#" -eq 7 ]; then
  sms_env=$7
  image_bundle=''
  image_bundle_hash=''
elif [ "$#" -eq 9 ]; then
  sms_env=$9
fi
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
expected_env=$(mktemp)
runtime_env=$(mktemp)
candidate_env=$(mktemp)
candidate_comparable_env=$(mktemp)
final_env=$(mktemp)
old_mounts=$(mktemp)
expected_mounts=$(mktemp)
candidate_mounts=$(mktemp)
final_mounts=$(mktemp)
jwt=''
old_renamed=false
old_stopped=false
deployment_succeeded=false

cleanup() {
  rm -f "$old_env" "$expected_env" "$runtime_env" "$candidate_env" "$candidate_comparable_env" "$final_env" \
    "$old_mounts" "$expected_mounts" "$candidate_mounts" "$final_mounts"
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

if [ -n "$image_bundle" ]; then
  test "$image_bundle" = "/opt/hgt-releases/incoming/hgt-image-$short.tar.gz"
  test "$(sha256sum "$image_bundle" | cut -d ' ' -f1)" = "$image_bundle_hash"
  docker load -i "$image_bundle"
  test "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$commit"
else
  # Serialize compiler stages on resource-constrained production hosts.
  docker build --pull=false --target server-builder "$release_dir"
  docker build --pull=false --target web-builder "$release_dir"
  docker build --pull=false -t "$image" "$release_dir"
fi
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

# Preserve all existing mounts; add only the host request log directory.
# Refuse a conflicting existing mount instead of hiding user data.
cp "$old_mounts" "$expected_mounts"
set --
log_mount=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/logs/requests"}}{{.Type}}|{{.Source}}|{{.RW}}{{end}}{{end}}' "$current")
if [ -n "$log_mount" ]; then
  test "$log_mount" = 'bind|/var/log/hgt/requests|true'
else
  mkdir -p /var/log/hgt/requests
  chmod 750 /var/log/hgt/requests
  set -- --mount type=bind,src=/var/log/hgt/requests,dst=/app/logs/requests
  printf '%s\n' 'bind |  | /var/log/hgt/requests | /app/logs/requests | true | rprivate' >> "$expected_mounts"
  sort -o "$expected_mounts" "$expected_mounts"
fi

docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$current" | sort > "$old_env"
jwt=$(sed -n 's/^JWT_SECRET=//p' "$old_env")
test "$(grep -c '^JWT_SECRET=' "$old_env")" -eq 1
test -n "$jwt"
jwt_hash=$(printf %s "$jwt" | sha256sum | cut -d ' ' -f1)
test "$(grep -c '^COOKIE_DOMAIN=' "$old_env")" -eq 1
test "$(grep -c '^COOKIE_SECURE=' "$old_env")" -eq 1
test "$(sed -n 's/^COOKIE_DOMAIN=//p' "$old_env")" = .caqis.com
test "$(sed -n 's/^COOKIE_SECURE=//p' "$old_env")" = false
cp "$old_env" "$expected_env"
if [ -n "$voice_env" ]; then
  test "$voice_env" = "/opt/hgt-releases/incoming/voice-$short/runtime.env"
  test -f "$voice_env"
  # Never source the file. Only these RTC values may differ from the old container.
  test "$(wc -l < "$voice_env" | tr -d ' ')" -eq 6
  for key in VOICE_ROOMS_ENABLED TRTC_ADVANCED_PERMISSION TRTC_SDK_APP_ID TRTC_SDK_SECRET TRTC_SECRET_ID TRTC_SECRET_KEY; do
    test "$(grep -Ec "^${key}=[A-Za-z0-9_+/=.-]+$" "$voice_env")" -eq 1
  done
  grep -qx 'VOICE_ROOMS_ENABLED=true' "$voice_env"
  grep -qx 'TRTC_ADVANCED_PERMISSION=true' "$voice_env"
  grep -Eq '^TRTC_SDK_APP_ID=[1-9][0-9]*$' "$voice_env"
  ! grep -Eq '^TRTC_(SDK_SECRET|SECRET_ID|SECRET_KEY)_FILE=' "$old_env"
  grep -Ev '^(VOICE_ROOMS_ENABLED|TRTC_ADVANCED_PERMISSION|TRTC_SDK_APP_ID|TRTC_SDK_SECRET|TRTC_SECRET_ID|TRTC_SECRET_KEY)=' "$old_env" > "$expected_env"
  cat "$voice_env" >> "$expected_env"
  sort -o "$expected_env" "$expected_env"
fi
# Only the five SMS settings may be added or replaced. Keep the file private
# and never print its contents or source it as shell code.
if [ -n "$sms_env" ]; then
  test "$sms_env" = "/opt/hgt-releases/incoming/sms-$short/runtime.env"
  test -f "$sms_env"
  test "$(wc -l < "$sms_env" | tr -d ' ')" -eq 5
  for key in ALIYUN_SMS_ENDPOINT ALIYUN_SMS_ACCESS_KEY_ID ALIYUN_SMS_ACCESS_KEY_SECRET ALIYUN_SMS_SIGN_NAME ALIYUN_SMS_VERIFICATION_TEMPLATE_CODE; do
    test "$(grep -c "^${key}=[^=][^=]*$" "$sms_env")" -eq 1
  done
  grep -Eq '^ALIYUN_SMS_VERIFICATION_TEMPLATE_CODE=SMS_[0-9]+$' "$sms_env"
  grep -Eq '^ALIYUN_SMS_ENDPOINT=[A-Za-z0-9.-]+$' "$sms_env"
  grep -Ev '^(ALIYUN_SMS_ENDPOINT|ALIYUN_SMS_ACCESS_KEY_ID|ALIYUN_SMS_ACCESS_KEY_SECRET|ALIYUN_SMS_SIGN_NAME|ALIYUN_SMS_VERIFICATION_TEMPLATE_CODE)=' "$expected_env" > "$runtime_env"
  cat "$sms_env" >> "$runtime_env"
  sort "$runtime_env" > "$expected_env"
fi
# Never replace an existing custom request-log directory silently; it needs a
# matching audited host mount first.
if grep -q '^REQUEST_LOG_DIR=' "$expected_env"; then
  grep -qx 'REQUEST_LOG_DIR=/app/logs/requests' "$expected_env"
else
  printf '%s\n' 'REQUEST_LOG_DIR=/app/logs/requests' >> "$expected_env"
  sort -o "$expected_env" "$expected_env"
fi
grep -v '^JWT_SECRET=' "$expected_env" > "$runtime_env"
chmod 600 "$old_env" "$expected_env" "$runtime_env" "$candidate_env" "$candidate_comparable_env" "$final_env" \
  "$old_mounts" "$expected_mounts" "$candidate_mounts" "$final_mounts"
! grep -q '^RELEASE_CANDIDATE=' "$old_env"

docker run -d --name "$candidate" \
  --network mysql-docker_default \
  --restart no \
  -p 127.0.0.1:4001:4000 \
  --env-file "$runtime_env" \
  -e JWT_SECRET="$jwt" \
  -e RELEASE_CANDIDATE=true \
  --volumes-from "$current" \
  "$@" \
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
test "$(sha256sum "$candidate_comparable_env" | cut -d ' ' -f1)" = "$(sha256sum "$expected_env" | cut -d ' ' -f1)"
test "$(printf %s "$(sed -n 's/^JWT_SECRET=//p' "$candidate_env")" | sha256sum | cut -d ' ' -f1)" = "$jwt_hash"
docker inspect -f '{{range .Mounts}}{{println .Type "|" .Name "|" .Source "|" .Destination "|" .RW "|" .Propagation}}{{end}}' "$candidate" | sort > "$candidate_mounts"
cmp -s "$candidate_mounts" "$expected_mounts"
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
  "$@" \
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
test "$(sha256sum "$final_env" | cut -d ' ' -f1)" = "$(sha256sum "$expected_env" | cut -d ' ' -f1)"
test "$(printf %s "$(sed -n 's/^JWT_SECRET=//p' "$final_env")" | sha256sum | cut -d ' ' -f1)" = "$jwt_hash"
test "$(sed -n 's/^COOKIE_DOMAIN=//p' "$final_env")" = .caqis.com
test "$(sed -n 's/^COOKIE_SECURE=//p' "$final_env")" = false
docker inspect -f '{{range .Mounts}}{{println .Type "|" .Name "|" .Source "|" .Destination "|" .RW "|" .Propagation}}{{end}}' "$current" | sort > "$final_mounts"
cmp -s "$final_mounts" "$expected_mounts"

# Keep the rollback armed until public routing and Android credentialed CORS
# have also passed. A failure here still enters the EXIT rollback branch.
curl -fsS https://hgt.caqis.com/api/health >/dev/null
curl -fsS https://hgt.caqis.com/ >/dev/null
cors_headers=$(curl -fsS -D - -o /dev/null -H 'Origin: https://app.caqis.com' 'https://hgt.caqis.com/api/soups?limit=1' | tr -d '\r')
printf '%s\n' "$cors_headers" | grep -qi '^Access-Control-Allow-Origin: https://app.caqis.com$'
printf '%s\n' "$cors_headers" | grep -qi '^Access-Control-Allow-Credentials: true$'
if [ -n "$voice_env" ]; then
  curl -fsS http://127.0.0.1:4000/api/online-soup/voice/capabilities | grep -q '"enabled":true'
fi

deployment_succeeded=true
echo "DEPLOYMENT=complete"
echo "IMAGE=$image"
echo "CONTAINER_ID=$(docker inspect -f '{{.Id}}' "$current")"
echo "JWT_HASH_UNCHANGED=true"
echo "COOKIE_CONFIG_UNCHANGED=true"
echo "EXISTING_MOUNTS_PRESERVED=true"
echo "REQUEST_LOG_HOST_DIR=/var/log/hgt/requests"
echo "EXPECTED_ENVIRONMENT_MATCHED=true"
echo "PUBLIC_HEALTH_AND_CORS=ok"
