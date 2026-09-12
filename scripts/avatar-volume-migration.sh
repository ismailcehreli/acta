#!/usr/bin/env bash
set -euo pipefail

# Move profile pictures from the container's writable layer to the persistent
# volume — a **one-time upgrade step** (audit 2026-08-24, P4-3).
#
# The old version left avatars in the app container's writable layer under
# `/app/storage/avatars` because `AVATAR_STORAGE_DIR` was not configured. The
# new version writes them to the `avatar-data` volume under `/data/avatars`.
# Without this migration, the first `docker compose up --build` removes the old
# container and all profile pictures: `avatarExtension` remains in the database,
# but the files disappear and every profile returns 404.
#
# Run this script after pulling the new code, while the old container is still
# running and before building and starting the new image:
#
#   git pull
#   ./scripts/avatar-volume-migration.sh
#   docker compose build && docker compose up -d
#
# Behavior:
#   · A missing or empty source directory is treated as a clean installation;
#     nothing is changed and the script exits with 0.
#   · An existing file with the same name at the destination stops the script.
#     Overwriting silently could lose data when two installations are mixed.
#   · Running the script a second time reports conflicts instead of copying the
#     same files again.

SOURCE_CONTAINER="${1:-}"
SOURCE_DIR="${AVATAR_OLD_DIR:-/app/storage/avatars}"
TARGET_DIR="/data/avatars"

log() { echo "[avatar migration] $*"; }
fail() { echo "[avatar migration] ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker was not found."

if [[ -z "$SOURCE_CONTAINER" ]]; then
  SOURCE_CONTAINER="$(docker compose ps -q app || true)"
fi

[[ -n "$SOURCE_CONTAINER" ]] || fail \
  "Source container was not found. Run this before the upgrade while the old app container is running."

# 1. Check whether the old container contains any files.
COUNT="$(docker exec "$SOURCE_CONTAINER" sh -c \
  "ls -A '$SOURCE_DIR' 2>/dev/null | wc -l" | tr -d ' ')"

if [[ "$COUNT" == "0" ]]; then
  log "no profile pictures found at the old path ($SOURCE_DIR); treating this as a clean installation."
  exit 0
fi

log "found $COUNT files at $SOURCE_DIR"

TEMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

# 2. Copy the files out of the old container.
docker cp "$SOURCE_CONTAINER:$SOURCE_DIR/." "$TEMP_DIR/" \
  || fail "Could not copy files out of the container."

# 3. Start a one-time helper container with the destination volume mounted:
#    `docker cp` requires a running container and cannot copy to a volume directly.
HELPER="$(docker compose run -d --rm --no-deps --entrypoint sh app \
  -c "mkdir -p '$TARGET_DIR' && sleep 300")" \
  || fail "Could not start the helper container."

stop_helper() {
  docker stop "$HELPER" >/dev/null 2>&1 || true
  cleanup
}
trap stop_helper EXIT

# Wait for the container's `mkdir` step to complete.
for _ in $(seq 1 30); do
  docker exec "$HELPER" sh -c "[ -d '$TARGET_DIR' ]" >/dev/null 2>&1 && break
  sleep 1
done

# 4. Check for conflicts; never overwrite silently.
CONFLICTS=""
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  if docker exec "$HELPER" sh -c "[ -e '$TARGET_DIR/$file' ]" >/dev/null 2>&1; then
    CONFLICTS="$CONFLICTS $file"
  fi
done < <(cd "$TEMP_DIR" && ls -A)

if [[ -n "$CONFLICTS" ]]; then
  fail "Files with the same names already exist at the destination:$CONFLICTS
Overwriting could lose data. Decide which copy is correct and move files manually."
fi

# 5. Copy the files to the volume.
docker cp "$TEMP_DIR/." "$HELPER:$TARGET_DIR/" \
  || fail "Could not copy files to the volume."

MOVED="$(docker exec "$HELPER" sh -c "ls -A '$TARGET_DIR' | wc -l" | tr -d ' ')"
[[ "$MOVED" == "$COUNT" ]] \
  || fail "Expected $COUNT files but found $MOVED; migration could not be verified."

log "moved $MOVED profile pictures to the $TARGET_DIR volume."
log "You can continue the upgrade: docker compose build && docker compose up -d"
