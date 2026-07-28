ALTER TABLE "formative_conversation_sessions"
DROP CONSTRAINT "formative_conversation_sessions_concept_unit_session_db_id_fkey",
ADD CONSTRAINT "formative_conversation_sessions_concept_unit_session_db_id_fkey"
FOREIGN KEY ("concept_unit_session_db_id")
REFERENCES "concept_unit_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_message_receipts"
DROP CONSTRAINT "formative_conversation_message_receipts_formative_conversa_fkey",
ADD CONSTRAINT "formative_conversation_message_receipts_formative_conversa_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_memory_snapshots"
DROP CONSTRAINT "formative_conversation_memory_snapshots_formative_conversa_fkey",
ADD CONSTRAINT "formative_conversation_memory_snapshots_formative_conversa_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_interventions"
DROP CONSTRAINT "formative_conversation_interventions_formative_conversatio_fkey",
ADD CONSTRAINT "formative_conversation_interventions_formative_conversatio_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_review_signals"
DROP CONSTRAINT "formative_conversation_review_signals_formative_conversati_fkey",
ADD CONSTRAINT "formative_conversation_review_signals_formative_conversati_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_lifecycle_events"
DROP CONSTRAINT "formative_conversation_lifecycle_events_session_fkey",
ADD CONSTRAINT "formative_conversation_lifecycle_events_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_turn_telemetry"
DROP CONSTRAINT "formative_conversation_turn_telemetry_session_fkey",
ADD CONSTRAINT "formative_conversation_turn_telemetry_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_turn_telemetry"
DROP CONSTRAINT "formative_conversation_turn_telemetry_turn_fkey",
ADD CONSTRAINT "formative_conversation_turn_telemetry_turn_fkey"
FOREIGN KEY ("conversation_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_input_telemetry"
DROP CONSTRAINT "formative_conversation_input_telemetry_session_fkey",
ADD CONSTRAINT "formative_conversation_input_telemetry_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_input_telemetry"
DROP CONSTRAINT "formative_conversation_input_telemetry_turn_fkey",
ADD CONSTRAINT "formative_conversation_input_telemetry_turn_fkey"
FOREIGN KEY ("conversation_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transitions"
DROP CONSTRAINT "formative_conversation_profile_transitions_session_fkey",
ADD CONSTRAINT "formative_conversation_profile_transitions_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transitions"
DROP CONSTRAINT "formative_conversation_profile_transitions_prior_profile_fkey",
ADD CONSTRAINT "formative_conversation_profile_transitions_prior_profile_fkey"
FOREIGN KEY ("prior_student_profile_db_id")
REFERENCES "student_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_transitions"
DROP CONSTRAINT "formative_conversation_profile_transitions_updated_profile_fkey",
ADD CONSTRAINT "formative_conversation_profile_transitions_updated_profile_fkey"
FOREIGN KEY ("updated_student_profile_db_id")
REFERENCES "student_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_evidence_references"
DROP CONSTRAINT "fc_profile_evidence_session_fkey",
ADD CONSTRAINT "fc_profile_evidence_session_fkey"
FOREIGN KEY ("formative_conversation_session_db_id")
REFERENCES "formative_conversation_sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_evidence_references"
DROP CONSTRAINT "fc_profile_evidence_agent_call_fkey",
ADD CONSTRAINT "fc_profile_evidence_agent_call_fkey"
FOREIGN KEY ("source_agent_call_db_id")
REFERENCES "agent_calls"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formative_conversation_profile_evidence_references"
DROP CONSTRAINT "fc_profile_evidence_tutor_turn_fkey",
ADD CONSTRAINT "fc_profile_evidence_tutor_turn_fkey"
FOREIGN KEY ("source_tutor_turn_db_id")
REFERENCES "conversation_turns"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
