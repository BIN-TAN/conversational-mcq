import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type { AgentOutputByName } from "@/lib/agents/contracts";
import {
  runFormativeConversationProtocolValidation,
  type FormativeConversationValidationAssessmentDefinition,
  type FormativeConversationValidationSubject
} from "@/lib/evaluation/synthetic-student-validation/framework";
import { prisma } from "@/lib/db";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  getResearchExportReadiness
} from "@/lib/services/teacher-research-data/readiness";
import {
  assertFormativeConversationV17IntendedArtifactCoverage,
  FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  type FormativeConversationV17CompiledCase,
  type FormativeConversationV17FormativeFixture
} from "./contracts";
import {
  createFormativeConversationV17CandidateRunner,
  type FormativeConversationV17ProfilingExecution
} from "./candidate-runner";
import { summarizeFormativeConversationV17EvaluationAccounting } from "./evaluation-accounting";
import {
  buildFormativeConversationV17EvaluationPlan,
  exactFormativeConversationV17LiveAuthorization,
  loadFormativeConversationV17EvaluationPackage,
  verifyFormativeConversationV17Governance
} from "./package";
import {
  resolveFormativeConversationV5ApplicationReadiness
} from "./live-environment";
import {
  createFormativeConversationV17FinalizedManifest,
  FORMATIVE_CONVERSATION_V17_ATTESTATION_FILENAME,
  FORMATIVE_CONVERSATION_V17_MANIFEST_FILENAME,
  FORMATIVE_CONVERSATION_V17_STAGING_ROOT
} from "./security-release";
import {
  writeFormativeConversationV17DispatchCheckpoint
} from "./dispatch-checkpoint";
import type { FormativeConversationPersistenceDiagnostic } from "@/lib/services/student-assessment/formative-conversation/persistence-observability";

export type FormativeConversationV5LiveOptions = {
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  confirm_live_provider_calls: boolean;
  authorization: string;
  persistence_diagnostics?: FormativeConversationPersistenceDiagnostic[];
};

type FormativeConversationV5PreDispatchDependencies = {
  get_research_export_readiness?: typeof getResearchExportReadiness;
  get_migration_readiness?: typeof getFormativeConversationV17MigrationReadiness;
};

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export async function getFormativeConversationV17MigrationReadiness() {
  const entries = await readdir(
    path.resolve(process.cwd(), "prisma/migrations"),
    { withFileTypes: true }
  );
  const expected = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
    'SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations" ORDER BY "migration_name" ASC'
  );
  const applied = new Set(
    rows
      .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .map((row) => row.migration_name)
  );
  const missing = expected.filter((migration) => !applied.has(migration));
  const failed = rows
    .filter((row) => row.finished_at === null && row.rolled_back_at === null)
    .map((row) => row.migration_name);
  return {
    ready: expected.length > 0 && missing.length === 0 && failed.length === 0,
    expected_migration_count: expected.length,
    applied_migration_count: applied.size,
    expected_migration_set_hash: stableHash(expected),
    missing_migration_count: missing.length,
    failed_migration_count: failed.length
  };
}

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

