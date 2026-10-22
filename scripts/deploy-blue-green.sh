#!/usr/bin/env bash
# Blue/green en /opt/crc: levanta el slot inactivo, espera health, cambia nginx, baja el viejo.
# Uso (en el servidor, con API_IMAGE=ghcr.io/... exportada si aplica):
#   bash /opt/crc/api/scripts/deploy-blue-green.sh
set -euo pipefail

ROOT="${CRC_ROOT:-/opt/crc}"
SLOT_FILE="${ROOT}/.api-slot"
UPSTREAM_FILE="${ROOT}/nginx/upstream.conf"

# Compose siempre con API_IMAGE explícita si viene (evita caer en crc-api:local del default).
compose() {
  if [ -n "${API_IMAGE:-}" ]; then
    sudo env "API_IMAGE=${API_IMAGE}" COMPOSE_BAKE=0 DOCKER_BUILDKIT=1 docker compose "$@"
  else
    sudo env COMPOSE_BAKE=0 DOCKER_BUILDKIT=1 docker compose "$@"
  fi
}

die() {
  echo "::error title=Deploy Backend::$1"
  exit 1
}

log() { echo ">>> $*"; }

# No usar `compose ps <svc>` con pipefail: si el servicio no existe, compose sale 1.
svc_running() {
  local svc="$1"
  local out
  out="$(compose ps --status running --services 2>/dev/null || true)"
  echo "${out}" | grep -qx "${svc}"
}

container_running() {
  local name="$1"
  sudo docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$name"
}

wait_api_health() {
  local svc="$1"
  local i
  log "Esperando health en ${svc} (hasta ~3 min)…"
  for i in $(seq 1 60); do
    if compose exec -T "$svc" node -e "
      require('http').get('http://127.0.0.1:3000/api/v1/health', (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => {
          const ok = r.statusCode === 200 && d.includes('\"ok\":true');
          process.exit(ok ? 0 : 1);
        });
      }).on('error', () => process.exit(1));
    " >/dev/null 2>&1; then
      echo "Health OK (intento ${i})"
      return 0
    fi
    sleep 3
  done
  return 1
}

write_upstream() {
  local slot="$1"
  mkdir -p "${ROOT}/nginx"
  cat >"${UPSTREAM_FILE}" <<EOF
# Generado por deploy-blue-green.sh — no editar a mano en deploy.
upstream crc_api {
  server api-${slot}:3000;
}
EOF
}

nginx_uses_crc_upstream() {
  local conf
  conf="$(compose exec -T nginx sh -c 'cat /etc/nginx/conf.d/default.conf 2>/dev/null' || true)"
  echo "${conf}" | grep -q 'crc_api'
}

ensure_nginx() {
  local slot="$1"
  write_upstream "${slot}"
  if ! svc_running nginx && ! container_running crc-nginx-1 && ! container_running crc-nginx; then
    log "Nginx no está arriba; lo levanto"
    compose up -d --no-deps nginx || die "No se pudo levantar nginx"
    sleep 2
    return 0
  fi
  # El template default.conf solo se regenera al crear el contenedor.
  if ! nginx_uses_crc_upstream; then
    log "Migrando nginx al upstream blue/green (recreate una vez)"
    compose up -d --no-deps --force-recreate nginx || die "recreate nginx falló"
    sleep 2
    return 0
  fi
  compose exec -T nginx nginx -t || die "nginx -t falló (upstream inválido?)"
  compose exec -T nginx nginx -s reload || die "nginx -s reload falló"
}

cd "${ROOT}" || die "No existe ${ROOT}"

[ -f docker-compose.yml ] || die "Falta ${ROOT}/docker-compose.yml"
mkdir -p nginx
[ -f nginx/default.conf ] || die "Falta nginx/default.conf"
[ -f nginx/upstream.conf ] || write_upstream blue

if [ -n "${API_IMAGE:-}" ]; then
  log "API_IMAGE=${API_IMAGE}"
else
  log "Sin API_IMAGE → imagen local crc-api:local (fallback build)"
fi

# Detectar slot activo
active=""
if [ -f "${SLOT_FILE}" ]; then
  active="$(tr -d '[:space:]' <"${SLOT_FILE}" || true)"
fi
if [ "${active}" != "blue" ] && [ "${active}" != "green" ]; then
  if svc_running api-blue || container_running crc-api-blue; then
    active=blue
  elif svc_running api-green || container_running crc-api-green; then
    active=green
  else
    active=""
  fi
fi

legacy=false
if container_running crc-api || container_running crc-api-1; then
  legacy=true
fi

if [ -z "${active}" ]; then
  next=blue
  prev=""
  log "Arranque en frío → slot blue"
else
  if [ "${active}" = "blue" ]; then
    next=green
  else
    next=blue
  fi
  prev="${active}"
  log "Activo=${active} → nuevo=${next} (la vieja sigue hasta el switch)"
fi

log "Asegurar DB"
compose up -d db || die "No se pudo levantar db"

log "Preparar imagen para api-${next}"
if [ -n "${API_IMAGE:-}" ]; then
  sudo docker pull "${API_IMAGE}" || die "docker pull ${API_IMAGE} falló (¿login GHCR?)"
  sudo docker tag "${API_IMAGE}" crc-api:local || true
else
  log "Sin API_IMAGE: se usa crc-api:local (build fallback)"
  if ! sudo docker image inspect crc-api:local >/dev/null 2>&1; then
    die "No hay imagen crc-api:local ni API_IMAGE — corré compose build api-blue antes"
  fi
fi

log "Levantar api-${next} (sin tocar el slot activo)"
compose up -d --no-deps --force-recreate --no-build "api-${next}" \
  || die "docker compose up api-${next} falló"

if ! wait_api_health "api-${next}"; then
  echo "---- Logs api-${next} ----"
  compose logs --tail=100 "api-${next}" || true
  die "api-${next} no pasó /api/v1/health — se deja el slot viejo en tráfico"
fi

log "Apuntar nginx → api-${next}"
ensure_nginx "${next}"

echo "${next}" >"${SLOT_FILE}"

if [ -n "${prev}" ] && [ "${prev}" != "${next}" ]; then
  log "Bajar slot viejo api-${prev}"
  compose stop "api-${prev}" 2>/dev/null || true
  compose rm -f "api-${prev}" 2>/dev/null || true
fi

if [ "${legacy}" = true ]; then
  log "Retirar contenedores legacy crc-api*"
  for name in crc-api crc-api-1; do
    if container_running "${name}" || sudo docker ps -aq --filter "name=^${name}$" 2>/dev/null | grep -q .; then
      sudo docker rm -f "${name}" 2>/dev/null || true
    fi
  done
fi

log "Estado final"
compose ps db "api-${next}" nginx || true
echo "Slot activo: ${next}"
echo "Deploy blue/green OK"
