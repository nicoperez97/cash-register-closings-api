#!/bin/sh
# El volumen uploads-data suele crearse como root; el proceso corre como node.
set -e
mkdir -p /app/uploads
chown -R node:node /app/uploads
exec runuser -u node -- "$@"
