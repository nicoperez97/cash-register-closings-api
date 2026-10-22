#!/usr/bin/env bash
# Compat: timers / deploys viejos. Delega al blue/green (api-blue / api-green).
# Preferí el workflow de GitHub Actions (pull GHCR). Este script hace build local.
set -euo pipefail

cd /opt/crc/api
git fetch origin main
git reset --hard origin/main

mkdir -p /opt/crc/nginx
cp -f /opt/crc/api/docker-compose.yml /opt/crc/docker-compose.yml
cp -rf /opt/crc/api/nginx/. /opt/crc/nginx/

cd /opt/crc
unset API_IMAGE || true
sudo COMPOSE_BAKE=0 DOCKER_BUILDKIT=1 docker compose build api-blue api-green
bash /opt/crc/api/scripts/deploy-blue-green.sh

echo "Deploy OK: $(date -u +%FT%TZ)"
