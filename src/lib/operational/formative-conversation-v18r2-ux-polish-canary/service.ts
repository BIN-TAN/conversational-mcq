import { createHash, randomBytes } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  createFormativeConversationV18R2CandidateRunner
} from "@/lib/operational/formative-conversation-v5-evaluation-v18r2/candidate-runner";
import { writeFormativeConversationV18R2DispatchCheckpoint } from "@/lib/operational/formative-conversation-v5-evaluation-v18r2/dispatch-checkpoint";
import type { FormativeConversationV18Package } from "@/lib/operational/formative-conversation-v5-evaluation-v18r2/package";
import {
  FORMATIVE_CONVERSATION_V18R2_RELEASE_ROOT,
  createFormativeConversationV18R2FinalizedManifest
} from "@/lib/operational/formative-conversation-v5-evaluation-v18r2/security-release";
import {
  FormativeConversationV18R2ExecutionAuditSchema,
  FormativeConversationV18R2ExecutionError
} from "@/lib/services/student-assessment/formative-conversation/execution-v18r2";
import {
  FormativeConversationV18R2AgentOutputSchema
} from "@/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "@/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import {
  V18R2_UX_CANARY_ARTIFACT_PATHS,
  V18R2_UX_CANARY_CASE_ORDER,
  V18R2_UX_CANARY_DISPATCH_ROOT,
  V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS,
  V18R2_UX_CANARY_INTENDED_LIVE_ARTIFACTS,
  V18R2_UX_CANARY_MACHINE_CRITERIA,
  V18R2_UX_CANARY_PLAN_ROOT
} from "./contracts";
import {
  validateV18R2UxCanaryLiveEnvironment,
  verifyV18R2UxCanaryDatabaseReadiness
} from "./environment";
import {
  loadV18R2UxPolishCanaryPackage,
  type V18R2UxPolishCanaryPackage
} from "./package";

const FORBIDDEN_LEGACY_OUTPUT_KEYS = new Set([
  "activity_family",
  "activity_attempt_public_id",
  "semantic_deduplication_key",
  "next_interaction",
  "pedagogical_operation",
  "topic_dialogue_action"
]);

function assertCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
  return /^[a-z0-9_]+$/u.test(code)
    ? code
    : "v18r2_ux_canary_execution_failed";
}

function containsForbiddenLegacyKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenLegacyKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, entry]) =>
      FORBIDDEN_LEGACY_OUTPUT_KEYS.has(key) || containsForbiddenLegacyKey(entry)
  );
}

function exactAuthorization(input: {
  loaded: V18R2UxPolishCanaryPackage;
  expected_deployed_git_sha: string;
}) {
  return `I authorize one live execution of formative-conversation-v18r2-ux-polish-targeted-canary-v1 from expected deployed Git SHA ${input.expected_deployed_git_sha} for runtime candidate hash ${input.loaded.runtime_candidate_hash} and evaluation protocol hash ${input.loaded.protocol_hash}, using exactly 4 isolated synthetic canaries with 4 formative base calls, at most 8 logical calls, 24 provider attempts, 400000 input tokens, 56000 output tokens, 456000 total tokens, 1800000 milliseconds wall-clock time, concurrency 1, and a USD 15 ceiling.`;
}

function checkpointPath(loaded: V18R2UxPolishCanaryPackage) {
  return path.resolve(
    process.cwd(),
    V18R2_UX_CANARY_DISPATCH_ROOT,
    "dispatch",
    `${loaded.protocol_hash}.json`
  );
}

async function assertNoPriorCheckpoint(loaded: V18R2UxPolishCanaryPackage) {
  try {
    await access(checkpointPath(loaded));
    throw new Error("v18r2_ux_canary_protocol_already_dispatched");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "v18r2_ux_canary_protocol_already_dispatched" ||
        !("code" in error) ||
        error.code !== "ENOENT")
    ) {
      throw error;
    }
  }
}

