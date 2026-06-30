import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { sanitizedAuditSummary, type LiveAuditCall } from "./student-live-llm-diagnostics";

export const LIVE_LLM_FAILURE_ARTIFACT_VERSION = "student-live-llm-smoke-failure-v1";
export const LIVE_LLM_FAILURE_ARTIFACT_DIR = path.join(
  process.cwd(),
  ".data",
  "student-live-llm-smoke",
  "failures"
);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function safeDiagnosticText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_OPENAI_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .slice(0, 800);
}

function iso(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : null;
}

function hashShape(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseValidationError(value: string | null) {
  if (!value) {
    return {
      present: false,
      category: null,
      type: null,
      code: null,
      message: null,
      issue_count: 0,
      issue_paths: [] as string[],
      issue_details: [] as Array<{
        field_path: string | null;
        rule_code: string | null;
        blocked_pattern_label: string | null;
      }>,
      rule_codes: [] as string[],
      blocked_pattern_labels: [] as string[]
    };
  }

  try {
    const parsed = JSON.parse(value);
    const parsedRecord = record(parsed);
    const issues = Array.isArray(parsedRecord?.issues) ? parsedRecord.issues : [];
    const issueDetails = issues
      .map((issue) => {
        if (typeof issue === "string") {
          return legacyValidationIssueDetail(issue);
        }

        const issueRecord = record(issue);

        if (!issueRecord) {
          return null;
        }

        return {
          field_path:
            stringValue(issueRecord.field_path) ?? stringValue(issueRecord.path),
          rule_code:
            stringValue(issueRecord.rule_code) ?? stringValue(issueRecord.code),
          blocked_pattern_label: stringValue(issueRecord.blocked_pattern_label)
        };
      })
      .filter((issue): issue is {
        field_path: string | null;
        rule_code: string | null;
        blocked_pattern_label: string | null;
      } => Boolean(issue))
      .slice(0, 30);

    return {
      present: true,
      category: stringValue(parsedRecord?.category),
      type: stringValue(parsedRecord?.type),
      code: stringValue(parsedRecord?.code),
      message: safeDiagnosticText(stringValue(parsedRecord?.message)),
      issue_count:
        typeof parsedRecord?.issue_count === "number" ? parsedRecord.issue_count : issues.length,
      issue_paths: issueDetails
        .map((issue) => issue.field_path)
        .filter((issuePath): issuePath is string => Boolean(issuePath)),
      issue_details: issueDetails,
      rule_codes: [...new Set(
        issueDetails
          .map((issue) => issue.rule_code)
          .filter((ruleCode): ruleCode is string => Boolean(ruleCode))
      )],
      blocked_pattern_labels: [...new Set(
        issueDetails
          .map((issue) => issue.blocked_pattern_label)
          .filter((label): label is string => Boolean(label))
      )]
    };
  } catch {
    return {
      present: true,
      category: null,
      type: null,
      code: null,
      message: safeDiagnosticText(value),
      issue_count: 0,
      issue_paths: [] as string[],
      issue_details: [] as Array<{
        field_path: string | null;
        rule_code: string | null;
        blocked_pattern_label: string | null;
      }>,
      rule_codes: [] as string[],
      blocked_pattern_labels: [] as string[]
    };
  }
}

function legacyValidationIssueDetail(issue: string) {
  const lower = issue.toLowerCase();

  if (lower.includes("too long")) {
    return {
      field_path: "student_facing_text",
      rule_code: "unsafe_student_facing_text",
      blocked_pattern_label: null
    };
  }

  if (lower.includes("rigid") || lower.includes("heading")) {
    return {
      field_path: "student_facing_text",
      rule_code: "rigid_heading_detected",
      blocked_pattern_label: "rigid_heading"
    };
  }

  if (lower.includes("internal")) {
    return {
      field_path: "student_facing_text",
      rule_code: "internal_label_detected",
      blocked_pattern_label: "internal_label"
    };
  }

  if (lower.includes("answer key")) {
    return {
      field_path: "student_facing_text",
      rule_code: "answer_key_leak_detected",
      blocked_pattern_label: null
    };
  }

  return {
    field_path: "student_facing_text",
    rule_code: "unsafe_student_facing_text",
    blocked_pattern_label: null
  };
}

function validationStatusFromCall(call: {
  call_status: string;
  output_validated: boolean;
}) {
  if (call.output_validated) {
    return "validated";
  }

  if (call.call_status === "invalid_output") {
    return "invalid_output";
  }

  if (call.call_status === "failed") {
    return "provider_failed";
  }

  return call.call_status;
}

function structuredPayloadSummary(value: unknown) {
  const payload = record(value);

  return {
    turn_type: stringValue(payload?.turn_type) ?? stringValue(payload?.message_type),
    message_classification: stringValue(payload?.message_classification),
    response_quality: stringValue(payload?.response_quality),
    should_advance: booleanValue(payload?.should_advance),
    agent_call_id: stringValue(payload?.agent_call_id) ?? stringValue(payload?.based_on_agent_call_id)
  };
}

function processPayloadSummary(value: unknown) {
  const payload = record(value);

  return {
    assessment_state: stringValue(payload?.assessment_state),
    item_admin_tutor_source: stringValue(payload?.item_admin_tutor_source),
    live_status: stringValue(payload?.live_status),
    validation_status: stringValue(payload?.validation_status),
    agent_call_id: stringValue(payload?.agent_call_id),
    provider_status: stringValue(payload?.provider_status),
    validation_issue_count:
      typeof payload?.validation_issue_count === "number" ? payload.validation_issue_count : null
  };
}

function assessmentStateFromResumeContext(value: unknown) {
  const context = record(value);
  return stringValue(context?.assessment_state);
}

function currentItemFromResumeContext(value: unknown) {
  const context = record(value);
  return stringValue(context?.current_item_public_id);
}

function errorSummary(error: unknown) {
  const details = record(record(error)?.details);
  const code = stringValue(record(error)?.code);
  const safeDetails = safeErrorDetails(details);
  const stateShapeFailure =
    safeDetails.failure_stage === "live_smoke_state_shape_error" ||
    (error instanceof Error && error.name === "ZodError");

  return {
    name: error instanceof Error ? error.name : null,
    code,
    status: typeof record(error)?.status === "number" ? record(error)?.status : null,
    message: stateShapeFailure
      ? "Student assessment state shape validation failed."
      : safeDiagnosticText(error instanceof Error ? error.message : String(error)),
    agent_call_id: stringValue(details?.agent_call_id),
    validation_status: stringValue(details?.validation_status),
    details_keys: details ? Object.keys(details).sort() : [],
    safe_details: stateShapeFailure && Object.keys(safeDetails).length === 0
      ? {
          failure_stage: "live_smoke_state_shape_error",
          expected_schema: "student_assessment_state",
          missing_paths: zodIssuePaths(error),
          returned_payload_keys: [],
          last_action_attempted: null,
          refetch_attempted: null,
          refetch_succeeded: null,
          resulting_state_if_refetched: null
        }
      : safeDetails
  };
}

function safeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => safeDiagnosticText(entry))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 20)
    : [];
}

function safeLoopHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const entryRecord = record(entry);

      if (!entryRecord) {
        return null;
      }

      return {
        turn_index:
          typeof entryRecord.turn_index === "number" ? entryRecord.turn_index : null,
        from_state: stringValue(entryRecord.from_state),
        action: stringValue(entryRecord.action),
        to_state: stringValue(entryRecord.to_state),
        next_step: stringValue(entryRecord.next_step),
        returned_payload_keys: safeStringArray(entryRecord.returned_payload_keys),
        refetch_attempted:
          typeof entryRecord.refetch_attempted === "boolean" ? entryRecord.refetch_attempted : null,
        refetch_succeeded:
          typeof entryRecord.refetch_succeeded === "boolean" ? entryRecord.refetch_succeeded : null,
        state_source: stringValue(entryRecord.state_source)
      };
    })
    .filter((entry): entry is {
      turn_index: number | null;
      from_state: string | null;
      action: string | null;
      to_state: string | null;
      next_step: string | null;
      returned_payload_keys: string[];
      refetch_attempted: boolean | null;
      refetch_succeeded: boolean | null;
      state_source: string | null;
    } => Boolean(entry))
    .slice(0, 12);
}

function zodIssuePaths(error: unknown) {
  const issues = Array.isArray(record(error)?.issues) ? (record(error)?.issues as unknown[]) : [];

  return issues
    .map((issue) => {
      const issueRecord = record(issue);
      const path = Array.isArray(issueRecord?.path) ? issueRecord.path : [];

      return path
        .map((entry) => (typeof entry === "string" || typeof entry === "number" ? String(entry) : null))
        .filter((entry): entry is string => Boolean(entry))
        .join(".");
    })
    .filter((path) => path.length > 0)
    .slice(0, 50);
}

