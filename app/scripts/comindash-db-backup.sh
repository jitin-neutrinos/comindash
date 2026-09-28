#!/usr/bin/env bash
# comindash-db-backup.sh — off-disk Postgres backup for community-insights.
# Custom-format pg_dump (compressed) + SHA256 manifest + 14-day rotation,
# into ~/Backups/comindash (separate NVFS path from the docker volume).
# Off-machine: set RSYNC_TARGET below once laptop SSH is fixed; rsync is
# best-effort — a failed sync never fails the local backup.
set -euo pipefail

BACKUP_DIR="${HOME}/Backups/comindash"
KEEP_DAYS=14
# Off-machine copy (optional). Examples:
#   RSYNC_TARGET="in-neu-bl-l0518:D:/backups/comindash"   (work laptop, once ssh works)
# Leave empty to skip. Sync failures are logged, never fatal.
RSYNC_TARGET="${RSYNC_TARGET:-}"

CONTAINER="${COMINDASH_DB_CONTAINER:-app-db-1}"
DB_USER="${COMINDASH_DB_USER:-insights}"
DB_NAME="${COMINDASH_DB_NAME:-insights}"

mkdir -p "$BACKUP_DIR"
ts=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/insights-$ts.dump"

# Dump inside the container (pg_dump lives there), stream to host.
if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$out"; then
  echo "FATAL: pg_dump failed" >&2
  rm -f "$out"
  exit 1
fi

size=$(stat -c%s "$out")
sha=$(sha256sum "$out" | cut -d' ' -f1)
if [ "$size" -lt 1024 ]; then
  echo "FATAL: dump suspiciously small ($size bytes) — refusing to record" >&2
  rm -f "$out"
  exit 1
fi
echo "$sha  insights-$ts.dump  $size  $(date -u +%FT%TZ)" >> "$BACKUP_DIR/MANIFEST.sha256"

# Rotation: drop dumps older than KEEP_DAYS (by mtime), then prune manifest lines.
find "$BACKUP_DIR" -name 'insights-*.dump' -mtime +"$KEEP_DAYS" -delete
grep -vE "insights-[0-9T]+Z\.dump" "$BACKUP_DIR/MANIFEST.sha256" > /tmp/m.$$ || true
while read -r line; do
  f=$(echo "$line" | awk '{print $2}')
  [ -f "$BACKUP_DIR/$f" ] && echo "$line" >> /tmp/m.$$
done < "$BACKUP_DIR/MANIFEST.sha256"
mv /tmp/m.$$ "$BACKUP_DIR/MANIFEST.sha256"

# Off-machine best-effort copy.
if [ -n "$RSYNC_TARGET" ]; then
  if rsync -az --timeout=60 "$out" "$RSYNC_TARGET/" 2>>"$BACKUP_DIR/rsync.log"; then
    echo "$(date -u +%FT%TZ) synced $f to $RSYNC_TARGET" >> "$BACKUP_DIR/rsync.log"
  else
    echo "$(date -u +%FT%TZ) SYNC-FAILED (non-fatal): $RSYNC_TARGET" >> "$BACKUP_DIR/rsync.log"
  fi
fi

kept=$(ls -1 "$BACKUP_DIR"/insights-*.dump 2>/dev/null | wc -l)
echo "OK $out ($((size/1024)) KB, sha256 $sha) — $kept dump(s) retained"
