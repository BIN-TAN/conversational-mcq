import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type { AgentOutputByName } from "@/lib/agents/contracts";
import {
  SyntheticStudentPersonaSchema,
  type SyntheticStudentPersona
} from "@/lib/evaluation/synthetic-student-validation/contracts";
import {
  runSyntheticStudentResearchValidation
} from "@/lib/evaluation/synthetic-student-validation/framework";
import { getLlmRuntimeConfig } from "@/lib/llm/config";
import { resolveOpenAICredentialFromEnv } from "@/lib/llm/openai-credential-resolver";
import { prisma } from "@/lib/db";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  type FormativeConversationV5Fixture
} from "./contracts";
import {
  createFormativeConversationV5CandidateRunner
} from "./candidate-runner";
import {
  buildFormativeConversationV5EvaluationPlan,
  exactFormativeConversationV5LiveAuthorization,
  loadFormativeConversationV5EvaluationPackage,
  verifyFormativeConversationV5Governance
} from "./package";

export type FormativeConversationV5LiveOptions = {
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  confirm_live_provider_calls: boolean;
  authorization: string;
};

function timestampId() {
  return new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
}

function safeRelative(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

async function writeJson(
  filePath: string,
  value: unknown,
  options?: { exclusive?: boolean }
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    ...(options?.exclusive ? { flag: "wx" } : {})
  });
  return filePath;
}

async function sha256File(filePath: string) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function contractOutcomeFromPersisted(
  value: unknown
):
  | "sound_understanding"
  | "largely_improved_understanding"
  | "teacher_assistance_recommended"
  | null {
  if (value === "sound") {
    return "sound_understanding";
  }
  if (value === "largely_improved") {
    return "largely_improved_understanding";
  }
  return value === "teacher_assistance_recommended"
    ? value
    : null;
}

function personaFromFixture(
  fixture: FormativeConversationV5Fixture
): SyntheticStudentPersona {
  return SyntheticStudentPersonaSchema.parse({
    validation_version: "synthetic-student-research-validation-v2",
    persona_id: fixture.execution_persona_id,
    display_name: `Synthetic ${fixture.title}`,
    description:
      "Frozen synthetic case for the formative conversation v5 operational candidate.",
    initial_knowledge_state:
      fixture.initial_profile_source.profile.integrated_profile_rationale,
    response_behavior:
      "Assessment responses, reasoning, confidence, and observable process behavior are frozen in the executable fixture.",
    assessment_response_behavior:
      fixture.assessment_responses.map((response) => ({
        item_number: response.item_number,
        selected_option: response.selected_option,
        prior_option_selections:
          response.prior_option_selections,
        tempting_option: response.tempting_option,
        tempting_option_reason:
          response.tempting_option_reason,
        reasoning_text: response.reasoning_text,
        confidence_rating: response.confidence_rating,
        response_time_ms: response.response_time_ms,
        time_to_first_action_ms:
          response.time_to_first_action_ms,
        reasoning_revision_count:
          response.reasoning_revision_count,
        navigation_observations:
          response.navigation_observations
      })),
    reasoning_style:
      fixture.initial_profile_source.profile.reasoning_quality_summary,
    confidence_pattern:
      fixture.initial_profile_source.profile.confidence_alignment,
    interaction_behavior:
      "Uses only the ordered student messages frozen in this fixture.",
    process_behavior:
      "Contains raw synthetic timings, revisions, navigation, and input observations only.",
    validation_purpose: fixture.case_assertions
      .map((assertion) => assertion.description)
      .join(" "),
    conversation_behavior: fixture.student_messages.map((message) => ({
      intent: message.intent,
      message_text: message.message_text,
      response_time_ms:
        message.observable_input_telemetry.response_time_ms,
      typing_duration_ms:
        message.observable_input_telemetry.typing_duration_ms,
      edit_count:
        message.observable_input_telemetry.edit_count,
      backspace_count:
        message.observable_input_telemetry.backspace_count,
      paste_event_count:
        message.observable_input_telemetry.paste_event_count,
      paste_character_count:
        message.observable_input_telemetry.paste_character_count
    }))
  });
}

