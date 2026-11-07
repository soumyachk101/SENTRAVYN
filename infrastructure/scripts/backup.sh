#!/usr/bin/env bash
#
# SENTRAVYN local-dev backup for the Postgres + PostGIS service.
#
# Usage (from the repo root, with local infra up: `pnpm db:up`):
#   set -a && . .env && set +a
#   pnpm db:backup                # or: bash infrastructure/scripts/backup.sh
#
# What it does:
#   - Resolves connection details from env vars. Resolution order:
#       PGHOST / PGPORT / PGUSER / PGDATABASE / PGPASSWORD if set,
#       otherwise parsed from DATABASE_URL (from .env / the environment).
#     Nothing is hardcoded: credentials come only from the environment.
#   - Prefers `docker exec` inside the sentravyn-postgres container so the
#     server-matching pg_dump binary is used (server 16 vs any host binary).
#   - Writes a custom-format archive to data/backups/ (gitignored):
#       data/backups/sentravyn-postgres-<timestamp>.pgdump
#     Custom format (.pgdump) is what `restore.sh` feeds to pg_restore; it is
#     smaller than plain SQL and supports selective/per-table restore.
#   - Verifies the archive: non-empty and `pg_restore --list` succeeds.
#
# RPO / RTO: LOCAL DEV TARGETS ONLY. Production values are pending the
# Phase 9 operational risk assessment (ARCHITECTURE.md 9: "Define RPO/RTO
# based on an explicit operational risk assessment"). Documented targets:
#   RPO (dev) <= 24 h  (run this daily; keep the last 7 archives)
#   RTO (dev) <= 30 min (restore.sh into a discardable database)
#
# set -euo pipefail: any failure aborts; a failed dump never leaves a
# half-written archive that could later be mistaken for a good backup.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# -- Load .env when present (compose reads the same file; never sourced in a subshell that leaks)
if [[ -f "${repo_root}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${repo_root}/.env"
  set +a
fi

# -- Resolve connection details (env wins over DATABASE_URL parsing)
url="${DATABASE_URL:-}"
url_user=""
url_password=""
url_host=""
url_port=""
url_db=""
if [[ -n "$url" ]]; then
  rest="${url#*://}" # strip scheme
  userinfo="${rest%%@*}"
  rest="${rest#*@}"
  url_user="${userinfo%%:*}"
  url_password="${userinfo#*:}"
  hostport="${rest%%/*}"
  url_db="${rest#*/}"
  url_db="${url_db%%\?*}" # drop ?schema=... query part
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
mkdir -p "$backup_dir"

stamp="$(date +%Y%m%dT%H%M%S)"
dump_file="${backup_dir}/sentravyn-postgres-${stamp}.pgdump"

echo "SENTRAVYN backup: target = ${pg_user}@${pg_host}:${pg_port}/${pg_db} (via ${container} if reachable)"
echo "SENTRAVYN backup: archive  = ${dump_file}"

# -- Dump: prefer docker exec (server-matching binary), fall back to local pg_dump
run_dump() {
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
    # In-container server port is always 5432; host port mapping is irrelevant here.
    docker exec -e PGPASSWORD "${container}" pg_dump \
      -h 127.0.0.1 -p 5432 -U "$pg_user" -d "$pg_db" -Fc -v > "$dump_file"
  else
    echo "SENTRAVYN backup: container '${container}' not running; using local pg_dump against ${pg_host}:${pg_port}"
    pg_dump -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$pg_db" -Fc -v > "$dump_file"
  fi
}
run_dump

# -- Verify: non-empty and pg_restore --list parses the archive
size="$(wc -c < "$dump_file" | tr -d ' ')"
if [[ "$size" -eq 0 ]]; then
  echo "SENTRAVYN backup: FAILED - archive is empty; deleting ${dump_file}" >&2
  rm -f "$dump_file"
  exit 1
fi

list_ok=0
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
  # Verify inside the container (server-matching pg_restore): copy the
  # archive in first, list, remove the copy. pg_restore takes the file as
  # a positional argument (there is no --file flag).
  docker cp "$dump_file" "${container}:/tmp/sentravyn-verify.pgdump"
  if docker exec -e PGPASSWORD "${container}" pg_restore --list \
      /tmp/sentravyn-verify.pgdump > "${dump_file}.manifest" 2>/dev/null; then
    list_ok=1
  fi
  docker exec "${container}" rm -f /tmp/sentravyn-verify.pgdump
fi
if [[ "$list_ok" -eq 0 ]]; then
  if pg_restore --list "$dump_file" > "${dump_file}.manifest" 2>/dev/null; then
    list_ok=1
  fi
fi
if [[ "$list_ok" -eq 0 ]]; then
  echo "SENTRAVYN backup: FAILED - pg_restore --list could not parse the archive" >&2
  exit 1
fi
objects="$(wc -l < "${dump_file}.manifest" | tr -d ' ')"
echo "SENTRAVYN backup: OK - ${size} bytes, ${objects} objects listed by pg_restore --list"
echo "SENTRAVYN backup: restore with:  pnpm db:restore ${dump_file}"
echo "SENTRAVYN backup: RPO/RTO are local dev targets only; production values pending Phase 9 risk assessment."

# -- Retention: keep the last 7 archives (dev target; see header)
ls -1t "${backup_dir}"/sentravyn-postgres-*.pgdump 2>/dev/null | tail -n +8 | while read -r old; do
  echo "SENTRAVYN backup: retention - removing old archive ${old}"
  rm -f "$old" "${old}.manifest"
done
