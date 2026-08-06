#!/usr/bin/env bash
# Deploy del backend en la instancia Lightsail.
# git pull + docker compose build/up. Pensado para invocarse a mano por ahora
# (via SSH) o desde GitHub Actions.
set -euo pipefail

cd /opt/crc/api
git fetch origin main
git reset --hard origin/main

cd /opt/crc
if [ ! -f docker-compose.yml ]; then
  cp api/docker-compose.yml .
fi
if [ ! -d nginx ] && [ -d api/nginx ]; then
  cp -r api/nginx .
fi

docker compose pull --ignore-pull-failures || true
docker compose build api

# Evitar "Conflict. The container name ... is already in use" tras recreates fallidos.
docker compose stop api 2>/dev/null || true
conflict_ids="$(docker ps -aq --filter name=crc-api 2>/dev/null || true)"
if [ -n "${conflict_ids}" ]; then
  # shellcheck disable=SC2086
  docker rm -f ${conflict_ids} || true
fi

docker compose up -d --remove-orphans --force-recreate api
docker image prune -f

echo "Deploy OK: $(date -u +%FT%TZ)"