export function buildV18R2UxCanaryPlan() {
  const loaded = loadV18R2UxPolishCanaryPackage();
  return {
    plan_version: "formative-conversation-v18r2-ux-polish-canary-plan-v1",
    mode: "plan",
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    formative_prompt_hash: loaded.candidate_identity.formative_prompt_hash,
    evaluation_protocol_hash: loaded.protocol_hash,
    runner_implementation_hash: loaded.runner_implementation_hash,
    fixture_manifest_hash: loaded.fixture_manifest_hash,
    aggregate_fixture_hash: loaded.aggregate_fixture_hash,
    compiled_plan_hash: loaded.compiled_plan_hash,
    environment_contract_hash: loaded.live_environment_contract_hash,
    checkpoint_contract_hash: loaded.dispatch_checkpoint_contract_hash,
    provenance_contract_hash: loaded.provenance_contract_hash,
    security_wrapper_hash: loaded.security_wrapper_hash,
    fixed_case_order: [...V18R2_UX_CANARY_CASE_ORDER],
    call_graph: loaded.compiled_plan.aggregate_call_graph,
    budget: loaded.protocol.budget,
    machine_validation_criteria: [...V18R2_UX_CANARY_MACHINE_CRITERIA],
    human_review_dimensions: [...V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS],
    human_judgment_first: true,
    deterministic_ux_wording_assertions: false,
    provider_calls: 0,
    model_auth_requests: 0,
    generation_network_requests: 0,
    real_dispatch_checkpoints: 0,
    live_execution_prepared: true,
    approval_eligible: false,
    activation_permitted: false,
    exact_future_authorization_text: null,
    exact_future_live_command: null,
    plan_output_root: V18R2_UX_CANARY_PLAN_ROOT
  } as const;
}

export async function preflightV18R2UxCanary(input: {
  expected_deployed_git_sha: string;
  verify_database?: boolean;
}) {
  const loaded = loadV18R2UxPolishCanaryPackage();
  await assertNoPriorCheckpoint(loaded);
  const environment = validateV18R2UxCanaryLiveEnvironment({
    loaded,
    env: process.env,
    expected_deployed_git_sha: input.expected_deployed_git_sha
  });
  const database = input.verify_database === false
    ? { database_check_deferred: true, migrations_run: false }
    : await verifyV18R2UxCanaryDatabaseReadiness();
  return {
    status: "ready_immediately_before_dispatch_checkpoint",
    loaded,
    environment,
    database,
    checkpoint_created: false,
    provider_calls: 0,
    model_auth_requests: 0
  } as const;
}

async function writeOwnerOnlyJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
}

async function hashRegularArtifacts(root: string) {
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(path.join(root, name));
      return { path: name, sha256: sha256(bytes), bytes: bytes.byteLength };
    })
  );
}