function frozenProfiles(
  fixtures: readonly FormativeConversationV5Fixture[]
) {
  return Object.fromEntries(
    fixtures.map((fixture) => [
      fixture.execution_persona_id,
      fixture.initial_profile_source.profile
    ])
  ) as Partial<
    Record<
      SyntheticStudentPersona["persona_id"],
      AgentOutputByName["student_profiling_agent"]
    >
  >;
}

export async function writeFormativeConversationV5PlanArtifact() {
  const plan = buildFormativeConversationV5EvaluationPlan();
  const planPublicId = `fcv5_plan_${timestampId()}_${randomUUID().slice(0, 8)}`;
  const artifact = {
    ...plan,
    plan_public_id: planPublicId,
    generated_at: new Date().toISOString()
  };
  const artifactPath = safeRelative(
    path.join(
      FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
      `${planPublicId}.json`
    )
  );
  await writeJson(artifactPath, artifact);
  return {
    artifact,
    artifact_path: artifactPath,
    artifact_sha256: await sha256File(artifactPath)
  };
}

function assertLivePreflight(options: FormativeConversationV5LiveOptions) {
  const loaded = loadFormativeConversationV5EvaluationPackage();
  verifyFormativeConversationV5Governance(loaded);
  if (
    options.runtime_candidate_hash !==
    loaded.runtime_candidate_hash
  ) {
    throw new Error(
      "formative_conversation_v5_runtime_candidate_hash_mismatch"
    );
  }
  if (
    options.evaluation_protocol_hash !== loaded.protocol_hash
  ) {
    throw new Error(
      "formative_conversation_v5_protocol_hash_mismatch"
    );
  }
  if (!options.confirm_live_provider_calls) {
    throw new Error(
      "formative_conversation_v5_live_confirmation_missing"
    );
  }
  if (
    options.authorization !==
    exactFormativeConversationV5LiveAuthorization(loaded)
  ) {
    throw new Error(
      "formative_conversation_v5_exact_authorization_mismatch"
    );
  }
  if (
    process.env
      .FORMATIVE_CONVERSATION_V5_LIVE_EVALUATION_ENABLED !==
    "true"
  ) {
    throw new Error(
      "formative_conversation_v5_live_environment_flag_missing"
    );
  }
  if (!process.env.RESEARCH_PSEUDONYMIZATION_KEY?.trim()) {
    throw new Error(
      "formative_conversation_v5_research_export_configuration_missing"
    );
  }
  const runtime = getLlmRuntimeConfig();
  if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
    throw new Error(
      "formative_conversation_v5_openai_live_runtime_required"
    );
  }
  const credential = resolveOpenAICredentialFromEnv(process.env);
  if (!credential.ok) {
    throw new Error(
      `formative_conversation_v5_openai_credential_unavailable:${credential.code}`
    );
  }
  return loaded;
}

