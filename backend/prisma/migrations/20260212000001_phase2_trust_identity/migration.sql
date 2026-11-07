-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "DataProvider" ADD COLUMN "lastSeededAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminReviewDecision" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "placeId" TEXT,
    "shelterId" TEXT,
    "decision" TEXT NOT NULL,
    "rationale" TEXT,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AdminReviewDecision_alertId_idx" ON "AdminReviewDecision"("alertId");

-- CreateIndex
CREATE INDEX "AdminReviewDecision_placeId_idx" ON "AdminReviewDecision"("placeId");

-- CreateIndex
CREATE INDEX "AdminReviewDecision_shelterId_idx" ON "AdminReviewDecision"("shelterId");

-- CreateIndex
CREATE INDEX "AdminReviewDecision_actorUserId_createdAt_idx" ON "AdminReviewDecision"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminReviewDecision" ADD CONSTRAINT "AdminReviewDecision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
