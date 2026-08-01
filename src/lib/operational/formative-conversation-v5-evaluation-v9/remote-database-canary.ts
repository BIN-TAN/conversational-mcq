import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentOutputByName } from "@/lib/agents/contracts";
import { prisma } from "@/lib/db";
import {
  cleanupSyntheticStudentValidationRun,
  runFormativeConversationProtocolValidation,
  type FormativeConversationValidationAssessmentDefinition,
  type FormativeConversationValidationSubject
} from "@/lib/evaluation/synthetic-student-validation/framework";
import { readCandidateOperationalModelConfig } from "@/lib/operational/model-upgrade";
import { stableHash } from "@/lib/operational/stable-hash";
import { scanExactSecretArtifactSet } from "@/lib/operational/exact-secret-artifact-scanner";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentInput,
  type FormativeConversationCanonicalProfile
} from "@/lib/services/student-assessment/formative-conversation/agent-contract";
import type { FormativeConversationAgentRunner } from "@/lib/services/student-assessment/formative-conversation/runtime";
import { processFormativeConversationStudentMessage } from "@/lib/services/student-assessment/formative-conversation/runtime";
import { buildFormativeConversationRuntimeContextSeed } from "@/lib/services/student-assessment/formative-conversation/runtime-context";
import type { FormativeConversationPersistenceDiagnostic } from "@/lib/services/student-assessment/formative-conversation/persistence-observability";
import {
  FormativeConversationV5FixtureSchema,
  type FormativeConversationV5Fixture
} from "../formative-conversation-v5-evaluation-v8/contracts";
import { validateFormativeConversationV5LiveEnvironment } from "./live-environment";

export const FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_VERSION =
  "formative-conversation-v9-remote-database-lifecycle-canary-v2" as const;

export const FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT = {
  version: FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_VERSION,
  waits_ms: [10_000, 60_000, 90_000],
  outcomes: [
    "sound_understanding",
    "largely_improved_understanding",
    "teacher_assistance_recommended"
  ],
  provider_calls: 0,
  model_auth_requests: 0,
  dispatch_checkpoints: 0,
  concurrency: 1,
  isolated_synthetic_records_only: true,
  cleanup_policy: "cleanup_after_artifact_and_export_validation",
  failure_artifact_policy:
    "persist_safe_failure_evidence_scan_cleanup_revalidate",
  secure_environment_broker:
    "formative-conversation-v9-canary-environment-broker-v1",
  process_local_secret_classification:
    "exact-secrets-minimum-length-and-nonboolean-v1",
  ephemeral_session_secret_marker:
    "FORMATIVE_CONVERSATION_V5_V9_CANARY_SESSION_SECRET_SOURCE=ephemeral_canary"
} as const;

export const FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH =
  stableHash(FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT);

export const FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_AUTHORIZATION =
  `I authorize one no-provider V9 remote database lifecycle canary for contract hash ${FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH}, using only isolated synthetic records, real 10-second, 60-second, and 90-second waits, zero OpenAI calls, zero model-auth requests, zero dispatch checkpoints, and cleanup after artifact and export validation.`;

const V8_RUNTIME_CANDIDATE_HASH =
  "132d69caab27b6e94f8bfa416c89d843da97676f41dcefb11c0e03ec95d3af80";
const V8_RUNTIME_CANDIDATE_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v8/runtime-candidate-manifest.json";
const V8_SOURCE_CONFIGURATION_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v8/source-configuration.json";
const V8_FIXTURE_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v8/fixtures";
const CANARY_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v9/remote-database-canaries";

type TerminalOutcome =
  | "sound_understanding"
  | "largely_improved_understanding"
  | "teacher_assistance_recommended";

type CanaryFixture = {
  fixture: FormativeConversationV5Fixture;
  outcome: TerminalOutcome;
  wait_ms: number;
};

type DatabaseOwnerState = {
  client_id: string;
  client_generation: number;
  reconnect_count: number;
  max_read_attempts: number;
  final_disconnect_started: boolean;
  final_disconnect_completed: boolean;
  pool_state: "opaque_prisma_pool";
};

