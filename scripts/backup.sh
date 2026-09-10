#!/usr/bin/env bash
# Yedekleme (§15.6). Veritabanı ve dosya deposu **tutarlı bir anlık görüntü**
# olarak birlikte alınır, şifrelenir ve tek dosyaya paketlenir.
#
# Sıra önemlidir: önce veritabanı, sonra dosyalar. Ekler asla silinmediği için
# (§15.4) dump'tan sonra eklenen bir dosya yedekte fazladan durur — zararsız.
# Ters sırada olsaydı dump'ta kaydı olan ama dosyası yedeklenmemiş ek çıkardı.
#
# Kullanım:
#   scripts/backup.sh [hedef-dizin]
#
# Gerekli ortam değişkenleri `.env` dosyasından okunur. Şifreleme parolası
# BACKUP_PASSPHRASE'dir; tanımlı değilse betik **çalışmaz** — şifresiz yedek
# §15.6'ya aykırıdır.

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

HEDEF_DIZIN="${1:-${BACKUP_DIR:-$KOK/yedek}}"
DAMGA="$(date +%Y%m%d-%H%M%S)"
KILIT_DOSYASI="${BACKUP_LOCK_FILE:-${BACKUP_RUNNER_LOCK_FILE:-$KOK/.faaliyet-backup.lock}}"

CALISMA=""
KILIT_ALINDI=0
APP_CALISIYORDU=0
WORKER_CALISIYORDU=0
APP_DURDURMA_DENENDI=0
WORKER_DURDURMA_DENENDI=0
APP_GERI_ACILDI=0
WORKER_GERI_ACILDI=0
SERVISLERI_GERI_AC=1

if [[ "${BACKUP_KEEP_SERVICES_STOPPED:-0}" == "1" ]]; then
  # Başlangıca dönüş gibi daha geniş bir bakım işlemi, yedek bittikten sonra
  # servisleri kendisi yönetir. Yedek burada açılırsa reset öncesi kısa bir
  # yazma penceresi oluşur.
  SERVISLERI_GERI_AC=0
fi

hata() {
  echo "[yedek] HATA: $*" >&2
  exit 1
}

log() {
  echo "[yedek] $*"
}

servis_calisiyor() {
  local servis="$1"
  local kimlik

  if ! kimlik="$(docker compose ps --status running -q "$servis")"; then
    hata "$servis servisinin başlangıç durumu okunamadı."
  fi

  [[ -n "$kimlik" ]]
}

# Yalnız yedek başında çalışan ve durdurulması denenmiş servisleri geri açar.
# Başlangıçta kapalı olan bir servisin işletim kararını yedek değiştirmez.
servisleri_geri_ac() {
  local baslatma_hatasi=0

  if [[ "$SERVISLERI_GERI_AC" == "0" ]]; then
    return 0
  fi

  if [[ "$APP_CALISIYORDU" == "1" && "$APP_DURDURMA_DENENDI" == "1" && "$APP_GERI_ACILDI" == "0" ]]; then
    if docker compose start app >/dev/null 2>&1; then
      APP_GERI_ACILDI=1
    else
      echo "[yedek] HATA: app servisi yeniden başlatılamadı." >&2
      baslatma_hatasi=1
    fi
  fi

  if [[ "$WORKER_CALISIYORDU" == "1" && "$WORKER_DURDURMA_DENENDI" == "1" && "$WORKER_GERI_ACILDI" == "0" ]]; then
    if docker compose start worker >/dev/null 2>&1; then
      WORKER_GERI_ACILDI=1
    else
      echo "[yedek] HATA: worker servisi yeniden başlatılamadı." >&2
      baslatma_hatasi=1
    fi
  fi

  return "$baslatma_hatasi"
}

# Tek çıkış işleyicisi: ikinci bir `trap ... EXIT` birincisini zincirlemez,
# **ezer**. Servis kurtarma ve açık metin çalışma dizini temizliği bu yüzden
# aynı yerde durur (denetim 24.08.2026, P4-R2-1/P4-R2-3).
cikis_temizligi() {
  local onceki_kod=$?
  local temizlik_hatasi=0
  trap - EXIT
  set +e

  servisleri_geri_ac || temizlik_hatasi=1

  if [[ -n "$CALISMA" && -d "$CALISMA" ]]; then
    rm -rf -- "$CALISMA" || {
      echo "[yedek] HATA: geçici çalışma dizini temizlenemedi: $CALISMA" >&2
      temizlik_hatasi=1
    }
  fi

  if [[ "$KILIT_ALINDI" == "1" ]]; then
    flock -u 9 || temizlik_hatasi=1
    exec 9>&-
  fi

  if [[ "$onceki_kod" == "0" && "$temizlik_hatasi" != "0" ]]; then
    onceki_kod=1
  fi
  exit "$onceki_kod"
}

