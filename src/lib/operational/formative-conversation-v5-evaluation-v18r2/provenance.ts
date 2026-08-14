import {
  FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V18R2_VERIFICATION_SOURCE_PATHS
} from "@/lib/operational/formative-conversation-v18r2/candidate";
import { FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT } from "./contracts";

export {
  FORMATIVE_CONVERSATION_V18R2_DEPLOYED_PROVENANCE_MODE,
  FORMATIVE_CONVERSATION_V18R2_DEPLOYED_PROVENANCE_VERSION,
  verifyFormativeConversationV18R2DeployedProvenance,
  type FormativeConversationV18R2DeployedIdentity
} from "./deployed-provenance";
export {
  assertFormativeConversationV18R2MaterializationReproducible,
  FORMATIVE_CONVERSATION_V18R2_LOCAL_PROVENANCE_VERSION,
  verifyFormativeConversationV18R2LocalCommittedSource
} from "./local-committed-source";

export const FORMATIVE_CONVERSATION_V18R2_RUN_PROVENANCE_VERSION =
  "formative-conversation-v18r2-dual-boundary-provenance-v1";

export const FORMATIVE_CONVERSATION_V18R2_RUNNER_SOURCE_PATHS = [
  "scripts/operational-formative-conversation-v5-v18r2-process-local-runner.mjs",
  "scripts/operational-formative-conversation-v5-v18r2-launcher.mjs",
  "prisma/operational-formative-conversation-v5-v18r2-evaluate.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/package.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/evaluation-accounting.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/live-environment.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/dispatch-checkpoint.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/provenance.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/local-committed-source.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/deployed-provenance.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/security-release.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/service.ts",
  "src/lib/operational/formative-conversation-v18r2/candidate.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v16/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/contracts.ts"
] as const;

export const FORMATIVE_CONVERSATION_V18R2_COMMITTED_SOURCE_PATHS = [
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  "config/operational-candidates/formative-conversation-contract-coherence-v18r2",
  "src/lib/operational/formative-conversation-v18r2",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2",
  ...FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS,
  ...FORMATIVE_CONVERSATION_V18R2_VERIFICATION_SOURCE_PATHS,
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/evaluation-accounting.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v16/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v16/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/contracts.ts",
  "prisma/operational-formative-conversation-v18r2-materialize.ts",
  "prisma/helpers/formative-conversation-v5-v18r2-test-environment.ts",
  "prisma/operational-formative-conversation-v18r2-accounting-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-evaluate.ts",
  "prisma/operational-formative-conversation-v5-v18r2-compilation-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-launcher-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-environment-parity-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-security-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-deployment-provenance-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-provenance-boundary-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-dispatch-checkpoint-smoke-test.ts",
  "scripts/operational-formative-conversation-v5-v18r2-launcher.mjs",
  "scripts/operational-formative-conversation-v5-v18r2-process-local-runner.mjs",
  "docs/operations/FORMATIVE_CONVERSATION_V18R2_DEPLOYMENT_PROVENANCE.md",
  "package.json"
] as const;