async function canaryRecordCounts(runPublicId: string) {
  const assessments = await prisma.assessment.findMany({
    where: { title: { startsWith: `${runPublicId} ` } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((entry) => entry.id);
  const sessions = await prisma.assessmentSession.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true, session_public_id: true }
  });
  const sessionIds = sessions.map((entry) => entry.id);
  const sessionPublicIds = sessions.map((entry) => entry.session_public_id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((entry) => entry.id);
  const conversations = await prisma.formativeConversationSession.findMany({
    where: {
      concept_unit_session_db_id: { in: conceptUnitSessionIds }
    },
    select: { id: true }
  });
  const conversationIds = conversations.map((entry) => entry.id);
  const [
    users,
    itemResponses,
    processEvents,
    turns,
    calls,
    receipts,
    lifecycleEvents,
    turnTelemetry,
    inputTelemetry,
    profiles,
    transitions,
    transitionTurns,
    evidenceReferences,
    activities,
    topicDialogues
  ] = await Promise.all([
    prisma.user.count({ where: { user_id: { startsWith: runPublicId } } }),
    prisma.itemResponse.count({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    }),
    prisma.processEvent.count({
      where: { assessment_session_db_id: { in: sessionIds } }
    }),
    prisma.conversationTurn.findMany({
      where: { formative_conversation_session_db_id: { in: conversationIds } },
      select: { id: true, formative_conversation_session_db_id: true }
    }),
    prisma.agentCall.findMany({
      where: { formative_conversation_session_db_id: { in: conversationIds } },
      select: { id: true, agent_invocation_key: true }
    }),
    prisma.formativeConversationMessageReceipt.findMany({
      where: { formative_conversation_session_db_id: { in: conversationIds } },
      select: {
        id: true,
        formative_conversation_session_db_id: true,
        client_message_id: true
      }
    }),
    prisma.formativeConversationLifecycleEvent.findMany({
      where: { formative_conversation_session_db_id: { in: conversationIds } },
      select: {
        id: true,
        formative_conversation_session_db_id: true,
        client_event_id: true
      }
    }),
    prisma.formativeConversationTurnTelemetry.count({
      where: { formative_conversation_session_db_id: { in: conversationIds } }
    }),
    prisma.formativeConversationInputTelemetry.count({
      where: { formative_conversation_session_db_id: { in: conversationIds } }
    }),
    prisma.studentProfile.count({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    }),
    prisma.formativeConversationProfileTransition.findMany({
      where: { formative_conversation_session_db_id: { in: conversationIds } },
      select: {
        id: true,
        transition_public_id: true,
        source_agent_call_db_id: true
      }
    }),
    prisma.formativeConversationProfileTransitionTurnReference.count({
      where: {
        profile_transition: {
          formative_conversation_session_db_id: { in: conversationIds }
        }
      }
    }),
    prisma.formativeConversationProfileEvidenceReference.findMany({
      where: { formative_conversation_session_db_id: { in: conversationIds } },
      select: {
        id: true,
        source_agent_call_db_id: true,
        evidence_observation_index: true
      }
    }),
    prisma.activityRuntimeAttempt.count({
      where: { session_public_id: { in: sessionPublicIds } }
    }),
    prisma.topicDialogue.count({
      where: { assessment_session_db_id: { in: sessionIds } }
    })
  ]);
  const duplicateCount = <T>(values: T[]) =>
    values.length - new Set(values).size;
  return {
    users,
    assessments: assessmentIds.length,
    assessment_sessions: sessionIds.length,
    concept_unit_sessions: conceptUnitSessionIds.length,
    formative_conversation_sessions: conversationIds.length,
    item_responses: itemResponses,
    assessment_process_events: processEvents,
    conversation_turns: turns.length,
    agent_calls: calls.length,
    message_receipts: receipts.length,
    lifecycle_events: lifecycleEvents.length,
    turn_telemetry: turnTelemetry,
    input_telemetry: inputTelemetry,
    student_profiles: profiles,
    profile_transitions: transitions.length,
    transition_turn_references: transitionTurns,
    profile_evidence_references: evidenceReferences.length,
    activity_runtime_attempts: activities,
    topic_dialogues: topicDialogues,
    duplicate_audit: {
      agent_invocation_keys: duplicateCount(
        calls.map((entry) => entry.agent_invocation_key).filter(Boolean)
      ),
      message_receipts: duplicateCount(
        receipts.map(
          (entry) =>
            `${entry.formative_conversation_session_db_id}:${entry.client_message_id}`
        )
      ),
      lifecycle_events: duplicateCount(
        lifecycleEvents.map(
          (entry) =>
            `${entry.formative_conversation_session_db_id}:${entry.client_event_id}`
        )
      ),
      transition_agent_calls: duplicateCount(
        transitions.map((entry) => entry.source_agent_call_db_id).filter(Boolean)
      ),
      evidence_references: duplicateCount(
        evidenceReferences.map(
          (entry) =>
            `${entry.source_agent_call_db_id}:${entry.evidence_observation_index}`
        )
      )
    },
    transition_public_ids: transitions.map(
      (entry) => entry.transition_public_id
    )
  };
}

function safeErrorCode(error: unknown) {
  return error instanceof Error
    ? error.message.split(":", 1)[0]
    : "formative_conversation_v9_remote_database_canary_failed";
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function loadFixtures(): Promise<CanaryFixture[]> {
  const definitions = [
    {
      case_id: "fcv5_05_sound_profile_transition",
      outcome: "sound_understanding",
      wait_ms: 10_000
    },
    {
      case_id: "fcv5_06_largely_improved_temporal",
      outcome: "largely_improved_understanding",
      wait_ms: 60_000
    },
    {
      case_id: "fcv5_07_persistent_barrier_teacher_assistance",
      outcome: "teacher_assistance_recommended",
      wait_ms: 90_000
    }
  ] as const;
  return Promise.all(
    definitions.map(async (definition) => ({
      fixture: FormativeConversationV5FixtureSchema.parse(
        await readJson(
          path.join(V8_FIXTURE_ROOT, `${definition.case_id}.json`)
        )
      ),
      outcome: definition.outcome,
      wait_ms: definition.wait_ms
    }))
  );
}

function assessmentDefinition(
  fixture: FormativeConversationV5Fixture
): FormativeConversationValidationAssessmentDefinition {
  return {
    title: fixture.assessment.title,
    description:
      "Isolated no-provider remote database lifecycle validation.",
    diagnostic_focus: fixture.assessment.learning_objective,
    concept_title: fixture.assessment.concept_title,
    learning_objective: fixture.assessment.learning_objective,
    related_concept_description:
      "Measurement-theory distinctions used only by synthetic canary records.",
    assessment_boundary: fixture.assessment.assessment_boundary,
    administered_items: fixture.assessment.administered_items.map((item) => ({
      ...item,
      options: item.options.map((option) => ({ ...option })),
      distractor_rationales: { ...item.distractor_rationales },
      expected_reasoning_patterns: [...item.expected_reasoning_patterns]
    }))
  };
}

function subject(
  definition: CanaryFixture
): FormativeConversationValidationSubject {
  const evidenceBearingMessage = definition.fixture.student_messages.at(-1);
  if (!evidenceBearingMessage) {
    throw new Error("formative_conversation_v9_canary_message_missing");
  }
  return {
    subject_id: definition.fixture.execution_subject_id,
    display_name: `Synthetic remote lifecycle ${definition.outcome}`,
    assessment_response_behavior:
      definition.fixture.assessment_responses.map((response) => ({
        ...response
      })),
    conversation_behavior: [
      {
        intent: evidenceBearingMessage.intent,
        message_text: evidenceBearingMessage.message_text,
        ...evidenceBearingMessage.observable_input_telemetry
      }
    ]
  };
}

function updatedProfile(input: {
  prior: FormativeConversationCanonicalProfile;
  outcome: TerminalOutcome;
}) {
  const updated = structuredClone(input.prior);
  if (input.outcome === "sound_understanding") {
    updated.ability_profile = "robust_transfer_ready_understanding";
    updated.integrated_diagnostic_profile =
      "robust_understanding_ready_for_transfer";
    updated.misconception_indicators = [];
    updated.reasoning_quality_summary =
      "The latest synthetic student turn independently applies the conceptual distinction.";
  } else if (input.outcome === "largely_improved_understanding") {
    updated.ability_profile = "mostly_correct_understanding";
    updated.integrated_diagnostic_profile =
      "correct_but_fragile_understanding";
    updated.reasoning_quality_summary =
      "The latest synthetic student turn shows meaningful progress while a supported limitation remains.";
  } else {
    updated.integrated_profile_rationale =
      "The latest synthetic conversation evidence preserves a meaningful barrier that may benefit from instructor support.";
    updated.recommended_next_evidence = [
      "Instructor-supported explanation followed by independent application."
    ];
  }
  updated.rationale = `No-provider remote lifecycle canary: ${input.outcome}.`;
  return updated;
}

function openingOutput() {
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "Let us use your reviewed answers as a starting point.",
    teaching_artifact: null,
    evidence_observations: [],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function terminalOutput(input: {
  context: FormativeConversationAgentInput;
  outcome: TerminalOutcome;
}) {
  const prior = input.context.current_profile.canonical_profile;
  const studentTurn = [...input.context.visible_transcript]
    .reverse()
    .find((turn) => turn.actor === "student");
  if (!prior || !studentTurn) {
    throw new Error("formative_conversation_v9_canary_evidence_missing");
  }
  const updated = updatedProfile({ prior, outcome: input.outcome });
  const changed = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => JSON.stringify(prior[field]) !== JSON.stringify(updated[field])
  );
  const retained = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changed.includes(field)
  );
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "Your latest explanation gives us useful evidence to continue from.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "student_conceptual_application",
        observation:
          "The latest synthetic student message is the cited evidence for this no-provider persistence canary.",
        source_turn_sequence_indexes: [studentTurn.sequence_index]
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: input.outcome,
      rationale:
        "The cited synthetic student turn exercises terminal transition persistence.",
      source_turn_sequence_indexes: [studentTurn.sequence_index],
      updated_profile: updated,
      field_evidence: [
        {
          profile_fields: changed,
          disposition: "updated_from_conversation_evidence",
          evidence_basis: "conversation_evidence",
          rationale:
            "Changed fields are grounded in the cited synthetic student turn.",
          source_turn_sequence_indexes: [studentTurn.sequence_index]
        },
        {
          profile_fields: retained,
          disposition: "retained_evidence_remains_valid",
          evidence_basis: "prior_profile_evidence",
          rationale:
            "Retained fields exactly preserve their canonical prior values.",
          source_turn_sequence_indexes: []
        }
      ]
    },
    teacher_assistance_recommendation: {
      recommended: input.outcome === "teacher_assistance_recommended",
      reason_code:
        input.outcome === "teacher_assistance_recommended"
          ? "meaningful_barrier_remains"
          : null
    },
    lifecycle_recommendation: "continue"
  });
}

