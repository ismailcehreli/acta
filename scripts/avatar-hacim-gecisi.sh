#!/usr/bin/env bash
set -euo pipefail

# Profil resimlerini konteyner içinden kalıcı hacme taşır — **tek seferlik
# yükseltme adımı** (denetim 24.08.2026, P4-3).
#
# Eski sürümde `AVATAR_STORAGE_DIR` tanımlı değildi ve avatarlar app
# konteynerinin yazılabilir katmanında, `/app/storage/avatars` altında
# duruyordu. Yeni sürüm bunları `avatar-data` hacmine, `/veri/avatarlar`
# altına yazıyor. Arada bir taşıma adımı olmadan yükseltmenin **ilk**
# `docker compose up --build` çağrısı eski konteyneri kaldırır ve bütün
# profil resimlerini götürür: veritabanındaki `avatarExtension` kalır, dosya
# gider, her profil 404 döner. Yani düzeltmenin kendisi tam olarak gidermek
# istediği kaybı yaratır.
#
# Bu betik yeni kod çekildikten sonra, fakat eski konteyner hâlâ ayaktayken
# ve yeni imaj derlenip `up` edilmeden önce çalışır:
#
#   git pull
#   ./scripts/avatar-hacim-gecisi.sh
#   docker compose build && docker compose up -d
#
# Davranış:
#   · Kaynak dizin yoksa ya da boşsa: temiz kurulum sayılır, hiçbir şey
#     yapılmaz ve 0 ile çıkılır.
#   · Hedefte aynı adlı dosya varsa **durulur**. Sessizce ezmek, iki kurulumun
#     karıştığı bir durumda veri kaybettirir; karar insana bırakılır.
#   · Aynı betik ikinci kez çalıştırıldığında (kaynak boşaltılmadıysa) hedef
#     dosyalar zaten yerinde olduğu için çakışma raporlanır; tekrar kopyalama
#     yapılmaz.

KAYNAK_KONTEYNER="${1:-}"
KAYNAK_DIZIN="${AVATAR_ESKI_DIZIN:-/app/storage/avatars}"
HEDEF_DIZIN="/veri/avatarlar"

log() { echo "[avatar geçişi] $*"; }
hata() { echo "[avatar geçişi] HATA: $*" >&2; exit 1; }

command -v docker >/dev/null || hata "docker bulunamadı."

if [[ -z "$KAYNAK_KONTEYNER" ]]; then
  KAYNAK_KONTEYNER="$(docker compose ps -q app || true)"
fi

[[ -n "$KAYNAK_KONTEYNER" ]] || hata \
  "Kaynak konteyner bulunamadı. Yükseltmeden **önce**, eski app konteyneri ayaktayken çalıştırın."

# 1. Kaynakta dosya var mı? Konteyner içindeki eski yol.
SAYI="$(docker exec "$KAYNAK_KONTEYNER" sh -c \
  "ls -A '$KAYNAK_DIZIN' 2>/dev/null | wc -l" | tr -d ' ')"

if [[ "$SAYI" == "0" ]]; then
  log "eski yolda ($KAYNAK_DIZIN) profil resmi yok; temiz kurulum sayılıyor."
  exit 0
fi

log "$SAYI dosya bulundu: $KAYNAK_DIZIN"

GECICI="$(mktemp -d)"
temizle() { rm -rf "$GECICI"; }
trap temizle EXIT

# 2. Konteynerden dışarı al.
docker cp "$KAYNAK_KONTEYNER:$KAYNAK_DIZIN/." "$GECICI/" \
  || hata "Dosyalar konteynerden alınamadı."

# 3. Hedef hacmi bağlayan **tek seferlik** bir yardımcı konteyner: `docker cp`
#    çalışan bir konteyner ister, hacmin kendisine doğrudan kopyalanamaz.
YARDIMCI="$(docker compose run -d --rm --no-deps --entrypoint sh app \
  -c "mkdir -p '$HEDEF_DIZIN' && sleep 300")" \
  || hata "Yardımcı konteyner başlatılamadı."

yardimciyi_kapat() {
  docker stop "$YARDIMCI" >/dev/null 2>&1 || true
  temizle
}
trap yardimciyi_kapat EXIT

# Konteynerin `mkdir` adımını bitirmesini bekle.
for _ in $(seq 1 30); do
  docker exec "$YARDIMCI" sh -c "[ -d '$HEDEF_DIZIN' ]" >/dev/null 2>&1 && break
  sleep 1
done

# 4. Çakışma kontrolü: sessizce ezmek yok.
CAKISANLAR=""
while IFS= read -r dosya; do
  [[ -n "$dosya" ]] || continue
  if docker exec "$YARDIMCI" sh -c "[ -e '$HEDEF_DIZIN/$dosya' ]" >/dev/null 2>&1; then
    CAKISANLAR="$CAKISANLAR $dosya"
  fi
done < <(cd "$GECICI" && ls -A)

if [[ -n "$CAKISANLAR" ]]; then
  hata "Hedefte aynı adlı dosyalar var:$CAKISANLAR
Ezmek veri kaybettirebilir. Hangi kopyanın doğru olduğuna karar verip elle taşıyın."
fi

# 5. Taşı.
docker cp "$GECICI/." "$YARDIMCI:$HEDEF_DIZIN/" \
  || hata "Dosyalar hacme kopyalanamadı."

TASINAN="$(docker exec "$YARDIMCI" sh -c "ls -A '$HEDEF_DIZIN' | wc -l" | tr -d ' ')"
[[ "$TASINAN" == "$SAYI" ]] \
  || hata "Beklenen $SAYI dosya yerine $TASINAN dosya sayıldı; geçiş doğrulanamadı."

log "$TASINAN profil resmi $HEDEF_DIZIN hacmine taşındı."
log "Şimdi yükseltmeye devam edebilirsiniz: docker compose build && docker compose up -d"
