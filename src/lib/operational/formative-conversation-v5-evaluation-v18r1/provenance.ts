import {
  FORMATIVE_CONVERSATION_V18_RUNTIME_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V18_VERIFICATION_SOURCE_PATHS
} from "@/lib/operational/formative-conversation-v18/candidate";
import { FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT } from "./contracts";

export {
  FORMATIVE_CONVERSATION_V18R1_DEPLOYED_PROVENANCE_MODE,
  FORMATIVE_CONVERSATION_V18R1_DEPLOYED_PROVENANCE_VERSION,
  verifyFormativeConversationV18R1DeployedProvenance,
  type FormativeConversationV18R1DeployedIdentity
} from "./deployed-provenance";
export {
  assertFormativeConversationV18R1MaterializationReproducible,
  FORMATIVE_CONVERSATION_V18R1_LOCAL_PROVENANCE_VERSION,
  verifyFormativeConversationV18R1LocalCommittedSource
} from "./local-committed-source";

export const FORMATIVE_CONVERSATION_V18R1_RUN_PROVENANCE_VERSION =
  "formative-conversation-v18r1-dual-boundary-provenance-v1";

export const FORMATIVE_CONVERSATION_V18R1_RUNNER_SOURCE_PATHS = [
  "scripts/operational-formative-conversation-v5-v18r1-process-local-runner.mjs",
  "scripts/operational-formative-conversation-v5-v18r1-launcher.mjs",
  "prisma/operational-formative-conversation-v5-v18r1-evaluate.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/package.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/evaluation-accounting.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/live-environment.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/dispatch-checkpoint.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/provenance.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/local-committed-source.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/deployed-provenance.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/security-release.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/service.ts",
  "src/lib/operational/formative-conversation-v18r1/candidate.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v16/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/contracts.ts"
] as const;

export const FORMATIVE_CONVERSATION_V18R1_COMMITTED_SOURCE_PATHS = [
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  "config/operational-candidates/formative-conversation-contract-convergence-v18",
  "src/lib/operational/formative-conversation-v18",
  "src/lib/operational/formative-conversation-v18r1",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1",
  ...FORMATIVE_CONVERSATION_V18_RUNTIME_SOURCE_PATHS,
  ...FORMATIVE_CONVERSATION_V18_VERIFICATION_SOURCE_PATHS,
  "src/lib/operational/formative-conversation-v5-evaluation-v18/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/evaluation-accounting.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v16/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v16/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/contracts.ts",
  "prisma/operational-formative-conversation-v18r1-materialize.ts",
  "prisma/operational-formative-conversation-v5-v18r1-evaluate.ts",
  "prisma/operational-formative-conversation-v5-v18r1-compilation-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-launcher-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-environment-parity-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-security-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-deployment-provenance-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-provenance-boundary-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r1-dispatch-checkpoint-smoke-test.ts",
  "scripts/operational-formative-conversation-v5-v18r1-launcher.mjs",
  "scripts/operational-formative-conversation-v5-v18r1-process-local-runner.mjs",
  "docs/operations/FORMATIVE_CONVERSATION_V18R1_DEPLOYMENT_PROVENANCE.md",
  "package.json"
] as const;
