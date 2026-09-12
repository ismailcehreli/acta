#!/usr/bin/env bash
# Backup (§15.6). The database and file stores are captured as one **consistent
# snapshot**, encrypted, and packaged into a single file.
#
# Order matters: the database is captured first, followed by the files. Because
# attachments are never deleted (§15.4), a file added after the dump may appear
# in the backup as an extra, which is harmless. The reverse order could produce
# an attachment row whose file is missing from the backup.
#
# Usage:
#   scripts/backup.sh [destination-directory]
#
# Required environment variables are read from `.env`. The encryption passphrase
# is `BACKUP_PASSPHRASE`; the script **refuses to run** without it because an
# unencrypted backup violates §15.6.

set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

TARGET_DIR="${1:-${BACKUP_DIR:-$PROJECT_ROOT/backups}}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOCK_FILE="${BACKUP_LOCK_FILE:-${BACKUP_RUNNER_LOCK_FILE:-$PROJECT_ROOT/.acta-backup.lock}}"

WORK_DIR=""
LOCK_ACQUIRED=0
APP_WAS_RUNNING=0
WORKER_WAS_RUNNING=0
APP_STOP_ATTEMPTED=0
WORKER_STOP_ATTEMPTED=0
APP_RESTARTED=0
WORKER_RESTARTED=0
RESTART_SERVICES=1

if [[ "${BACKUP_KEEP_SERVICES_STOPPED:-0}" == "1" ]]; then
  # A broader maintenance operation such as an application reset manages the
  # services after the backup. Restarting them here would create a short write
  # window before the reset.
  RESTART_SERVICES=0
fi

fail() {
  echo "[backup] ERROR: $*" >&2
  exit 1
}

log() {
  echo "[backup] $*"
}

service_is_running() {
  local service="$1"
  local container_id

  if ! container_id="$(docker compose ps --status running -q "$service")"; then
    fail "Could not read the initial state of the $service service."
  fi

  [[ -n "$container_id" ]]
}

# Restart only services that were running and that the backup tried to stop.
# The backup does not change the operating decision for an initially stopped service.
restart_services() {
  local restart_error=0

  if [[ "$RESTART_SERVICES" == "0" ]]; then
    return 0
  fi

  if [[ "$APP_WAS_RUNNING" == "1" && "$APP_STOP_ATTEMPTED" == "1" && "$APP_RESTARTED" == "0" ]]; then
    if docker compose start app >/dev/null 2>&1; then
      APP_RESTARTED=1
    else
      echo "[backup] ERROR: could not restart the app service." >&2
      restart_error=1
    fi
  fi

  if [[ "$WORKER_WAS_RUNNING" == "1" && "$WORKER_STOP_ATTEMPTED" == "1" && "$WORKER_RESTARTED" == "0" ]]; then
    if docker compose start worker >/dev/null 2>&1; then
      WORKER_RESTARTED=1
    else
      echo "[backup] ERROR: could not restart the worker service." >&2
      restart_error=1
    fi
  fi

  return "$restart_error"
}

# One exit handler: a second `trap ... EXIT` does not chain the first one; it
# **replaces it**. Service recovery and cleanup of the plain-text working
# directory therefore live in the same handler (audit 2026-08-24, P4-R2-1/P4-R2-3).
exit_cleanup() {
  local previous_code=$?
  local cleanup_error=0
  trap - EXIT
  set +e

  restart_services || cleanup_error=1

  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR" || {
      echo "[backup] ERROR: could not remove temporary working directory: $WORK_DIR" >&2
      cleanup_error=1
    }
  fi

  if [[ "$LOCK_ACQUIRED" == "1" ]]; then
    flock -u 9 || cleanup_error=1
    exec 9>&-
  fi

  if [[ "$previous_code" == "0" && "$cleanup_error" != "0" ]]; then
    previous_code=1
  fi
  exit "$previous_code"
}