function zodIssuePathsFromText(value: unknown) {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    const issues = Array.isArray(parsed) ? parsed : [];

    return issues
      .map((issue) => {
        const issueRecord = record(issue);
        const path = Array.isArray(issueRecord?.path) ? issueRecord.path : [];

        return path
          .map((entry) => (typeof entry === "string" || typeof entry === "number" ? String(entry) : null))
          .filter((entry): entry is string => Boolean(entry))
          .join(".");
      })
      .filter((pathValue) => pathValue.length > 0)
      .slice(0, 50);
  } catch {
    return [];
  }
}

function safeErrorDetails(details: UnknownRecord | null) {
  if (!details) {
    return {};
  }

  return {
    failure_stage: stringValue(details.failure_stage),
    expected_states: safeStringArray(details.expected_states),
    actual_state: stringValue(details.actual_state),
    last_action_attempted: stringValue(details.last_action_attempted),
    allowed_actions: safeStringArray(details.allowed_actions),
    expected_schema: stringValue(details.expected_schema),
    missing_paths: safeStringArray(details.missing_paths),
    returned_payload_keys: safeStringArray(details.returned_payload_keys),
    current_phase: stringValue(details.current_phase),
    effective_phase: stringValue(details.effective_phase),
    next_step: stringValue(details.next_step),
    refetch_attempted:
      typeof details.refetch_attempted === "boolean" ? details.refetch_attempted : null,
    refetch_succeeded:
      typeof details.refetch_succeeded === "boolean" ? details.refetch_succeeded : null,
    resulting_state_if_refetched: stringValue(details.resulting_state_if_refetched),
    runtime_guard_status: stringValue(details.runtime_guard_status),
    loop_turns: typeof details.loop_turns === "number" ? details.loop_turns : null,
    loop_history: safeLoopHistory(details.loop_history)
  };
}

