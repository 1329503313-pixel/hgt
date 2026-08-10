#!/bin/sh
set -eu

container=hgt-app
echo "container_status=$(docker inspect -f '{{.State.Status}}' "$container")"
echo "image_ref=$(docker inspect -f '{{.Config.Image}}' "$container")"
echo "image_id=$(docker inspect -f '{{.Image}}' "$container")"
echo "network_mode=$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$container")"
echo "restart_policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$container")"
echo "port_bindings=$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$container")"
echo "binds=$(docker inspect -f '{{json .HostConfig.Binds}}' "$container")"

current_env=$(mktemp)
trap 'rm -f "$current_env"' EXIT
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container" > "$current_env"

echo "env_keys=$(cut -d= -f1 "$current_env" | sort | tr '\n' ',')"
for key in NODE_ENV PORT WEB_ORIGIN PUBLIC_SITE_URL COOKIE_DOMAIN COOKIE_SECURE RUN_DB_MIGRATIONS; do
  value=$(grep -m1 "^${key}=" "$current_env" || true)
  if [ -n "$value" ]; then
    echo "$value"
  else
    echo "$key=<missing>"
  fi
done

jwt=$(sed -n 's/^JWT_SECRET=//p' "$current_env")
test -n "$jwt"
echo "jwt_sha256=$(printf %s "$jwt" | sha256sum | cut -d' ' -f1)"
grep -q '^COOKIE_DOMAIN=.caqis.com$' "$current_env"
grep -q '^COOKIE_SECURE=false$' "$current_env"
echo "auth_invariants=verified"

docker exec "$container" node -e '
  const crypto = require("node:crypto");
  const hash = crypto.createHash("sha256").update(process.env.JWT_SECRET || "").digest("hex");
  process.stdout.write(`effective_jwt_sha256=${hash}\n`);
'
docker exec "$container" sh -c \
  "grep -n -E 'const app = express|app.use\\(cors|app.set\\(\"trust proxy|authCookieBaseOptions|maxAge:' /app/server/dist/index.js | head -20"
docker exec "$container" sh -c \
  "grep -n 'publicSiteUrl' /app/server/dist/config.js | head -5"
docker exec "$container" sh -c "sed -n '215,240p' /app/server/dist/index.js"
