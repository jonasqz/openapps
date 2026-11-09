#!/usr/bin/env python3
"""Prueft die laufende Traefik-Konfiguration gegen ADR 0008.

Gegenstueck zu `apps/control-plane/src/infra/gateway-guard.ts`, Zeile fuer
Zeile dieselben vier Pruefungen. Es gibt die Pruefung zweimal, weil sie zu
zwei verschiedenen Zeitpunkten gebraucht wird: beim Start der Control Plane
und beim Nachweis nach einem Coolify-Update, dann ohne laufende Control Plane.
Wird eine der beiden geaendert, gehoert die andere mit geaendert; der Test
`tests/traefik-guard-skript.spec.ts` haelt sie zusammen.

Eingabe auf stdin, ein JSON-Objekt:

    {"routers": [...], "middlewares": [...], "entrypoints": [...],
     "entrypoint": "https"}

Ausgabe: je Pruefung eine Zeile `STATUS\\tLABEL\\tTEXT`, STATUS `ok` oder
`FEHL`.

Exit-Code: 0 alles ok, 1 mindestens ein Verstoss, 2 nichts auswertbar — die
Unterscheidung ist der Zweck. „Ich habe nichts erfahren" ist kein Befund,
„die Antwort ist da und falsch" ist einer.
"""

import json
import sys

OWN_PREFIX = "openapps-"
STRIP = "openapps-strip-auth-headers"
FORWARD_AUTH = "openapps-forward-auth"
CHAIN = [STRIP, FORWARD_AUTH]
CATCH_ALL = "openapps-catch-all"


def plain(name):
    """`openapps-forward-auth@file` -> `openapps-forward-auth`."""
    return str(name).split("@")[0]


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return 2
    if not isinstance(data, dict):
        return 2

    routers = data.get("routers")
    middlewares = data.get("middlewares")
    entrypoints = data.get("entrypoints")
    wanted_entrypoint = data.get("entrypoint") or "https"
    if not all(isinstance(x, list) for x in (routers, middlewares, entrypoints)):
        return 2

    lines = []
    bad = False

    def ok(label, text):
        lines.append(("ok", label, text))

    def fail(label, text):
        nonlocal bad
        bad = True
        lines.append(("FEHL", label, text))

    # 1. Beide Middlewares gibt es, und sie sind enabled.
    by_name = {}
    for entry in middlewares:
        if isinstance(entry, dict) and isinstance(entry.get("name"), str):
            by_name[plain(entry["name"])] = entry
    for name in CHAIN:
        middleware = by_name.get(name)
        if middleware is None:
            fail(name, "FEHLER: fehlt in der laufenden Konfiguration")
        elif middleware.get("status") != "enabled":
            fail(
                name,
                'FEHLER: status "%s", erwartet "enabled"' % middleware.get("status"),
            )
        else:
            ok(name, "vorhanden und enabled")

    # 2. und 3. Jeder unserer Router. Ueber die Ausgabe der API iteriert, nicht
    #    ueber eine Liste erwarteter Namen: ein Router-Typ, den es heute noch
    #    nicht gibt, wird dadurch von selbst mitgeprueft.
    own = [
        entry
        for entry in routers
        if isinstance(entry, dict)
        and isinstance(entry.get("name"), str)
        and entry["name"].startswith(OWN_PREFIX)
    ]
    if not own:
        fail(
            "openapps-* (Router)",
            'FEHLER: kein einziger Router mit dem Praefix "%s" — unsere dynamische '
            "Konfiguration ist nicht geladen" % OWN_PREFIX,
        )
    for router in own:
        name = str(router["name"])
        raw = router.get("middlewares")
        chain = [plain(item) for item in raw] if isinstance(raw, list) else []
        if chain != CHAIN:
            fail(
                name,
                "FEHLER: Kette [%s] statt [%s] — Schutz weg oder Reihenfolge vertauscht"
                % (", ".join(chain), ", ".join(CHAIN)),
            )
        elif router.get("status") != "enabled":
            fail(
                name,
                'FEHLER: status "%s", erwartet "enabled" — dieser Router routet nichts'
                % router.get("status"),
            )
        else:
            ok(name, "Kette steht, enabled")

    # 4. Den Catch-all gibt es. Ohne ihn landet ein unbekannter Pfad in
    #    Traefiks 404 statt im Deny-Backend — und ein 404 ist kein Nein, das
    #    wir gegeben haben.
    if not any(plain(router["name"]) == CATCH_ALL for router in own):
        fail(CATCH_ALL, "FEHLER: der Catch-all fehlt")

    # 5. forwardedHeaders an unserem Entrypoint. Der gehoert Coolify; deshalb
    #    wird er gemessen, nicht gesetzt.
    found = None
    for entry in entrypoints:
        if isinstance(entry, dict) and entry.get("name") == wanted_entrypoint:
            found = entry
            break
    label = "%s.forwardedHeaders" % wanted_entrypoint
    if found is None:
        fail(
            label,
            'FEHLER: Entrypoint "%s" gibt es nicht — unsere Router haengen an nichts'
            % wanted_entrypoint,
        )
    else:
        forwarded = found.get("forwardedHeaders")
        if forwarded in (None, {}):
            ok(label, "leer (kein Client gilt als Proxy)")
        elif not isinstance(forwarded, dict):
            fail(label, "FEHLER: unbekannte Form — nicht als leer zaehlen")
        else:
            fail(
                label,
                "FEHLER: gesetzt (%s) — X-Forwarded-Host waere vom Client bestimmbar "
                "(Spec 1.3)" % ", ".join(sorted(forwarded)),
            )

    for status, label, text in lines:
        sys.stdout.write("%s\t%s\t%s\n" % (status, label, text))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
