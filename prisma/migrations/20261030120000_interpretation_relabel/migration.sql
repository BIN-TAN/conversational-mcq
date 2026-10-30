-- One-time reinterpretation of earlier attempts under updated interpretation rules (release 27).
-- A new profile is saved beside the original; these pointers say which profile instructor views
-- and exports use. Nothing existing is changed or deleted.
ALTER TABLE "concept_unit_sessions"
  ADD COLUMN "relabeled_student_profile_db_id" UUID,
  ADD COLUMN "relabeled_at" TIMESTAMPTZ(6),
  ADD COLUMN "pending_relabel_student_profile_db_id" UUID;

ALTER TABLE "concept_unit_sessions"
  ADD CONSTRAINT "concept_unit_sessions_relabeled_student_profile_db_id_fkey"
    FOREIGN KEY ("relabeled_student_profile_db_id") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "concept_unit_sessions_pending_relabel_student_profile_db_id_fkey"
    FOREIGN KEY ("pending_relabel_student_profile_db_id") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "concept_unit_sessions_relabeled_student_profile_db_id_idx" ON "concept_unit_sessions"("relabeled_student_profile_db_id");
CREATE INDEX "concept_unit_sessions_pending_relabel_student_profile_db_id_idx" ON "concept_unit_sessions"("pending_relabel_student_profile_db_id");
