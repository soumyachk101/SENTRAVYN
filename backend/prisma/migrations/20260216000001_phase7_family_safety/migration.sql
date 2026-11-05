-- Phase 7: family safety (consent-based).
-- LocationShare: a user's bounded, revocable grant for a named recipient to
-- see their (coarse) location for a stated purpose. Precise coordinates are
-- never persisted; `preciseConsent` only records that precise sharing is
-- allowed (SECURITY.md 5).
-- HouseholdPlan: the user's own household preparedness data (meeting point,
-- kit checklist, pet considerations). JSONB kit checklist; one row per user.

-- CreateTable
CREATE TABLE "LocationShare" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "preciseConsent" BOOLEAN NOT NULL DEFAULT false,
    "lastKnownLat" DOUBLE PRECISION,
    "lastKnownLng" DOUBLE PRECISION,
    "lastKnownAt" TIMESTAMP(3),
    "consented" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingPoint" TEXT,
    "meetingPointNote" TEXT,
    "kitChecklist" JSONB NOT NULL DEFAULT '[]',
    "petConsiderations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseholdPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationShare_userId_idx" ON "LocationShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdPlan_userId_key" ON "HouseholdPlan"("userId");

-- AddForeignKey
ALTER TABLE "LocationShare" ADD CONSTRAINT "LocationShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdPlan" ADD CONSTRAINT "HouseholdPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
