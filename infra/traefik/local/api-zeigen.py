#!/usr/bin/env python3
"""Zeigt aus der Traefik-API genau das, was der Startup-Check prueft:
unsere Router mit Status und Middleware-Kette, und unsere Middlewares mit
Status (`apps/control-plane/src/infra/gateway-guard.ts`).

Nur fuer das Nachweis-Protokoll — der Check selbst laeuft in der Control Plane.
"""

import json
import sys

PREFIX = "openapps-"


def own(path):
    with open(path, encoding="utf8") as handle:
        return [
            entry
            for entry in json.load(handle)
            if str(entry.get("name", "")).startswith(PREFIX)
        ]


def main():
    routers, middlewares = sys.argv[1], sys.argv[2]
    for router in own(routers):
        chain = ", ".join(router.get("middlewares") or [])
        print(f'   Router     {router["name"]:38s} status={router.get("status")} [{chain}]')
    for middleware in own(middlewares):
        print(f'   Middleware {middleware["name"]:38s} status={middleware.get("status")}')


if __name__ == "__main__":
    main()
