#!/usr/bin/env bash
# Backup de MySQL: mysqldump -> gzip -> S3
# Pensado para correr via cron en la instancia Lightsail (fuera del contenedor).
# Requiere que la AWS CLI ya este configurada con un rol/credenciales con permiso
# s3:PutObject sobre el bucket de backups, y que /opt/crc/.env tenga las variables.
set -euo pipefail

ENV_FILE=/opt/crc/.env
BACKUP_BUCKET="${BACKUP_BUCKET:-}"
RETAIN_DAYS=14
TS=$(date +%Y%m%d_%H%M%S)
OUT_DIR=/opt/crc/backups
OUT_FILE="$OUT_DIR/crc_${TS}.sql.gz"

if [ -f "$ENV_FILE" ]; then
set -a
. "$ENV_FILE"
set +a
fi

if [ -z "${BACKUP_BUCKET:-}" ]; then
echo "BACKUP_BUCKET no configurado, aborto." >&2
exit 1
fi

mkdir -p "$OUT_DIR"

docker compose -f /opt/crc/docker-compose.yml exec -T db \
mysqldump -u root -p"${MYSQL_ROOT_PASSWORD}" --single-transaction --routines --triggers "${DB_NAME}" \
| gzip -9 > "$OUT_FILE"

aws s3 cp "$OUT_FILE" "s3://${BACKUP_BUCKET}/mysql/$(basename "$OUT_FILE")"

# Archivos subidos (comprobantes, facturas, CVs, logos): viven en el volumen
# uploads-data y la DB solo guarda el path. Sin esto un restore deja links rotos.
UPLOADS_FILE="$OUT_DIR/crc_uploads_${TS}.tar.gz"
# Blue/green: el slot activo está en /opt/crc/.api-slot (blue|green).
SLOT="$(tr -d '[:space:]' </opt/crc/.api-slot 2>/dev/null || true)"
case "${SLOT}" in blue|green) ;; *) SLOT=blue ;; esac
docker compose -f /opt/crc/docker-compose.yml exec -T "api-${SLOT}" \
tar czf - -C /app/uploads . > "$UPLOADS_FILE"
aws s3 cp "$UPLOADS_FILE" "s3://${BACKUP_BUCKET}/uploads/$(basename "$UPLOADS_FILE")"

# Retencion local: borra backups locales de mas de RETAIN_DAYS dias
find "$OUT_DIR" -name 'crc_*.sql.gz' -mtime +$RETAIN_DAYS -delete
find "$OUT_DIR" -name 'crc_uploads_*.tar.gz' -mtime +$RETAIN_DAYS -delete

echo "Backup OK: $OUT_FILE y $UPLOADS_FILE subidos a s3://${BACKUP_BUCKET}/"
