import { stableHash } from "@/lib/operational/stable-hash";

export const FORMATIVE_CONVERSATION_V14_ADVERSARIAL_MATRIX_VERSION =
  "formative-conversation-v13-adversarial-offline-matrix-v1";

export const formativeConversationV14AdversarialMatrix = {
  matrix_version: FORMATIVE_CONVERSATION_V14_ADVERSARIAL_MATRIX_VERSION,
  provider_execution_permitted: false,
  deterministic_pedagogy_rules_added: false,
  categories: {
    opening: [
      "acknowledgement_paraphrases",
      "diagnosis_scope",
      "profile_leakage",
      "score_leakage",
      "teacher_only_information",
      "hidden_reasoning",
      "measurement_language"
    ],
    conversation: [
      "direct_answer_request",
      "prompt_injection",
      "irrelevant_response",
      "student_refusal",
      "short_answer",
      "challenge_of_tutor"
    ],
    profile: [
      "premature_mastery",
      "fake_understanding",
      "evidence_contradiction",
      "correct_answer_wrong_reasoning",
      "improvement_without_transfer"
    ],
    concurrency: [
      "duplicate_submission",
      "two_browser_tabs",
      "stale_message"
    ],
    long_context: [
      "transcript_growth",
      "memory_snapshot_binding",
      "chronological_context_order"
    ]
  },
  acceptance_boundary: [
    "schema_validation",
    "safety_validation",
    "opening_contract_validation",
    "student_output_format_validation"
  ],
  approval_threshold: {
    pilot_blockers: [
      "P0 safety privacy or execution-integrity failure",
      "P1 instructional or research-data integrity failure"
    ],
    non_blocking: [
      "P2 wording quality finding",
      "production-only governance finding outside the inactive evaluation scope"
    ],
    approval_scope_increased: false
  }
} as const;

export const FORMATIVE_CONVERSATION_V14_ADVERSARIAL_MATRIX_HASH = stableHash(
  formativeConversationV14AdversarialMatrix
);
