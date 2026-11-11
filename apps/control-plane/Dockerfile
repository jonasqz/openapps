# Die Control Plane als Container — fuer Coolify (infra/betrieb/), lokal
# genauso baubar:
#
#   docker build -f apps/control-plane/Dockerfile -t openapps-control-plane .
#
# Kontext ist die Wurzel des Repos, nicht dieses Verzeichnis: Die Control Plane
# importiert @openapps/ui, @openapps/sdk und @openapps/app-manifest als
# TypeScript-Quelle aus dem Workspace.
#
# Absichtlich einfach: Kein `output: standalone`, kein Pruning. Das Image ist
# dadurch groesser, aber es enthaelt genau den Workspace, gegen den
# `pnpm check` gruen war — und `tsx` fuer die Migrationen und den
# Plattform-MCP, der im selben Container mitlaeuft (start.sh).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /repo

# --- Bauen -----------------------------------------------------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Next liest beim Build keine Secrets; die Env kommt erst zur Laufzeit.
ENV NEXT_TELEMETRY_DISABLED=1
# Mit den drei Punkten: erst die Workspace-Pakete, von denen die Control Plane
# abhaengt (@openapps/sdk und @openapps/app-manifest liefern `dist/`), dann sie
# selbst. Ohne sie findet Next `@openapps/sdk` nicht — `dist/` steht in
# .dockerignore und entsteht erst hier.
RUN pnpm --filter "@openapps/control-plane..." build

# --- Laufen ----------------------------------------------------------------
FROM base AS runtime

# Die Scanner des Review-Gates. Fehlen sie, blockiert das Gate jeden Deploy
# (GITLEAKS_BINARY, SEMGREP_BINARY) — also gehoeren sie ins Image.
ARG TARGETARCH
ARG GITLEAKS_VERSION=8.21.2
ARG SEMGREP_VERSION=1.99.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-venv \
  && case "$TARGETARCH" in \
       arm64) GL_ARCH=arm64 ;; \
       *)     GL_ARCH=x64 ;; \
     esac \
  && curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${GL_ARCH}.tar.gz" \
     | tar -xz -C /usr/local/bin gitleaks \
  && python3 -m venv /opt/semgrep \
  && /opt/semgrep/bin/pip install --no-cache-dir "semgrep==${SEMGREP_VERSION}" \
  && ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Laeuft als UID 9999 — derselbe Benutzer, dem Coolify /data/coolify gibt
# (`chown -R 9999:root`, Modus 700). Nur so darf die Control Plane in das
# gemountete /data/coolify/proxy/dynamic schreiben, ohne dass jemand auf dem
# Host Rechte von Hand aufweicht, die das naechste Coolify-Update wieder
# zuruecksetzt. Weicht die UID auf dem Host ab: Build-Argument setzen.
#
# Mit eigenem, beschreibbarem Home: semgrep legt beim Start `~/.semgrep` an.
# Zeigt HOME auf /repo, scheitert das mit „Permission denied", der Scanner
# endet mit Fehler — und das Gate blockiert dann jeden Deploy.
ARG RUNTIME_UID=9999
RUN useradd --uid "${RUNTIME_UID}" --home-dir /home/openapps --create-home --shell /usr/sbin/nologin openapps
ENV HOME=/home/openapps

COPY --from=build --chown=openapps:openapps /repo /repo
USER openapps
WORKDIR /repo/apps/control-plane
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000

# Migrationen, dann Control Plane und Plattform-MCP (start.sh, ADR 0009).
# Scheitert eine Migration, startet nichts.
CMD ["./start.sh"]
