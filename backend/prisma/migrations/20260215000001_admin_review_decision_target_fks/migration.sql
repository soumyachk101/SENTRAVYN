-- Add database-level referential integrity to AdminReviewDecision target ids
-- (Gate C: database constraints). The review service already validates target
-- existence before any write (Gate E); these FKs are the second line of
-- defence so a decision row can never point at a target that does not exist.
--
-- All three target ids are nullable (a decision references exactly one of
-- alert / place / shelter), so no existing row is forced to satisfy a new
-- non-null constraint.

-- ConstraintIndex on alertId (Alert PK is already unique).
ALTER TABLE "AdminReviewDecision"
  ADD CONSTRAINT "AdminReviewDecision_alertId_fkey"
  FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminReviewDecision"
  ADD CONSTRAINT "AdminReviewDecision_placeId_fkey"
  FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminReviewDecision"
  ADD CONSTRAINT "AdminReviewDecision_shelterId_fkey"
  FOREIGN KEY ("shelterId") REFERENCES "ShelterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