function createCanaryRunner(definitions: CanaryFixture[]) {
  const stateByConversation = new Map<
    string,
    { definition: CanaryFixture; calls: number }
  >();
  let logicalCalls = 0;
  const runner: FormativeConversationAgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_VERSION,
      model_name: "no-provider-remote-database-canary",
      provider: "mock",
      prompt_version: FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_VERSION,
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update(FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_VERSION)
        .digest("hex"),
      reasoning_effort: null,
      max_output_tokens: 1_000,
      live_call_allowed: false
    },
    async execute({ context }) {
      logicalCalls += 1;
      let state = stateByConversation.get(context.conversation_public_id);
      if (!state) {
        const definition = definitions[stateByConversation.size];
        if (!definition) {
          throw new Error("formative_conversation_v9_canary_subject_overflow");
        }
        state = { definition, calls: 0 };
        stateByConversation.set(context.conversation_public_id, state);
      }
      state.calls += 1;
      const output =
        state.calls === 1
          ? openingOutput()
          : terminalOutput({ context, outcome: state.definition.outcome });
      const startedAt = new Date();
      return {
        output,
        raw_output: { fixture_type: "no_provider_remote_database_canary" },
        generation_source: "deterministic_test",
        provider_request_id: null,
        provider_response_id: null,
        client_request_id: null,
        retry_count: 0,
        latency_ms: 1,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost: 0,
        started_at: startedAt,
        completed_at: new Date(startedAt.getTime() + 1)
      };
    }
  };
  return { runner, logical_calls: () => logicalCalls };
}