function safeStoredFailureSummary(value: unknown) {
  const failure = record(value);

  if (!failure) {
    return null;
  }

  const safeDetails = safeErrorDetails(record(failure.safe_details));
  const parsedIssuePaths = zodIssuePathsFromText(failure.message);
  const missingPaths = Array.isArray(safeDetails.missing_paths) ? safeDetails.missing_paths : [];
  const returnedPayloadKeys = Array.isArray(safeDetails.returned_payload_keys)
    ? safeDetails.returned_payload_keys
    : [];
  const stateShapeFailure =
    safeDetails.failure_stage === "live_smoke_state_shape_error" ||
    stringValue(failure.name) === "ZodError" ||
    parsedIssuePaths.length > 0;
  const normalizedDetails = stateShapeFailure
    ? {
        ...safeDetails,
        failure_stage: "live_smoke_state_shape_error",
        expected_schema: safeDetails.expected_schema ?? "student_assessment_state",
        missing_paths: missingPaths.length > 0 ? missingPaths : parsedIssuePaths,
        returned_payload_keys: returnedPayloadKeys,
        last_action_attempted: safeDetails.last_action_attempted,
        refetch_attempted: safeDetails.refetch_attempted,
        refetch_succeeded: safeDetails.refetch_succeeded,
        resulting_state_if_refetched: safeDetails.resulting_state_if_refetched
      }
    : safeDetails;

  return {
    name: stringValue(failure.name),
    code: stringValue(failure.code),
    status: typeof failure.status === "number" ? failure.status : null,
    message: stateShapeFailure
      ? "Student assessment state shape validation failed."
      : safeDiagnosticText(failure.message),
    agent_call_id: stringValue(failure.agent_call_id),
    validation_status: stringValue(failure.validation_status),
    details_keys: safeStringArray(failure.details_keys),
    safe_details: normalizedDetails
  };
}

