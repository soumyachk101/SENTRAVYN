-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('RECEIVED', 'PARSED', 'VALIDATED', 'QUARANTINED', 'PUBLISHED', 'UPDATED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertVerification" AS ENUM ('UNVERIFIED', 'REVIEWED', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "PlaceVerification" AS ENUM ('UNVERIFIED', 'REVIEWED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ShelterVerification" AS ENUM ('UNVERIFIED', 'EVIDENCE_REVIEW', 'VERIFIED');

-- CreateEnum
CREATE TYPE "GuideApprovalState" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "InformationClass" AS ENUM ('OFFICIAL_SOURCE', 'SENTRAVYN_SUMMARY', 'THIRD_PARTY', 'USER_SUBMISSION', 'DERIVED_CALCULATION', 'UNVERIFIED_OR_STALE');

-- CreateEnum
CREATE TYPE "FetchStatus" AS ENUM ('PENDING', 'SUCCESS', 'PARTIAL', 'FAILED', 'RATE_LIMITED', 'OUTAGE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WEBSOCKET', 'PUSH_WEB', 'PUSH_FCM', 'PUSH_APNS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'DROPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "Role" NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "regionIso" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "notificationOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT,
    "phone" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataProvider" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docUrl" TEXT,
    "category" TEXT NOT NULL DEFAULT 'alerts',
    "license" TEXT,
    "attribution" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "freshnessPolicyHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderFetch" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "FetchStatus" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderFetch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawSourceRecord" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "payloadHash" TEXT NOT NULL,
    "rawPayload" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawSourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "sourceRecordId" TEXT,
    "externalRef" TEXT,
    "status" "AlertStatus" NOT NULL DEFAULT 'RECEIVED',
    "verification" "AlertVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "informationClass" "InformationClass" NOT NULL DEFAULT 'OFFICIAL_SOURCE',
    "headline" TEXT NOT NULL,
    "issuer" TEXT,
    "severity" TEXT,
    "urgency" TEXT,
    "certainty" TEXT,
    "issuedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRevision" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "AlertStatus" NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "affectedRegion" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "verification" "PlaceVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "sourceAuthority" TEXT,
    "operationalStatus" TEXT,
    "operationalEvidence" TEXT,
    "accessibility" TEXT,
    "capacityNote" TEXT,
    "staleSince" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceEvidence" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShelterProfile" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "classification" TEXT,
    "hazardApplicability" TEXT[],
    "capacity" TEXT,
    "inspectAuthority" TEXT,
    "inspectionDate" TIMESTAMP(3),
    "verification" "ShelterVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShelterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyGuide" (
    "id" TEXT NOT NULL,
    "hazardType" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "author" TEXT,
    "reviewer" TEXT,
    "authority" TEXT,
    "approval" "GuideApprovalState" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastReviewedAt" TIMESTAMP(3),
    "references" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuideRevision" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuideRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "dedupKey" TEXT,
    "receipt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "NotificationStatus" NOT NULL,
    "error" TEXT,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserPreference_userId_idx" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "EmergencyContact_userId_idx" ON "EmergencyContact"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DataProvider_key_key" ON "DataProvider"("key");

-- CreateIndex
CREATE INDEX "ProviderFetch_providerId_requestedAt_idx" ON "ProviderFetch"("providerId", "requestedAt");

-- CreateIndex
CREATE INDEX "RawSourceRecord_providerId_sourceId_idx" ON "RawSourceRecord"("providerId", "sourceId");

-- CreateIndex
CREATE INDEX "RawSourceRecord_ingestedAt_idx" ON "RawSourceRecord"("ingestedAt");

-- CreateIndex
CREATE INDEX "Alert_status_publishedAt_idx" ON "Alert"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Alert_externalRef_idx" ON "Alert"("externalRef");

-- CreateIndex
CREATE INDEX "Alert_verification_idx" ON "Alert"("verification");

-- CreateIndex
CREATE INDEX "AlertRevision_alertId_revision_idx" ON "AlertRevision"("alertId", "revision");

-- CreateIndex
CREATE INDEX "Incident_type_occurredAt_idx" ON "Incident"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "Place_kind_verification_idx" ON "Place"("kind", "verification");

-- CreateIndex
CREATE INDEX "PlaceEvidence_placeId_idx" ON "PlaceEvidence"("placeId");

-- CreateIndex
CREATE INDEX "ShelterProfile_placeId_verification_idx" ON "ShelterProfile"("placeId", "verification");

-- CreateIndex
CREATE INDEX "SafetyGuide_hazardType_approval_idx" ON "SafetyGuide"("hazardType", "approval");

-- CreateIndex
CREATE INDEX "GuideRevision_guideId_revision_idx" ON "GuideRevision"("guideId", "revision");

-- CreateIndex
CREATE INDEX "Notification_alertId_channel_idx" ON "Notification"("alertId", "channel");

-- CreateIndex
CREATE INDEX "Notification_dedupKey_idx" ON "Notification"("dedupKey");

-- CreateIndex
CREATE INDEX "NotificationAttempt_notificationId_attempt_idx" ON "NotificationAttempt"("notificationId", "attempt");

-- CreateIndex
CREATE INDEX "AuditEvent_entity_entityId_idx" ON "AuditEvent"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderFetch" ADD CONSTRAINT "ProviderFetch_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "DataProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawSourceRecord" ADD CONSTRAINT "RawSourceRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "DataProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "RawSourceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRevision" ADD CONSTRAINT "AlertRevision_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceEvidence" ADD CONSTRAINT "PlaceEvidence_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShelterProfile" ADD CONSTRAINT "ShelterProfile_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideRevision" ADD CONSTRAINT "GuideRevision_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "SafetyGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
