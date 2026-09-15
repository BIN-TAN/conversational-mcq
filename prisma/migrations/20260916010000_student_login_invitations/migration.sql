CREATE TABLE "student_login_invitations" (
  "id" UUID NOT NULL,
  "delivery_key" TEXT NOT NULL,
  "student_db_id" UUID NOT NULL,
  "teacher_db_id" UUID NOT NULL,
  "recipient_email" TEXT NOT NULL,
  "sender_email" TEXT NOT NULL,
  "message_digest" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "provider_message_id" TEXT,
  "failure_code" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "student_login_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_login_invitations_status_check" CHECK ("status" IN ('sending', 'sent', 'failed', 'unknown')),
  CONSTRAINT "student_login_invitations_student_fkey" FOREIGN KEY ("student_db_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "student_login_invitations_teacher_fkey" FOREIGN KEY ("teacher_db_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "student_login_invitations_delivery_key_key" ON "student_login_invitations"("delivery_key");
CREATE INDEX "student_login_invitations_teacher_db_id_created_at_idx" ON "student_login_invitations"("teacher_db_id", "created_at");
