#!/usr/bin/env python3
"""Stub der Control-Plane-Forward-Auth, nur fuer den lokalen Nachweis.

Er ersetzt `apps/control-plane/src/app/api/authz/forward/route.ts` nicht und
bildet dessen Logik auch nicht nach. Er macht genau eines: auf Zuruf 200, 302,
403 oder „zu langsam" antworten, damit der Nachweis aus
`docs/nachweise/dod-02-laeufe/` ohne Datenbank und ohne Better Auth
wiederholbar ist.

Was sich mit ADR 0007/0008 geaendert hat: Entschieden wird ueber den **Pfad**,
nicht ueber den Host. Alle Apps liegen unter derselben Domain; das erste
Pfadsegment sagt, welche App gemeint ist.

Steuerung ueber den Pfad der Originalanfrage (`X-Forwarded-Uri`):

    /<app>/deny        -> 403
    /<app>/nosession   -> 302 auf den Login
    /<app>/slow        -> 3,5 s Pause, dann 200 (soll am Timeout sterben)
    /force-allow...    -> 200, obwohl kein App-Pfad — damit der Nachweis
                          zeigen kann, dass das Deny-Backend unabhaengig sperrt
    /<freigegebene App>-> 200 mit den fuenf Identitaets-Headern
    alles andere       -> 403 (kein App-Pfad, keine Freigabe)
"""

import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APPS_DOMAIN = os.environ.get("STUB_APPS_DOMAIN", "intern.local.test").lower()
CONTROL_PLANE_HOST = os.environ.get("STUB_CONTROL_PLANE_HOST", "control-plane.local.test").lower()
ALLOWED_APPS = set(
    name.strip()
    for name in os.environ.get("STUB_ALLOWED_APPS", "app1,app2,ohne-router").split(",")
    if name.strip()
)
LOGIN_URL = os.environ.get("STUB_LOGIN_URL", "https://control-plane.local.test/login")

# Pfade der Control Plane, die ohne Session erreichbar sind (Spec 1.3). Die
# echte Liste steht im Code der Route, nicht hier.
PUBLIC_CONTROL_PLANE_PREFIXES = ("/login", "/api/auth/", "/api/authz/forward", "/healthz")

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


def app_name_from_path(path):
    segments = [segment for segment in path.split("/") if segment]
    return segments[0] if segments else None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "openapps-forward-auth-stub"

    def log_message(self, fmt, *args):  # ruhiges Log, keine Nutzdaten
        pass

    def _decide(self):
        host = (self.headers.get("X-Forwarded-Host") or "").split(":")[0].lower()
        uri = self.headers.get("X-Forwarded-Uri") or "/"
        path = uri.split("?")[0]

        # Schritt 1a: die Control Plane selbst.
        if host == CONTROL_PLANE_HOST:
            if any(path.startswith(prefix) for prefix in PUBLIC_CONTROL_PLANE_PREFIXES):
                return 200, {}, b""
            return 302, {"Location": f"{LOGIN_URL}?next=https://{host}{path}"}, b""

        rest = path[len(f"/{app_name_from_path(path) or ''}") :] or "/"
        if rest.startswith("/slow"):
            time.sleep(float(os.environ.get("STUB_SLOW_SECONDS", "3.5")))
            return 200, dict(IDENTITY), b""
        if rest.startswith("/deny"):
            return 403, {}, b"stub: keine Freigabe\n"
        if rest.startswith("/nosession"):
            return 302, {"Location": f"{LOGIN_URL}?next=https://{host}{path}"}, b""

        # Absichtlich freigegeben, obwohl es kein App-Pfad ist: Der Nachweis
        # soll zeigen, dass das Deny-Backend auch dann sperrt, wenn die Control
        # Plane durchlaesst. Zwei Schichten, die unabhaengig Nein sagen.
        if path.startswith("/force-allow"):
            return 200, dict(IDENTITY), b""

        app = app_name_from_path(path)
        if host == APPS_DOMAIN and app in ALLOWED_APPS:
            return 200, dict(IDENTITY), b""
        return 403, {}, b"stub: kein App-Pfad oder keine Freigabe\n"

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
