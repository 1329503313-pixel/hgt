"""Paced, side-effect-free requests to a nonexistent API route for diagnostics."""
from pathlib import Path
from urllib.parse import urlsplit
import http.client
import json
import re
import sys
import time


def probe(origin):
    url = urlsplit(origin)
    assert url.scheme in ('http', 'https') and url.hostname and not url.username
    client = http.client.HTTPSConnection if url.scheme == 'https' else http.client.HTTPConnection
    connection = client(url.hostname, url.port, timeout=20)
    body = json.dumps({'diagnostic': 'x' * 4096}).encode()
    try:
        connection.putrequest('POST', '/api/__request_log_probe__')
        connection.putheader('Content-Type', 'application/json')
        connection.putheader('Content-Length', str(len(body)))
        connection.endheaders()
        for offset in range(0, len(body), 512):
            connection.send(body[offset:offset + 512])
            if offset + 512 < len(body):
                time.sleep(0.2)
        response = connection.getresponse()
        request_id = response.getheader('X-Request-Id', '')
        assert response.status == 404, 'Unexpected probe response'
        assert re.fullmatch('[a-f0-9]{32}', request_id), 'Missing request ID'
        response.read()
        return request_id
    finally:
        connection.close()


if __name__ == '__main__':
    assert len(sys.argv) == 4, 'usage: probe-request-logs.py <output> <nginx-origin> <server-origin>'
    records = ['nginx ' + probe(sys.argv[2]), 'server ' + probe(sys.argv[3])]
    Path(sys.argv[1]).write_text('\n'.join(records) + '\n')
