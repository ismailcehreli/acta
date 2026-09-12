#!/bin/sh
# Marks test databases as "this is a test database" **while the database is
# being provisioned**.
#
# If the test process created the marker, it would not be independent evidence:
# a misnamed database could be declared a "test" database by the process that
# empties its tables and then be deleted (Audit 2026-08-18, finding 8).
#
# The marker is a database comment, not a table. A table would make Prisma treat
# the schema as "not empty" and reject migration deployment.
set -e

for db in "$POSTGRES_DB" acta_e2e; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" \
    -c "COMMENT ON DATABASE \"$db\" IS 'acta-test-database';"
done