export async function buildLiveLlmSmokeFailureArtifact(input: {
  prisma: PrismaClient;
  sessionPublicId?: string | null;
  stage?: string;
  error?: unknown;
}) {
  const failure = errorSummary(input.error);
  const session = input.sessionPublicId
    ? await input.prisma.assessmentSession.findUnique({
        where: { session_public_id: input.sessionPublicId },
        select: {
          id: true,
          session_public_id: true,
          status: true,
          current_phase: true,
          resume_context: true,
          created_at: true,
          started_at: true,
          last_activity_at: true,
          completed_at: true
        }
      })
    : null;

  const sessionDbId = session?.id ?? null;
  const [latestItemResponse, agentCalls, processEvents, conversationTurns] = sessionDbId
    ? await Promise.all([
        input.prisma.itemResponse.findFirst({
          where: {
            concept_unit_session: { assessment_session_db_id: sessionDbId }
          },
          orderBy: [{ updated_at: "desc" }],
          select: {
            item: { select: { item_public_id: true } }
          }
        }),
        input.prisma.agentCall.findMany({
          where: { assessment_session_db_id: sessionDbId },
          orderBy: [{ created_at: "asc" }],
          select: {
            id: true,
            agent_name: true,
            schema_version: true,
            provider: true,
            model_name: true,
            live_call_allowed: true,
            output_payload: true,
            output_validated: true,
            validation_error: true,
            error_category: true,
            call_status: true,
            provider_request_id: true,
            provider_response_id: true,
            client_request_id: true,
            prompt_version: true,
            raw_output: true,
            token_usage: true,
            created_at: true,
            completed_at: true
          }
        }),
        input.prisma.processEvent.findMany({
          where: { assessment_session_db_id: sessionDbId },
          orderBy: [{ occurred_at: "asc" }],
          select: {
            event_type: true,
            event_category: true,
            event_source: true,
            payload: true,
            occurred_at: true,
            created_at: true
          }
        }),
        input.prisma.conversationTurn.findMany({
          where: { assessment_session_db_id: sessionDbId },
          orderBy: [{ created_at: "asc" }],
          select: {
            actor_type: true,
            agent_name: true,
            structured_payload: true,
            created_at: true
          }
        })
      ])
    : [null, [], [], []] as const;

  const agentCallSummaries = agentCalls.map((call) => {
    const summary = sanitizedAuditSummary(call as LiveAuditCall);

    return {
      agent_call_id: summary.agent_call_id,
      agent_name: summary.agent_name,
      schema_version: summary.schema_version,
      provider: summary.provider,
      model_name: summary.model_name,
      call_status: summary.call_status,
      output_validated: summary.output_validated,
      validation_status: validationStatusFromCall(call),
      validation_error: parseValidationError(call.validation_error),
      validation_issue_paths: summary.validation_issue_paths,
      validation_issue_count: summary.validation_issue_count,
      validation_issue_details: summary.validation_issue_details,
      validation_rule_codes: summary.validation_rule_codes,
      validation_blocked_pattern_labels: summary.validation_blocked_pattern_labels,
      output_payload_keys: summary.output_payload_keys,
      student_visible_message_present: summary.student_visible_message_present,
      raw_output_present: summary.raw_output_exists,
      provider_metadata_present: summary.provider_metadata_present,
      token_usage_present: summary.token_usage_exists,
      provider_error: {
        category: summary.sanitized_error_category,
        type: summary.sanitized_error_type,
        code: summary.sanitized_error_code,
        message: safeDiagnosticText(summary.sanitized_error_message),
        http_status: summary.provider_http_status,
        provider_error_code: summary.provider_error_code,
        provider_error_type: summary.provider_error_type,
        typed_failure_reason: summary.typed_failure_reason,
        endpoint_host: summary.provider_endpoint_host
      },
      created_at: summary.created_at,
      completed_at: summary.completed_at
    };
  });
  const primaryAgentCall =
    agentCallSummaries.find((call) => call.agent_call_id === failure.agent_call_id) ??
    [...agentCallSummaries]
      .reverse()
      .find((call) => call.call_status === "invalid_output" || call.call_status === "failed") ??
    null;

  const artifact = {
    artifact_type: "student_live_llm_smoke_failure",
    artifact_version: LIVE_LLM_FAILURE_ARTIFACT_VERSION,
    generated_at: new Date().toISOString(),
    stage: input.stage ?? null,
    failure,
    session_summary: session
      ? {
          session_public_id: session.session_public_id,
          session_status: session.status,
          current_phase: session.current_phase,
          assessment_state: assessmentStateFromResumeContext(session.resume_context),
          current_item_id:
            currentItemFromResumeContext(session.resume_context) ??
            latestItemResponse?.item.item_public_id ??
            null,
          created_at: iso(session.created_at),
          started_at: iso(session.started_at),
          last_activity_at: iso(session.last_activity_at),
          completed_at: iso(session.completed_at)
        }
      : null,
    primary_agent_call: primaryAgentCall
      ? {
          agent_call_id: primaryAgentCall.agent_call_id,
          agent_name: primaryAgentCall.agent_name,
          schema_version: primaryAgentCall.schema_version,
          validation_status: primaryAgentCall.validation_status,
          call_status: primaryAgentCall.call_status
        }
      : null,
    agent_calls: agentCallSummaries,
    process_events: processEvents.map((event) => ({
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      ...processPayloadSummary(event.payload),
      occurred_at: iso(event.occurred_at),
      created_at: iso(event.created_at)
    })),
    conversation_turns: conversationTurns.map((turn) => ({
      actor_type: turn.actor_type,
      agent_name: turn.agent_name,
      ...structuredPayloadSummary(turn.structured_payload),
      created_at: iso(turn.created_at)
    }))
  };

  return {
    artifact,
    session_public_id: session?.session_public_id ?? null,
    agent_call_id: primaryAgentCall?.agent_call_id ?? failure.agent_call_id ?? null,
    agent_name: primaryAgentCall?.agent_name ?? null,
    schema_version: primaryAgentCall?.schema_version ?? null,
    validation_status: primaryAgentCall?.validation_status ?? failure.validation_status ?? null
  };
}

export async function writeLiveLlmSmokeFailureArtifact(input: {
  prisma: PrismaClient;
  sessionPublicId?: string | null;
  stage?: string;
  error?: unknown;
}) {
  const built = await buildLiveLlmSmokeFailureArtifact(input);
  await mkdir(LIVE_LLM_FAILURE_ARTIFACT_DIR, { recursive: true });
  const safeSession = (built.session_public_id ?? "unknown_session").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeAgentCall = (built.agent_call_id ?? "unknown_call").replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(
    LIVE_LLM_FAILURE_ARTIFACT_DIR,
    `${timestamp}-${safeSession}-${safeAgentCall}.json`
  );

  await writeFile(filePath, `${JSON.stringify(built.artifact, null, 2)}\n`, "utf8");

  return {
    ...built,
    file_path: filePath,
    artifact_hash: hashShape(built.artifact)
  };
}

