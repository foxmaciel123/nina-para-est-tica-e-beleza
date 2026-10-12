#!/bin/sh
# Backup diário do banco da Nina (cron 03:30): cópia local de 7 dias e, se
# /opt/nina/backup-remote.env existir, cópia no Cloudflare R2 (30 dias).
#   backup-remote.env:  BACKUP_URL=https://nina-backups.<conta>.workers.dev
#                       BACKUP_TOKEN=<segredo>
set -e
DEST=/opt/nina/backups
NAME="nina-$(date +%Y%m%d-%H%M).sql.gz"
F="$DEST/$NAME"
docker exec supabase-db pg_dumpall -U supabase_admin --clean --if-exists | gzip > "$F"
find "$DEST" -name 'nina-*.sql.gz' -mtime +7 -delete

if [ -f /opt/nina/backup-remote.env ]; then
  . /opt/nina/backup-remote.env
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 300 -X PUT \
    -H "Authorization: Bearer $BACKUP_TOKEN" -H 'Content-Type: application/gzip' \
    --data-binary "@$F" "$BACKUP_URL/backups/$NAME")
  if [ "$CODE" = "201" ]; then
    echo "$(date -Is) remoto ok $NAME"
  else
    echo "$(date -Is) ERRO envio remoto $NAME (HTTP $CODE)" >&2
    exit 1
  fi
fi
