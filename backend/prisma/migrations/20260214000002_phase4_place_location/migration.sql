-- AlterTable
ALTER TABLE "Place" ADD COLUMN "location" geography(Point, 4326);

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN "footprint" geography;

-- Backfill (ADR-004: staged lat/lng are the source of truth until a provider supplies real geometry)
UPDATE "Place" SET "location" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Place_location_idx" ON "Place" USING GIST ("location");
