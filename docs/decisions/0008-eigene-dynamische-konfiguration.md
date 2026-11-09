# ADR 0008: Eigene Router in Coolifys dynamischer Konfiguration

Stand 2026-11-09 · angenommen
Belegt gegen Coolify **v4.7.1** (Commit `4f56c81`), abgerufen 2026-11-09.

## Kontext

[ADR 0007](0007-eine-domain-pfade-statt-subdomains.md) hat den Weg geöffnet,
die Forward-Auth aus Traefiks **statischer** Konfiguration herauszuholen. Zu
klären war, ob Coolify eine eigene **dynamische** Konfiguration zulässt, die
ein Update übersteht.

## Entscheidung

Ja — und wir nutzen sie. Die Control Plane schreibt
`/data/coolify/proxy/dynamic/openapps.yaml`. Dort stehen Router, Service und
die ForwardAuth-Middleware. **Coolifys statische Datei bleibt unangetastet.**

Apps werden **ohne Domain** deployt, damit Coolify ihnen keinen eigenen Router
gibt. Angesprochen werden sie über einen von uns gesetzten Netz-Alias, nicht
über den Containernamen.

## Was das belegt

| Befund | Beleg |
| --- | --- |
| Der File-Provider ist in Coolifys Default-Konfiguration an, mit `watch=true` | `bootstrap/helpers/proxy.php:774-775` |
| `/traefik/dynamic/` im Container ist `/data/coolify/proxy/dynamic/` auf dem Host | `proxy.php:791`, `app/Models/Server.php:1315-1330`, `config/constants.php:16` |
| Coolify überschreibt dort nur vier **namentlich bekannte** Dateien, kein Glob, kein `rm -rf` | `Server.php:748-783`, `:1005-1017`, `:1120-1247` |
| Das Update-Skript rührt das Verzeichnis nicht an | `scripts/upgrade.sh` nennt `dynamic` nicht |
| Ohne Domain erzeugt Coolify keine einzige Traefik-Label | `bootstrap/helpers/docker.php:1342-1343`, `:1048` |
| Apps bekommen keine Host-Ports, solange `ports_mappings` leer ist | `ApplicationDeploymentJob.php:4785`, `:4902-4903` |
| Coolifys Catch-all hat `priority: -1000` — unsere Router gewinnen | `Server.php:826-827` |

Reservierte Dateinamen, die wir nicht verwenden: `coolify.yaml`,
`default_redirect_503.yaml`, `coolify-maintenance.yaml`,
`default_redirect_404.yaml`.

## Folgen

**Die wichtigste, und sie ist eine Verschiebung, kein Gewinn:** Es gibt keine
Stelle mehr, die die Forward-Auth global erzwingt. Sie muss in **jedem** Router
stehen, den wir schreiben. Das Default-Deny wandert damit von der
Infrastruktur in unseren Konfigurations-Generator.

Das ist der richtige Tausch, aber er ist keiner umsonst: Vorher hing die
Garantie an einer Datei, die uns nicht gehört und die wir nur überwachen
konnten. Jetzt hängt sie an Code, den wir besitzen, testen und im Review-Gate
prüfen. Ein Generator, der einen Router ohne Middleware ausgibt, ist ein
Loch — und genau dafür braucht es einen Test, der es unmöglich macht, nicht
nur einen, der es bemerkt.

**Weiter:**

- **Der Containername ist nicht stabil.** Default ist `<uuid>-<Zeitstempel>`,
  er ändert sich bei jedem Deploy (`docker.php:670-686`,
  `is_consistent_container_name_enabled` default `false`). Wir setzen
  `custom_network_aliases` — der Alias steht in jedem Deploy im Compose und ist
  von uns gewählt. Zusätzlich `is_consistent_container_name_enabled` und
  `custom_internal_name`, als zweiter Halt.
- **Beim Deployen über die API ist `autogenerate_domain` default `true`**
  (`ApplicationsController.php:1690`). Wer `domains` wegläßt, bekommt trotzdem
  eine sslip.io-Domain und damit einen Router. Es muss ausdrücklich
  `autogenerate_domain: false` gesendet werden. Das gehört in den Adapter und
  in einen Test.
- **`custom_labels` ist uneinheitlich kodiert:** Eingang verlangt base64
  (`:5478-5497`), Ausgang liefert je nach Pfad base64 oder Klartext mit
  Zeilenumbrüchen (`Application.php:2885` gegen `ApplicationsController.php:1997`).
  Unser Parser nimmt bereits beides — das war Glück, jetzt ist es belegt.
- **Das API-Token braucht `read:sensitive` oder `root`** plus Team-Admin, sonst
  liefert die API `custom_labels` gar nicht (`ApiSensitiveData.php:14-19`).
- **TLS geht mit:** Der Resolver `letsencrypt` ist in der statischen Datei
  definiert (`proxy.php:776-778`); wir referenzieren ihn nur.
- **Rolling Update:** Während eines Deploys tragen alt und neu denselben Alias,
  Dockers DNS verteilt round-robin — kurzzeitig gehen Aufrufe an die alte
  Fassung. Wer das nicht will, braucht `loadBalancer.healthCheck` im Service.
  Das ist aus dem Code geschlossen, nicht aus einer Quelle belegt.
- **Der Proxy veröffentlicht Port 8080** (`proxy.php:747-752`), das Dashboard
  läuft aber mit `api.insecure=false`. Eine Firewall-Frage, keine
  Coolify-Frage.

## Alternativen

- **Entrypoint-Middleware in der statischen Datei** (bisher). Verworfen und
  jetzt belegt warum: `GetProxyConfiguration` regeneriert die statische
  Konfiguration auf Defaults, wenn die Datenbank leer ist oder der Proxy-Typ
  nicht passt, und mutiert sie über `removeLegacyTraefikDashboardExposure()`
  und `replaceDevHostDockerProxyPaths()`. Eine Änderung, die nur auf der Platte
  steht, ist beim nächsten Proxy-Start weg.
- **Eigener Reverse-Proxy vor Coolify.** Nicht mehr nötig. Bleibt der
  Rückfallweg, falls Coolify das dynamische Verzeichnis in einer späteren
  Fassung doch aufräumt — der Startup-Check würde es melden.
