# Inbetriebnahme auf einem Server mit Coolify

Für genau einen Server: Coolifys Proxy, die Control Plane und alle Apps auf
derselben Maschine (ADR 0008). Getestet ist die Annahme gegen Coolify
**v4.7.1**. Ein frischer Lauf auf einem echten Server steht noch aus. Was dabei
zu prüfen ist, steht unten unter „Erster Start“.

Der Stapel ist [`docker-compose.yml`](docker-compose.yml): Control Plane,
Deny-Backend und Postgres, als **eine** Ressource in Coolify.

## Größe des Servers

Coolify selbst will mindestens 2 vCPU und 2 GB RAM. Der Bau des Images
(`next build` und die Installation von semgrep) braucht kurzzeitig mehr. Unter
4 GB RAM vor dem ersten Deploy Swap anlegen, sonst bricht der Build mit „Killed“
ab:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 1. Vorher auf dem Server

```bash
stat -c '%u %a' /data/coolify/proxy/dynamic
```

Erwartet: `9999 700`. Die Control Plane läuft im Container als UID 9999 und
darf nur deshalb in dieses Verzeichnis schreiben. Steht dort eine andere UID,
in Coolify beim Build das Argument `RUNTIME_UID` auf diesen Wert setzen. Die
Rechte auf dem Host **nicht** aufweichen. Das nächste Coolify-Update setzt sie
zurück, und dann scheitert das Schreiben (laut, aber erst dann).

## 2. Was du außerhalb anlegst

| Was                                                                                                     | Wo                                         | Wert für die Env                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| DNS: zwei A-Records auf die IP des Servers                                                              | dein DNS-Anbieter                          | `CONTROL_PLANE_HOST`, `APPS_DOMAIN`                    |
| E-Mail für Let's Encrypt                                                                                | Coolify → Server → Proxy                   | —                                                      |
| OAuth-Client (Typ „Webanwendung“), Redirect-URI `https://<CONTROL_PLANE_HOST>/api/auth/callback/google` | Google Cloud Console → APIs → Anmeldedaten | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`             |
| API-Token mit `root` bzw. `read:sensitive` + `write` + `deploy`                                         | Coolify → Keys & Tokens                    | `COOLIFY_API_TOKEN`                                    |
| UUID des Projekts und des Servers, in denen die Apps landen                                             | Coolify, steht in der URL der Seite        | `COOLIFY_PROJECT_UUID`, `COOLIFY_SERVER_UUID`          |
| Token mit Zugriff auf die App-Repos und das Starter-Template                                            | GitHub → Settings → Developer settings     | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_TEMPLATE_REPO` |

Secrets trägst du **nur** in Coolify ein, nicht in einen Chat und nicht ins
Repo. Zufallswerte erzeugst du auf dem Server:

```bash
openssl rand -base64 48 | tr -d '\n=+/' ; echo
```

Je einmal für `OPENAPPS_AUTH_MASTER_SECRET`, `BETTER_AUTH_SECRET`,
`OPENAPPS_OWNER_PASSWORD` und `POSTGRES_SUPERUSER_PASSWORD`.

## 3. Die Ressource in Coolify

1. Projekt → **New Resource** → Repository (privat über die GitHub-App oder
   per Deploy-Key) → dieses Repo, Branch `main`.
2. Build Pack: **Docker Compose**. Compose-Datei:
   `/infra/betrieb/docker-compose.yml`.
3. **Keinem** der drei Dienste eine Domain geben. Den Router schreibt die
   Control Plane selbst. Ein Router von Coolify hätte unsere Middlewares nicht.
4. Environment: alle Variablen, die Coolify als Pflicht anzeigt.
   `AUTH_ALLOWED_EMAIL_DOMAINS` ist die Domain deiner Firmenadressen,
   `AUTH_BOOTSTRAP_ADMINS` deine eigene Adresse.
5. Deploy.

## 4. Erster Start: was zu prüfen ist

Auf dem Server, in dieser Reihenfolge. Jeder Schritt hat eine erwartete
Ausgabe. Weicht sie ab, nicht weitermachen.

```bash
# Container-Name der Control Plane finden
CP=$(docker ps --format '{{.Names}}' | grep control-plane | head -1)

# a) Migrationen gelaufen, Datei geschrieben
docker logs "$CP" 2>&1 | grep -E 'angewendet|keine neue Migration|Gateway-Konfiguration|ALARM|WARN'
#    erwartet: "angewendet: 0001_… 0013_…" und "Gateway-Konfiguration geschrieben: 2 Router."
#    (Control Plane und Catch-all; jede App bringt einen weiteren)

# b) Die Datei liegt beim Proxy
ls -l /data/coolify/proxy/dynamic/openapps.yaml

# c) Traefik erreicht die Control Plane über den Alias
docker exec coolify-proxy wget -qO- http://openapps-control-plane:3000/healthz
#    erwartet: "ok"

# d) Von außen: ohne Session kein Durchkommen
curl -sI https://<CONTROL_PLANE_HOST>/            # erwartet: 302 auf /login
curl -sI https://<CONTROL_PLANE_HOST>/login       # erwartet: 200
curl -skI https://<APPS_DOMAIN>/irgendwas         # erwartet: 403 oder 302, nie 200

# e) Kann die Control Plane die Traefik-API lesen? (Startup-Check)
docker logs "$CP" 2>&1 | grep -E 'Gateway-Schutz'
```

Zu **d)**: Für `APPS_DOMAIN` gibt es erst ein Let's-Encrypt-Zertifikat, wenn
die erste App einen Router hat. Der Catch-all beantragt absichtlich keines.
Bis dahin liefert Traefik sein Standard-Zertifikat, daher `-k`.

Zu **e)**: Coolify startet Traefik mit `api.insecure=false`. Ob die API unter
`http://coolify-proxy:8080` dann überhaupt antwortet, ist **nicht belegt**.
Antwortet sie nicht, meldet der Startup-Check „nicht prüfbar“ (eine Warnung,
kein Alarm). Dann trägt der Schutz trotzdem, aber die laufende Messung fehlt,
und `check-auth.sh` prüft nur den ersten Teil. Das ist der erste Befund, den
dieser Lauf liefern soll.

Danach meldest du dich unter `https://<CONTROL_PLANE_HOST>` mit Google an.
Steht deine Adresse in `AUTH_BOOTSTRAP_ADMINS`, landest du in
`platform-admins`.

## Was hier bewusst noch fehlt

- **Der Review-Gate kann auf dem Server noch keinen Code prüfen.**
  `POST /api/apps/<app>/deploys` erwartet einen Pfad `repoDir` im Container
  der Control Plane, und niemand legt dort einen Checkout an. Für DoD 2 stört
  das nicht (geprüft wird der Weg zur Control Plane und der Catch-all), für
  DoD 4 schon.
- **Backups.** Das Volume `openapps-postgres` hält Rechte, Audit-Log und
  Gruppen. Coolify sichert es nicht von selbst.