async function caseEvidenceArtifact(input: {
  loaded: ReturnType<
    typeof loadFormativeConversationV5EvaluationPackage
  >;
  fixture: FormativeConversationV5Fixture;
  student: Awaited<
    ReturnType<typeof runSyntheticStudentResearchValidation>
  >["report"]["students"][number];
}) {
  const agentCalls = await prisma.agentCall.findMany({
    where: {
      agent_call_public_id: {
        in: input.student.agent_calls.public_ids
      }
    },
    orderBy: { created_at: "asc" },
    select: {
      agent_call_public_id: true,
      agent_name: true,
      agent_version: true,
      model_name: true,
      provider: true,
      prompt_hash: true,
      prompt_version: true,
      schema_version: true,
      formative_conversation_context_version: true,
      reasoning_effort: true,
      max_output_tokens: true,
      call_status: true,
      output_validated: true,
      live_call_allowed: true,
      retry_count: true,
      latency_ms: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      error_category: true,
      usage_guard_snapshot: true,
      output_payload: true,
      started_at: true,
      completed_at: true,
      formative_conversation_message_receipt: {
        select: {
          receipt_public_id: true,
          assistant_turn: {
            select: {
              sequence_index: true,
              message_text: true,
              structured_payload: true,
              created_at: true
            }
          }
        }
      }
    }
  });
  const safeAgentCalls = agentCalls.map((call) => {
    const output = asRecord(call.output_payload);
    const usageGuard = asRecord(call.usage_guard_snapshot);
    const assistantTurn =
      call.formative_conversation_message_receipt?.assistant_turn ??
      null;
    const assistantPayload = asRecord(
      assistantTurn?.structured_payload
    );
    return {
      agent_call_public_id: call.agent_call_public_id,
      receipt_public_id:
        call.formative_conversation_message_receipt
          ?.receipt_public_id ?? null,
      assistant_turn_sequence_index:
        assistantTurn?.sequence_index ?? null,
      agent_name: call.agent_name,
      agent_version: call.agent_version,
      model_name: call.model_name,
      provider: call.provider,
      prompt_hash: call.prompt_hash,
      prompt_version: call.prompt_version,
      schema_version: call.schema_version,
      context_version:
        call.formative_conversation_context_version,
      reasoning_effort: call.reasoning_effort,
      max_output_tokens: call.max_output_tokens,
      generation_source:
        typeof usageGuard.generation_source === "string"
          ? usageGuard.generation_source
          : typeof assistantPayload.generation_source === "string"
            ? assistantPayload.generation_source
            : null,
      output_validation: {
        status: call.output_validated ? "passed" : "failed",
        validator_status:
          typeof assistantPayload.validator_status === "string"
            ? assistantPayload.validator_status
            : null
      },
      safety_validation: {
        boundary_version:
          input.loaded.protocol.target_identity.safety_version,
        context_status: "passed_before_agent_dispatch"
      },
      fallback_used:
        assistantPayload.fallback_used === true,
      call_status: call.call_status,
      typed_failure:
        call.call_status === "succeeded"
          ? null
          : call.error_category ?? "agent_call_failed",
      retry_count: call.retry_count,
      provider_attempt_count: call.retry_count + 1,
      latency_ms: call.latency_ms,
      input_tokens: call.input_tokens,
      output_tokens: call.output_tokens,
      total_tokens: call.total_tokens,
      started_at: call.started_at,
      completed_at: call.completed_at,
      student_visible_tutor_output:
        assistantTurn?.message_text ?? null,
      student_visible_tutor_output_created_at:
        assistantTurn?.created_at ?? null,
      profile_recommendation: call.output_validated
        ? output.profile_transition_recommendation ?? null
        : null,
      evidence_observations: call.output_validated
        ? output.evidence_observations ?? []
        : [],
      teacher_assistance_recommendation: call.output_validated
        ? output.teacher_assistance_recommendation ?? null
        : null,
      lifecycle_recommendation: call.output_validated
        ? output.lifecycle_recommendation ?? null
        : null
    };
  });
  const persistedTransition = asRecord(
    input.student.final_profile_transition
  );
  const persistedContractOutcome = contractOutcomeFromPersisted(
    persistedTransition.learning_outcome
  );
  const deterministicIssues = [
    ...(input.student.execution_error
      ? [`execution_error:${input.student.execution_error}`]
      : []),
    ...(input.student.agent_calls.total !==
    input.fixture.call_graph.expected_logical_calls
      ? ["logical_call_count_mismatch"]
      : []),
    ...(input.student.agent_calls.failed > 0
      ? ["agent_call_failure"]
      : []),
    ...(input.student.tutor_response_behavior.fallback_count > 0
      ? ["fallback_used"]
      : []),
    ...(input.student.tutor_response_behavior.generation_sources.some(
      (source) => source !== "live_llm"
    )
      ? ["non_live_generation_source"]
      : []),
    ...(input.student.final_profile_transition &&
    !input.fixture.permitted_terminal_outcomes.includes(
      persistedContractOutcome ??
        "continue_conversation"
    )
      ? ["terminal_outcome_not_permitted"]
      : []),
    ...(input.student.profile_transition_occurred &&
    (input.student.transition_evidence.supporting_turn_count === 0 ||
      input.student.transition_evidence.evidence_reference_count === 0 ||
      !input.student.transition_evidence
        .source_agent_call_public_id)
      ? ["profile_transition_provenance_incomplete"]
      : [])
  ];
  const transcript = {
    artifact_version:
      "formative-conversation-v5-safe-case-transcript-v1",
    data_classification: "synthetic_operational_evaluation",
    case_id: input.fixture.case_id,
    fixture_hash: input.fixture.fixture_hash,
    session_public_id: input.student.session_public_id,
    conversation_public_id:
      input.student.conversation_public_id,
    candidate_fingerprints: {
      runtime_candidate_hash: input.loaded.runtime_candidate_hash,
      evaluation_protocol_hash: input.loaded.protocol_hash,
      prompt_version:
        input.loaded.protocol.target_identity.prompt_version,
      prompt_hash: input.loaded.protocol.target_identity.prompt_hash,
      schema_version:
        input.loaded.protocol.target_identity.schema_version,
      context_version:
        input.loaded.protocol.target_identity.context_version,
      safety_version:
        input.loaded.protocol.target_identity.safety_version,
      memory_version:
        input.loaded.protocol.target_identity.memory_version,
      opening_validator_version:
        input.loaded.protocol.target_identity
          .opening_validator_version
    },
    transcript:
      (
        input.student.teacher_trajectory as Record<
          string,
          unknown
        >
      ).learning_conversation ?? [],
    agent_calls: safeAgentCalls,
    profile_transition:
      input.student.final_profile_transition,
    transition_evidence: input.student.transition_evidence,
    teacher_projection: input.student.teacher_trajectory,
    export_projection: {
      session_public_id: input.student.session_public_id,
      conversation_public_id:
        input.student.conversation_public_id,
      public_agent_call_ids:
        input.student.agent_calls.public_ids,
      profile_transition_public_id:
        typeof persistedTransition.transition_public_id === "string"
          ? persistedTransition.transition_public_id
          : null
    },
    telemetry_summary: input.student.telemetry_summary,
    prohibited_fields_excluded: [
      "api_keys",
      "hidden_prompts",
      "chain_of_thought",
      "raw_provider_payloads",
      "internal_database_ids"
    ]
  };
  const validation = {
    artifact_version:
      "formative-conversation-v5-case-validation-v1",
    case_id: input.fixture.case_id,
    fixture_hash: input.fixture.fixture_hash,
    status:
      deterministicIssues.length === 0 ? "passed" : "failed",
    deterministic_issue_codes: deterministicIssues,
    human_review_status: "pending",
    assertions: input.fixture.case_assertions.map((assertion) => ({
      ...assertion,
      status:
        assertion.evaluation_method ===
        "deterministic_artifact_check"
          ? deterministicIssues.length === 0
            ? "passed"
            : "failed"
          : "pending_human_review"
    }))
  };
  return { transcript, validation };
}