[[ -n "${BACKUP_PASSPHRASE:-}" ]] || fail "BACKUP_PASSPHRASE is not set; refusing to create an unencrypted backup (§15.6)."
[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || fail "POSTGRES_USER / POSTGRES_DB are not set."

command -v docker >/dev/null || fail "docker was not found."
command -v openssl >/dev/null || fail "openssl was not found."
command -v flock >/dev/null || fail "flock was not found (the util-linux package is required)."

if [[ "${BACKUP_LOCK_HELD:-0}" != "1" ]]; then
  # Because the backup stops services, it must be exclusive for the whole
  # application tree. Runners hold this lock for their entire operation so a
  # reset cannot start between the backup and the reset itself.
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    fail "Another backup or maintenance operation is running; the second operation was not started."
  fi
  LOCK_ACQUIRED=1
fi

WORK_DIR="$(mktemp -d)"
trap exit_cleanup EXIT

mkdir -p "$TARGET_DIR"

if service_is_running app; then APP_WAS_RUNNING=1; fi
if service_is_running worker; then WORKER_WAS_RUNNING=1; fi

# **Write-free maintenance window** (audit 2026-08-24, P4-2).
#
# The database dump and file archives are separate steps; if the application can
# write between them, the backup is **not a consistent snapshot**. An avatar is
# a two-part mutation (file + `User.avatarExtension`): if the picture is removed
# after the dump records `png`, the archive has no file and the restored profile
# returns 404. Reordering the steps does not make the mutation atomic; closing
# the window is the only solution.
#
# Postgres remains running because it serves the dump; only **initially running**
# writers are stopped. Recovery is armed before stopping: even if the second
# stop call fails, the first service is restarted.
log "opening write-free window"
if [[ "$APP_WAS_RUNNING" == "1" ]]; then
  APP_STOP_ATTEMPTED=1
  docker compose stop app >/dev/null 2>&1 || fail "could not stop the app service."
fi
if [[ "$WORKER_WAS_RUNNING" == "1" ]]; then
  WORKER_STOP_ATTEMPTED=1
  docker compose stop worker >/dev/null 2>&1 || fail "could not stop the worker service."
fi

# 1. Database. `--clean --if-exists` makes restore repeatable.
log "capturing database: $POSTGRES_DB"
docker compose exec -T postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format=custom \
  --clean --if-exists \
  > "$WORK_DIR/database.dump" || fail "pg_dump failed."

[[ -s "$WORK_DIR/database.dump" ]] || fail "The database dump is empty."

# 2. File stores. Because the application is stopped, volumes are read through
#    a **one-time helper container**: `exec` requires a running container, while
#    `run` can mount the same volumes for reading.
#
#    **There are two separate stores**: attachments and profile pictures. Avatars
#    used to be omitted from backups; after restore, `avatarExtension` remained
#    in the database while the file was missing, so every profile returned 404.
log "capturing file stores"
docker compose run --rm --no-deps --entrypoint sh app -c \
  'mkdir -p /data/attachments /data/avatars && tar -C /data -cf - attachments' \
  > "$WORK_DIR/attachments.tar" || fail "Could not capture attachments."

docker compose run --rm --no-deps --entrypoint sh app -c \
  'tar -C /data -cf - avatars' \
  > "$WORK_DIR/avatars.tar" || fail "Could not capture profile pictures."

log "closing write-free window: starting app and worker"
restart_services || fail "Could not restart services."

# 3. Package and encrypt. The passphrase is read from the environment and is
#    not placed on the command line, where it would appear in the process list.
log "packaging and encrypting"
tar -C "$WORK_DIR" -czf "$WORK_DIR/archive.tar.gz" database.dump attachments.tar avatars.tar

OUTPUT="$TARGET_DIR/acta-$TIMESTAMP.tar.gz.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$WORK_DIR/archive.tar.gz" \
  -out "$OUTPUT" \
  -pass env:BACKUP_PASSPHRASE || fail "Encryption failed."

SIZE="$(du -h "$OUTPUT" | cut -f1)"
log "ready: $OUTPUT ($SIZE)"

# 4. Heartbeat. A failed backup never reaches this point; the `backup` job is
#    considered delayed and the existing alert path (§12.4) emails the system
#    administrator. No separate monitor is needed.
docker compose exec -T postgres psql \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --quiet \
  --command "INSERT INTO \"ScheduledJobStatus\" (\"jobName\", \"lastSuccessAt\", \"lastError\", \"expectedIntervalMinutes\", \"updatedAt\")
             VALUES ('backup', now(), NULL, 1440, now())
             ON CONFLICT (\"jobName\") DO UPDATE
             SET \"lastSuccessAt\" = now(), \"lastError\" = NULL, \"updatedAt\" = now();" \
  >/dev/null || log "WARNING: heartbeat could not be written; the backup exists but will not appear in monitoring."

# 5. Remove old backups (default: 30 days).
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
find "$TARGET_DIR" -name 'acta-*.tar.gz.enc' \
  -type f -mtime "+$RETENTION_DAYS" -print -delete \
  | sed 's/^/[backup] removed (old): /' || true

log "finished. Keep a second copy outside the server (§15.6)."
