-- Phase 31e: teacher-managed student accounts and password reset.
-- Additive only; existing access-code credentials remain supported.

ALTER TYPE "StudentAccountEventType" ADD VALUE IF NOT EXISTS 'teacher_student_account_created';
ALTER TYPE "StudentAccountEventType" ADD VALUE IF NOT EXISTS 'teacher_student_password_reset';
ALTER TYPE "StudentAccountEventType" ADD VALUE IF NOT EXISTS 'teacher_student_deactivated';
ALTER TYPE "StudentAccountEventType" ADD VALUE IF NOT EXISTS 'teacher_student_reactivated';
ALTER TYPE "StudentAccountEventType" ADD VALUE IF NOT EXISTS 'student_password_changed';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "credential_reset_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "created_by_teacher_user_id" UUID;

CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_created_by_teacher_user_id_idx" ON "users"("created_by_teacher_user_id");
