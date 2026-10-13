import { LUNA_PROFILE_FIDELITY_SOURCE_FILES } from "./luna-profile-fidelity-identity";

// A distinct experiment and approval identity; historic all-Luna artifacts keep
// their original meaning. Only the conversational tutor changes model.
export const MIXED_TUTOR_MODEL = "gpt-6.1-sol" as const;
export const MIXED_TUTOR_ROLE = "formative_conversation_agent" as const;
export const MIXED_TUTOR_CANDIDATE_VERSION = "luna-medium-gpt61-sol-tutor-profile-fidelity-candidate-v1";
export const MIXED_TUTOR_AMENDMENT_VERSION = "luna-medium-gpt61-sol-tutor-profile-fidelity-amendment-v1";
export const MIXED_TUTOR_VALIDATION_VERSION = "luna-medium-gpt61-sol-tutor-profile-fidelity-validation-v1";
export const MIXED_TUTOR_SOURCE_FILES = [...LUNA_PROFILE_FIDELITY_SOURCE_FILES,
  "src/lib/operational/mixed-tutor-identity.ts",
  "src/lib/operational/active-approval-bundle.ts",
  "src/lib/operational/luna-low-validation-evidence.ts",
  "src/lib/llm/config.ts"
] as const;

export function lunaCandidateModelForRole(role: string, tutorModel?: typeof MIXED_TUTOR_MODEL) {
  return tutorModel && role === MIXED_TUTOR_ROLE ? MIXED_TUTOR_MODEL : "gpt-5.6-luna";
}
