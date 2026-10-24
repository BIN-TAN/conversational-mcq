import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertNoProhibitedProviderInput, findProhibitedProviderInputPaths, redactForAudit } from "@/lib/agents/redaction";
import { getServerEnv } from "@/lib/env";
import {
  type AgentModelConfig,
  getLlmRuntimeConfig,
  LlmConfigurationError,
  ReasoningEffort
} from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { ContentServiceError } from "@/lib/services/content/errors";
import { toPrismaJson } from "@/lib/services/json";
import { assembleInstructorReportV8, reportInputProblems, type AssembledInstructorReport } from "./assemble";
import {
  INSTRUCTOR_REPORT_AGENT_NAME,
  INSTRUCTOR_REPORT_DAILY_LIMIT_PER_MINI_TEST,
  INSTRUCTOR_REPORT_DEFAULT_MAX_OUTPUT_TOKENS,
  INSTRUCTOR_REPORT_V8_AGENT_VERSION,
  INSTRUCTOR_REPORT_V8_COUNTS_VERSION,
  INSTRUCTOR_REPORT_V8_INSTRUCTIONS,
  INSTRUCTOR_REPORT_V8_PROMPT_HASH,
  INSTRUCTOR_REPORT_V8_PROMPT_VERSION,
  INSTRUCTOR_REPORT_V8_RECORD_VERSION,
  INSTRUCTOR_REPORT_V8_SCHEMA_VERSION,
  InstructorReportV8OutputSchema,
  LegacyInstructorReportV1OutputSchema,
  type InstructorReportV8Output,
  type InstructorReportV8Record,
  type LegacyInstructorReportV1EvidenceIndex,
  type LegacyInstructorReportV1Output
} from "./contract";
import { buildLocalTestNarrative, buildReportRecord, narrativeUnavailableReason } from "./deterministic";
import { loadInstructorReportRecords } from "./evidence";
import { validateInstructorReportV8, type InstructorReportIssue } from "./validate";

/**
 * Instructor reporting module (D8, docs/DESIGN_ALIGNMENT_2026-10-17.md; section 9.7 of
 * docs/AI_MODULE_REDESIGN_2026-10-19.md).
 *
 * Reports are stored as AgentCall rows (agent_name "instructor_report_agent"); input_payload
 * keeps the exact model input plus the label index, output_payload the stored report record.
 * Every report carries the application's counts. The narrative is added only when the model
 * call is allowed and its output passes the application's checks, after at most one
 * regeneration. Otherwise the instructor gets a counts-only report with a note saying why the
 * narrative could not be generated; the instructor is never left with nothing.
 *
 * Live calls keep the module's gating (mock provider gives a labelled local test report; live
 * calls must be enabled and a model set) and add a prompt approval: the narrative is requested
 * only when INSTRUCTOR_REPORT_V8_APPROVED_PROMPT_HASH equals the hash of the current prompt
 * and schema, the operator's record that this prompt passed validation.
 */

const MAX_ATTEMPTS = 2;
/** GPT-6.1 Sol streams about 50 tokens/s, so a full 12,000-token budget needs about 4 minutes. */
const PROVIDER_TIMEOUT_MS = 300_000;
/** Longer than MAX_ATTEMPTS x PROVIDER_TIMEOUT_MS, so a running generation is never overlapped. */
const IN_PROGRESS_WINDOW_MS = (MAX_ATTEMPTS * PROVIDER_TIMEOUT_MS) + 60_000;
const APPLICATION_PROVIDER = "application";
const COUNTS_ONLY_MODEL_NAME = "application-counts-only";
const LOCAL_TEST_MODEL_NAME = "local-test-report";

export type StoredInstructorReportV8 = InstructorReportV8Record & {
  kind: "v8";
  agent_call_public_id: string;
  generated_at: string;
  model_name: string;
  provider: string;
};

/** A report saved by the first version of this module, shown as it was saved. */
export type StoredInstructorReportLegacy = {
  kind: "legacy_v1";
  agent_call_public_id: string;
  generated_at: string;
  generation_mode: "live_model" | "local_test_summary";
  model_name: string;
  provider: string;
  report: LegacyInstructorReportV1Output;
  evidence_index: LegacyInstructorReportV1EvidenceIndex;
  student_count: number;
  item_count: number;
};

export type StoredInstructorReport = StoredInstructorReportV8 | StoredInstructorReportLegacy;

