import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V18_PRESERVED_ACTIVE_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V18_PRESERVED_ROLLBACK_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V18_REQUIRED_NO_PROVIDER_TESTS,
  buildFormativeConversationV18RuntimeCandidateManifest
} from "../src/lib/operational/formative-conversation-v18/candidate";
import { FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE } from "../src/lib/operational/formative-conversation-v18/forensics";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT,
  FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18/contracts";
import {
  exactFormativeConversationV18LiveAuthorization,
  loadFormativeConversationV18EvaluationPackage,
  packagePathsExist
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18/package";

type JsonRecord = Record<string, unknown>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function bytes(filename: string) {
  return readFileSync(
    path.resolve(process.cwd(), FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT, filename)
  );
}

function json(filename: string) {
  return JSON.parse(bytes(filename).toString("utf8")) as JsonRecord;
}

const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = (async () => {
  networkRequests += 1;
  throw new Error("network_forbidden_in_v18_executable_candidate_smoke");
}) as typeof fetch;

try {
  const loaded = loadFormativeConversationV18EvaluationPackage();
  assert.equal(packagePathsExist(), true);
  const expectedRuntime = buildFormativeConversationV18RuntimeCandidateManifest();
  assert.deepEqual(loaded.runtime_manifest, expectedRuntime);
  assert.equal(
    expectedRuntime.runtime_candidate_hash,
    "17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca"
  );
  assert.equal(
    expectedRuntime.student_profiling_role.prompt_hash,
    "c6dcc59c6698b2c9eb8082080bde122b3f29be7e2c7632066b9acbbbbbdaf626"
  );
  assert.equal(
    expectedRuntime.formative_conversation_role.prompt_hash,
    "cec7ea8dcb2ef86b588346b540ef0439f78e6265b12de7a317a3f7514f776a9a"
  );

  assert.deepEqual(
    loaded.compiled_plan.cases.map((entry) => entry.case_id),
    [...FORMATIVE_CONVERSATION_V5_CASE_ORDER]
  );
  assert.equal(loaded.fixtures.length, 12);
  assert.equal(
    loaded.fixtures.filter((entry) => entry.case_type === "profiling_contract_canary").length,
    3
  );
  assert.equal(
    loaded.fixtures.filter((entry) => entry.case_type === "formative_conversation").length,
    8
  );
  assert.equal(
    loaded.fixtures.filter((entry) => entry.case_type === "dissertation_end_to_end").length,
    1
  );
  assert.equal(FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER.length, 3);
  assert.equal(FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER.length, 8);
  assert.equal(FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER.length, 1);

  const budget = loaded.protocol.budget;
  assert.equal(budget.base_profiling_call_count, 4);
  assert.equal(budget.base_formative_call_count, 24);
  assert.equal(budget.expected_logical_call_count, 28);
  assert.equal(budget.maximum_semantic_regeneration_count, 28);
  assert.equal(budget.maximum_logical_call_count, 56);
  assert.equal(budget.maximum_provider_attempt_count, 168);
  assert.equal(budget.maximum_concurrency, 1);
  assert.equal(
    loaded.source_candidate.roles.formative_conversation_agent.max_output_tokens,
    7_000
  );
  assert.equal(
    loaded.source_candidate.roles.student_profiling_agent.max_output_tokens,
    4_000
  );
  const profilingIdentity = loaded.protocol.profiling_identity as JsonRecord;
  assert.equal(profilingIdentity.prompt_version, "student-profiling-v5");
  assert.equal(profilingIdentity.schema_version, "student-profile-output-v4");

  const candidate = loaded.candidate_manifest;
  const identity = loaded.candidate_identity;
  assert.equal(candidate.live_execution_prepared, true);
  assert.equal((candidate.approval as JsonRecord).eligible, false);
  assert.equal((candidate.activation as JsonRecord).permitted, false);
  assert.equal(identity.live_execution_prepared, true);
  assert.equal(identity.approval_eligible, false);
  assert.equal(identity.activation_permitted, false);
  assert.equal(
    candidate.preserved_active_runtime_hash,
    FORMATIVE_CONVERSATION_V18_PRESERVED_ACTIVE_RUNTIME_HASH
  );
  assert.equal(
    candidate.preserved_rollback_runtime_hash,
    FORMATIVE_CONVERSATION_V18_PRESERVED_ROLLBACK_RUNTIME_HASH
  );
  assert.equal(
    loaded.authorization_package.exact_future_authorization_text,
    exactFormativeConversationV18LiveAuthorization(loaded)
  );
  assert.match(
    String(loaded.authorization_package.exact_future_live_command),
    /^node --import tsx scripts\/operational-formative-conversation-v5-v18-process-local-runner\.mjs/u
  );

  const packageJson = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };
  for (const command of FORMATIVE_CONVERSATION_V18_REQUIRED_NO_PROVIDER_TESTS) {
    if (command === "npx prisma validate" || command === "build_with_8gb_heap") {
      continue;
    }
    assert.equal(
      typeof packageJson.scripts?.[command],
      "string",
      `V18 required no-provider command is unavailable: ${command}`
    );
  }

  const fixtureFiles = FORMATIVE_CONVERSATION_V5_CASE_ORDER.map(
    (caseId) => `${FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT}/${caseId}.json`
  );
  assert.equal(fixtureFiles.every((filename) => existsSync(path.resolve(filename))), true);
  const immutable = loaded.immutable_v17_reference;
  assert.equal(
    immutable.candidate_tree_sha256,
    FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE.candidate_tree_sha256
  );
  assert.equal(
    immutable.run_tree_sha256,
    FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE.run_tree_sha256
  );
  assert.equal(immutable.required_for_v18_live_readiness, false);
  assert.equal(immutable.candidate_artifacts_mutated, false);
  assert.equal(immutable.run_artifacts_mutated, false);

  const protocol = json("executable-evaluation-protocol.json");
  const { protocol_hash: protocolHash, ...protocolIdentity } = protocol;
  assert.equal(protocolHash, stableHash(protocolIdentity));
  const candidateManifest = json("candidate-manifest.json");
  const { candidate_manifest_hash: candidateManifestHash, ...candidateMaterial } =
    candidateManifest;
  assert.equal(candidateManifestHash, stableHash(candidateMaterial));
  const identityFileSha256 = identity.file_sha256 as JsonRecord;
  assert.equal(
    identityFileSha256.candidate_manifest,
    sha256(bytes("candidate-manifest.json"))
  );
  assert.equal(
    identityFileSha256.executable_evaluation_protocol,
    sha256(bytes("executable-evaluation-protocol.json"))
  );
  assert.equal(networkRequests, 0);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        case_count: loaded.fixtures.length,
        profiling_cases: 3,
        formative_cases: 8,
        end_to_end_cases: 1,
        runtime_candidate_hash: loaded.runtime_candidate_hash,
        profiling_prompt_hash: expectedRuntime.student_profiling_role.prompt_hash,
        formative_prompt_hash: expectedRuntime.formative_conversation_role.prompt_hash,
        protocol_hash: loaded.protocol_hash,
        candidate_manifest_hash: candidateManifestHash,
        fixture_manifest_hash: loaded.fixture_manifest_hash,
        aggregate_fixture_hash: loaded.aggregate_fixture_hash,
        compiled_plan_hash: loaded.compiled_plan.compiled_plan_hash,
        live_execution_prepared: true,
        approval_eligible: false,
        activation_permitted: false,
        provider_calls: 0,
        model_auth_requests: 0,
        generation_network_requests: networkRequests,
        dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
} finally {
  globalThis.fetch = originalFetch;
}
