#!/usr/bin/env bash
# Runs an application-reset request left by the web panel on the host.
#
# Order: claim the request → create an encrypted backup → stop app and worker
# → clear data in one transaction → clear stores → start services. The
# application container is not given access to the Docker socket.

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

LOCK_FILE="${BACKUP_LOCK_FILE:-${BACKUP_RUNNER_LOCK_FILE:-$PROJECT_ROOT/.acta-backup.lock}}"

[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || {
  echo "[reset runner] POSTGRES_USER / POSTGRES_DB are not set." >&2
  exit 1
}

command -v docker >/dev/null || {
  echo "[reset runner] docker was not found." >&2
  exit 1
}
command -v flock >/dev/null || {
  echo "[reset runner] flock was not found." >&2
  exit 1
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

psql() {
  docker compose exec -T postgres psql \
    --no-psqlrc -v ON_ERROR_STOP=1 -Atq \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"
}

log() {
  echo "[reset runner] $*"
}

take_pending_request() {
  psql --command "
    WITH selected_request AS (
      SELECT \"id\"
      FROM \"SystemResetRequest\"
      WHERE \"status\" = 'PENDING'
      ORDER BY \"requestedAt\", \"id\"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE \"SystemResetRequest\" AS request
    SET \"status\" = 'RUNNING', \"startedAt\" = now(), \"message\" = NULL
    FROM selected_request
    WHERE request.\"id\" = selected_request.\"id\"
    RETURNING request.\"id\";
  " | sed -n '1p'
}

request_id="$(take_pending_request)"
if [[ -z "$request_id" ]]; then
  exit 0
fi

TEMP_LOG=""
SERVICES_STOPPED=0
RESET_COMPLETED=0

runner_exit() {
  local exit_code=$?
  local service_error=0
  trap - EXIT
  set +e

  if [[ "$SERVICES_STOPPED" == "1" ]]; then
    docker compose up -d app worker >/dev/null 2>&1 || service_error=1
  fi

  if [[ "$exit_code" != "0" && "$RESET_COMPLETED" == "0" && -n "$request_id" ]]; then
    psql \
      --set="id=$request_id" \
      --set="message=The reset runner could not complete the operation." \
      --command "UPDATE \"SystemResetRequest\"
                 SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                     \"message\" = left(:'message', 1000)
                 WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
      >/dev/null
  fi

  if [[ -n "$TEMP_LOG" && -f "$TEMP_LOG" ]]; then
    rm -f -- "$TEMP_LOG"
  fi

  if [[ "$exit_code" == "0" && "$service_error" != "0" ]]; then
    exit_code=1
  fi
  exit "$exit_code"
}
trap runner_exit EXIT

TEMP_LOG="$(mktemp)"
mkdir -p "${BACKUP_DIR:-$PROJECT_ROOT/backups}"

# If the pre-reset backup fails, data remains unchanged. The backup script would
# normally restart app and worker at the end; we deliberately prevent that here.
# Otherwise a new user operation could enter between the backup and reset.
SERVICES_STOPPED=1
set +e
BACKUP_KEEP_SERVICES_STOPPED=1 BACKUP_LOCK_HELD=1 \
  "$PROJECT_ROOT/scripts/backup.sh" "${BACKUP_DIR:-$PROJECT_ROOT/backups}" >"$TEMP_LOG" 2>&1
backup_exit_code=$?
set -e

if [[ "$backup_exit_code" != "0" ]]; then
  error_message="$(tail -c 1000 "$TEMP_LOG" | tr '\n' ' ')"
  psql \
    --set="id=$request_id" \
    --set="message=$error_message" \
    --command "UPDATE \"SystemResetRequest\"
               SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                   \"message\" = left(:'message', 1000)
               WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
    >/dev/null
  request_id=""
  exit "$backup_exit_code"
fi

log "backup completed; app and worker are already stopped"

docker compose run --rm --no-deps migrate \
  node --import tsx scripts/reset-application.ts "$request_id"

# The database was reset successfully. Clear the application stores as well;
# the mount points themselves are not removed.
docker compose run --rm --no-deps --entrypoint sh app -c \
  'mkdir -p /data/attachments /data/avatars &&
   find /data/attachments -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + &&
   find /data/avatars -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'

# The logo and similar settings may live in the app container's writable layer
# rather than a named volume. Removing the old container clears a stale logo
# that could otherwise survive the reset; the image and persistent file volumes
# are preserved.
docker compose rm -sf app >/dev/null

docker compose up -d app worker >/dev/null
[[ -n "$(docker compose ps --status running -q app)" ]] || {
  echo "[reset runner] could not restart app." >&2
  exit 1
}
[[ -n "$(docker compose ps --status running -q worker)" ]] || {
  echo "[reset runner] could not restart worker." >&2
  exit 1
}
SERVICES_STOPPED=0
RESET_COMPLETED=1
request_id=""
rm -f -- "$TEMP_LOG"
TEMP_LOG=""
log "application reset completed"
