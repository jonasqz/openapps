# Ein Image je App des lokalen Betriebs (infra/lokal, ADR 0015). Welche App,
# sagt das Build-Argument LOKAL_APP; apps-dienste.mjs setzt es fuer jeden
# Ordner in standard-apps/.
#
# Next backt `OPENAPPS_APP_BASE_PATH` in den Build
# (templates/starter-app/next.config.js), also baut jedes Image seine App mit
# ihrem Pfad `/<app>`.
#
# Die Env zur Laufzeit kommt **nicht** von hier, sondern von der Control Plane
# (app-start.mjs wartet darauf).

FROM node:22-bookworm-slim
ARG LOKAL_APP
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# Erst die Workspace-Pakete (SDK und Manifest liefern dist/), dann die App mit
# ihrem Pfad.
RUN test -n "$LOKAL_APP" && test -f "standard-apps/$LOKAL_APP/app.json" \
  && pnpm --filter "@openapps/sdk" --filter "@openapps/app-manifest" build \
  && OPENAPPS_APP_BASE_PATH="/$LOKAL_APP" pnpm --filter "./standard-apps/$LOKAL_APP" build

# Dieselbe UID wie die Control Plane: Sie schreibt Env und Startsignal mit
# Modus 0600 in das gemeinsame Verzeichnis, und nur dieselbe UID darf lesen.
ENV LOKAL_APP=$LOKAL_APP
RUN chown -R 9999:0 /repo/standard-apps
USER 9999
CMD ["node", "/repo/infra/lokal/app-start.mjs"]
