#!/usr/bin/env bash
#
# SENTRAVYN local-dev restore: put a .pgdump archive from backup.sh into a
# DISCARDABLE database. NEVER restores over the live database.
#
# Usage (from the repo root, with local infra up: `pnpm db:up`):
#   set -a && . .env && set +a
#   pnpm db:restore                      # restores the newest data/backups/*.pgdump
#   pnpm db:restore data/backups/sentravyn-postgres-<stamp>.pgdump
#
# Target database:
#   Default: sentravyn_restore_dev (override with SENTRAVYN_RESTORE_DB).
#   Safety guard: if the target equals the live application database
#   (PGDATABASE / the database part of DATABASE_URL), the script refuses.
#   The target is dropped and recreated fresh, so every run starts clean.
#
# RPO / RTO: LOCAL DEV TARGETS ONLY. Production values are pending the
# Phase 9 operational risk assessment (ARCHITECTURE.md 9).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -f "${repo_root}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${repo_root}/.env"
  set +a
fi

# -- Resolve connection details the same way backup.sh does
url="${DATABASE_URL:-}"
url_user=""
url_password=""
url_host=""
url_port=""
url_db=""
if [[ -n "$url" ]]; then
  rest="${url#*://}"
  userinfo="${rest%%@*}"
  rest="${rest#*@}"
  url_user="${userinfo%%:*}"
  url_password="${userinfo#*:}"
  hostport="${rest%%/*}"
  url_db="${rest#*/}"
  url_db="${url_db%%\?*}"
  if [[ "$hostport" == *":"* ]]; then
    url_host="${hostport%%:*}"
    url_port="${hostport#*:}"
  else
    url_host="${hostport}"
    url_port="5432"
  fi
fi

pg_user="${PGUSER:-${url_user:-sentravyn}}"
pg_db="${PGDATABASE:-${url_db:-sentravyn}}"
pg_host="${PGHOST:-${url_host:-localhost}}"
pg_port="${PGPORT:-${url_port:-5432}}"
if [[ -z "${PGPASSWORD:-}" && -n "${url_password}" && "$url_password" != "$url_user" ]]; then
  export PGPASSWORD="$url_password"
fi
container="${SENTRAVYN_PG_CONTAINER:-sentravyn-postgres}"
backup_dir="${SENTRAVYN_BACKUP_DIR:-${repo_root}/data/backups}"
target_db="${SENTRAVYN_RESTORE_DB:-sentravyn_restore_dev}"

# -- Safety guard: never restore into the live application database
if [[ "$target_db" == "$pg_db" ]]; then
  echo "SENTRAVYN restore: REFUSED - target database '${target_db}' is the live" >&2
  echo "application database (from DATABASE_URL/PGDATABASE). Pass a discardable" >&2
  echo "target via SENTRAVYN_RESTORE_DB (default: sentravyn_restore_dev)." >&2
  exit 2
fi

# -- Pick the dump file: $1 or the newest archive
dump_file="${1:-}"
if [[ -z "$dump_file" ]]; then
  dump_file="$(ls -1t "${backup_dir}"/sentravyn-postgres-*.pgdump 2>/dev/null | head -n 1 || true)"
fi
if [[ -z "$dump_file" || ! -s "$dump_file" ]]; then
  echo "SENTRAVYN restore: no non-empty archive found." >&2
  echo "Run 'pnpm db:backup' first, or pass an archive path as the first argument." >&2
  exit 1
fi
dump_file="$(cd "$(dirname "$dump_file")" && pwd)/$(basename "$dump_file")"

in_container=0
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
  in_container=1
fi

echo "SENTRAVYN restore: archive   = ${dump_file}"
echo "SENTRAVYN restore: target    = ${target_db} (DISCARDABLE; live DB '${pg_db}' untouched)"

# -- psql helper: run SQL against the MAINTENANCE db (never the target)
run_sql() {
  # $1 = sql statement, $2 = db to connect to
  local sql="$1" db="$2"
  if [[ "$in_container" -eq 1 ]]; then
    docker exec -e PGPASSWORD "${container}" psql -h 127.0.0.1 -U "$pg_user" -d "$db" -v ON_ERROR_STOP=1 -c "$sql"
  else
    psql -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$db" -v ON_ERROR_STOP=1 -c "$sql"
  fi
}

maint_db="${SENTRAVYN_MAINT_DB:-postgres}"
# The application user can only connect to the maintenance db if it exists;
# fall back to the live app db for the DDL statements (CREATE/DROP DATABASE
# do not mutate that database's contents).
if [[ "$in_container" -eq 0 ]]; then
  if ! psql -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$maint_db" -tAc "SELECT 1" >/dev/null 2>&1; then
    echo "SENTRAVYN restore: cannot use maintenance db '${maint_db}'; using '${pg_db}' for DDL"
    maint_db="$pg_db"
  fi
fi

echo "SENTRAVYN restore: dropping + creating discardable database '${target_db}'"
run_sql "DROP DATABASE IF EXISTS ${target_db};" "$maint_db"
run_sql "CREATE DATABASE ${target_db};" "$maint_db"

echo "SENTRAVYN restore: restoring archive into '${target_db}'"
if [[ "$in_container" -eq 1 ]]; then
  docker cp "$dump_file" "${container}:/tmp/sentravyn-restore.pgdump"
  docker exec -e PGPASSWORD "${container}" pg_restore \
    -h 127.0.0.1 -U "$pg_user" -d "$target_db" \
    --clean --if-exists --single-transaction --no-owner \
    /tmp/sentravyn-restore.pgdump
  docker exec "${container}" rm -f /tmp/sentravyn-restore.pgdump
else
  pg_restore -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$target_db" \
    --clean --if-exists --single-transaction --no-owner \
    "$dump_file"
fi

# PostGIS: the archive carries CREATE EXTENSION where the dump includes it,
# but pg_restore with --clean can drop it; re-enable defensively.
echo "SENTRAVYN restore: enabling PostGIS extension in '${target_db}'"
run_sql "CREATE EXTENSION IF NOT EXISTS postgis;" "$target_db"

# -- Verify: schema tables present + object count sanity check
table_count="$(
  if [[ "$in_container" -eq 1 ]]; then
    docker exec -e PGPASSWORD "${container}" psql -h 127.0.0.1 -U "$pg_user" -d "$target_db" -tAc \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
  else
    psql -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$target_db" -tAc \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
  fi
)"
echo "SENTRAVYN restore: OK - '${target_db}' has ${table_count} public base tables"
echo "SENTRAVYN restore: the live database '${pg_db}' was NOT modified."
echo "SENTRAVYN restore: RPO/RTO are local dev targets only; production values pending Phase 9 risk assessment."
echo "SENTRAVYN restore: discard with: psql -c \"DROP DATABASE ${target_db};\" (or keep for inspection)."