export async function executeV18R2UxCanaryLive(input: {
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  expected_deployed_git_sha: string;
  authorization: string;
  confirm_live_provider_calls: boolean;
  staging_base_root: string;
}) {
  assertCondition(
    input.confirm_live_provider_calls,
    "v18r2_ux_canary_live_provider_confirmation_missing"
  );
  const preflight = await preflightV18R2UxCanary({
    expected_deployed_git_sha: input.expected_deployed_git_sha
  });
  const { loaded } = preflight;
  assertCondition(
    input.runtime_candidate_hash === loaded.runtime_candidate_hash &&
      input.evaluation_protocol_hash === loaded.protocol_hash,
    "v18r2_ux_canary_authorized_identity_mismatch"
  );
  const requiredAuthorization = exactAuthorization({
    loaded,
    expected_deployed_git_sha: input.expected_deployed_git_sha
  });
  assertCondition(
    input.authorization === requiredAuthorization,
    "v18r2_ux_canary_exact_authorization_mismatch"
  );

  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "").slice(0, 14);
  const nonce = randomBytes(4).toString("hex");
  const providerRunId = `fcv5v18r2_provider_ux_${timestamp}_${nonce}`;
  const derivedEvaluationId = `fcv5v18r2_derived_ux_${timestamp}_${nonce}`;
  const authorizationIdentityHash = stableHash({
    authorization: input.authorization,
    expected_deployed_git_sha: input.expected_deployed_git_sha,
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    protocol_hash: loaded.protocol_hash
  });
  const deployedArtifactProvenanceHash = stableHash({
    provenance_version: "v18r2-ux-canary-deployed-source-v1",
    expected_deployed_git_sha: input.expected_deployed_git_sha,
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    protocol_hash: loaded.protocol_hash,
    runner_implementation_hash: loaded.runner_implementation_hash
  });
  let checkpoint: Awaited<
    ReturnType<typeof writeFormativeConversationV18R2DispatchCheckpoint>
  > | null = null;
  const runnerLoaded = {
    source_candidate: loaded.source_candidate,
    protocol: { budget: loaded.protocol.budget },
    runtime_manifest: loaded.runtime_manifest,
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    protocol_hash: loaded.protocol_hash,
    aggregate_fixture_hash: loaded.aggregate_fixture_hash
  } as unknown as FormativeConversationV18Package;
  const runner = createFormativeConversationV18R2CandidateRunner({
    loaded: runnerLoaded,
    evaluation_id: providerRunId,
    before_first_generation_request: async () => {
      assertCondition(
        checkpoint === null,
        "v18r2_ux_canary_duplicate_dispatch_checkpoint"
      );
      checkpoint = await writeFormativeConversationV18R2DispatchCheckpoint({
        dispatch_root: V18R2_UX_CANARY_DISPATCH_ROOT,
        identity: {
          provider_run_id: providerRunId,
          derived_evaluation_id: derivedEvaluationId,
          runtime_candidate_hash: loaded.runtime_candidate_hash,
          evaluation_protocol_hash: loaded.protocol_hash,
          runner_implementation_hash: loaded.runner_implementation_hash,
          candidate_manifest_hash: loaded.candidate_manifest_hash,
          fixture_manifest_hash: loaded.fixture_manifest_hash,
          aggregate_fixture_hash: loaded.aggregate_fixture_hash,
          compiled_plan_hash: loaded.compiled_plan_hash,
          live_environment_contract_hash: loaded.live_environment_contract_hash,
          dispatch_checkpoint_contract_hash:
            loaded.dispatch_checkpoint_contract_hash,
          provenance_contract_hash: loaded.provenance_contract_hash,
          source_commit_sha: input.expected_deployed_git_sha,
          deployment_reported_commit_sha: input.expected_deployed_git_sha,
          operator_authorized_commit_sha: input.expected_deployed_git_sha,
          deployed_artifact_identity_status: "verified",
          deployed_artifact_provenance_hash: deployedArtifactProvenanceHash,
          execution_authorization_identity_hash: authorizationIdentityHash
        }
      });
    }
  });

  const cases: Array<Record<string, unknown>> = [];
  for (const fixture of loaded.fixtures) {
    const startedAt = new Date();
    try {
      const execution = await runner.formative_runner.execute({
        agent_call_db_id: `${providerRunId}:${fixture.case_id}:synthetic-agent-call`,
        invocation_key: `${providerRunId}:${fixture.case_id}`,
        context: fixture.context
      });
      const output = FormativeConversationV18R2AgentOutputSchema.parse(
        execution.output
      );
      const acceptance = validateFormativeConversationV18R2CandidateAcceptance({
        candidate: output,
        context: fixture.context
      });
      const audit = FormativeConversationV18R2ExecutionAuditSchema.parse(
        execution.provider_execution_audit
      );
      const machineChecks = {
        structured_response_valid: true,
        privacy_and_assessment_truth_boundary_valid: acceptance.valid,
        legacy_activity_contamination_absent:
          !containsForbiddenLegacyKey(output),
        nonterminal_or_transition_contract_valid: acceptance.valid,
        formative_lifecycle_valid: acceptance.valid,
        opening_acceptance_valid_when_applicable:
          !fixture.opening_case ||
          (acceptance.valid && audit.semantic_regeneration_calls === 0)
      };
      const passed = Object.values(machineChecks).every(Boolean);
      cases.push({
        case_id: fixture.case_id,
        case_order: fixture.case_order,
        status: passed ? "passed" : "failed",
        purpose: fixture.purpose,
        opening_case: fixture.opening_case,
        input_context: fixture.context,
        transcript: [
          ...fixture.context.visible_transcript,
          {
            sequence_index: fixture.context.visible_transcript.length + 1,
            actor: "tutor",
            message_text: output.student_visible_message,
            created_at: execution.completed_at.toISOString()
          }
        ],
        tutor_output: output,
        provider_execution_audit: audit,
        machine_validation: machineChecks,
        validation_status: acceptance.validation_status,
        validation_issue_paths: acceptance.validation_issue_paths,
        human_review: Object.fromEntries(
          V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS.map((dimension) => [
            dimension,
            "pending"
          ])
        ),
        latency_ms: execution.latency_ms,
        input_tokens: execution.input_tokens,
        output_tokens: execution.output_tokens,
        total_tokens: execution.total_tokens,
        started_at: startedAt.toISOString(),
        completed_at: execution.completed_at.toISOString()
      });
    } catch (error) {
      const executionError =
        error instanceof FormativeConversationV18R2ExecutionError ? error : null;
      cases.push({
        case_id: fixture.case_id,
        case_order: fixture.case_order,
        status: "failed",
        purpose: fixture.purpose,
        opening_case: fixture.opening_case,
        input_context: fixture.context,
        transcript: fixture.context.visible_transcript,
        tutor_output: null,
        typed_failure: safeErrorCode(error),
        provider_execution_audit: executionError?.audit ?? null,
        preserved_invalid_output: executionError?.last_result.raw_output ?? null,
        machine_validation: Object.fromEntries(
          V18R2_UX_CANARY_MACHINE_CRITERIA.map((criterion) => [criterion, false])
        ),
        human_review: Object.fromEntries(
          V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS.map((dimension) => [
            dimension,
            "not_exercised"
          ])
        ),
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString()
      });
    }
  }
  const ledger = runner.complete();
  assertCondition(
    checkpoint !== null,
    "v18r2_ux_canary_dispatch_checkpoint_missing"
  );
  const passedCount = cases.filter((entry) => entry.status === "passed").length;
  const failedCount = cases.length - passedCount;
  const aggregate = {
    artifact_version: "formative-conversation-v18r2-ux-canary-aggregate-v1",
    provider_run_id: providerRunId,
    derived_evaluation_id: derivedEvaluationId,
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    protocol_hash: loaded.protocol_hash,
    case_count: cases.length,
    passed_case_count: passedCount,
    failed_case_count: failedCount,
    invalid_case_count: 0,
    not_exercised_case_count: 0,
    ledger,
    human_review_status: "pending",
    approval_eligible: false,
    activation_permitted: false
  } as const;

  const stagingRoot = path.resolve(input.staging_base_root, providerRunId);
  await mkdir(stagingRoot, { recursive: false, mode: 0o700 });
  await chmod(stagingRoot, 0o700);
  await writeOwnerOnlyJson(path.join(stagingRoot, "source-provider-run.json"), {
    artifact_version: "formative-conversation-v18r2-ux-canary-source-run-v1",
    ...aggregate,
    checkpoint,
    cases
  });
  await writeOwnerOnlyJson(
    path.join(stagingRoot, "aggregate-evaluation.json"),
    aggregate
  );
  await writeOwnerOnlyJson(
    path.join(stagingRoot, "human-review-package.json"),
    {
      artifact_version: "formative-conversation-v18r2-ux-human-review-v1",
      provider_run_id: providerRunId,
      review_status: "pending",
      machine_checks_are_hard_contracts_only: true,
      human_review_dimensions: [...V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS],
      cases: cases.map((entry) => ({
        case_id: entry.case_id,
        purpose: entry.purpose,
        tutor_output: entry.tutor_output,
        transcript: entry.transcript,
        machine_validation: entry.machine_validation,
        human_review: entry.human_review
      })),
      approval_eligible: false,
      activation_permitted: false
    }
  );
  await writeOwnerOnlyJson(path.join(stagingRoot, "provenance-manifest.json"), {
    artifact_version: "formative-conversation-v18r2-ux-canary-provenance-v1",
    provider_run_id: providerRunId,
    derived_evaluation_id: derivedEvaluationId,
    source_commit_sha: input.expected_deployed_git_sha,
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    formative_prompt_hash: loaded.candidate_identity.formative_prompt_hash,
    protocol_hash: loaded.protocol_hash,
    runner_implementation_hash: loaded.runner_implementation_hash,
    fixture_manifest_hash: loaded.fixture_manifest_hash,
    aggregate_fixture_hash: loaded.aggregate_fixture_hash,
    compiled_plan_hash: loaded.compiled_plan_hash,
    environment_contract_hash: loaded.live_environment_contract_hash,
    checkpoint_contract_hash: loaded.dispatch_checkpoint_contract_hash,
    provenance_contract_hash: loaded.provenance_contract_hash,
    security_wrapper_hash: loaded.security_wrapper_hash,
    checkpoint,
    historical_v18r2_run_mutated: false
  });
  const initialArtifacts = await hashRegularArtifacts(stagingRoot);
  await writeOwnerOnlyJson(path.join(stagingRoot, "artifact-hash-manifest.json"), {
    artifact_version: "formative-conversation-v18r2-ux-canary-hash-manifest-v1",
    provider_run_id: providerRunId,
    artifacts: initialArtifacts
  });
  assertCondition(
    V18R2_UX_CANARY_INTENDED_LIVE_ARTIFACTS.every((name) =>
      [
        ...initialArtifacts.map((entry) => entry.path),
        "artifact-hash-manifest.json"
      ].includes(name)
    ),
    "v18r2_ux_canary_artifact_coverage_incomplete"
  );
  const finalized = await createFormativeConversationV18R2FinalizedManifest({
    staging_root: stagingRoot,
    package_id: providerRunId
  });
  return {
    status: "completed_pending_human_review",
    provider_run_id: providerRunId,
    derived_evaluation_id: derivedEvaluationId,
    aggregate,
    cases,
    checkpoint,
    artifacts: {
      staging_root: stagingRoot,
      release_root: path.resolve(
        process.cwd(),
        FORMATIVE_CONVERSATION_V18R2_RELEASE_ROOT,
        providerRunId
      ),
      finalized_artifact_manifest_path: finalized.manifest_path,
      finalized_artifact_manifest_sha256: finalized.manifest_sha256
    },
    approval_eligible: false,
    activation_permitted: false
  } as const;
}

export function v18R2UxCanaryFutureAuthorizationTemplate() {
  const loaded = loadV18R2UxPolishCanaryPackage();
  return exactAuthorization({
    loaded,
    expected_deployed_git_sha: "<expected_deployed_git_sha>"
  });
}

export const V18R2_UX_CANARY_PACKAGE_PATHS = V18R2_UX_CANARY_ARTIFACT_PATHS;
