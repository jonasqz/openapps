# Postgres der Plattform. Dasselbe Major wie die Nachweise (16).
FROM postgres:16

# pgvector (ADR 0025) aus der PGDG-Quelle, die das Basis-Image schon nutzt.
# Das Paket legt nur die Dateien ab; angelegt wird die Erweiterung erst durch
# openapps-vector, als Superuser, im Schema `extensions`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-16-pgvector \
  && rm -rf /var/lib/apt/lists/*

COPY infra/betrieb/postgres/10-owner.sh /docker-entrypoint-initdb.d/10-owner.sh
COPY infra/betrieb/postgres/20-vector.sh /docker-entrypoint-initdb.d/20-vector.sh
COPY infra/betrieb/postgres/vector.sql /usr/local/share/openapps/vector.sql
COPY infra/betrieb/postgres/openapps-vector.sh /usr/local/bin/openapps-vector
RUN chmod 0755 /docker-entrypoint-initdb.d/20-vector.sh /usr/local/bin/openapps-vector \
  && chmod 0644 /usr/local/share/openapps/vector.sql