export type InstructorReportStatus = {
  latest_report: StoredInstructorReport | null;
  latest_attempt: {
    agent_call_public_id: string;
    status: string;
    created_at: string;
    error: string | null;
  } | null;
  /** A report (at least the counts) can always be generated once a student has submitted. */
  generation_available: boolean;
  generation_unavailable_reason: string | null;
  narrative_mode: "live_model" | "local_test" | "counts_only";
  /** Instructor-facing reason when a new report would carry counts only. */
  narrative_unavailable_reason: string | null;
};

function invocationPrefix(assessmentPublicId: string) {
  return `instructor-report:${assessmentPublicId}:`;
}

function configured(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Model resolution for the instructor report (D9 five-module policy): the module-level
 * OPENAI_MODEL_MODULE_INSTRUCTOR_REPORTING is authoritative; the older role-specific
 * OPENAI_MODEL_INSTRUCTOR_REPORT applies when the module variable is unset. The
 * reasoning effort follows the variable that supplied the model.
 */
export function resolveInstructorReportModelConfig(): AgentModelConfig | null {
  const env = getServerEnv();
  const moduleModel = configured(env.OPENAI_MODEL_MODULE_INSTRUCTOR_REPORTING);
  const model = moduleModel ?? configured(env.OPENAI_MODEL_INSTRUCTOR_REPORT);
  if (!model) return null;
  const reasoning = moduleModel
    ? configured(env.OPENAI_REASONING_EFFORT_MODULE_INSTRUCTOR_REPORTING)
    : configured(env.OPENAI_REASONING_EFFORT_INSTRUCTOR_REPORT);
  return {
    model_name: model,
    reasoning_effort: reasoning ? ReasoningEffort.parse(reasoning) : undefined,
    max_output_tokens: env.OPENAI_MAX_OUTPUT_TOKENS_INSTRUCTOR_REPORT ?? INSTRUCTOR_REPORT_DEFAULT_MAX_OUTPUT_TOKENS
  };
}

/** Same pattern as interpretationV8ApprovalStatus: the approved hash must equal the current prompt's. */
export function instructorReportV8ApprovalStatus() {
  const approved = process.env.INSTRUCTOR_REPORT_V8_APPROVED_PROMPT_HASH?.trim() || null;
  return { approved: approved === INSTRUCTOR_REPORT_V8_PROMPT_HASH, prompt_hash: INSTRUCTOR_REPORT_V8_PROMPT_HASH, configured_hash: approved };
}

type NarrativePlan =
  | { mode: "live_model"; model_config: AgentModelConfig }
  | { mode: "local_test" }
  | { mode: "counts_only"; reason_code: string };

/** Decides whether a new report gets a model narrative, a local test narrative or counts only. */
export function instructorReportNarrativePlan(): NarrativePlan {
  try {
    const runtime = getLlmRuntimeConfig();
    // Local/mock environments get a clearly labelled deterministic narrative so the workflow
    // can be tested without a provider. It is never presented as AI output.
    if (runtime.provider === "mock") return { mode: "local_test" };
    if (!runtime.live_calls_enabled) return { mode: "counts_only", reason_code: "live_calls_disabled" };
    const modelConfig = resolveInstructorReportModelConfig();
    if (!modelConfig) return { mode: "counts_only", reason_code: "model_not_configured" };
    if (!instructorReportV8ApprovalStatus().approved) return { mode: "counts_only", reason_code: "prompt_not_approved" };
    return { mode: "live_model", model_config: modelConfig };
  } catch (error) {
    if (error instanceof LlmConfigurationError) return { mode: "counts_only", reason_code: `configuration_${error.code}` };
    throw error;
  }
}

function inputHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function providerAuditUpdate(result: StructuredAgentResult<unknown>) {
  return {
    provider: result.provider,
    ...providerAuditMetadata(result),
    refusal_text: result.status === "refused" ? result.refusal ?? "refused" : null,
    incomplete_reason: result.status === "incomplete" ? result.incomplete_reason ?? "incomplete" : null,
    raw_output: result.raw_output === undefined ? Prisma.JsonNull : toPrismaJson(redactForAudit(result.raw_output)),
    latency_ms: result.latency_ms,
    input_tokens: result.usage?.input_tokens,
    output_tokens: result.usage?.output_tokens,
    total_tokens: result.usage?.total_tokens,
    token_usage: result.usage ? toPrismaJson(result.usage.raw ?? result.usage) : undefined
  };
}

/** Reads a stored report of either version; null when the payload is not a report. */
export function storedReportFromCall(call: {
  agent_call_public_id: string;
  created_at: Date;
  model_name: string;
  provider: string;
  output_payload: Prisma.JsonValue | null;
}): StoredInstructorReport | null {
  const payload = call.output_payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const base = {
    agent_call_public_id: call.agent_call_public_id,
    generated_at: call.created_at.toISOString(),
    model_name: call.model_name,
    provider: call.provider
  };
  if (payload.record_version === INSTRUCTOR_REPORT_V8_RECORD_VERSION) {
    const stored = payload as unknown as InstructorReportV8Record;
    if (!stored.counts || typeof stored.counts !== "object") return null;
    const narrative = stored.narrative ? InstructorReportV8OutputSchema.safeParse(stored.narrative) : null;
    if (narrative && !narrative.success) return null;
    return { ...stored, ...base, kind: "v8" };
  }
  const legacy = LegacyInstructorReportV1OutputSchema.safeParse(payload.report);
  if (!legacy.success) return null;
  return {
    ...base,
    kind: "legacy_v1",
    generation_mode: payload.generation_mode === "live_model" ? "live_model" : "local_test_summary",
    report: legacy.data,
    evidence_index: (payload.evidence_index as LegacyInstructorReportV1EvidenceIndex | undefined) ?? { students: {}, items: {} },
    student_count: typeof payload.student_count === "number" ? payload.student_count : 0,
    item_count: typeof payload.item_count === "number" ? payload.item_count : 0
  };
}

async function assertOwnedAssessment(teacherUserDbId: string, assessmentPublicId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { assessment_public_id: assessmentPublicId, created_by_user_db_id: teacherUserDbId },
    select: { id: true }
  });
  if (!assessment) throw new ContentServiceError("not_found", "Assessment was not found.", 404);
}

