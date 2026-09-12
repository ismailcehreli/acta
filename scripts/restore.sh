#!/usr/bin/env bash
# Restore (§15.6). An **untested backup is not a backup**; this script is the
# exercise described in the deployment guide.
#
# Usage:
#   scripts/restore.sh backups/acta-20260818-120000.tar.gz.enc
#
# The script overwrites the current database and therefore asks for
# confirmation. Set `RESTORE_CONFIRM=yes` for unattended execution.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

BACKUP_FILE="${1:-}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  echo "[restore] ERROR: $*" >&2
  exit 1
}

log() {
  echo "[restore] $*"
}

[[ -n "$BACKUP_FILE" ]] || fail "No backup file was provided. Usage: scripts/restore.sh <file>"
[[ -f "$BACKUP_FILE" ]] || fail "File was not found: $BACKUP_FILE"
[[ -n "${BACKUP_PASSPHRASE:-}" ]] || fail "BACKUP_PASSPHRASE is not set."
[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || fail "POSTGRES_USER / POSTGRES_DB are not set."

if [[ "${RESTORE_CONFIRM:-}" != "yes" ]]; then
  echo "[restore] WARNING: the current database and file stores will be OVERWRITTEN."
  echo "[restore] Target: $POSTGRES_DB"
  read -r -p "[restore] Continue? (yes/no) " response
  [[ "$response" == "yes" ]] || fail "Cancelled."
fi

log "decrypting"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$BACKUP_FILE" -out "$WORK_DIR/archive.tar.gz" \
  -pass env:BACKUP_PASSPHRASE || fail "Could not decrypt the backup (the passphrase may be wrong)."

tar -C "$WORK_DIR" -xzf "$WORK_DIR/archive.tar.gz" || fail "Could not extract the archive."

DATABASE_DUMP="$WORK_DIR/database.dump"
[[ -s "$DATABASE_DUMP" ]] || fail "The archive does not contain a database dump."

# Stop application processes: a client writing during restore would create
# inconsistent data.
log "stopping app and worker"
docker compose stop app worker >/dev/null 2>&1 || true

log "restoring database"
docker compose exec -T postgres pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --clean --if-exists --no-owner \
  < "$DATABASE_DUMP" || fail "pg_restore failed."

ATTACHMENTS_ARCHIVE="$WORK_DIR/attachments.tar"
AVATARS_ARCHIVE="$WORK_DIR/avatars.tar"

if [[ -s "$ATTACHMENTS_ARCHIVE" || -s "$AVATARS_ARCHIVE" ]]; then
  log "restoring file stores"
  docker compose start app >/dev/null
  # Wait for the container to become ready.
  for _ in $(seq 1 30); do
    docker compose exec -T app true >/dev/null 2>&1 && break
    sleep 1
  done
fi

if [[ -s "$ATTACHMENTS_ARCHIVE" ]]; then
  # The directory is a mount point and cannot be removed; clear its contents.
  docker compose exec -T app sh -c 'mkdir -p /data/attachments && find /data/attachments -mindepth 1 -delete' </dev/null
  docker compose exec -T app tar -C /data -xf - < "$ATTACHMENTS_ARCHIVE" \
    || fail "Could not restore attachments."
fi

# Profile pictures are stored in a separate archive. **Older backups may not
# contain it**; that is not an error and existing pictures remain untouched.
if [[ -s "$AVATARS_ARCHIVE" ]]; then
  docker compose exec -T app sh -c 'mkdir -p /data/avatars && find /data/avatars -mindepth 1 -delete' </dev/null
  docker compose exec -T app tar -C /data -xf - < "$AVATARS_ARCHIVE" \
    || fail "Could not restore profile pictures."
else
  log "no profile-picture archive in the backup; existing pictures were left untouched."
fi

log "starting services"
docker compose start app worker >/dev/null

log "finished. Verify the health endpoint and a few records manually."
