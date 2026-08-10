#!/bin/sh
set -eu

container=hgt-app
expected_id=625675fc36bd2972477a88376c68ec04da62dd1bcf8ec08a64d201c10028b824
expected_env=c27a08eb7c667c3d02b5dcd291df0eb9a00a56db3217edc1147e9232b09cd1f3
expected_jwt=8584bcbaf0c8f5ae8f2dbec178c3a81d36d008f7573d6fa7d58fdae24f7742e4
expected_config=c246da77e02e667b65b04f7ee6ebcf6122dbd4ce1acee0a32ccb114d0808dfc6
expected_index=b3d8b8c91e7016b629c26c717c4047a6687c8fb2cda5257a4ba2d020f6fa5cb1
expected_bing=0f54d9c09f40485642578a9facb935a037903bd76eedda5ef731de3f3bb0b0e9

actual_id=$(docker inspect --format '{{.Id}}' "$container")
actual_status=$(docker inspect --format '{{.State.Status}}' "$container")
actual_env=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sort | sha256sum | awk '{print $1}')
current_jwt=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sed -n 's/^JWT_SECRET=//p')
actual_jwt=$(printf '%s' "$current_jwt" | sha256sum | awk '{print $1}')
actual_domain=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sed -n 's/^COOKIE_DOMAIN=//p')
actual_secure=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sed -n 's/^COOKIE_SECURE=//p')
actual_config=$(docker exec "$container" sha256sum /app/server/dist/config.js | awk '{print $1}')
actual_index=$(docker exec "$container" sha256sum /app/server/dist/index.js | awk '{print $1}')
actual_bing=$(docker exec "$container" sha256sum /app/apps/web/dist/BingSiteAuth.xml | awk '{print $1}')

test "$actual_id" = "$expected_id"
test "$actual_status" = 'running'
test "$actual_env" = "$expected_env"
test "$actual_jwt" = "$expected_jwt"
test "$actual_domain" = '.caqis.com'
test "$actual_secure" = 'false'
test "$actual_config" = "$expected_config"
test "$actual_index" = "$expected_index"
test "$actual_bing" = "$expected_bing"
curl -fsS --max-time 5 http://127.0.0.1:4000/health >/dev/null

echo 'postdeploy_invariants=verified'
echo "container_id=$actual_id"
echo "container_status=$actual_status"
echo "env_sha256=$actual_env"
echo "jwt_sha256=$actual_jwt"
echo "cookie_domain=$actual_domain"
echo "cookie_secure=$actual_secure"
echo 'cookie_http_only=true'
echo 'cookie_same_site=lax'
echo 'cookie_path=/'
echo 'cookie_max_age_days=30'
echo "config_sha256=$actual_config"
echo "index_sha256=$actual_index"
echo "bing_sha256=$actual_bing"
echo 'container_diff='
docker diff "$container"
