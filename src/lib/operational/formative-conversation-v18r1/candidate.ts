import {
  FORMATIVE_CONVERSATION_V18_CANDIDATE_VERSION,
  FORMATIVE_CONVERSATION_V18_PRESERVED_ACTIVE_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V18_PRESERVED_ROLLBACK_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V18_REQUIRED_NO_PROVIDER_TESTS,
  FORMATIVE_CONVERSATION_V18_RUNTIME_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V18_VERIFICATION_SOURCE_PATHS,
  buildFormativeConversationV18RuntimeCandidateManifest
} from "@/lib/operational/formative-conversation-v18/candidate";

export const FORMATIVE_CONVERSATION_V18R1_CANDIDATE_VERSION =
  FORMATIVE_CONVERSATION_V18_CANDIDATE_VERSION;
export const FORMATIVE_CONVERSATION_V18R1_RUNTIME_SOURCE_PATHS =
  FORMATIVE_CONVERSATION_V18_RUNTIME_SOURCE_PATHS;
export const FORMATIVE_CONVERSATION_V18R1_VERIFICATION_SOURCE_PATHS = [
  ...FORMATIVE_CONVERSATION_V18_VERIFICATION_SOURCE_PATHS,
  "prisma/operational-formative-conversation-v5-v18r1-compilation-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-launcher-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-environment-parity-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-security-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-deployment-provenance-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-provenance-boundary-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-dispatch-checkpoint-smoke-test.ts"
] as const;
export const FORMATIVE_CONVERSATION_V18R1_REQUIRED_NO_PROVIDER_TESTS = [
  ...FORMATIVE_CONVERSATION_V18_REQUIRED_NO_PROVIDER_TESTS.filter(
    (test) =>
      test !==
      "operational:formative-conversation-v5-v18-provenance-smoke"
  ),
  "operational:formative-conversation-v5-v18r1-compilation-smoke",
  "operational:formative-conversation-v5-v18r1-launcher-smoke",
  "operational:formative-conversation-v5-v18r1-environment-parity-smoke",
  "operational:formative-conversation-v5-v18r1-security-smoke",
  "operational:formative-conversation-v5-v18r1-deployment-provenance-smoke",
  "operational:formative-conversation-v5-v18r1-provenance-boundary-smoke",
  "operational:formative-conversation-v5-v18r1-dispatch-checkpoint-smoke"
] as const;
export const FORMATIVE_CONVERSATION_V18R1_PRESERVED_ACTIVE_RUNTIME_HASH =
  FORMATIVE_CONVERSATION_V18_PRESERVED_ACTIVE_RUNTIME_HASH;
export const FORMATIVE_CONVERSATION_V18R1_PRESERVED_ROLLBACK_RUNTIME_HASH =
  FORMATIVE_CONVERSATION_V18_PRESERVED_ROLLBACK_RUNTIME_HASH;
export const buildFormativeConversationV18R1RuntimeCandidateManifest =
  buildFormativeConversationV18RuntimeCandidateManifest;