export async function getInstructorReportStatus(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}): Promise<InstructorReportStatus> {
  await assertOwnedAssessment(input.teacher_user_db_id, input.assessment_public_id);
  // The 20 most recent calls, without their payloads. Only the payload of the newest validated
  // call is then loaded; an older one is loaded only when a newer payload cannot be read.
  const calls = await prisma.agentCall.findMany({
    where: {
      agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
      agent_invocation_key: { startsWith: invocationPrefix(input.assessment_public_id) }
    },
    orderBy: { created_at: "desc" },
    take: 20,
    select: {
      agent_call_public_id: true,
      created_at: true,
      call_status: true,
      output_validated: true,
      validation_error: true,
      error_category: true
    }
  });
  let latestReport: StoredInstructorReport | null = null;
  for (const candidate of calls.filter((call) => call.call_status === "succeeded" && call.output_validated)) {
    const call = await prisma.agentCall.findUnique({
      where: { agent_call_public_id: candidate.agent_call_public_id },
      select: { agent_call_public_id: true, created_at: true, model_name: true, provider: true, output_payload: true }
    });
    latestReport = call ? storedReportFromCall(call) : null;
    if (latestReport) break;
  }
  const latest = calls[0] ?? null;
  const plan = instructorReportNarrativePlan();
  return {
    latest_report: latestReport,
    latest_attempt: latest
      ? {
          agent_call_public_id: latest.agent_call_public_id,
          status: latest.call_status,
          created_at: latest.created_at.toISOString(),
          error: latest.validation_error ?? latest.error_category ?? null
        }
      : null,
    generation_available: true,
    generation_unavailable_reason: null,
    narrative_mode: plan.mode,
    narrative_unavailable_reason: plan.mode === "counts_only" ? narrativeUnavailableReason(plan.reason_code) : null
  };
}

class DailyLimitReached extends Error {}

