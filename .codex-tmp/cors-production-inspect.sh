#!/bin/sh
set -eu

container=hgt-app
echo 'audit=production-layout'
printf 'repo_head='
(cd /opt/hgt && git rev-parse HEAD)
echo 'repo_status='
(cd /opt/hgt && git status --short)
echo 'container_diff='
docker diff "$container"
echo 'container_runtime='
docker inspect --format 'cmd={{json .Config.Cmd}}' "$container"
docker inspect --format 'entrypoint={{json .Config.Entrypoint}}' "$container"
docker inspect --format 'working_dir={{.Config.WorkingDir}}' "$container"
docker inspect --format 'user={{.Config.User}}' "$container"
docker inspect --format 'hostname={{.Config.Hostname}}' "$container"
docker inspect --format 'network_mode={{.HostConfig.NetworkMode}}' "$container"
docker inspect --format 'restart={{.HostConfig.RestartPolicy.Name}}' "$container"
docker inspect --format 'port_bindings={{json .HostConfig.PortBindings}}' "$container"
docker inspect --format 'binds={{json .HostConfig.Binds}}' "$container"
docker inspect --format 'mounts={{json .Mounts}}' "$container"
echo 'cors_source_markers='
docker exec "$container" sh -c "grep -n -E 'webOrigin|appOrigin|corsOrigins|app.use\\(cors' /app/server/dist/config.js /app/server/dist/index.js | head -30"
echo 'cookie_source_markers='
docker exec "$container" sh -c "grep -n -E 'AUTH_COOKIE_NAME|sameSite|httpOnly|maxAge|cookieDomain|cookieSecure' /app/server/dist/index.js | head -50"
echo 'images='
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}' | grep '^hgt:'
printf 'jq_path='
command -v jq || true

env_file=$(mktemp)
trap 'rm -f "$env_file"' EXIT
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" > "$env_file"
for key in JWT_SECRET COOKIE_DOMAIN COOKIE_SECURE; do
  persisted=$(sed -n "s/^${key}=//p" /opt/hgt/.env)
  running=$(sed -n "s/^${key}=//p" "$env_file")
  if [ "$persisted" = "$running" ]; then
    echo "persisted_match_${key}=true"
  else
    echo "persisted_match_${key}=false"
  fi
done