function parseJsonRecord(value: string | null) {
  if (!value) {
    return {};
  }
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
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

function executionSubjectFromCompiledCase(
  compiledCase: Extract<
    FormativeConversationV17CompiledCase,
    { case_type: "formative_conversation" }
  >["formative_case"]
): FormativeConversationValidationSubject {
  return {
    subject_id: compiledCase.execution_subject_id,
    display_name: `Synthetic ${compiledCase.title}`,
    assessment_response_behavior:
      compiledCase.assessment_fixture_input.responses.map((response) => ({
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
    conversation_behavior:
      compiledCase.student_message_input_templates.map((message) => ({
        intent: message.intent_fixture_metadata,
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
  };
}

function frozenProfiles(
  compiledCases: readonly Extract<
    FormativeConversationV17CompiledCase,
    { case_type: "formative_conversation" }
  >["formative_case"][]
) {
  return Object.fromEntries(
    compiledCases.map((compiledCase) => [
      compiledCase.execution_subject_id,
      compiledCase.initial_profile_persistence_input.profile
    ])
  ) as Partial<
    Record<
      FormativeConversationValidationSubject["subject_id"],
      AgentOutputByName["student_profiling_agent"]
    >
  >;
}

function assessmentDefinitionFromCompiledCase(
  compiledCase: Extract<
    FormativeConversationV17CompiledCase,
    { case_type: "formative_conversation" }
  >["formative_case"]
): FormativeConversationValidationAssessmentDefinition {
  const assessment =
    compiledCase.assessment_fixture_input.assessment;
  return {
    title: assessment.title,
    description:
      "Frozen synthetic operational evaluation fixture for the assessment-to-formative-conversation pipeline.",
    diagnostic_focus: assessment.learning_objective,
    concept_title: assessment.concept_title,
    learning_objective: assessment.learning_objective,
    related_concept_description:
      "Measurement-theory distinctions used in score interpretation.",
    assessment_boundary: assessment.assessment_boundary,
    administered_items: assessment.administered_items.map(
      (item) => ({
        ...item,
        options: item.options.map((option) => ({ ...option })),
        distractor_rationales: {
          ...item.distractor_rationales
        },
        expected_reasoning_patterns: [
          ...item.expected_reasoning_patterns
        ]
      })
    )
  };
}

export function buildFormativeConversationV5RuntimeInputs(
  compiledCases: readonly FormativeConversationV17CompiledCase[]
) {
  const formativeCases = compiledCases
    .filter(
      (entry): entry is Extract<
        FormativeConversationV17CompiledCase,
        { case_type: "formative_conversation" }
      > => entry.case_type === "formative_conversation"
    )
    .map((entry) => entry.formative_case);
  const firstCompiledCase = formativeCases[0];
  if (!firstCompiledCase) {
    throw new Error(
      "formative_conversation_v5_v5_compiled_cases_missing"
    );
  }
  const subjects = formativeCases.map(
    executionSubjectFromCompiledCase
  );
  const assessmentDefinition =
    assessmentDefinitionFromCompiledCase(firstCompiledCase);
  const initialProfiles = frozenProfiles(formativeCases);
  if (
    subjects.length !== formativeCases.length ||
    new Set(subjects.map((subject) => subject.subject_id)).size !==
      formativeCases.length ||
    subjects.some(
      (subject, index) =>
        subject.conversation_behavior.length !==
        formativeCases[index].call_graph
          .actual_student_message_count
    ) ||
    assessmentDefinition.administered_items.length === 0 ||
    Object.keys(initialProfiles).length !== formativeCases.length
  ) {
    throw new Error(
      "formative_conversation_v5_v5_runtime_input_compilation_failed"
    );
  }
  return {
    subjects,
    assessment_definition: assessmentDefinition,
    frozen_initial_profiles: initialProfiles,
    include_production_profiling: false as const,
    runtime_input_hash: stableHash({
      subjects,
      assessment_definition: assessmentDefinition,
      frozen_initial_profiles: initialProfiles,
      include_production_profiling: false
    })
  };
}

export function compileFormativeConversationV5EnvironmentPreflight() {
  const loaded = loadFormativeConversationV17EvaluationPackage();
  const governance =
    verifyFormativeConversationV17Governance(loaded);
  const liveEnvironment =
    resolveFormativeConversationV5ApplicationReadiness({
      env: process.env,
      candidate: loaded.source_candidate,
      runtime_candidate_hash: loaded.runtime_candidate_hash,
      expected_active_runtime_hash:
        loaded.candidate_manifest.preserved_active_runtime_hash,
      expected_rollback_runtime_hash:
        loaded.candidate_manifest.preserved_rollback_runtime_hash
    });
  const runtimeInputs =
    buildFormativeConversationV5RuntimeInputs(
      loaded.compiled_plan.cases
    );
  return {
    loaded,
    governance,
    live_environment: liveEnvironment,
    runtime_inputs: runtimeInputs,
    provider_calls: 0,
    provider_auth_network_requests: 0
  } as const;
}

export async function compileFormativeConversationV5PreDispatch(
  dependencies: FormativeConversationV5PreDispatchDependencies = {}
) {
  const environmentPreflight =
    compileFormativeConversationV5EnvironmentPreflight();
  const {
    loaded,
    governance,
    live_environment: liveEnvironment,
    runtime_inputs: runtimeInputs
  } = environmentPreflight;
  const exportReadiness = await (
    dependencies.get_research_export_readiness ??
    getResearchExportReadiness
  )();
  const migrationReadiness = await (
    dependencies.get_migration_readiness ??
    getFormativeConversationV17MigrationReadiness
  )();
  if (
    !exportReadiness.ready ||
    !exportReadiness.database_ready ||
    !exportReadiness.artifact_path_writable ||
    !exportReadiness.dictionary_registry_ready ||
    !exportReadiness.key_configured
  ) {
    throw new Error(
      "formative_conversation_v5_research_export_configuration_unavailable"
    );
  }
  if (!migrationReadiness.ready) {
    throw new Error(
      "formative_conversation_v17_database_migrations_not_current"
    );
  }
  const plan = buildFormativeConversationV17EvaluationPlan();
  return {
    loaded,
    plan,
    governance,
    runtime_inputs: runtimeInputs,
    readiness: {
      database_ready: exportReadiness.database_ready,
      research_export_ready: exportReadiness.ready,
      research_key_configured: exportReadiness.key_configured,
      artifact_path_writable:
        exportReadiness.artifact_path_writable,
      dictionary_registry_ready:
        exportReadiness.dictionary_registry_ready,
      export_schema_version:
        exportReadiness.export_schema_version,
      migrations: migrationReadiness,
      live_environment: liveEnvironment
    },
    dispatch_boundary: {
      status: "ready_immediately_before_dispatch_checkpoint",
      checkpoint_created: false,
      provider_calls: 0,
      provider_auth_network_requests: 0,
      database_readiness_queries: 2
    }
  } as const;
}

export async function writeFormativeConversationV5PlanArtifact() {
  const preDispatch =
    await compileFormativeConversationV5PreDispatch();
  const plan = preDispatch.plan;
  const planPublicId = `fcv5_plan_${timestampId()}_${randomUUID().slice(0, 8)}`;
  const artifact = {
    ...plan,
    runtime_input_compilation: {
      status: "compiled",
      case_count: preDispatch.runtime_inputs.subjects.length,
      execution_subject_ids:
        preDispatch.runtime_inputs.subjects.map(
          (subject) => subject.subject_id
        ),
      assessment_item_count:
        preDispatch.runtime_inputs.assessment_definition
          .administered_items.length,
      frozen_profile_count: Object.keys(
        preDispatch.runtime_inputs.frozen_initial_profiles
      ).length,
      production_profiling_called:
        false,
      profiling_contract_canary_count: 3,
      profiling_contract_canaries_execute_real_provider_calls_in_live_mode:
        true,
      runtime_input_hash:
        preDispatch.runtime_inputs.runtime_input_hash
    },
    pre_dispatch_validation: preDispatch.readiness,
    dispatch_boundary: preDispatch.dispatch_boundary,
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

export async function assertFormativeConversationV5LivePreflight(
  options: FormativeConversationV5LiveOptions,
  dependencies: FormativeConversationV5PreDispatchDependencies = {}
) {
  const preDispatch =
    await compileFormativeConversationV5PreDispatch(dependencies);
  const { loaded } = preDispatch;
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
    exactFormativeConversationV17LiveAuthorization(loaded)
  ) {
    throw new Error(
      "formative_conversation_v5_exact_authorization_mismatch"
    );
  }
  return preDispatch;
}

async function caseEvidenceArtifact(input: {
  loaded: ReturnType<
    typeof loadFormativeConversationV17EvaluationPackage
  >;
  fixture: FormativeConversationV17FormativeFixture;
  student: Awaited<
    ReturnType<
      typeof runFormativeConversationProtocolValidation
    >
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
      validation_error: true,
      usage_guard_snapshot: true,
      output_payload: true,
      raw_output: true,
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
    const rawOutput = asRecord(call.raw_output);
    const providerExecutionAudit = asRecord(
      rawOutput.provider_execution_audit
    );
    const validationError = parseJsonRecord(call.validation_error);
    const invalidStudentVisibleCandidate =
      !call.output_validated &&
      typeof output.student_visible_message === "string"
        ? output.student_visible_message
        : null;
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
      safe_invalid_output_evidence:
        invalidStudentVisibleCandidate !== null
          ? {
              evidence_version:
                "formative-conversation-safe-opening-invalid-output-evidence-v1",
              output_presence: "student_visible_candidate",
              candidate_hash: createHash("sha256")
                .update(invalidStudentVisibleCandidate)
                .digest("hex"),
              candidate_text: invalidStudentVisibleCandidate,
              validation: validationError
            }
          : Object.keys(providerExecutionAudit).length > 0 &&
              !call.output_validated
            ? providerExecutionAudit
            : null,
      provider_execution_audit:
        Object.keys(providerExecutionAudit).length > 0
          ? providerExecutionAudit
          : null,
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
    input.fixture.formative_fixture.call_graph.expected_logical_calls
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
    !input.fixture.formative_fixture.permitted_terminal_outcomes.includes(
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
    execution_failure: input.student.execution_failure,
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
    assertions: input.fixture.formative_fixture.case_assertions.map((assertion) => ({
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
    typeof loadFormativeConversationV17EvaluationPackage
  >;
  provider_run_id: string;
  derived_evaluation_id: string;
  result: Awaited<
    ReturnType<
      typeof runFormativeConversationProtocolValidation
    >
  >;
  ledger: ReturnType<
    typeof createFormativeConversationV17CandidateRunner
  >["ledger"];
  profiling_results: readonly FormativeConversationV17ProfilingExecution[];
  persistence_diagnostics: readonly FormativeConversationPersistenceDiagnostic[];
}) {
  const configuredStagingBase =
    process.env.FORMATIVE_CONVERSATION_V5_V17_STAGING_BASE_ROOT;
  if (!configuredStagingBase) {
    throw new Error(
      "formative_conversation_v17_staging_base_not_configured"
    );
  }
  const stagingBoundary = safeRelative(
    FORMATIVE_CONVERSATION_V17_STAGING_ROOT
  );
  const stagingBase = path.resolve(configuredStagingBase);
  if (
    stagingBase === stagingBoundary ||
    !stagingBase.startsWith(`${stagingBoundary}${path.sep}`)
  ) {
    throw new Error(
      "formative_conversation_v17_staging_base_invalid"
    );
  }
  const runRoot = path.join(stagingBase, input.provider_run_id);
  const releaseRoot = safeRelative(
    path.join(
      FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
      input.provider_run_id
    )
  );
  await mkdir(path.join(runRoot, "cases"), {
    recursive: true,
    mode: 0o700
  });
  const written: string[] = [];
  const write = async (relativePath: string, value: unknown) => {
    const outputPath = path.join(runRoot, relativePath);
    await writeJson(outputPath, value);
    written.push(outputPath);
    return outputPath;
  };
  const executionAccounting =
    summarizeFormativeConversationV17EvaluationAccounting({
      budget: input.loaded.protocol.budget,
      ledger: input.ledger
    });
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
      executionAccounting.base_call_graph_complete,
    evaluation_accounting: executionAccounting,
    ledger: input.ledger,
    raw_provider_payloads_excluded: true
  });
  await write("persistence-observability.json", {
    artifact_version:
      "formative-conversation-v17-persistence-observability-v1",
    provider_run_id: input.provider_run_id,
    diagnostic_count: input.persistence_diagnostics.length,
    diagnostics: input.persistence_diagnostics,
    credentials_excluded: true,
    database_urls_excluded: true,
    sql_text_excluded: true,
    sensitive_stack_traces_excluded: true
  });
  const caseResults = [];
  const caseArtifacts = new Map<
    string,
    Awaited<ReturnType<typeof caseEvidenceArtifact>>
  >();
  for (const fixture of input.loaded.fixtures) {
    if (fixture.case_type === "profiling_contract_canary") {
      const profiling = input.profiling_results.find(
        (entry) => entry.case_id === fixture.case_id
      );
      const validation = {
        artifact_version:
          "formative-conversation-v17-profiling-case-validation-v1",
        case_id: fixture.case_id,
        fixture_hash: fixture.fixture_hash,
        status: profiling?.status ?? "not_exercised",
        deterministic_issue_codes:
          profiling?.validation.issue_codes ?? ["case_result_missing"],
        human_review_status: "not_required",
        assertions: fixture.case_assertions.map((assertion) => ({
          ...assertion,
          status:
            profiling?.status === "passed" ? "passed" : "failed"
        }))
      };
      await write(`cases/${fixture.case_id}-profiling.json`, {
        artifact_version:
          "formative-conversation-v17-profiling-case-evidence-v1",
        case_id: fixture.case_id,
        fixture_hash: fixture.fixture_hash,
        output: profiling?.output ?? null,
        canonical_catalog: profiling?.canonical_catalog ?? null,
        validation: profiling?.validation ?? null,
        provider_execution_audit:
          profiling?.provider_execution_audit ?? null,
        machine_ids_assigned_by_platform_after_validation: true,
        raw_provider_payloads_excluded: true
      });
      await write(`cases/${fixture.case_id}-validation.json`, validation);
      caseResults.push(validation);
      continue;
    }
    const student = input.result.report.students.find(
      (entry) =>
        entry.persona_id ===
        fixture.formative_fixture.execution_subject_id
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
        assertions: fixture.formative_fixture.case_assertions.map((assertion) => ({
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
      executionAccounting.base_call_graph_complete,
    evaluation_accounting: executionAccounting,
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
    evaluation_accounting: executionAccounting,
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
      if (fixture.case_type === "profiling_contract_canary") {
        const profiling = input.profiling_results.find(
          (entry) => entry.case_id === fixture.case_id
        );
        return {
          case_id: fixture.case_id,
          fixture_hash: fixture.fixture_hash,
          assertions: fixture.case_assertions,
          student_visible_tutor_outputs: [],
          transition: null,
          profiling_contract_result: profiling?.status ?? "not_exercised"
        };
      }
      const student = input.result.report.students.find(
        (entry) =>
          entry.persona_id ===
          fixture.formative_fixture.execution_subject_id
      );
      return {
        case_id: fixture.case_id,
        fixture_hash: fixture.fixture_hash,
        assertions: fixture.formative_fixture.case_assertions,
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
  const teacherExportCases = input.loaded.fixtures
    .filter((fixture) => fixture.case_type === "formative_conversation")
    .map((fixture) => {
      const student = input.result.report.students.find(
        (entry) =>
          entry.persona_id ===
          fixture.formative_fixture.execution_subject_id
      );
      const teacherTrajectory = asRecord(student?.teacher_trajectory);
      const persistedTransition = student?.final_profile_transition ?? null;
      const teacherTransition = teacherTrajectory.validated_change ?? null;
      const persistedOutcome = asRecord(persistedTransition).learning_outcome ?? null;
      const teacherOutcome = teacherTrajectory.learning_outcome ?? null;
      return {
        case_id: fixture.case_id,
        persisted_transition_present: persistedTransition !== null,
        teacher_transition_present: teacherTransition !== null,
        transition_substantive_parity:
          stableHash(persistedTransition) === stableHash(teacherTransition),
        outcome_substantive_parity: persistedOutcome === teacherOutcome
      };
    });
  await write("teacher-export-consistency.json", {
    artifact_version:
      "formative-conversation-v17-teacher-export-consistency-v1",
    source_provider_run_id: input.provider_run_id,
    derived_evaluation_id: input.derived_evaluation_id,
    status: teacherExportCases.every(
      (entry) =>
        entry.transition_substantive_parity &&
        entry.outcome_substantive_parity
    )
      ? "passed"
      : "failed",
    cases: teacherExportCases,
    hidden_prompts_excluded: true,
    chain_of_thought_excluded: true,
    internal_database_ids_excluded: true
  });
  await write("research-export-integrity.json", {
    artifact_version:
      "formative-conversation-v17-research-export-integrity-v1",
    source_provider_run_id: input.provider_run_id,
    derived_evaluation_id: input.derived_evaluation_id,
    export_filename: "research-export.zip",
    validation: input.result.report.export_validation,
    status: input.result.report.export_validation.status,
    raw_provider_payloads_excluded: true,
    hidden_prompts_excluded: true
  });
  await write("provider-retry-milestone-evidence.json", {
    artifact_version:
      "formative-conversation-v17-provider-retry-milestone-evidence-v1",
    source_provider_run_id: input.provider_run_id,
    derived_evaluation_id: input.derived_evaluation_id,
    logical_call_count: input.ledger.logical_calls_used,
    provider_attempt_count: input.ledger.adapter_attempts_used,
    semantic_regeneration_count:
      input.ledger.semantic_regeneration_calls_completed,
    transport_retry_count: executionAccounting.transport_retries,
    attempts: input.ledger.attempts,
    raw_provider_payloads_excluded: true
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
  written.push(hashManifestPath);
  const generatedArtifactNames = new Set(
    written.map((artifactPath) =>
      path.relative(runRoot, artifactPath).split(path.sep).join("/")
    )
  );
  const deferredSecurityArtifacts = new Set([
    FORMATIVE_CONVERSATION_V17_MANIFEST_FILENAME,
    FORMATIVE_CONVERSATION_V17_ATTESTATION_FILENAME
  ]);
  assertFormativeConversationV17IntendedArtifactCoverage({
    generated_artifacts: [...generatedArtifactNames],
    deferred_artifacts: [...deferredSecurityArtifacts]
  });
  const finalized =
    await createFormativeConversationV17FinalizedManifest({
      staging_root: runRoot,
      package_id: input.provider_run_id
    });
  return {
    staging_root: runRoot,
    release_root: releaseRoot,
    finalized_artifact_manifest_path: finalized.manifest_path,
    finalized_artifact_manifest_sha256:
      finalized.manifest_sha256,
    artifact_hash_manifest_path: hashManifestPath,
    artifact_hash_manifest_sha256:
      await sha256File(hashManifestPath)
  };
}

export async function executeFormativeConversationV5LiveEvaluation(
  options: FormativeConversationV5LiveOptions
) {
  const preDispatch =
    await assertFormativeConversationV5LivePreflight(options);
  const { loaded } = preDispatch;
  const providerRunId = `fcv5v17_provider_${timestampId()}_${randomUUID().slice(0, 8)}`;
  const derivedEvaluationId = `fcv5v17_derived_${timestampId()}_${randomUUID().slice(0, 8)}`;
  let checkpointCreated = false;
  const writeDispatchCheckpoint = async () => {
    await writeFormativeConversationV17DispatchCheckpoint({
        dispatch_root: FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
        identity: {
          provider_run_id: providerRunId,
          derived_evaluation_id: derivedEvaluationId,
          runtime_candidate_hash: loaded.runtime_candidate_hash,
          evaluation_protocol_hash: loaded.protocol_hash,
          runner_implementation_hash: String(
            loaded.protocol.runner_implementation_hash
          ),
          fixture_manifest_hash: loaded.fixture_manifest_hash,
          aggregate_fixture_hash: loaded.aggregate_fixture_hash,
          compiled_plan_hash: loaded.compiled_plan.compiled_plan_hash,
          live_environment_contract_hash:
            loaded.live_environment_contract_hash,
          dispatch_checkpoint_contract_hash:
            loaded.dispatch_checkpoint_contract_hash
        }
      });
    checkpointCreated = true;
  };
  const candidateRunner =
    createFormativeConversationV17CandidateRunner({
      loaded,
      evaluation_id: derivedEvaluationId,
      before_first_generation_request: writeDispatchCheckpoint
    });
  try {
    const profilingResults: FormativeConversationV17ProfilingExecution[] = [];
    for (const fixture of loaded.fixtures) {
      if (fixture.case_type === "profiling_contract_canary") {
        profilingResults.push(
          await candidateRunner.run_profiling_canary(fixture)
        );
      }
    }
    const result =
      await runFormativeConversationProtocolValidation({
        mode: "live_llm",
        subjects: preDispatch.runtime_inputs.subjects,
        assessment_definition:
          preDispatch.runtime_inputs.assessment_definition,
        run_public_id: providerRunId,
        runner_factory: () => candidateRunner.formative_runner,
        include_production_profiling:
          preDispatch.runtime_inputs
            .include_production_profiling,
        frozen_initial_profiles:
          preDispatch.runtime_inputs
            .frozen_initial_profiles
      });
    const ledger = candidateRunner.complete();
    const executionAccounting =
      summarizeFormativeConversationV17EvaluationAccounting({
        budget: loaded.protocol.budget,
        ledger
      });
    const artifacts = await writeLiveArtifacts({
      loaded,
      provider_run_id: providerRunId,
      derived_evaluation_id: derivedEvaluationId,
      result,
      ledger,
      profiling_results: profilingResults,
      persistence_diagnostics:
        options.persistence_diagnostics ?? []
    });
    return {
      status:
        profilingResults.every((entry) => entry.status === "passed") &&
        result.report.technical_reliability_report
          .failed_sessions === 0 &&
        result.report.architecture_review.issue_codes.length === 0 &&
        executionAccounting.execution_accounting_complete
          ? "completed_pending_human_review"
          : "completed_failed",
      provider_run_id: providerRunId,
      derived_evaluation_id: derivedEvaluationId,
      runtime_candidate_hash: loaded.runtime_candidate_hash,
      evaluation_protocol_hash: loaded.protocol_hash,
      compiled_plan_hash:
        loaded.compiled_plan.compiled_plan_hash,
      dispatch_checkpoint_created: checkpointCreated,
      logical_calls: ledger.logical_calls_used,
      provider_attempts: ledger.adapter_attempts_used,
      provider_calls: ledger.adapter_attempts_used,
      artifacts
    };
  } catch (error) {
    if (!checkpointCreated) {
      const failurePath = safeRelative(
        path.join(
          FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT,
          "predispatch-failures",
          `fcv5v17_predispatch_${timestampId()}_${randomUUID().slice(0, 8)}.json`
        )
      );
      await writeJson(failurePath, {
        artifact_version:
          "formative-conversation-v5-v17-predispatch-failure-v1",
        runtime_candidate_hash: loaded.runtime_candidate_hash,
        evaluation_protocol_hash: loaded.protocol_hash,
        compiled_plan_hash:
          loaded.compiled_plan.compiled_plan_hash,
        failure_recorded_at: new Date().toISOString(),
        failure_code:
          error instanceof Error
            ? error.message.split(":", 1)[0]
            : "formative_conversation_v5_v5_predispatch_failed",
        dispatch_checkpoint_created: false,
        provider_calls: 0,
        secrets_excluded: true
      });
    }
    throw error;
  }
}

export function formativeConversationV5PackageSummaryHash() {
  const loaded = loadFormativeConversationV17EvaluationPackage();
  return stableHash({
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    evaluation_protocol_hash: loaded.protocol_hash,
    candidate_revision_manifest_hash:
      loaded.candidate_revision_manifest_hash,
    fixture_manifest_hash: loaded.fixture_manifest_hash,
    aggregate_fixture_hash: loaded.aggregate_fixture_hash,
    compiled_plan_hash: loaded.compiled_plan.compiled_plan_hash
  });
}