[[ -n "${BACKUP_PASSPHRASE:-}" ]] || hata "BACKUP_PASSPHRASE tanımlı değil; şifresiz yedek alınmaz (§15.6)."
[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || hata "POSTGRES_USER / POSTGRES_DB tanımlı değil."

command -v docker >/dev/null || hata "docker bulunamadı."
command -v openssl >/dev/null || hata "openssl bulunamadı."
command -v flock >/dev/null || hata "flock bulunamadı (util-linux paketi gerekli)."

if [[ "${BACKUP_LOCK_HELD:-0}" != "1" ]]; then
  # Yedek, servisleri durdurduğu için bütün çalışma ağacı için tekil
  # olmalıdır. Runner'lar bu kilidi kendi işlemleri boyunca tutar; böylece
  # yedek bittikten sonra başlayan başlangıca dönüş işlemiyle çakışmaz.
  exec 9>"$KILIT_DOSYASI"
  if ! flock -n 9; then
    hata "Başka bir yedek veya bakım işlemi çalışıyor; ikinci işlem başlatılmadı."
  fi
  KILIT_ALINDI=1
fi

CALISMA="$(mktemp -d)"
trap cikis_temizligi EXIT

mkdir -p "$HEDEF_DIZIN"

if servis_calisiyor app; then APP_CALISIYORDU=1; fi
if servis_calisiyor worker; then WORKER_CALISIYORDU=1; fi

# **Yazmasız bakım penceresi** (denetim 24.08.2026, P4-2).
#
# Veritabanı dökümü ile dosya arşivleri ayrı adımlardır; arada uygulama yazmaya
# açık kalırsa yedek **tutarlı bir anlık görüntü olmaz**. Avatar iki parçalı
# bir mutasyondur (dosya + `User.avatarExtension`): dump `png` değerini aldıktan
# sonra kullanıcı resmini kaldırırsa arşivde dosya bulunmaz ve geri yüklemede o
# profil 404 döner. Sıralamayı değiştirmek iki parçalı mutasyonu atomik
# yapmıyor; tek çözüm pencereyi kapatmak.
#
# Postgres ayakta kalıyor (dökümü o veriyor); yalnız **başlangıçta çalışan**
# yazan süreçler durur. Kurtarma tuzağı stop'tan önce kurulmuştur: iki stop
# çağrısından biri başarısız olsa bile ilk durdurulan servis geri açılır.
log "yazmasız pencere açılıyor"
if [[ "$APP_CALISIYORDU" == "1" ]]; then
  APP_DURDURMA_DENENDI=1
  docker compose stop app >/dev/null 2>&1 || hata "app servisi durdurulamadı."
fi
if [[ "$WORKER_CALISIYORDU" == "1" ]]; then
  WORKER_DURDURMA_DENENDI=1
  docker compose stop worker >/dev/null 2>&1 || hata "worker servisi durdurulamadı."
fi

# 1. Veritabanı. `--clean --if-exists` geri yüklemeyi tekrarlanabilir yapar.
log "veritabanı alınıyor: $POSTGRES_DB"
docker compose exec -T postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format=custom \
  --clean --if-exists \
  > "$CALISMA/veritabani.dump" || hata "pg_dump başarısız."

[[ -s "$CALISMA/veritabani.dump" ]] || hata "Veritabanı dökümü boş."

# 2. Dosya depoları. Uygulama durduğu için birimler **tek seferlik yardımcı
#    konteynerden** okunuyor: `exec` çalışan konteyner ister, `run` ise aynı
#    birimleri bağlayıp okumaya yeter.
#
#    **İki ayrı depo var**: ekler ve profil resimleri. Avatarlar yedeğe hiç
#    girmiyordu; geri yükleme sonrası veritabanındaki `avatarExtension` kalıp
#    dosya gelmediği için bütün profil resimleri 404 dönerdi (bulgu 5).
log "dosya depoları alınıyor"
docker compose run --rm --no-deps --entrypoint sh app -c \
  'mkdir -p /veri/ekler /veri/avatarlar && tar -C /veri -cf - ekler' \
  > "$CALISMA/ekler.tar" || hata "Ek dosyaları alınamadı."

docker compose run --rm --no-deps --entrypoint sh app -c \
  'tar -C /veri -cf - avatarlar' \
  > "$CALISMA/avatarlar.tar" || hata "Profil resimleri alınamadı."

log "yazmasız pencere kapanıyor: app ve worker başlatılıyor"
servisleri_geri_ac || hata "Servisler yeniden başlatılamadı."

# 3. Paketle ve şifrele. Parola ortamdan okunur; komut satırına yazılmaz,
#    çünkü süreç listesinde görünürdü.
log "paketleniyor ve şifreleniyor"
tar -C "$CALISMA" -czf "$CALISMA/paket.tar.gz" veritabani.dump ekler.tar avatarlar.tar

CIKTI="$HEDEF_DIZIN/faaliyet-$DAMGA.tar.gz.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$CALISMA/paket.tar.gz" \
  -out "$CIKTI" \
  -pass env:BACKUP_PASSPHRASE || hata "Şifreleme başarısız."

BOYUT="$(du -h "$CIKTI" | cut -f1)"
log "hazır: $CIKTI ($BOYUT)"

# 4. Nabız. Yedek başarısızsa buraya hiç gelinmez; `backup` işi gecikmiş
#    görünür ve mevcut alarm yolu (§12.4) sistem yöneticisine e-posta atar.
#    Ayrı bir izleme kurmaya gerek yok.
docker compose exec -T postgres psql \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --quiet \
  --command "INSERT INTO \"ScheduledJobStatus\" (\"jobName\", \"lastSuccessAt\", \"lastError\", \"expectedIntervalMinutes\", \"updatedAt\")
             VALUES ('backup', now(), NULL, 1440, now())
             ON CONFLICT (\"jobName\") DO UPDATE
             SET \"lastSuccessAt\" = now(), \"lastError\" = NULL, \"updatedAt\" = now();" \
  >/dev/null || log "UYARI: nabız yazılamadı; yedek alındı ama izlemede görünmeyecek."

# 5. Eski yedekleri temizle (varsayılan: 30 gün).
GUN="${BACKUP_RETENTION_DAYS:-30}"
find "$HEDEF_DIZIN" -name 'faaliyet-*.tar.gz.enc' -type f -mtime "+$GUN" -print -delete \
  | sed 's/^/[yedek] silindi (eski): /' || true

log "bitti. Sunucu dışında ikinci bir kopya tutmayı unutmayın (§15.6)."