export async function readLiveLlmFailureArtifact(filePath: string) {
  const text = await readFile(filePath, "utf8");
  const parsed = JSON.parse(text) as unknown;
  const parsedRecord = record(parsed);

  if (parsedRecord?.artifact_type !== "student_live_llm_smoke_failure") {
    throw new Error("The artifact is not a student live LLM smoke failure artifact.");
  }

  return parsedRecord;
}

async function listFailureArtifactFiles() {
  try {
    const entries = await readdir(LIVE_LLM_FAILURE_ARTIFACT_DIR);
    const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
    const files = await Promise.all(
      jsonFiles.map(async (entry) => {
        const filePath = path.join(LIVE_LLM_FAILURE_ARTIFACT_DIR, entry);
        return { filePath, stats: await stat(filePath) };
      })
    );

    return files.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
  } catch {
    return [];
  }
}

export async function findLatestLiveLlmFailureArtifact() {
  const [latest] = await listFailureArtifactFiles();
  return latest?.filePath ?? null;
}

export async function findLiveLlmFailureArtifact(input: {
  agentCallId?: string | null;
  sessionPublicId?: string | null;
}) {
  const files = await listFailureArtifactFiles();

  for (const file of files) {
    const artifact = await readLiveLlmFailureArtifact(file.filePath);
    const artifactSession = record(artifact.session_summary);
    const artifactPrimary = record(artifact.primary_agent_call);
    const artifactCalls = Array.isArray(artifact.agent_calls) ? artifact.agent_calls : [];
    const agentCallMatches = input.agentCallId
      ? artifactPrimary?.agent_call_id === input.agentCallId ||
        artifactCalls.some((call) => record(call)?.agent_call_id === input.agentCallId)
      : false;
    const sessionMatches = input.sessionPublicId
      ? artifactSession?.session_public_id === input.sessionPublicId
      : false;

    if (agentCallMatches || sessionMatches) {
      return file.filePath;
    }
  }

  return null;
}

export function sanitizeLiveLlmFailureArtifactForDiagnostic(artifact: UnknownRecord) {
  return {
    ...artifact,
    failure: safeStoredFailureSummary(artifact.failure)
  };
}

export function summarizeLiveLlmFailureArtifact(artifact: UnknownRecord, filePath: string) {
  const session = record(artifact.session_summary);
  const primary = record(artifact.primary_agent_call);

  return {
    status: "artifact_found",
    diagnostic_artifact_path: filePath,
    artifact_version: stringValue(artifact.artifact_version),
    generated_at: stringValue(artifact.generated_at),
    stage: stringValue(artifact.stage),
    session_public_id: stringValue(session?.session_public_id),
    session_status: stringValue(session?.session_status),
    current_phase: stringValue(session?.current_phase),
    assessment_state: stringValue(session?.assessment_state),
    current_item_id: stringValue(session?.current_item_id),
    agent_call_id: stringValue(primary?.agent_call_id),
    agent_name: stringValue(primary?.agent_name),
    schema_version: stringValue(primary?.schema_version),
    validation_status: stringValue(primary?.validation_status),
    call_status: stringValue(primary?.call_status),
    agent_call_count: Array.isArray(artifact.agent_calls) ? artifact.agent_calls.length : 0,
    process_event_count: Array.isArray(artifact.process_events) ? artifact.process_events.length : 0,
    conversation_turn_count: Array.isArray(artifact.conversation_turns)
      ? artifact.conversation_turns.length
      : 0,
    failure: safeStoredFailureSummary(artifact.failure)
  };
}
