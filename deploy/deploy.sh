#!/usr/bin/env bash
# Deploy del backend en la instancia Lightsail.
# git pull + docker compose build/up. Pensado para invocarse a mano por ahora
# (via SSH) o desde un systemd timer que corra este mismo script.
set -euo pipefail

cd /opt/crc/api
git fetch origin main
git reset --hard origin/main

cd /opt/crc
if [ ! -f docker-compose.yml ]; then
cp api/docker-compose.yml .
fi
if [ ! -d nginx ]; then
cp -r api/nginx .
fi

docker compose pull --ignore-pull-failures || true
docker compose build api
docker compose up -d --remove-orphans
docker image prune -f

echo "Deploy OK: $(date -u +%FT%TZ)"
