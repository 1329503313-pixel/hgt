#!/bin/sh
set -eu

container=hgt-app
env_file=$(mktemp)
trap 'rm -f "$env_file"' EXIT

echo 'audit=production-predeploy'
printf 'container_id='
docker inspect --format '{{.Id}}' "$container"
printf 'container_name='
docker inspect --format '{{.Name}}' "$container"
printf 'image_ref='
docker inspect --format '{{.Config.Image}}' "$container"
printf 'image_id='
docker inspect --format '{{.Image}}' "$container"
printf 'started_at='
docker inspect --format '{{.State.StartedAt}}' "$container"
printf 'status='
docker inspect --format '{{.State.Status}}' "$container"
printf 'restart='
docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$container"
printf 'network_mode='
docker inspect --format '{{.HostConfig.NetworkMode}}' "$container"
printf 'ports='
docker inspect --format '{{json .HostConfig.PortBindings}}' "$container"
printf 'mounts='
docker inspect --format '{{json .Mounts}}' "$container"
printf 'labels='
docker inspect --format '{{json .Config.Labels}}' "$container"

docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" > "$env_file"
printf 'env_sha256='
sort "$env_file" | sha256sum | cut -d' ' -f1
jwt=$(sed -n 's/^JWT_SECRET=//p' "$env_file")
test -n "$jwt"
printf 'jwt_sha256='
printf '%s' "$jwt" | sha256sum | cut -d' ' -f1

for key in NODE_ENV WEB_ORIGIN APP_ORIGIN PUBLIC_SITE_URL COOKIE_DOMAIN COOKIE_SECURE RUN_DB_MIGRATIONS; do
  value=$(sed -n "s/^${key}=//p" "$env_file")
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$key" "$value"
  else
    printf '%s=<absent>\n' "$key"
  fi
done

printf 'env_key_count='
wc -l < "$env_file" | tr -d ' '
echo 'deploy_dir_listing='
find /opt/hgt -maxdepth 1 -mindepth 1 -printf '%f\n' | sort
printf 'compose_version='
docker compose version --short 2>/dev/null || true
printf 'image_created='
image_id=$(docker inspect --format '{{.Image}}' "$container")
docker image inspect --format '{{.Created}}' "$image_id"
