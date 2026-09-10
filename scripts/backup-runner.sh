#!/usr/bin/env bash
# Yedek istek koşucusu.
#
# Bu betik host üzerinde systemd timer ya da cron tarafından dakikada bir
# çalıştırılır. Panelde bırakılan isteği alır, uygulama konteynerlerinin dışında
# backup.sh'i çalıştırır ve sonucu veritabanına yazar.

set -euo pipefail
umask 077

KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KOK"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

HEDEF_DIZIN="${BACKUP_DIR:-$KOK/yedek}"
KILIT_DOSYASI="${BACKUP_LOCK_FILE:-${BACKUP_RUNNER_LOCK_FILE:-$KOK/.faaliyet-backup.lock}}"

[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || {
  echo "[yedek koşucu] POSTGRES_USER / POSTGRES_DB tanımlı değil." >&2
  exit 1
}

command -v docker >/dev/null || {
  echo "[yedek koşucu] docker bulunamadı." >&2
  exit 1
}
command -v flock >/dev/null || {
  echo "[yedek koşucu] flock bulunamadı." >&2
  exit 1
}

# Önceki yedek hâlâ sürüyorsa yeni koşu aynı isteği yeniden ele almasın.
exec 9>"$KILIT_DOSYASI"
if ! flock -n 9; then
  exit 0
fi

psql() {
  docker compose exec -T postgres psql \
    --no-psqlrc -v ON_ERROR_STOP=1 -Atq \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"
}

log() {
  echo "[yedek koşucu] $*"
}

# Bekleyen ilk isteği atomik biçimde çalışana çeker. SKIP LOCKED, aynı hostta
# yanlışlıkla iki koşucu başlasa bile iki sürecin aynı satırı almamasını sağlar.
bekleyen_istegi_al() {
  psql --command "
    WITH secilen AS (
      SELECT \"id\"
      FROM \"BackupRequest\"
      WHERE \"status\" = 'PENDING'
      ORDER BY \"requestedAt\", \"id\"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE \"BackupRequest\" AS istek
    SET \"status\" = 'RUNNING', \"startedAt\" = now(), \"message\" = NULL
    FROM secilen
    WHERE istek.\"id\" = secilen.\"id\"
    RETURNING istek.\"id\";
  " | sed -n '1p'
}

# Günlük istek aynı tabloya yazılır. Son 24 saatte başarılı yedek ya da günlük
# istek varsa yeni bir otomatik istek açılmaz; başarısız bir çalışma her dakika
# yeniden başlatılıp sunucuyu yormaz.
gunluk_istek_olustur() {
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
gecici_log=""

request_id="$(bekleyen_istegi_al)"

if [[ -z "$request_id" ]]; then
  gunluk_istek_olustur
  request_id="$(bekleyen_istegi_al)"
fi

if [[ -z "$request_id" ]]; then
  exit 0
fi

# Beklenmeyen bir hata RUNNING satırını sonsuza kadar kilitlemesin. Normal
# başarıda request_id boşaltılır ve bu işlem yapılmaz.
kosucu_cikisi() {
  local kod=$?
  trap - EXIT
  if [[ "$kod" != "0" && -n "$request_id" ]]; then
    set +e
    psql \
      --set="id=$request_id" \
      --set="message=Koşucu beklenmeyen bir hatayla durdu." \
      --command "UPDATE \"BackupRequest\"
                 SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                     \"message\" = left(:'message', 1000)
                 WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
      >/dev/null
  fi
  exit "$kod"
}
trap kosucu_cikisi EXIT

mkdir -p "$HEDEF_DIZIN"
gecici_log="$(mktemp)"
set +e
BACKUP_LOCK_HELD=1 "$KOK/scripts/backup.sh" "$HEDEF_DIZIN" >"$gecici_log" 2>&1
backup_kodu=$?
set -e

if [[ "$backup_kodu" != "0" ]]; then
  hata_mesaji="$(tail -c 1000 "$gecici_log" | tr '\n' ' ')"
  psql \
    --set="id=$request_id" \
    --set="message=$hata_mesaji" \
    --command "UPDATE \"BackupRequest\"
               SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                   \"message\" = left(:'message', 1000)
               WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
    >/dev/null
  request_id=""
  rm -f -- "$gecici_log"
  exit "$backup_kodu"
fi

dosya="$(find "$HEDEF_DIZIN" -maxdepth 1 -type f -name 'faaliyet-*.tar.gz.enc' -print | sort | tail -n 1)"
if [[ -z "$dosya" ]]; then
  psql \
    --set="id=$request_id" \
    --set="message=Yedek tamamlandı ama çıktı dosyası bulunamadı." \
    --command "UPDATE \"BackupRequest\"
               SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                   \"message\" = left(:'message', 1000)
               WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
    >/dev/null
  request_id=""
  rm -f -- "$gecici_log"
  exit 1
fi

dosya_adi="$(basename "$dosya")"
boyut="$(wc -c <"$dosya" | tr -d '[:space:]')"

psql \
  --set="id=$request_id" \
  --set="file_name=$dosya_adi" \
  --set="size_bytes=$boyut" \
  --command "UPDATE \"BackupRequest\"
             SET \"status\" = 'DONE', \"finishedAt\" = now(),
                 \"fileName\" = :'file_name', \"sizeBytes\" = :size_bytes,
                 \"message\" = 'Yedek dosyası hazır.'
             WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
  >/dev/null

# İzleme ilk başarılı yedekten sonra açılır. Ayar satırı yoksa da koşucu açar;
# kayıt defterindeki varsayılan açıklama burada tekrar edilir.
psql \
  --set="id=$request_id" \
  --command "
  INSERT INTO \"SystemSetting\" (\"key\", \"value\", \"description\", \"updatedAt\")
  VALUES ('backup_monitoring_enabled', 'true', 'Yedekleme izlemesi', now())
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
rm -f -- "$gecici_log"
log "yedek isteği tamamlandı: $dosya_adi ($boyut bayt)"
