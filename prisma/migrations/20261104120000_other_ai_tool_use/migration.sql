-- Release 40: after submitting a mini-test, students answer "Did you use another AI tool while
-- answering the questions?" (yes or no). The answer is stored with the attempt for the research dataset only.
-- Nothing existing is changed; earlier attempts keep a null answer.
ALTER TABLE "assessment_sessions"
  ADD COLUMN "other_ai_tool_use" BOOLEAN,
  ADD COLUMN "other_ai_tool_use_reported_at" TIMESTAMPTZ(6);
