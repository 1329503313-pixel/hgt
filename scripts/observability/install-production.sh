#!/bin/sh
set -eu
# First installation for the audited host topology. Subsequent installations
# must audit and update the expected configuration hashes before proceeding.
test "$#" -eq 2
commit=$1
test "$2" = install-hgt-request-logging
case "$commit" in *[!0-9a-f]*|'') exit 2;; esac
test "${#commit}" -eq 40
short=$(printf %.7s "$commit")
incoming="/opt/hgt-observability/incoming-$short"
installed="/opt/hgt-observability/release-$short"
backup="/opt/hgt-observability/backup-$short"
collector=hgt-request-log-collector
test "$(docker inspect -f '{{.Config.Image}}' hgt-app)" = "hgt:$short"
test "$(sha256sum /etc/nginx/nginx.conf | cut -d ' ' -f1)" = c715a23688e1002945dbbc618fff16cb94182750e08de31533b9846ba70cfc64
test "$(sha256sum /etc/nginx/conf.d/tangwuyu.conf | cut -d ' ' -f1)" = bea9360fedde1f816bc5c22fe52745f8f7cb85cb64407257023882a5c04d9071
test "$(sha256sum /etc/nginx/conf.d/wgt.conf | cut -d ' ' -f1)" = 08c315e67667ea5deb5af07e50727f32d8c0e190eb000ca208a3aee3387fa720
test ! -e /etc/nginx/conf.d/00-hgt-request-logging.conf
test ! -e "$installed"
test ! -e "$backup"
! docker inspect "$collector" >/dev/null 2>&1
sh "$incoming/production-preflight.sh"
app_before=$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{json .Config.Env}} {{json .Mounts}}' hgt-app | sha256sum | cut -d ' ' -f1)
success=false
config_changed=false
collector_created=false
cleanup() {
  if [ "$success" != true ]; then
    if [ "$config_changed" = true ]; then
      cp "$backup/tangwuyu.conf" /etc/nginx/conf.d/tangwuyu.conf
      cp "$backup/wgt.conf" /etc/nginx/conf.d/wgt.conf
      rm -f /etc/nginx/conf.d/00-hgt-request-logging.conf
      nginx -t && nginx -s reload
    fi
    if [ "$collector_created" = true ]; then docker rm -f "$collector" >/dev/null; fi
  fi
}
trap cleanup EXIT INT TERM
mkdir -m 750 "$installed" "$backup"
cp "$incoming/nginx-http.conf" "$incoming/nginx-server.conf" "$incoming/nginx-proxy.conf" "$installed/"
cp /etc/nginx/conf.d/tangwuyu.conf /etc/nginx/conf.d/wgt.conf "$backup/"
docker run -d --name "$collector" --restart unless-stopped \
  --memory 128m --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 \
  -p 127.0.0.1:15140:15140/udp \
  --mount type=bind,src=/var/log/hgt/requests,dst=/app/logs/requests \
  -e REQUEST_LOG_DIR=/app/logs/requests -e REQUEST_LOG_SLOW_MS=500 \
  "hgt:$short" node server/dist/nginxLogCollector.js >/dev/null
collector_created=true
sleep 1
test "$(docker inspect -f '{{.State.Running}}' "$collector")" = true
docker logs "$collector" 2>&1 | grep -q 'collector listening'

# Patch only the inspected site blocks, preserving every original line and the
# inherited main access log. Python receives paths as arguments, never code.
python3 - "$installed" "$backup" <<'PY'
from pathlib import Path
import sys
installed, backup = map(Path, sys.argv[1:])
for name, expected_servers, expected_proxies in [('tangwuyu.conf', 2, 1), ('wgt.conf', 3, 1)]:
    source = (backup / name).read_text()
    lines, servers, proxies = [], 0, 0
    for line in source.splitlines(keepends=True):
        lines.append(line)
        if line.strip().startswith('server_name '):
            servers += 1
            lines.append(f'    include {installed}/nginx-server.conf;\n')
            lines.append('    access_log /var/log/nginx/access.log main;\n')
        if line.strip() == 'proxy_pass http://127.0.0.1:4000;':
            proxies += 1
            lines.append(f'        include {installed}/nginx-proxy.conf;\n')
    assert (servers, proxies) == (expected_servers, expected_proxies), 'Unexpected Nginx layout'
    (installed / name).write_text(''.join(lines))
PY
config_changed=true
cp "$installed/nginx-http.conf" /etc/nginx/conf.d/00-hgt-request-logging.conf
cp "$installed/tangwuyu.conf" /etc/nginx/conf.d/tangwuyu.conf
cp "$installed/wgt.conf" /etc/nginx/conf.d/wgt.conf
nginx -t
nginx -s reload
sleep 1
curl -fsS https://hgt.caqis.com/api/health >/dev/null
curl -fsS https://tangwuyu.com/api/health >/dev/null

# A slow upload to a nonexistent API route exercises body receipt through both
# layers without invoking a business handler or modifying application data.
# With the existing Nginx request buffering, a slow upload is slow at Nginx
# but fast at Express. Exercise the two sources independently without changing
# buffering or introducing a production-only slow endpoint.
# Pace individual socket writes. curl --limit-rate can send a small body in a
# single write, delaying the client without making the server request slow.
python3 "$incoming/probe-request-logs.py" "$installed/probe.ids" \
  https://hgt.caqis.com http://127.0.0.1:4000
sleep 1
python3 - "$installed/probe.ids" <<'PY'
from pathlib import Path
import json, sys
expected = dict(line.split() for line in Path(sys.argv[1]).read_text().splitlines())
records = []
for file in Path('/var/log/hgt/requests').glob('requests-*.jsonl'):
    for line in file.read_text().splitlines():
        if any(request_id in line for request_id in expected.values()):
            record = json.loads(line)
            if record.get('requestId') in expected.values(): records.append(record)
for source, request_id in expected.items():
    assert any(record.get('source') == source and record.get('requestId') == request_id for record in records), 'Missing host request log source'
assert all(record['path'] == '/api/__request_log_probe__' for record in records)
print('MERGED_SERVER_NGINX_LOGS=verified')
PY
rm -f "$installed/probe.ids"
test "$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{json .Config.Env}} {{json .Mounts}}' hgt-app | sha256sum | cut -d ' ' -f1)" = "$app_before"
sh "$incoming/production-preflight.sh"
success=true
echo 'NGINX_REQUEST_LOGGING=installed'
echo 'APPLICATION_CONTAINER_ENV_MOUNTS_UNCHANGED=true'
echo 'REQUEST_LOG_HOST_DIR=/var/log/hgt/requests'
echo "NGINX_BACKUP=$backup"
