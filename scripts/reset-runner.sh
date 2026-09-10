#!/usr/bin/env bash
# Web panelinden bırakılan başlangıca dönüş isteğini host üzerinde çalıştırır.
#
# Sıra: isteği al → şifreli yedek al → app ve worker'ı durdur → veriyi tek
# transaction içinde temizle → depoları temizle → servisleri başlat.
# Uygulama konteynerine Docker soketi verilmez.

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

KILIT_DOSYASI="${BACKUP_LOCK_FILE:-${BACKUP_RUNNER_LOCK_FILE:-$KOK/.faaliyet-backup.lock}}"

[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || {
  echo "[başlangıca dönüş koşucu] POSTGRES_USER / POSTGRES_DB tanımlı değil." >&2
  exit 1
}

command -v docker >/dev/null || {
  echo "[başlangıca dönüş koşucu] docker bulunamadı." >&2
  exit 1
}
command -v flock >/dev/null || {
  echo "[başlangıca dönüş koşucu] flock bulunamadı." >&2
  exit 1
}

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
  echo "[başlangıca dönüş koşucu] $*"
}

bekleyen_istegi_al() {
  psql --command "
    WITH secilen AS (
      SELECT \"id\"
      FROM \"SystemResetRequest\"
      WHERE \"status\" = 'PENDING'
      ORDER BY \"requestedAt\", \"id\"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE \"SystemResetRequest\" AS istek
    SET \"status\" = 'RUNNING', \"startedAt\" = now(), \"message\" = NULL
    FROM secilen
    WHERE istek.\"id\" = secilen.\"id\"
    RETURNING istek.\"id\";
  " | sed -n '1p'
}

request_id="$(bekleyen_istegi_al)"
if [[ -z "$request_id" ]]; then
  exit 0
fi

gecici_log=""
servisler_durduruldu=0
sifirlama_tamamlandi=0

kosucu_cikisi() {
  local kod=$?
  local servis_hatasi=0
  trap - EXIT
  set +e

  if [[ "$servisler_durduruldu" == "1" ]]; then
    docker compose up -d app worker >/dev/null 2>&1 || servis_hatasi=1
  fi

  if [[ "$kod" != "0" && "$sifirlama_tamamlandi" == "0" && -n "$request_id" ]]; then
    psql \
      --set="id=$request_id" \
      --set="message=Başlangıca dönüş koşucusu işlemi tamamlayamadı." \
      --command "UPDATE \"SystemResetRequest\"
                 SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                     \"message\" = left(:'message', 1000)
                 WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
      >/dev/null
  fi

  if [[ -n "$gecici_log" && -f "$gecici_log" ]]; then
    rm -f -- "$gecici_log"
  fi

  if [[ "$kod" == "0" && "$servis_hatasi" != "0" ]]; then
    kod=1
  fi
  exit "$kod"
}
trap kosucu_cikisi EXIT

gecici_log="$(mktemp)"
mkdir -p "${BACKUP_DIR:-$KOK/yedek}"

# Reset öncesi yedek başarısızsa veri değişmez. Yedek betiği normalde kendi
# sonunda app ve worker'ı yeniden açar; burada bunu bilinçli olarak engelliyoruz.
# Aksi hâlde yedek ile sıfırlama arasına yeni bir kullanıcı işlemi girebilir.
servisler_durduruldu=1
set +e
BACKUP_KEEP_SERVICES_STOPPED=1 BACKUP_LOCK_HELD=1 \
  "$KOK/scripts/backup.sh" "${BACKUP_DIR:-$KOK/yedek}" >"$gecici_log" 2>&1
backup_kodu=$?
set -e

if [[ "$backup_kodu" != "0" ]]; then
  hata_mesaji="$(tail -c 1000 "$gecici_log" | tr '\n' ' ')"
  psql \
    --set="id=$request_id" \
    --set="message=$hata_mesaji" \
    --command "UPDATE \"SystemResetRequest\"
               SET \"status\" = 'FAILED', \"finishedAt\" = now(),
                   \"message\" = left(:'message', 1000)
               WHERE \"id\" = :'id' AND \"status\" = 'RUNNING';" \
    >/dev/null
  request_id=""
  exit "$backup_kodu"
fi

log "yedek tamamlandı; uygulama ve worker zaten durduruldu"

docker compose run --rm --no-deps migrate \
  node --import tsx scripts/reset-application.ts "$request_id"

# Veritabanı başarıyla sıfırlandı. Uygulama depoları da aynı başlangıç
# durumuna çekilir; bağlama noktalarının kendisi silinmez.
docker compose run --rm --no-deps --entrypoint sh app -c \
  'mkdir -p /veri/ekler /veri/avatarlar &&
   find /veri/ekler -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + &&
   find /veri/avatarlar -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'

# Logo, veritabanı ayarı gibi named volume'larda değil app konteynerinin
# yazılabilir katmanında tutulabilir. Eski konteyneri kaldırmak, sıfırlama
# sonrasında görünmeye devam edebilecek eski logoyu da temizler; image ve
# kalıcı ek/avatar volume'ları korunur.
docker compose rm -sf app >/dev/null

docker compose up -d app worker >/dev/null
[[ -n "$(docker compose ps --status running -q app)" ]] || {
  echo "[başlangıca dönüş koşucu] app yeniden başlatılamadı." >&2
  exit 1
}
[[ -n "$(docker compose ps --status running -q worker)" ]] || {
  echo "[başlangıca dönüş koşucu] worker yeniden başlatılamadı." >&2
  exit 1
}
servisler_durduruldu=0
sifirlama_tamamlandi=1
request_id=""
rm -f -- "$gecici_log"
gecici_log=""
log "başlangıca dönüş tamamlandı"
