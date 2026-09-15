CREATE TABLE "assessment_attempt_chances" (
  "id" UUID NOT NULL,
  "session_public_id" TEXT NOT NULL,
  "student_db_id" UUID NOT NULL,
  "assessment_public_id" TEXT NOT NULL,
  "assessment_family_public_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "policy_version" TEXT NOT NULL DEFAULT 'assessment-attempt-policy-v2',
  "used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "waived_at" TIMESTAMPTZ(6),
  "waived_by_user_db_id" UUID,
  "waiver_reason" TEXT,
  CONSTRAINT "assessment_attempt_chances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessment_attempt_chances_student_fkey" FOREIGN KEY ("student_db_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assessment_attempt_chances_teacher_fkey" FOREIGN KEY ("waived_by_user_db_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "assessment_attempt_chances_session_public_id_key" ON "assessment_attempt_chances"("session_public_id");
CREATE INDEX "assessment_attempt_chances_student_db_id_assessment_family_public_id_idx" ON "assessment_attempt_chances"("student_db_id", "assessment_family_public_id");

-- Preserve original attempts and policy provenance, including histories over three.
INSERT INTO "assessment_attempt_chances" ("id", "session_public_id", "student_db_id", "assessment_public_id", "assessment_family_public_id", "attempt_number", "policy_version", "used_at")
SELECT s."id", s."session_public_id", s."user_db_id", a."assessment_public_id",
  COALESCE(a."revision_family_public_id", a."assessment_public_id"), s."attempt_number",
  'legacy_unlimited', COALESCE(s."started_at", s."created_at")
FROM "assessment_sessions" s JOIN "assessments" a ON a."id" = s."assessment_db_id";
