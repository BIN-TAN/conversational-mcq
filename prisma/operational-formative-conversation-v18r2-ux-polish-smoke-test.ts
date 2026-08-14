import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_LIVE_REFERENCE,
  FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT,
  FORMATIVE_CONVERSATION_V18R2_UX_POLISH_REQUIRED_TESTS,
  buildFormativeConversationV18R2UxPolishArtifacts
} from "../src/lib/operational/formative-conversation-v18r2-ux-polish/candidate";

function readJson(relativePath: string) {
  return JSON.parse(
    readFileSync(path.resolve(process.cwd(), relativePath), "utf8")
  ) as Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
let generationNetworkRequests = 0;
globalThis.fetch = (async () => {
  generationNetworkRequests += 1;
  throw new Error("network_forbidden_in_v18r2_ux_polish_candidate_smoke");
}) as typeof fetch;

try {
  const expected = buildFormativeConversationV18R2UxPolishArtifacts();
  const actualRuntime = readJson(
    `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/runtime-candidate-manifest.json`
  );
  const actualFixtures = readJson(
    `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/fixture-manifest.json`
  );
  const actualProtocol = readJson(
    `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/targeted-validation-protocol.json`
  );
  const actualIdentity = readJson(
    `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/candidate-identity.json`
  );

  assert.deepEqual(actualRuntime, expected.runtimeCandidateManifest);
  assert.deepEqual(actualFixtures, expected.fixtureManifest);
  assert.deepEqual(actualProtocol, expected.targetedValidationProtocol);
  assert.deepEqual(actualIdentity, expected.candidateIdentity);
  assert.notEqual(
    actualRuntime.runtime_candidate_hash,
    FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_LIVE_REFERENCE.runtime_candidate_hash
  );

  const historicalV18R2 = readJson(
    "config/operational-candidates/formative-conversation-contract-coherence-v18r2/runtime-candidate-manifest.json"
  );
  assert.equal(
    historicalV18R2.runtime_candidate_hash,
    FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_LIVE_REFERENCE.runtime_candidate_hash
  );
  assert.equal(
    (historicalV18R2.formative_conversation_role as Record<string, unknown>)
      .prompt_hash,
    FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_LIVE_REFERENCE.prompt_hash
  );

  const governance = actualIdentity.governance as Record<string, unknown>;
  assert.equal(governance.live_authorization_created, false);
  assert.equal(governance.live_execution_prepared, false);
  assert.equal(governance.approval_eligible, false);
  assert.equal(governance.activation_permitted, false);
  assert.deepEqual(
    actualProtocol.required_tests,
    [...FORMATIVE_CONVERSATION_V18R2_UX_POLISH_REQUIRED_TESTS]
  );
  assert.equal(actualProtocol.provider_calls_permitted, 0);
  assert.equal(actualProtocol.model_auth_requests_permitted, 0);
  assert.equal(actualProtocol.generation_network_requests_permitted, 0);
  assert.equal(actualProtocol.real_dispatch_checkpoints_permitted, 0);
  assert.equal(generationNetworkRequests, 0);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        runtime_candidate_hash: actualRuntime.runtime_candidate_hash,
        prompt_hash: actualIdentity.prompt_hash,
        protocol_hash: actualProtocol.protocol_hash,
        fixture_manifest_hash: actualFixtures.fixture_manifest_hash,
        candidate_identity_hash: actualIdentity.candidate_identity_hash,
        historical_v18r2_reference_unchanged: true,
        live_authorization_created: false,
        live_execution_prepared: false,
        approval_eligible: false,
        activation_permitted: false,
        provider_calls: 0,
        model_auth_requests: 0,
        generation_network_requests: generationNetworkRequests,
        real_dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
} finally {
  globalThis.fetch = originalFetch;
}
