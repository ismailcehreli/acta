#!/usr/bin/env bash
# Backup request runner.
#
# This script runs once per minute from a systemd timer or cron on the host. It
# claims a request left by the administration panel, runs backup.sh outside the
# application containers, and writes the result to the database.

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

TARGET_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
LOCK_FILE="${BACKUP_LOCK_FILE:-${BACKUP_RUNNER_LOCK_FILE:-$PROJECT_ROOT/.acta-backup.lock}}"

[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || {
  echo "[backup runner] POSTGRES_USER / POSTGRES_DB are not set." >&2
  exit 1
}

command -v docker >/dev/null || {
  echo "[backup runner] docker was not found." >&2
  exit 1
}
command -v flock >/dev/null || {
  echo "[backup runner] flock was not found." >&2
  exit 1
}

# Do not claim the same request while another backup is still running.
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
  echo "[backup runner] $*"
}

# Atomically claim the first pending request. SKIP LOCKED prevents two runners
# accidentally started on the same host from claiming the same row.
take_pending_request() {
  psql --command "
    WITH selected_request AS (
      SELECT \"id\"
      FROM \"BackupRequest\"
      WHERE \"status\" = 'PENDING'
      ORDER BY \"requestedAt\", \"id\"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE \"BackupRequest\" AS request
    SET \"status\" = 'RUNNING', \"startedAt\" = now(), \"message\" = NULL
    FROM selected_request
    WHERE request.\"id\" = selected_request.\"id\"
    RETURNING request.\"id\";
  " | sed -n '1p'
}

# Create the daily scheduled request in the same table. A successful backup or
# scheduled request in the last 24 hours suppresses another automatic request;
# a failed run is not restarted every minute and cannot overload the server.
create_scheduled_request() {
  psql --command "
    INSERT INTO \"BackupRequest\" (\"id\", \"source\", \"requestedById\", \"status\", \"requestedAt\")
    SELECT gen_random_uuid(), 'SCHEDULED', NULL, 'PENDING', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM \"BackupRequest\"
      WHERE \"status\" IN ('PENDING', 'RUNNING')
    )
    AND NOT EXISTS (
      SELECT 1 FROM \"BackupRequest\"
      WHERE \"status\" = 'DONE'
        AND \"finishedAt\" >= now() - interval '24 hours'
    )
    AND NOT EXISTS (
      SELECT 1 FROM \"BackupRequest\"
      WHERE \"source\" = 'SCHEDULED'
        AND \"requestedAt\" >= now() - interval '24 hours'
    )
    ON CONFLICT DO NOTHING;
  " >/dev/null
}

request_id=""
TEMP_LOG=""

request_id="$(take_pending_request)"

if [[ -z "$request_id" ]]; then
  create_scheduled_request
  request_id="$(take_pending_request)"
fi

if [[ -z "$request_id" ]]; then
  exit 0
fi

# Do not leave a RUNNING row locked forever after an unexpected error. On
# normal success request_id is cleared, so this handler does nothing.
runner_exit() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" != "0" && -n "$request_id" ]]; then
    set +e
    psql \
      --set="id=$request_id" \
      --set="message=The backup runner stopped unexpectedly." \
      --command "UPDATE \"BackupRequest\"
                 SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                     \"message\" = left(:'message', 1000)
                 WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
      >/dev/null
  fi
  exit "$exit_code"
}
trap runner_exit EXIT

mkdir -p "$TARGET_DIR"
TEMP_LOG="$(mktemp)"
set +e
BACKUP_LOCK_HELD=1 "$PROJECT_ROOT/scripts/backup.sh" "$TARGET_DIR" >"$TEMP_LOG" 2>&1
backup_exit_code=$?
set -e

if [[ "$backup_exit_code" != "0" ]]; then
  error_message="$(tail -c 1000 "$TEMP_LOG" | tr '\n' ' ')"
  psql \
    --set="id=$request_id" \
    --set="message=$error_message" \
    --command "UPDATE \"BackupRequest\"
               SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                   \"message\" = left(:'message', 1000)
               WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
    >/dev/null
  request_id=""
  rm -f -- "$TEMP_LOG"
  exit "$backup_exit_code"
fi

output_file="$(find "$TARGET_DIR" -maxdepth 1 -type f -name 'acta-*.tar.gz.enc' -print | sort | tail -n 1)"
if [[ -z "$output_file" ]]; then
  psql \
    --set="id=$request_id" \
    --set="message=Backup finished but no output file was found." \
    --command "UPDATE \"BackupRequest\"
               SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                   \"message\" = left(:'message', 1000)
               WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
    >/dev/null
  request_id=""
  rm -f -- "$TEMP_LOG"
  exit 1
fi

file_name="$(basename "$output_file")"
size_bytes="$(wc -c <"$output_file" | tr -d '[:space:]')"

psql \
  --set="id=$request_id" \
  --set="file_name=$file_name" \
  --set="size_bytes=$size_bytes" \
  --command "UPDATE \"BackupRequest\"
             SET \"status\" = 'DONE', \"finishedAt\" = now(),
                 \"fileName\" = :'file_name', \"sizeBytes\" = :size_bytes,
                 \"message\" = 'Backup file is ready.'
             WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
  >/dev/null

# Monitoring is enabled after the first successful backup. The runner creates
# the setting if it does not exist; the registry's default description is
# repeated here.
psql \
  --set="id=$request_id" \
  --command "
  INSERT INTO \"SystemSetting\" (\"key\", \"value\", \"description\", \"updatedAt\")
  VALUES ('backup_monitoring_enabled', 'true', 'Backup monitoring', now())
  ON CONFLICT (\"key\") DO UPDATE
    SET \"value\" = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM \"BackupRequest\"
        WHERE \"status\" = 'DONE' AND \"id\" <> :'id'
      ) THEN 'true'
      ELSE \"SystemSetting\".\"value\"
    END,
    \"updatedAt\" = now();
" >/dev/null

request_id=""
rm -f -- "$TEMP_LOG"
log "backup request completed: $file_name ($size_bytes bytes)"