function assertCanaryEnvironment(env: NodeJS.ProcessEnv) {
  if (
    env.FORMATIVE_CONVERSATION_V5_V9_REMOTE_DATABASE_CANARY_ENABLED !==
    "true"
  ) {
    throw new Error(
      "formative_conversation_v9_remote_database_canary_gate_disabled"
    );
  }
  const source = JSON.parse(
    readFileSync(V8_SOURCE_CONFIGURATION_PATH, "utf8")
  ) as {
    preserved_governance: {
      active_runtime_hash: string;
      rollback_runtime_hash: string;
    };
  };
  const candidate = readCandidateOperationalModelConfig(
    V8_RUNTIME_CANDIDATE_PATH
  );
  return validateFormativeConversationV5LiveEnvironment({
    env,
    candidate,
    runtime_candidate_hash: V8_RUNTIME_CANDIDATE_HASH,
    expected_active_runtime_hash:
      source.preserved_governance.active_runtime_hash,
    expected_rollback_runtime_hash:
      source.preserved_governance.rollback_runtime_hash,
    validation_purpose: "no_provider_database_canary",
    allowed_environment_sources: [
      "render_process_local",
      "render_runtime",
      "deterministic_test"
    ]
  });
}

export async function compileFormativeConversationV9RemoteDatabaseCanaryPreflight(input: {
  authorization: string;
  env?: NodeJS.ProcessEnv;
  verify_database_readiness?: () => Promise<void>;
}) {
  if (
    input.authorization !==
    FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_AUTHORIZATION
  ) {
    throw new Error(
      "formative_conversation_v9_remote_database_canary_authorization_mismatch"
    );
  }
  const env = input.env ?? process.env;
  const environment = assertCanaryEnvironment(env);
  const definitions = await loadFixtures();
  if (
    definitions.length !== 3 ||
    definitions.some(
      (definition, index) =>
        definition.wait_ms !==
          FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT.waits_ms[
            index
          ] ||
        definition.outcome !==
          FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT.outcomes[
            index
          ]
    )
  ) {
    throw new Error(
      "formative_conversation_v9_remote_database_canary_fixture_contract_mismatch"
    );
  }
  await (input.verify_database_readiness ??
    (async () => {
      await prisma.$queryRaw`SELECT 1`;
    }))();
  return {
    status: "ready" as const,
    contract_hash:
      FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
    environment,
    frozen_scenario_count: definitions.length,
    waits_ms: definitions.map((definition) => definition.wait_ms),
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0,
    database_readiness_queries: 1,
    v9_materialization_required: false
  };
}

