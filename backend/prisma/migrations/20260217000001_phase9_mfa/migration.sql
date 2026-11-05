-- Phase 9 MFA (docs/SECURITY.md section 2: MFA required for privileged
-- administrators). Hand-authored because `prisma migrate dev`'s shadow-DB
-- path breaks on the PostGIS-enabled schema; applied via `prisma migrate
-- deploy` against the local PostgreSQL (ADR-004 review path).
--
-- Adds to "User":
--   mfaSecret          base32 TOTP seed (RFC 6238); reversible seed material,
--                      never returned by any API shape after the one-time
--                      /auth/mfa/setup response.
--   mfaEnabled         true only after the user confirms a TOTP/recovery code.
--   mfaRecoveryCodes   single-use recovery codes, stored as sha256 hex array
--                      (a DB leak exposes no usable code; 8 issued).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "mfaSecret" TEXT, ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
