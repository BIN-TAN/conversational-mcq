-- Clarify that lifecycle duration values are observed intervals, not inferred behavior.

ALTER TABLE "formative_conversation_lifecycle_events"
RENAME COLUMN "duration_ms" TO "observed_interval_duration_ms";
