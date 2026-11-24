# Ein Image fuer alle Standard-Apps des lokalen Betriebs (infra/lokal).
#
# Gebaut wird einmal fuer alle drei, jede mit ihrem eigenen basePath: Next
# backt `OPENAPPS_APP_BASE_PATH` in den Build (templates/starter-app/next.config.js),
# also bekommt jede App ihren eigenen `next build` mit ihrem Pfad. Welche App
# ein Container startet, sagt `LOKAL_APP` im Compose.
#
# Die Env zur Laufzeit kommt **nicht** von hier, sondern von der Control Plane
# (app-start.mjs wartet darauf).

FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# Erst die Workspace-Pakete (SDK und Manifest liefern dist/), dann jede App mit
# ihrem Pfad.
RUN pnpm --filter "@openapps/sdk" --filter "@openapps/app-manifest" build \
  && for app in wiki crm wissen; do \
       OPENAPPS_APP_BASE_PATH="/$app" pnpm --filter "./standard-apps/$app" build || exit 1; \
     done

# Dieselbe UID wie die Control Plane: Sie schreibt Env und Startsignal mit
# Modus 0600 in das gemeinsame Verzeichnis, und nur dieselbe UID darf lesen.
RUN chown -R 9999:0 /repo/standard-apps
USER 9999
CMD ["node", "/repo/infra/lokal/app-start.mjs"]
