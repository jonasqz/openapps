#!/usr/bin/env python3
"""Stub der Control-Plane-Forward-Auth, nur fuer den lokalen Nachweis.

Er ersetzt `apps/control-plane/src/app/api/authz/forward/route.ts` nicht und
bildet dessen Logik auch nicht nach. Er macht genau eines: auf Zuruf 200, 302,
403 oder „zu langsam" antworten, damit der Nachweis aus
`docs/nachweise/dod-02-laeufe/` ohne Datenbank und ohne Better Auth
wiederholbar ist.

Steuerung ueber den Pfad der Originalanfrage (`X-Forwarded-Uri`):

    /deny           -> 403
    /nosession      -> 302 auf den Login
    /slow           -> 3,5 s Pause, dann 200 (muss am Traefik-Timeout sterben)
    /force-allow    -> 200, auch fuer eine nicht registrierte Domain
    alles andere    -> 200 fuer registrierte Hosts, sonst 403
"""

import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REGISTERED = set(
    h.strip()
    for h in os.environ.get(
        "STUB_REGISTERED_HOSTS", "app1.local.test,app2.local.test,nolabels.local.test"
    ).split(",")
    if h.strip()
)
LOGIN_URL = os.environ.get("STUB_LOGIN_URL", "https://control-plane.local.test/login")

# Die fuenf Header aus Spec 3.1. Die Signatur ist hier ein Platzhalter: der
# Nachweis prueft, dass Traefik genau diese fuenf uebernimmt, nicht die
# Kryptografie — die hat ihre eigenen Tests im SDK.
IDENTITY = {
    "X-Auth-User-Id": "usr_stub_1",
    "X-Auth-User-Email": "stub@example.invalid",
    "X-Auth-Groups": "team-a,team-b",
    "X-Auth-Issued-At": "0",
    "X-Auth-Signature": "stub-signature-not-a-real-hmac",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "openapps-forward-auth-stub"

    def log_message(self, fmt, *args):  # ruhiges Log, keine Nutzdaten
        pass

    def _decide(self):
        host = (self.headers.get("X-Forwarded-Host") or "").split(":")[0].lower()
        uri = self.headers.get("X-Forwarded-Uri") or "/"
        path = uri.split("?")[0]

        if path.startswith("/slow"):
            time.sleep(float(os.environ.get("STUB_SLOW_SECONDS", "3.5")))
            return 200, {}, b""
        if path.startswith("/deny"):
            return 403, {}, b"stub: keine Freigabe\n"
        if path.startswith("/nosession"):
            return 302, {"Location": f"{LOGIN_URL}?next=https://{host}{path}"}, b""
        if path.startswith("/force-allow"):
            return 200, dict(IDENTITY), b""
        if host in REGISTERED:
            return 200, dict(IDENTITY), b""
        return 403, {}, b"stub: keine App fuer diese Domain\n"

    def _respond(self):
        if self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        status, headers, body = self._decide()
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = _respond
    do_POST = _respond
    do_HEAD = _respond
    do_PUT = _respond
    do_DELETE = _respond


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 3000), Handler).serve_forever()
