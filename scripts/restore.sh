#!/usr/bin/env bash
# Geri yükleme (§15.6). **Denenmemiş yedek, yedek sayılmaz** — bu betik
# kurulum kılavuzundaki tatbikatın aracıdır.
#
# Kullanım:
#   scripts/restore.sh yedek/faaliyet-20260818-120000.tar.gz.enc
#
# Betik mevcut veritabanının üzerine yazar. Bu yüzden onay ister; onaysız
# çalıştırmak için RESTORE_CONFIRM=evet verilmelidir.

set -euo pipefail

KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KOK"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

YEDEK="${1:-}"
CALISMA="$(mktemp -d)"
trap 'rm -rf "$CALISMA"' EXIT

hata() {
  echo "[geri yükleme] HATA: $*" >&2
  exit 1
}

log() {
  echo "[geri yükleme] $*"
}

[[ -n "$YEDEK" ]] || hata "Yedek dosyası verilmedi. Kullanım: scripts/restore.sh <dosya>"
[[ -f "$YEDEK" ]] || hata "Dosya bulunamadı: $YEDEK"
[[ -n "${BACKUP_PASSPHRASE:-}" ]] || hata "BACKUP_PASSPHRASE tanımlı değil."
[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || hata "POSTGRES_USER / POSTGRES_DB tanımlı değil."

if [[ "${RESTORE_CONFIRM:-}" != "evet" ]]; then
  echo "[geri yükleme] UYARI: mevcut veritabanı ve dosya deposu ÜZERİNE yazılacak."
  echo "[geri yükleme] Hedef: $POSTGRES_DB"
  read -r -p "[geri yükleme] Devam edilsin mi? (evet/hayır) " cevap
  [[ "$cevap" == "evet" ]] || hata "Vazgeçildi."
fi

log "çözülüyor"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$YEDEK" -out "$CALISMA/paket.tar.gz" \
  -pass env:BACKUP_PASSPHRASE || hata "Şifre çözülemedi (parola yanlış olabilir)."

tar -C "$CALISMA" -xzf "$CALISMA/paket.tar.gz" || hata "Paket açılamadı."
[[ -s "$CALISMA/veritabani.dump" ]] || hata "Pakette veritabanı dökümü yok."

# Uygulama süreçleri durdurulur: geri yükleme sırasında yazan bir istemci
# tutarsızlık yaratır.
log "uygulama ve işleyici durduruluyor"
docker compose stop app worker >/dev/null 2>&1 || true

log "veritabanı geri yükleniyor"
docker compose exec -T postgres pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --clean --if-exists --no-owner \
  < "$CALISMA/veritabani.dump" || hata "pg_restore başarısız."

if [[ -s "$CALISMA/ekler.tar" || -s "$CALISMA/avatarlar.tar" ]]; then
  log "dosya deposu geri yükleniyor"
  docker compose start app >/dev/null
  # Konteynerin ayağa kalkmasını bekle.
  for _ in $(seq 1 30); do
    docker compose exec -T app true >/dev/null 2>&1 && break
    sleep 1
  done
fi

if [[ -s "$CALISMA/ekler.tar" ]]; then
  # Dizinin kendisi bir bağlama noktasıdır ve silinemez; **içi** boşaltılır.
  docker compose exec -T app sh -c 'mkdir -p /veri/ekler && find /veri/ekler -mindepth 1 -delete' </dev/null
  docker compose exec -T app tar -C /veri -xf - < "$CALISMA/ekler.tar" \
    || hata "Ek dosyaları geri yüklenemedi."
fi

# Profil resimleri ayrı arşivde. **Eski yedeklerde bu dosya yok**; olmaması
# hata değil, o yedeğin avatar taşımadığı anlamına gelir ve mevcut resimlere
# dokunulmaz.
if [[ -s "$CALISMA/avatarlar.tar" ]]; then
  docker compose exec -T app sh -c 'mkdir -p /veri/avatarlar && find /veri/avatarlar -mindepth 1 -delete' </dev/null
  docker compose exec -T app tar -C /veri -xf - < "$CALISMA/avatarlar.tar" \
    || hata "Profil resimleri geri yüklenemedi."
else
  log "yedekte profil resmi arşivi yok; avatarlara dokunulmadı."
fi

log "servisler başlatılıyor"
docker compose start app worker >/dev/null

log "bitti. Sağlık ucunu ve birkaç kaydı gözle doğrulayın."
