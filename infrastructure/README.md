# SENTRAVYN local-dev Postgres backup / restore

Scripts live in `infrastructure/scripts/`:

| Script           | Purpose                                                                     |
|------------------|-----------------------------------------------------------------------------|
| `backup.sh`      | `pg_dump` of the local PostGIS service into a custom-format `.pgdump` archive under `data/backups/` (gitignored), verified with `pg_restore --list`. Keeps the last 7 archives. |
| `restore.sh`     | Restores a `.pgdump` archive into a **discardable** target (`sentravyn_restore_dev` database by default), never over the live database. |

Run from the repo root with the env loaded (same `.env` the compose file reads):

```sh
set -a && . .env && set +a
pnpm db:backup            # = bash infrastructure/scripts/backup.sh
pnpm db:restore [file]    # = bash infrastructure/scripts/restore.sh [file]
```

Both scripts resolve connection details from `PGUSER/PGHOST/PGPORT/PGDATABASE/PGPASSWORD`
(or parse `DATABASE_URL` from `.env`) and **never contain hardcoded credentials**.
The container (default `sentravyn-postgres`, override with `SENTRAVYN_PG_CONTAINER`)
is used via `docker exec` when reachable so the server-matching pg_dump/pg_restore
binaries are used; otherwise host `pg_dump`/`pg_restore` are used.

## RPO / RTO

Local dev targets only; production values are pending the Phase 9 operational
risk assessment (ARCHITECTURE.md 9):

- **RPO (dev)** <= 24 h — run `pnpm db:backup` daily; 7-archive retention.
- **RTO (dev)** <= 30 min — `pnpm db:restore` into a discardable database.

## What was tested (evidence captured 2026-11-05, host `:5434`, container `sentravyn-postgres`)

1. `pnpm db:backup` against the live local service:
   - dump written to `data/backups/sentravyn-postgres-<stamp>.pgdump`,
     317,669 bytes (non-empty)
   - `pg_restore --list` (in-container, server-matching binary 16.4) listed
     145 objects into the sidecar `.manifest`; the script fails the backup if
     the archive cannot be parsed
   - host `pg_restore --list` on the same archive also succeeded
   - `data/backups/` is gitignored; 7-archive retention prunes older dumps
2. `pnpm db:restore` into the discardable database
   `sentravyn_restore_dev` (created fresh, restored with
   `--clean --if-exists --single-transaction --no-owner`):
   - 23 public base tables present; PostGIS extension available
     (`postgis_version()` = 3.4)
   - row counts in the restored DB equal the live DB at dump time
     (`Alert` 288, `User` 515)
   - the live `sentravyn` database was not touched; `restore.sh` refuses to
     target the live database name (exit 2)

Limitations:
- Single-node local Docker Postgres; no off-site / managed-DB replication.
  Production backup strategy (WAL archiving, cross-region copies, RPO/RTO
  from the risk assessment) is out of scope until Phase 9 sign-off.
- The in-container path needs the Docker CLI and a reachable
  `sentravyn-postgres`; the host fallback needs `pg_dump`/`pg_restore`
  reachable on the host port. Both paths exist in the script; the evidence
  run used the in-container path.
