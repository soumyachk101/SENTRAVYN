-- SENTRAVYN local Postgres: enable PostGIS for the application database.
-- The application database `sentravyn` is created by the image entrypoint;
-- this script runs against it on first initialisation of the volume.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Sanity check so the extension is genuinely available (ADR-004):
SELECT postgis_version();
