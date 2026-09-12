#!/bin/sh
# The test server contains two separate databases:
#   faaliyet_test — Vitest (tables are emptied before each test)
#   faaliyet_e2e  — Playwright (end-to-end runs use their own data)
# If they shared a database, a unit test running during an end-to-end run could
# empty its tables and break the other suite.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE faaliyet_e2e OWNER "$POSTGRES_USER";
EOSQL
