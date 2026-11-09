#!/usr/bin/env python3
"""Dummy-App fuer den lokalen Nachweis: gibt zurueck, was bei ihr ankommt.

Sie ersetzt eine echte App und steht fuer das, was eine echte App laut
`AGENTS.md` Regel 1 tut: sie glaubt den Headern des Gateways und baut keinen
Login. Hier liest sie sie nur vor, damit der Nachweis zeigen kann, welche
`X-Auth-*`-Header angekommen sind — und welche nicht.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME = os.environ.get("APP_NAME", "dummy")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "openapps-dummy-app"

    def log_message(self, fmt, *args):
        pass

    def _respond(self):
        body = json.dumps(
            {
                "app": NAME,
                "path": self.path,
                "auth_headers": {
                    k: v for k, v in self.headers.items() if k.lower().startswith("x-auth-")
                },
            },
            indent=2,
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = _respond
    do_POST = _respond
    do_HEAD = _respond


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
