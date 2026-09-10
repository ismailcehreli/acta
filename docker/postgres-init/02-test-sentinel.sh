#!/bin/sh
# Test veritabanlarına "bu bir test veritabanıdır" işaretini **veritabanı
# hazırlanırken** koyar.
#
# İşareti test sürecinin kendisi oluşturursa bağımsız kanıt olmaz: yanlış
# adlandırılmış bir veritabanı, tabloları boşaltacak süreç tarafından "test"
# ilan edilip hemen ardından silinebilirdi (denetim 18.08.2026, bulgu 8).
#
# İşaret bir tablo değil, veritabanı yorumudur: tablo olsaydı Prisma şemayı
# "boş değil" sayar ve migration uygulamayı reddederdi.
set -e

for db in "$POSTGRES_DB" faaliyet_e2e; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" \
    -c "COMMENT ON DATABASE \"$db\" IS 'faaliyet-test-veritabani';"
done
