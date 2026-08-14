import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT,
  buildFormativeConversationV18R2UxPolishArtifacts
} from "../src/lib/operational/formative-conversation-v18r2-ux-polish/candidate";

function writeJson(relativePath: string, value: unknown) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const artifacts = buildFormativeConversationV18R2UxPolishArtifacts();

writeJson(
  `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/runtime-candidate-manifest.json`,
  artifacts.runtimeCandidateManifest
);
writeJson(
  `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/fixture-manifest.json`,
  artifacts.fixtureManifest
);
writeJson(
  `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/targeted-validation-protocol.json`,
  artifacts.targetedValidationProtocol
);
writeJson(
  `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/candidate-identity.json`,
  artifacts.candidateIdentity
);

console.log(
  JSON.stringify(
    {
      status: "materialized",
      candidate_root:
        FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT,
      runtime_candidate_hash:
        artifacts.runtimeCandidateManifest.runtime_candidate_hash,
      prompt_hash: artifacts.candidateIdentity.prompt_hash,
      protocol_hash: artifacts.targetedValidationProtocol.protocol_hash,
      fixture_manifest_hash: artifacts.fixtureManifest.fixture_manifest_hash,
      candidate_identity_hash:
        artifacts.candidateIdentity.candidate_identity_hash,
      provider_calls: 0,
      model_auth_requests: 0,
      generation_network_requests: 0,
      real_dispatch_checkpoints: 0
    },
    null,
    2
  )
);
