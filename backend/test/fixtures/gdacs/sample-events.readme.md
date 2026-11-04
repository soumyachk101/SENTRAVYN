# GDACS sample event feed

Fixture for the GDACS adapter (backend/src/integrations/adapters/gdacs.adapter.ts).
Mirrors the minimal documented feed shape: a JSON array of `{ eventid, title,
datetime, description? }` elements. Used by the adapter and ingest service
tests in place of a live GDACS request.
