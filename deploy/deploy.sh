#!/usr/bin/env bash
# Deploy del backend en la instancia Lightsail.
# git pull + docker compose build/up. Se invoca via SSH:
# manualmente, desde el systemd timer, o desde GitHub Actions (deploy.yml)
set -euo pipefail

cd /opt/crc/api
git fetch origin main
git reset --hard origin/main

mkdir -p /opt/crc/nginx
cp -f /opt/crc/api/docker-compose.yml /opt/crc/docker-compose.yml
cp -rf /opt/crc/api/nginx/. /opt/crc/nginx/

cd /opt/crc
docker compose pull --ignore-pull-failures || true
docker compose build api
docker compose up -d --remove-orphans
docker image prune -f

echo "Deploy OK: $(date -u +%FT%TZ)"