export async function generateInstructorReport(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  provider_override_for_test?: { provider: LlmProvider; model_config: AgentModelConfig };
}): Promise<StoredInstructorReport> {
  const loaded = await prisma.$transaction(
    (tx) => loadInstructorReportRecords(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 }
  );
  if (!loaded) throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  const assembled: AssembledInstructorReport = assembleInstructorReportV8(loaded);
  if (assembled.counts.students_with_submitted_attempt === 0) {
    throw new ContentServiceError("no_session_data", "No student has submitted responses for this mini test yet.", 409);
  }

  const plan: NarrativePlan = input.provider_override_for_test
    ? { mode: "live_model", model_config: input.provider_override_for_test.model_config }
    : instructorReportNarrativePlan();
  const prefix = invocationPrefix(input.assessment_public_id);
  const auditInput = {
    report_input: assembled.input,
    evidence_index: assembled.index,
    input_hash: inputHash(assembled.input)
  };

  // Serialise report generation per mini test (advisory lock), refuse overlapping runs and
  // enforce the daily cap on live calls inside the same transaction as the reservation.
  const reserveCall = (data: Prisma.AgentCallUncheckedCreateInput, options: { first_attempt: boolean }) =>
    prisma.$transaction(async (tx) => {
      // $executeRaw: pg_advisory_xact_lock returns void, which $queryRaw cannot
      // deserialize ("Failed to deserialize column of type 'void'").
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;
      if (options.first_attempt) {
        const running = await tx.agentCall.findFirst({
          where: {
            agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
            agent_invocation_key: { startsWith: prefix },
            call_status: "started",
            created_at: { gte: new Date(Date.now() - IN_PROGRESS_WINDOW_MS) }
          },
          select: { id: true }
        });
        if (running) {
          throw new ContentServiceError("conflict", "A report for this mini test is already being generated. Refresh in a few minutes.", 409);
        }
      }
      if (data.provider === "openai") {
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const today = await tx.agentCall.count({
          where: {
            agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
            agent_invocation_key: { startsWith: prefix },
            provider: "openai",
            created_at: { gte: dayStart }
          }
        });
        if (today >= INSTRUCTOR_REPORT_DAILY_LIMIT_PER_MINI_TEST * MAX_ATTEMPTS) throw new DailyLimitReached();
      }
      return tx.agentCall.create({ data });
    });

  const completedRow = (fields: { model_name: string; provider: string; prompt_version: string; schema_version: string; prompt_hash: string | null; record: InstructorReportV8Record }) => ({
    id: randomUUID(),
    agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
    agent_version: INSTRUCTOR_REPORT_V8_AGENT_VERSION,
    model_name: fields.model_name,
    provider: fields.provider,
    agent_invocation_key: `${prefix}${randomUUID()}`,
    prompt_hash: fields.prompt_hash,
    prompt_version: fields.prompt_version,
    schema_version: fields.schema_version,
    input_payload: toPrismaJson(redactForAudit(auditInput)) ?? Prisma.JsonNull,
    output_payload: toPrismaJson(fields.record) ?? Prisma.JsonNull,
    output_validated: true,
    live_call_allowed: false,
    call_status: "succeeded" as const,
    started_at: new Date(),
    completed_at: new Date()
  });

  /** The counts-only report: saved whenever there is no checked narrative. */
  const saveCountsOnly = async (reasonCode: string, firstAttempt: boolean) => {
    const call = await reserveCall(completedRow({
      model_name: COUNTS_ONLY_MODEL_NAME,
      provider: APPLICATION_PROVIDER,
      prompt_version: INSTRUCTOR_REPORT_V8_COUNTS_VERSION,
      schema_version: INSTRUCTOR_REPORT_V8_RECORD_VERSION,
      prompt_hash: null,
      record: buildReportRecord(assembled, { generation_mode: "counts_only", reason_code: reasonCode })
    }), { first_attempt: firstAttempt });
    return storedReportFromCall(call)!;
  };

  // The model input must carry no process data or identifiers (section 6).
  const inputProblems = reportInputProblems(assembled.input, assembled.identifiers);
  if (inputProblems.length > 0 || findProhibitedProviderInputPaths(assembled.input).length > 0) {
    return saveCountsOnly("input_check_failed", true);
  }

  if (plan.mode === "counts_only") return saveCountsOnly(plan.reason_code, true);

  if (plan.mode === "local_test") {
    const narrative = buildLocalTestNarrative(assembled.input);
    if (validateInstructorReportV8(assembled.input, narrative).length > 0) return saveCountsOnly("local_test_rejected", true);
    const call = await reserveCall(completedRow({
      model_name: LOCAL_TEST_MODEL_NAME,
      provider: "mock",
      prompt_version: INSTRUCTOR_REPORT_V8_PROMPT_VERSION,
      schema_version: INSTRUCTOR_REPORT_V8_SCHEMA_VERSION,
      prompt_hash: INSTRUCTOR_REPORT_V8_PROMPT_HASH,
      record: buildReportRecord(assembled, { generation_mode: "local_test", narrative })
    }), { first_attempt: true });
    return storedReportFromCall(call)!;
  }

  const provider = input.provider_override_for_test?.provider ?? createLlmProvider();
  assertNoProhibitedProviderInput(assembled.input);
  let previousIssues: InstructorReportIssue[] = [];
  let failureCode = "provider_failure";
  let anyCallReserved = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const clientRequestId = `instructor_report_${randomUUID()}`;
    const providerInput = previousIssues.length
      ? { ...assembled.input, previous_attempt_rejected_for: previousIssues.slice(0, 30) }
      : assembled.input;
    let call: Awaited<ReturnType<typeof reserveCall>>;
    try {
      call = await reserveCall({
        id: randomUUID(),
        agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
        agent_version: INSTRUCTOR_REPORT_V8_AGENT_VERSION,
        model_name: plan.model_config.model_name,
        provider: "openai",
        client_request_id: clientRequestId,
        agent_invocation_key: `${prefix}${randomUUID()}`,
        prompt_hash: INSTRUCTOR_REPORT_V8_PROMPT_HASH,
        max_output_tokens: plan.model_config.max_output_tokens ?? null,
        reasoning_effort: plan.model_config.reasoning_effort ?? null,
        prompt_version: INSTRUCTOR_REPORT_V8_PROMPT_VERSION,
        schema_version: INSTRUCTOR_REPORT_V8_SCHEMA_VERSION,
        input_payload: toPrismaJson(redactForAudit({ ...auditInput, attempt, previous_attempt_rejected_for: previousIssues.slice(0, 30) })) ?? Prisma.JsonNull,
        live_call_allowed: true,
        call_status: "started",
        retry_count: attempt - 1,
        started_at: new Date()
      }, { first_attempt: attempt === 1 });
    } catch (error) {
      if (error instanceof DailyLimitReached) {
        failureCode = "daily_limit_reached";
        break;
      }
      throw error;
    }
    anyCallReserved = true;
    let result: StructuredAgentResult<InstructorReportV8Output>;
    try {
      result = await provider.executeStructured({
        agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
        model_config: plan.model_config,
        instructions: INSTRUCTOR_REPORT_V8_INSTRUCTIONS,
        input: providerInput,
        output_schema: InstructorReportV8OutputSchema,
        schema_name: INSTRUCTOR_REPORT_V8_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
        client_request_id: clientRequestId,
        timeout_ms: PROVIDER_TIMEOUT_MS,
        metadata: { purpose: "instructor_report", prompt_version: INSTRUCTOR_REPORT_V8_PROMPT_VERSION, attempt: String(attempt) }
      });
    } catch {
      // A thrown provider error must not leave the reservation in "started".
      failureCode = "provider_failure";
      await prisma.agentCall.update({
        where: { id: call.id },
        data: { output_validated: false, call_status: "failed", error_category: "provider_exception", completed_at: new Date() }
      });
      continue;
    }

    if (result.status !== "completed" || !result.parsed_output) {
      failureCode = "provider_failure";
      await prisma.agentCall.update({
        where: { id: call.id },
        data: {
          ...providerAuditUpdate(result),
          output_validated: false,
          call_status: "failed",
          error_category: result.error?.category ?? result.status,
          completed_at: new Date()
        }
      });
      if (result.error?.retryable === false) break;
      continue;
    }

    const parsed = InstructorReportV8OutputSchema.safeParse(result.parsed_output);
    const issues = parsed.success
      ? validateInstructorReportV8(assembled.input, parsed.data)
      : [{ path: "$", code: "schema_mismatch", message: "The output did not match the required format." }];
    if (!parsed.success || issues.length > 0) {
      previousIssues = issues;
      failureCode = "validation_failed";
      await prisma.agentCall.update({
        where: { id: call.id },
        data: {
          ...providerAuditUpdate(result),
          output_payload: toPrismaJson({ rejected_output: result.parsed_output, issues }),
          output_validated: false,
          call_status: "invalid_output",
          error_category: "semantic_validation",
          validation_error: issues.map((issue) => `${issue.path}: ${issue.code}`).join("; ").slice(0, 4000),
          completed_at: new Date()
        }
      });
      continue;
    }

    const updated = await prisma.agentCall.update({
      where: { id: call.id },
      data: {
        ...providerAuditUpdate(result),
        output_payload: toPrismaJson(buildReportRecord(assembled, { generation_mode: "live_model", narrative: parsed.data })),
        output_validated: true,
        call_status: "succeeded",
        completed_at: new Date()
      }
    });
    return storedReportFromCall(updated)!;
  }

  // No checked narrative: the instructor still gets the counts, with the reason.
  return saveCountsOnly(failureCode, !anyCallReserved);
}
