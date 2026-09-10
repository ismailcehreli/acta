#!/bin/sh
# Test sunucusunda iki ayrı veritabanı bulunur:
#   faaliyet_test — Vitest (her testten önce tablolar boşaltılır)
#   faaliyet_e2e  — Playwright (uçtan uca koşu kendi verisiyle çalışır)
# Aynı veritabanını paylaşsalardı uçtan uca koşu sırasında çalışan bir birim
# testi tabloları boşaltıp diğerini çökertebilirdi.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE faaliyet_e2e OWNER "$POSTGRES_USER";
EOSQL