async function writeLiveArtifacts(input: {
  loaded: ReturnType<
    typeof loadFormativeConversationV5EvaluationPackage
  >;
  provider_run_id: string;
  derived_evaluation_id: string;
  result: Awaited<
    ReturnType<typeof runSyntheticStudentResearchValidation>
  >;
  ledger: ReturnType<
    typeof createFormativeConversationV5CandidateRunner
  >["ledger"];
}) {
  const runRoot = safeRelative(
    path.join(
      FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
      input.provider_run_id
    )
  );
  await mkdir(path.join(runRoot, "cases"), { recursive: true });
  const written: string[] = [];
  const write = async (relativePath: string, value: unknown) => {
    const outputPath = path.join(runRoot, relativePath);
    await writeJson(outputPath, value);
    written.push(outputPath);
    return outputPath;
  };
  await write("source-provider-run.json", {
    artifact_version:
      "formative-conversation-v5-source-provider-run-v1",
    data_classification: "synthetic_operational_evaluation",
    provider_run_id: input.provider_run_id,
    runtime_candidate_hash: input.loaded.runtime_candidate_hash,
    evaluation_protocol_hash: input.loaded.protocol_hash,
    aggregate_fixture_hash: input.loaded.aggregate_fixture_hash,
    expected_logical_call_count:
      input.loaded.protocol.budget.expected_logical_call_count,
    call_graph_complete:
      input.ledger.logical_calls_used ===
      input.loaded.protocol.budget.expected_logical_call_count,
    ledger: input.ledger,
    raw_provider_payloads_excluded: true
  });
  const caseResults = [];
  const caseArtifacts = new Map<
    string,
    Awaited<ReturnType<typeof caseEvidenceArtifact>>
  >();
  for (const fixture of input.loaded.fixtures) {
    const student = input.result.report.students.find(
      (entry) =>
        entry.persona_id === fixture.execution_persona_id
    );
    if (!student) {
      const validation = {
        artifact_version:
          "formative-conversation-v5-case-validation-v1",
        case_id: fixture.case_id,
        fixture_hash: fixture.fixture_hash,
        status: "not_exercised",
        deterministic_issue_codes: ["case_result_missing"],
        human_review_status: "not_started",
        assertions: fixture.case_assertions.map((assertion) => ({
          ...assertion,
          status: "not_exercised"
        }))
      };
      await write(
        `cases/${fixture.case_id}-validation.json`,
        validation
      );
      caseResults.push(validation);
      continue;
    }
    const artifacts = await caseEvidenceArtifact({
      loaded: input.loaded,
      fixture,
      student
    });
    caseArtifacts.set(fixture.case_id, artifacts);
    await write(
      `cases/${fixture.case_id}-transcript.json`,
      artifacts.transcript
    );
    await write(
      `cases/${fixture.case_id}-validation.json`,
      artifacts.validation
    );
    caseResults.push(artifacts.validation);
  }
  const deterministicFailureCount = caseResults.filter(
    (entry) => entry.status !== "passed"
  ).length;
  await write("aggregate-evaluation.json", {
    artifact_version:
      "formative-conversation-v5-aggregate-evaluation-v1",
    provider_run_id: input.provider_run_id,
    derived_evaluation_id: input.derived_evaluation_id,
    status:
      deterministicFailureCount === 0
        ? "completed_pending_human_review"
        : "completed_failed",
    case_count: caseResults.length,
    expected_logical_call_count:
      input.loaded.protocol.budget.expected_logical_call_count,
    actual_logical_call_count: input.ledger.logical_calls_used,
    call_graph_complete:
      input.ledger.logical_calls_used ===
      input.loaded.protocol.budget.expected_logical_call_count,
    deterministic_failure_count: deterministicFailureCount,
    human_review_required: true,
    approval_eligible: false,
    case_results: caseResults.map((entry) => ({
      case_id: entry.case_id,
      status: entry.status,
      human_review_status: entry.human_review_status
    }))
  });
  await write("derived-evaluation.json", {
    artifact_version:
      "formative-conversation-v5-derived-evaluation-v1",
    derived_evaluation_id: input.derived_evaluation_id,
    source_provider_run_id: input.provider_run_id,
    runtime_candidate_hash: input.loaded.runtime_candidate_hash,
    evaluation_protocol_hash: input.loaded.protocol_hash,
    evaluation_scope: "system_validation_not_learning_effectiveness",
    technical_reliability:
      input.result.report.technical_reliability_report,
    architecture_review: input.result.report.architecture_review,
    export_validation: input.result.report.export_validation,
    approval_eligible: false
  });
  await write("provenance-manifest.json", {
    artifact_version:
      "formative-conversation-v5-provenance-manifest-v1",
    source_provider_run_id: input.provider_run_id,
    derived_evaluation_id: input.derived_evaluation_id,
    candidate_revision_manifest_hash:
      input.loaded.candidate_revision_manifest_hash,
    runtime_candidate_hash: input.loaded.runtime_candidate_hash,
    evaluation_protocol_hash: input.loaded.protocol_hash,
    fixture_manifest_hash: input.loaded.fixture_manifest_hash,
    aggregate_fixture_hash: input.loaded.aggregate_fixture_hash,
    active_runtime_hash:
      input.loaded.candidate_manifest.preserved_active_runtime_hash,
    rollback_runtime_hash:
      input.loaded.candidate_manifest
        .preserved_rollback_runtime_hash
  });
  await write("human-review-package.json", {
    artifact_version:
      "formative-conversation-v5-human-review-package-v1",
    source_provider_run_id: input.provider_run_id,
    derived_evaluation_id: input.derived_evaluation_id,
    review_status: "not_started",
    all_student_visible_outputs_reviewed: false,
    explicit_decision: null,
    cases: input.loaded.fixtures.map((fixture) => {
      const student = input.result.report.students.find(
        (entry) =>
          entry.persona_id === fixture.execution_persona_id
      );
      return {
        case_id: fixture.case_id,
        fixture_hash: fixture.fixture_hash,
        assertions: fixture.case_assertions,
        student_visible_tutor_outputs:
          caseArtifacts
            .get(fixture.case_id)
            ?.transcript.agent_calls.flatMap((call) =>
              typeof call.student_visible_tutor_output === "string"
                ? [call.student_visible_tutor_output]
                : []
            ) ?? [],
        transition: student?.final_profile_transition ?? null
      };
    }),
    prohibited_fields_excluded: true
  });
  const exportPath = path.join(
    runRoot,
    "research-export.zip"
  );
  await writeFile(exportPath, input.result.research_export.buffer);
  written.push(exportPath);
  await write("research-export-marker.json", {
    artifact_version:
      "formative-conversation-v5-research-export-marker-v1",
    data_classification: "synthetic_operational_evaluation",
    provider_run_id: input.provider_run_id,
    derived_evaluation_id: input.derived_evaluation_id,
    export_filename: "research-export.zip",
    included_in_ordinary_teacher_summaries: false
  });
  const hashEntries = [];
  for (const artifactPath of written) {
    hashEntries.push({
      path: path.relative(runRoot, artifactPath),
      sha256: await sha256File(artifactPath)
    });
  }
  const hashManifestPath = path.join(
    runRoot,
    "artifact-hash-manifest.json"
  );
  await writeJson(hashManifestPath, {
    artifact_version:
      "formative-conversation-v5-artifact-hash-manifest-v1",
    source_provider_run_id: input.provider_run_id,
    artifacts: hashEntries
  });
  return {
    run_root: runRoot,
    artifact_hash_manifest_path: hashManifestPath,
    artifact_hash_manifest_sha256:
      await sha256File(hashManifestPath)
  };
}