export async function executeFormativeConversationV9RemoteDatabaseCanary(input: {
  authorization: string;
  diagnostics: FormativeConversationPersistenceDiagnostic[];
  database_state?: () => DatabaseOwnerState;
  env?: NodeJS.ProcessEnv;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  const env = input.env ?? process.env;
  const preflight =
    await compileFormativeConversationV9RemoteDatabaseCanaryPreflight({
      authorization: input.authorization,
      env
    });
  const environment = preflight.environment;
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const definitions = await loadFixtures();
  const runner = createCanaryRunner(definitions);
  const runPublicId = `fcv5v9_db_canary_${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")}_${randomUUID().slice(0, 8)}`;
  const artifactRoot = path.join(CANARY_OUTPUT_ROOT, runPublicId);
  const exactSecretValues = [
    env.DATABASE_URL,
    env.RESEARCH_PSEUDONYMIZATION_KEY,
    env.SESSION_SECRET
  ].filter((value): value is string => Boolean(value));
  const waits: Array<{
    subject_id: string;
    requested_wait_ms: number;
    actual_wait_ms: number;
    started_at: string;
    completed_at: string;
    context_read_kind: "student_message";
    context_read_succeeded: boolean;
  }> = [];
  let cleanupCompleted = false;
  let protocolResult: Awaited<
    ReturnType<typeof runFormativeConversationProtocolValidation>
  > | null = null;
  try {
    const initialProfiles: Partial<
      Record<string, AgentOutputByName["student_profiling_agent"]>
    > = Object.fromEntries(
      definitions.map(({ fixture }) => [
        fixture.execution_subject_id,
        fixture.initial_profile_source.profile
      ])
    );
    const waitBySubject = new Map<string, number>(
      definitions.map(({ fixture, wait_ms }) => [
        fixture.execution_subject_id,
        wait_ms
      ])
    );
    const result = await runFormativeConversationProtocolValidation({
      mode: "contract_test",
      subjects: definitions.map(subject),
      assessment_definition: assessmentDefinition(definitions[0].fixture),
      runner_factory: () => runner.runner,
      run_public_id: runPublicId,
      include_production_profiling: false,
      frozen_initial_profiles: initialProfiles,
      before_context_read: async (hook) => {
        if (
          hook.context_read_kind !== "student_message" ||
          hook.student_message_index !== 0
        ) {
          return;
        }
        const requestedWait = waitBySubject.get(hook.subject_id);
        if (requestedWait === undefined) {
          throw new Error(
            "formative_conversation_v9_canary_wait_subject_missing"
          );
        }
        const startedAt = Date.now();
        await sleep(requestedWait);
        const completedAt = Date.now();
        waits.push({
          subject_id: hook.subject_id,
          requested_wait_ms: requestedWait,
          actual_wait_ms: completedAt - startedAt,
          started_at: new Date(startedAt).toISOString(),
          completed_at: new Date(completedAt).toISOString(),
          context_read_kind: "student_message",
          context_read_succeeded: true
        });
      }
    });
    protocolResult = result;

    const expectedOutcomes = new Map<string, string>(
      definitions.map(({ fixture, outcome }) => [
        fixture.execution_subject_id,
        outcome === "sound_understanding"
          ? "sound"
          : outcome === "largely_improved_understanding"
            ? "largely_improved"
            : "teacher_assistance_recommended"
      ])
    );
    for (const student of result.report.students) {
      const expected = expectedOutcomes.get(student.persona_id);
      if (
        expected === undefined ||
        student.execution_error !== null ||
        student.final_profile_transition?.learning_outcome !== expected ||
        student.teacher_trajectory.learning_outcome !== expected ||
        student.transition_evidence.supporting_turn_count === 0 ||
        student.transition_evidence.evidence_reference_count === 0 ||
        !student.transition_evidence.source_agent_call_public_id
      ) {
        throw new Error(
          "formative_conversation_v9_remote_database_transition_validation_failed"
        );
      }
    }
    const recordCountsBeforeReplay = await canaryRecordCounts(runPublicId);
    const replayResults = [];
    for (const definition of definitions) {
      const reportStudent = result.report.students.find(
        (entry) => entry.persona_id === definition.fixture.execution_subject_id
      );
      const message = definition.fixture.student_messages.at(-1);
      const student = await prisma.user.findUnique({
        where: {
          user_id: `${runPublicId}_${definition.fixture.execution_subject_id}`
        },
        select: { id: true }
      });
      if (!reportStudent?.conversation_public_id || !message || !student) {
        throw new Error(
          "formative_conversation_v9_remote_database_idempotency_context_missing"
        );
      }
      const context = await buildFormativeConversationRuntimeContextSeed({
        conversation_public_id: reportStudent.conversation_public_id,
        student_user_db_id: student.id
      });
      const replay = await processFormativeConversationStudentMessage(
        {
          conversation_public_id: reportStudent.conversation_public_id,
          client_message_id: `${runPublicId}:${definition.fixture.execution_subject_id}:message:1`,
          message_text: message.message_text,
          context
        },
        { runner_factory: () => runner.runner }
      );
      replayResults.push({
        subject_id: definition.fixture.execution_subject_id,
        replayed: replay.replayed,
        tutor_turn_present: Boolean(replay.tutor_turn),
        transition_public_id:
          replay.profile_transition_recommendation?.transition
            .transition_public_id ?? null
      });
    }
    const recordCountsAfterReplay = await canaryRecordCounts(runPublicId);
    if (
      replayResults.some(
        (entry) => !entry.replayed || !entry.tutor_turn_present
      ) ||
      JSON.stringify(recordCountsBeforeReplay) !==
        JSON.stringify(recordCountsAfterReplay) ||
      Object.values(recordCountsAfterReplay.duplicate_audit).some(
        (count) => count !== 0
      )
    ) {
      throw new Error(
        "formative_conversation_v9_remote_database_idempotency_validation_failed"
      );
    }
    if (
      result.report.export_validation.status !== "passed" ||
      result.report.architecture_review.issue_codes.length !== 0 ||
      runner.logical_calls() !== definitions.length * 2 ||
      waits.length !== 3
    ) {
      throw new Error(
        "formative_conversation_v9_remote_database_canary_validation_failed"
      );
    }

    const transactionDiagnostics = input.diagnostics.filter(
      (entry) => entry.phase === "transaction"
    );
    if (
      transactionDiagnostics.length === 0 ||
      transactionDiagnostics.some(
        (entry) => entry.transaction_timeout_ms !== 30_000
      )
    ) {
      throw new Error(
        "formative_conversation_v9_remote_database_transaction_diagnostics_missing"
      );
    }
    const transactionOverlappedWait = transactionDiagnostics.some(
      (transaction) =>
        waits.some(
          (wait) =>
            Date.parse(transaction.started_at) <
              Date.parse(wait.completed_at) &&
            Date.parse(transaction.completed_at) > Date.parse(wait.started_at)
        )
    );
    if (transactionOverlappedWait) {
      throw new Error(
        "formative_conversation_v9_remote_database_wait_transaction_overlap"
      );
    }
    const failedDiagnostics = input.diagnostics.filter(
      (entry) => entry.duration_status === "failed"
    );
    const reconnectDiagnostics = input.diagnostics.filter(
      (entry) => entry.phase === "database_reconnect"
    );
    if (
      failedDiagnostics.some(
        (entry) =>
          entry.mutation_may_have_occurred &&
          !input.diagnostics.some(
            (candidate) =>
              candidate.logical_operation_id ===
                entry.logical_operation_id &&
              candidate.phase === "post_transaction_reconciliation" &&
              candidate.terminal_result === "succeeded"
          )
      )
    ) {
      throw new Error(
        "formative_conversation_v9_remote_database_ambiguous_partial_commit"
      );
    }
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(
      path.join(artifactRoot, "research-export.zip"),
      result.research_export.buffer
    );
    const report = {
      artifact_version:
        "formative-conversation-v9-remote-database-canary-report-v1",
      run_public_id: runPublicId,
      contract_hash:
        FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
      status: "passed",
      environment,
      waits,
      outcomes: result.report.students.map((student) => ({
        subject_id: student.persona_id,
        session_public_id: student.session_public_id,
        conversation_public_id: student.conversation_public_id,
        transition_public_id:
          student.final_profile_transition?.transition_public_id ?? null,
        outcome:
          student.final_profile_transition?.learning_outcome ?? null,
        supporting_turn_count:
          student.transition_evidence.supporting_turn_count,
        evidence_reference_count:
          student.transition_evidence.evidence_reference_count,
        source_agent_call_public_id:
          student.transition_evidence.source_agent_call_public_id
      })),
      isolated_record_counts: recordCountsAfterReplay,
      idempotency_replay: {
        status: "passed",
        results: replayResults,
        record_counts_unchanged: true,
        duplicate_counts: recordCountsAfterReplay.duplicate_audit
      },
      persistence_diagnostics: input.diagnostics,
      transaction_summary: {
        count: transactionDiagnostics.length,
        minimum_duration_ms: Math.min(
          ...transactionDiagnostics.map((entry) => entry.duration_ms)
        ),
        maximum_duration_ms: Math.max(
          ...transactionDiagnostics.map((entry) => entry.duration_ms)
        ),
        exact_durations_ms: transactionDiagnostics.map(
          (entry) => entry.duration_ms
        ),
        timeout_ms: 30_000,
        open_during_simulated_wait: false
      },
      connection_recovery: {
        client_state_before_final_disconnect:
          input.database_state?.() ?? null,
        final_disconnect_managed_by_evaluation_lifecycle: true,
        reconnect_attempts: reconnectDiagnostics.length,
        reconnect_results: reconnectDiagnostics.map((entry) => ({
          client_generation: entry.client_generation,
          attempt_number: entry.attempt_number,
          duration_ms: entry.duration_ms,
          terminal_result: entry.terminal_result,
          failure_category: entry.failure_category
        }))
      },
      persistence_integrity: {
        partial_commit_detected: false,
        typed_failures: failedDiagnostics.map((entry) => ({
          operation_name: entry.operation_name,
          failure_category: entry.failure_category,
          cause_code: entry.cause_code,
          mutation_may_have_occurred: entry.mutation_may_have_occurred,
          reconciliation_ran: input.diagnostics.some(
            (candidate) =>
              candidate.logical_operation_id === entry.logical_operation_id &&
              candidate.phase === "post_transaction_reconciliation" &&
              candidate.terminal_result === "succeeded"
          ),
          terminal_result: entry.terminal_result
        }))
      },
      research_export: {
        validation_status: result.report.export_validation.status,
        archive_path: "research-export.zip"
      },
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0,
      ordinary_classroom_records_used: false,
      secrets_recorded: false,
      artifact_secret_scan: null as null | {
        scanner_version: string;
        status: "passed";
        secrets_checked: number;
        files_checked: number;
        zip_entries_checked: number;
        matches_found: number;
        final_artifact_scan_revalidated: boolean;
      },
      cleanup: null as null | {
        status: "completed";
        retained_synthetic_database_records: number;
      }
    };
    await writeFile(
      path.join(artifactRoot, "canary-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
    const initialSecretScan = await scanExactSecretArtifactSet({
      artifact_roots: [artifactRoot],
      exact_secret_values: exactSecretValues
    });
    if (initialSecretScan.status !== "passed") {
      throw new Error(
        "formative_conversation_v9_remote_database_artifact_secret_scan_failed"
      );
    }
    await cleanupSyntheticStudentValidationRun(runPublicId);
    cleanupCompleted = true;
    const cleanupCounts = await canaryRecordCounts(runPublicId);
    const retainedSyntheticRecords = Object.entries(cleanupCounts)
      .filter(
        ([name, value]) =>
          name !== "duplicate_audit" &&
          name !== "transition_public_ids" &&
          typeof value === "number"
      )
      .reduce((total, [, value]) => total + Number(value), 0);
    if (retainedSyntheticRecords !== 0) {
      throw new Error(
        "formative_conversation_v9_remote_database_canary_cleanup_failed"
      );
    }
    report.artifact_secret_scan = {
      scanner_version: initialSecretScan.scanner_version,
      status: "passed",
      secrets_checked: initialSecretScan.secrets_checked,
      files_checked: initialSecretScan.files_checked,
      zip_entries_checked: initialSecretScan.zip_entries_checked,
      matches_found: initialSecretScan.matches_found,
      final_artifact_scan_revalidated: true
    };
    report.cleanup = {
      status: "completed",
      retained_synthetic_database_records: retainedSyntheticRecords
    };
    await writeFile(
      path.join(artifactRoot, "canary-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
    const finalSecretScan = await scanExactSecretArtifactSet({
      artifact_roots: [artifactRoot],
      exact_secret_values: exactSecretValues
    });
    if (finalSecretScan.status !== "passed") {
      throw new Error(
        "formative_conversation_v9_remote_database_final_artifact_secret_scan_failed"
      );
    }
    return {
      status: "passed" as const,
      run_public_id: runPublicId,
      artifact_root: artifactRoot,
      contract_hash:
        FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
      cleanup_completed: true,
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    };
  } catch (error) {
    const originalFailureCode = safeErrorCode(error);
    let artifactFailureCode: string | null = null;
    try {
      await mkdir(artifactRoot, { recursive: true });
      if (protocolResult) {
        await writeFile(
          path.join(artifactRoot, "research-export.zip"),
          protocolResult.research_export.buffer
        );
      }
      const recordCountsBeforeCleanup = await canaryRecordCounts(
        runPublicId
      ).catch(() => null);
      const failureReport = {
        artifact_version:
          "formative-conversation-v9-remote-database-canary-failure-report-v1",
        run_public_id: runPublicId,
        contract_hash:
          FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
        status: "failed",
        failure_code: originalFailureCode,
        environment,
        waits,
        protocol_execution:
          protocolResult?.report.students.map((student) => ({
            subject_id: student.persona_id,
            session_public_id: student.session_public_id,
            conversation_public_id: student.conversation_public_id,
            execution_error: student.execution_error,
            execution_failure: student.execution_failure,
            transition_public_id:
              student.final_profile_transition?.transition_public_id ?? null,
            learning_outcome:
              student.final_profile_transition?.learning_outcome ?? null,
            supporting_turn_count:
              student.transition_evidence.supporting_turn_count,
            evidence_reference_count:
              student.transition_evidence.evidence_reference_count
          })) ?? null,
        isolated_record_counts_before_cleanup: recordCountsBeforeCleanup,
        persistence_diagnostics: input.diagnostics,
        database_client_state_before_cleanup:
          input.database_state?.() ?? null,
        provider_calls: 0,
        model_auth_requests: 0,
        dispatch_checkpoints: 0,
        ordinary_classroom_records_used: false,
        secrets_recorded: false,
        artifact_secret_scan: null as null | {
          scanner_version: string;
          status: "passed";
          secrets_checked: number;
          files_checked: number;
          zip_entries_checked: number;
          matches_found: number;
          final_artifact_scan_revalidated: boolean;
        },
        cleanup: null as null | {
          status: "completed";
          retained_synthetic_database_records: number;
        }
      };
      const failureReportPath = path.join(
        artifactRoot,
        "canary-failure-report.json"
      );
      await writeFile(
        failureReportPath,
        `${JSON.stringify(failureReport, null, 2)}\n`,
        "utf8"
      );
      const initialFailureScan = await scanExactSecretArtifactSet({
        artifact_roots: [artifactRoot],
        exact_secret_values: exactSecretValues
      });
      if (initialFailureScan.status !== "passed") {
        throw new Error(
          "formative_conversation_v9_remote_database_failure_artifact_secret_scan_failed"
        );
      }
      await cleanupSyntheticStudentValidationRun(runPublicId);
      cleanupCompleted = true;
      const cleanupCounts = await canaryRecordCounts(runPublicId);
      const retainedSyntheticRecords = Object.entries(cleanupCounts)
        .filter(
          ([name, value]) =>
            name !== "duplicate_audit" &&
            name !== "transition_public_ids" &&
            typeof value === "number"
        )
        .reduce((total, [, value]) => total + Number(value), 0);
      if (retainedSyntheticRecords !== 0) {
        throw new Error(
          "formative_conversation_v9_remote_database_canary_cleanup_failed"
        );
      }
      failureReport.artifact_secret_scan = {
        scanner_version: initialFailureScan.scanner_version,
        status: "passed",
        secrets_checked: initialFailureScan.secrets_checked,
        files_checked: initialFailureScan.files_checked,
        zip_entries_checked: initialFailureScan.zip_entries_checked,
        matches_found: initialFailureScan.matches_found,
        final_artifact_scan_revalidated: true
      };
      failureReport.cleanup = {
        status: "completed",
        retained_synthetic_database_records: retainedSyntheticRecords
      };
      await writeFile(
        failureReportPath,
        `${JSON.stringify(failureReport, null, 2)}\n`,
        "utf8"
      );
      const finalFailureScan = await scanExactSecretArtifactSet({
        artifact_roots: [artifactRoot],
        exact_secret_values: exactSecretValues
      });
      if (finalFailureScan.status !== "passed") {
        throw new Error(
          "formative_conversation_v9_remote_database_final_failure_artifact_secret_scan_failed"
        );
      }
    } catch (artifactError) {
      artifactFailureCode = safeErrorCode(artifactError);
    }
    if (!cleanupCompleted) {
      await cleanupSyntheticStudentValidationRun(runPublicId).catch(() => {});
    }
    throw new Error(artifactFailureCode ?? originalFailureCode);
  }
}
