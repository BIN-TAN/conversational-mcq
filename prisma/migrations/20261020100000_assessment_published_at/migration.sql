-- First publication time of each mini-test (research: release timing). Existing rows stay null.
ALTER TABLE "assessments" ADD COLUMN "published_at" TIMESTAMPTZ(6);