export async function executeFormativeConversationV5LiveEvaluation(
  options: FormativeConversationV5LiveOptions
) {
  const loaded = assertLivePreflight(options);
  const providerRunId = `fcv5_provider_${timestampId()}_${randomUUID().slice(0, 8)}`;
  const derivedEvaluationId = `fcv5_derived_${timestampId()}_${randomUUID().slice(0, 8)}`;
  const dispatchPath = safeRelative(
    path.join(
      FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
      "dispatch",
      `${loaded.protocol_hash}.json`
    )
  );
  await writeJson(
    dispatchPath,
    {
      checkpoint_version:
        "formative-conversation-v5-dispatch-checkpoint-v1",
      provider_run_id: providerRunId,
      derived_evaluation_id: derivedEvaluationId,
      runtime_candidate_hash: loaded.runtime_candidate_hash,
      evaluation_protocol_hash: loaded.protocol_hash,
      dispatch_checkpoint_recorded_at: new Date().toISOString(),
      execution_may_not_be_rerun: true
    },
    { exclusive: true }
  ).catch((error) => {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        "formative_conversation_v5_protocol_already_dispatched"
      );
    }
    throw error;
  });
  const candidateRunner =
    createFormativeConversationV5CandidateRunner({
      loaded,
      evaluation_id: derivedEvaluationId
    });
  const personas = loaded.fixtures.map(personaFromFixture);
  const result = await runSyntheticStudentResearchValidation({
    mode: "live_llm",
    personas,
    run_public_id: providerRunId,
    runner_factory: () => candidateRunner.runner,
    frozen_initial_profiles: frozenProfiles(loaded.fixtures)
  });
  const ledger = candidateRunner.complete();
  const callGraphComplete =
    ledger.logical_calls_used ===
    loaded.protocol.budget.expected_logical_call_count;
  const artifacts = await writeLiveArtifacts({
    loaded,
    provider_run_id: providerRunId,
    derived_evaluation_id: derivedEvaluationId,
    result,
    ledger
  });
  return {
    status:
      result.report.technical_reliability_report.failed_sessions ===
        0 &&
      result.report.architecture_review.issue_codes.length === 0 &&
      callGraphComplete
        ? "completed_pending_human_review"
        : "completed_failed",
    provider_run_id: providerRunId,
    derived_evaluation_id: derivedEvaluationId,
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    evaluation_protocol_hash: loaded.protocol_hash,
    logical_calls: ledger.logical_calls_used,
    provider_attempts: ledger.adapter_attempts_used,
    provider_calls: ledger.adapter_attempts_used,
    artifacts
  };
}

export function formativeConversationV5PackageSummaryHash() {
  const loaded = loadFormativeConversationV5EvaluationPackage();
  return stableHash({
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    evaluation_protocol_hash: loaded.protocol_hash,
    candidate_revision_manifest_hash:
      loaded.candidate_revision_manifest_hash,
    fixture_manifest_hash: loaded.fixture_manifest_hash,
    aggregate_fixture_hash: loaded.aggregate_fixture_hash
  });
}
