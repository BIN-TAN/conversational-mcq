import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertNoProhibitedProviderInput, omitProhibitedProviderInputFields, redactForAudit } from "@/lib/agents/redaction";
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
import {
  INSTRUCTOR_REPORT_AGENT_NAME,
  INSTRUCTOR_REPORT_AGENT_VERSION,
  INSTRUCTOR_REPORT_DAILY_LIMIT_PER_MINI_TEST,
  INSTRUCTOR_REPORT_DEFAULT_MAX_OUTPUT_TOKENS,
  INSTRUCTOR_REPORT_INSTRUCTIONS,
  INSTRUCTOR_REPORT_PROMPT_VERSION,
  INSTRUCTOR_REPORT_SCHEMA_VERSION,
  InstructorReportOutputSchema,
  type InstructorReportEvidenceIndex,
  type InstructorReportInput,
  type InstructorReportOutput
} from "./contract";
import { buildInstructorReportInput } from "./evidence";
import { validateInstructorReport, type InstructorReportValidationIssue } from "./validate";

/**
 * Instructor reporting module (D8, docs/DESIGN_ALIGNMENT_2026-10-17.md).
 *
 * Reports are stored as AgentCall rows (agent_name "instructor_report_agent"), so no
 * schema migration is needed: input_payload keeps the exact evidence sent to the
 * model plus the label index, output_payload keeps the validated report. A report is
 * a system-generated interpretation; the evidence links let instructors check every
 * claim against the students' records.
 */

const MAX_ATTEMPTS = 2;
/** GPT-6.1 Sol streams about 50 tokens/s, so a full 12,000-token budget needs about 4 minutes. */
const PROVIDER_TIMEOUT_MS = 300_000;
/** Longer than MAX_ATTEMPTS x PROVIDER_TIMEOUT_MS, so a running generation is never overlapped. */
const IN_PROGRESS_WINDOW_MS = (MAX_ATTEMPTS * PROVIDER_TIMEOUT_MS) + 60_000;

export type InstructorReportGenerationMode = "live_model" | "local_test_summary";

export type StoredInstructorReport = {
  agent_call_public_id: string;
  generated_at: string;
  generation_mode: InstructorReportGenerationMode;
  model_name: string;
  provider: string;
  report: InstructorReportOutput;
  evidence_index: InstructorReportEvidenceIndex;
  student_count: number;
  item_count: number;
};

export type InstructorReportStatus = {
  latest_report: StoredInstructorReport | null;
  latest_attempt: {
    agent_call_public_id: string;
    status: string;
    created_at: string;
    error: string | null;
  } | null;
  generation_available: boolean;
  generation_unavailable_reason: string | null;
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

type GenerationPlan =
  | { mode: "live_model"; provider: LlmProvider; model_config: AgentModelConfig }
  | { mode: "local_test_summary" };

function generationPlan(): { plan: GenerationPlan | null; reason: string | null } {
  try {
    return generationPlanUnchecked();
  } catch (error) {
    if (error instanceof LlmConfigurationError) {
      return { plan: null, reason: `AI configuration is incomplete (${error.code}).` };
    }
    throw error;
  }
}

function generationPlanUnchecked(): { plan: GenerationPlan | null; reason: string | null } {
  const runtime = getLlmRuntimeConfig();
  if (runtime.provider === "mock") {
    // Local/mock environments get a clearly labelled deterministic summary so the
    // workflow can be tested without a provider. It is never presented as AI output.
    return { plan: { mode: "local_test_summary" }, reason: null };
  }
  if (!runtime.live_calls_enabled) {
    return { plan: null, reason: "Live AI calls are disabled for this environment." };
  }
  const modelConfig = resolveInstructorReportModelConfig();
  if (!modelConfig) {
    return {
      plan: null,
      reason: "Set OPENAI_MODEL_MODULE_INSTRUCTOR_REPORTING (or OPENAI_MODEL_INSTRUCTOR_REPORT) to enable AI instructor reports."
    };
  }
  return { plan: { mode: "live_model", provider: createLlmProvider(), model_config: modelConfig }, reason: null };
}

/** Deterministic, clearly labelled stand-in used only with the mock provider. */
export function buildLocalTestSummary(input: InstructorReportInput): InstructorReportOutput {
  const responses = input.students.flatMap((student) => student.responses);
  const correct = responses.filter((response) => response.correctness === "correct").length;
  const idk = responses.filter((response) => response.selected_i_dont_know).length;
  const conversations = input.students.filter((student) => (student.conversation?.student_turn_count ?? 0) > 0).length;
  return {
    schema_version: INSTRUCTOR_REPORT_SCHEMA_VERSION,
    overview:
      "Local test summary generated without an AI model. It counts recorded responses only and makes no interpretation of student understanding.",
    participation_summary:
      `${input.students_with_submitted_responses} of ${input.eligible_student_count} eligible students have a submitted response package. ` +
      `${correct} of ${responses.length} recorded item responses are correct; ${idk} are "I don't know yet".`,
    findings: [],
    item_notes: [],
    conversation_summary: `${conversations} students sent at least one message in the learning conversation.`,
    suggested_instructional_actions: [],
    limitations: [
      "Generated by the local mock configuration; no AI model reviewed the responses or transcripts.",
      ...input.truncation_notes
    ]
  };
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

function storedReportFromCall(call: {
  agent_call_public_id: string;
  created_at: Date;
  model_name: string;
  provider: string;
  output_payload: Prisma.JsonValue | null;
}): StoredInstructorReport | null {
  const payload = call.output_payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return null;
  const report = InstructorReportOutputSchema.safeParse(payload.report);
  if (!report.success) return null;
  const index = payload.evidence_index as InstructorReportEvidenceIndex | undefined;
  return {
    agent_call_public_id: call.agent_call_public_id,
    generated_at: call.created_at.toISOString(),
    generation_mode: payload.generation_mode === "live_model" ? "live_model" : "local_test_summary",
    model_name: call.model_name,
    provider: call.provider,
    report: report.data,
    evidence_index: index ?? { students: {}, items: {} },
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
      model_name: true,
      provider: true,
      call_status: true,
      output_validated: true,
      output_payload: true,
      validation_error: true,
      error_category: true
    }
  });
  const latestSucceeded = calls.find((call) => call.call_status === "succeeded" && call.output_validated);
  const latest = calls[0] ?? null;
  const { plan, reason } = generationPlan();
  return {
    latest_report: latestSucceeded ? storedReportFromCall(latestSucceeded) : null,
    latest_attempt: latest
      ? {
          agent_call_public_id: latest.agent_call_public_id,
          status: latest.call_status,
          created_at: latest.created_at.toISOString(),
          error: latest.validation_error ?? latest.error_category ?? null
        }
      : null,
    generation_available: plan !== null,
    generation_unavailable_reason: reason
  };
}

export async function generateInstructorReport(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  provider_override_for_test?: { provider: LlmProvider; model_config: AgentModelConfig };
}): Promise<StoredInstructorReport> {
  const built = await prisma.$transaction(
    (tx) => buildInstructorReportInput(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 }
  );
  if (!built) throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  if (built.input.students.length === 0) {
    throw new ContentServiceError("no_session_data", "No student has submitted responses for this mini test yet.", 409);
  }

  const planResult = input.provider_override_for_test
    ? { plan: { mode: "live_model" as const, ...input.provider_override_for_test }, reason: null }
    : generationPlan();
  if (!planResult.plan) {
    throw new ContentServiceError("validation_failed", planResult.reason ?? "AI instructor reports are not configured.", 503);
  }
  const plan = planResult.plan;
  // Teacher-authored JSON (for example distractor rationales) may carry keys the
  // provider boundary forbids; drop them instead of failing the whole report.
  built.input = omitProhibitedProviderInputFields(built.input);
  assertNoProhibitedProviderInput(built.input);

  const auditInput = { report_input: built.input, evidence_index: built.index, input_hash: inputHash(built.input) };
  const baseOutputPayload = {
    evidence_index: built.index,
    student_count: built.input.students.length,
    item_count: built.input.items.length
  };

  // Serialise report generation per mini test (advisory lock), refuse overlapping
  // runs and enforce the daily cap inside the same transaction as the reservation.
  const reserveCall = (data: Prisma.AgentCallUncheckedCreateInput, options: { first_attempt: boolean }) =>
    prisma.$transaction(async (tx) => {
      const prefix = invocationPrefix(input.assessment_public_id);
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
        if (today >= INSTRUCTOR_REPORT_DAILY_LIMIT_PER_MINI_TEST * MAX_ATTEMPTS) {
          throw new ContentServiceError("conflict", "The daily limit for AI reports on this mini test has been reached. Try again tomorrow.", 429);
        }
      }
      return tx.agentCall.create({ data });
    });

  if (plan.mode === "local_test_summary") {
    const report = buildLocalTestSummary(built.input);
    const call = await reserveCall({
        id: randomUUID(),
        agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
        agent_version: INSTRUCTOR_REPORT_AGENT_VERSION,
        model_name: "local-test-summary",
        provider: "mock",
        agent_invocation_key: `${invocationPrefix(input.assessment_public_id)}${randomUUID()}`,
        prompt_version: INSTRUCTOR_REPORT_PROMPT_VERSION,
        schema_version: INSTRUCTOR_REPORT_SCHEMA_VERSION,
        input_payload: toPrismaJson(redactForAudit(auditInput)) ?? Prisma.JsonNull,
        output_payload: toPrismaJson({ ...baseOutputPayload, generation_mode: "local_test_summary", report }),
        output_validated: true,
        live_call_allowed: false,
        call_status: "succeeded",
        started_at: new Date(),
        completed_at: new Date()
    }, { first_attempt: true });
    return storedReportFromCall(call)!;
  }

  let previousIssues: InstructorReportValidationIssue[] = [];
  let lastError = "The report could not be generated.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const clientRequestId = `instructor_report_${randomUUID()}`;
    const providerInput = previousIssues.length
      ? { ...built.input, previous_attempt_rejected_for: previousIssues.slice(0, 20) }
      : built.input;
    const call = await reserveCall({
        id: randomUUID(),
        agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
        agent_version: INSTRUCTOR_REPORT_AGENT_VERSION,
        model_name: plan.model_config.model_name,
        provider: "openai",
        client_request_id: clientRequestId,
        agent_invocation_key: `${invocationPrefix(input.assessment_public_id)}${randomUUID()}`,
        prompt_hash: createHash("sha256").update(INSTRUCTOR_REPORT_INSTRUCTIONS).digest("hex"),
        max_output_tokens: plan.model_config.max_output_tokens ?? null,
        reasoning_effort: plan.model_config.reasoning_effort ?? null,
        prompt_version: INSTRUCTOR_REPORT_PROMPT_VERSION,
        schema_version: INSTRUCTOR_REPORT_SCHEMA_VERSION,
        input_payload: toPrismaJson(redactForAudit({ ...auditInput, attempt })) ?? Prisma.JsonNull,
        live_call_allowed: true,
        call_status: "started",
        retry_count: attempt - 1,
        started_at: new Date()
    }, { first_attempt: attempt === 1 });
    let result: StructuredAgentResult<InstructorReportOutput>;
    try {
      result = await plan.provider.executeStructured({
      agent_name: INSTRUCTOR_REPORT_AGENT_NAME,
      model_config: plan.model_config,
      instructions: INSTRUCTOR_REPORT_INSTRUCTIONS,
      input: providerInput,
      output_schema: InstructorReportOutputSchema,
      schema_name: INSTRUCTOR_REPORT_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
      client_request_id: clientRequestId,
      timeout_ms: PROVIDER_TIMEOUT_MS,
      metadata: { purpose: "instructor_report", prompt_version: INSTRUCTOR_REPORT_PROMPT_VERSION, attempt: String(attempt) }
      });
    } catch (error) {
      // A thrown provider error must not leave the reservation in "started".
      lastError = error instanceof Error ? error.message : "The AI provider could not be reached.";
      await prisma.agentCall.update({
        where: { id: call.id },
        data: { output_validated: false, call_status: "failed", error_category: "provider_exception", completed_at: new Date() }
      });
      continue;
    }

    if (result.status !== "completed" || !result.parsed_output) {
      lastError = result.error?.message ?? result.incomplete_reason ?? result.refusal ?? result.status;
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

    const parsed = InstructorReportOutputSchema.safeParse(result.parsed_output);
    const issues = parsed.success ? validateInstructorReport(built.input, parsed.data) : [];
    if (!parsed.success || issues.length > 0) {
      previousIssues = issues;
      lastError = parsed.success
        ? `The generated report cited evidence that could not be verified (${issues.length} issue${issues.length === 1 ? "" : "s"}).`
        : "The generated report did not match the required format.";
      await prisma.agentCall.update({
        where: { id: call.id },
        data: {
          ...providerAuditUpdate(result),
          output_payload: toPrismaJson({ rejected_output: result.parsed_output, issues }),
          output_validated: false,
          call_status: "invalid_output",
          validation_error: lastError,
          completed_at: new Date()
        }
      });
      continue;
    }

    const updated = await prisma.agentCall.update({
      where: { id: call.id },
      data: {
        ...providerAuditUpdate(result),
        output_payload: toPrismaJson({ ...baseOutputPayload, generation_mode: "live_model", report: parsed.data }),
        output_validated: true,
        call_status: "succeeded",
        completed_at: new Date()
      }
    });
    return storedReportFromCall(updated)!;
  }

  throw new ContentServiceError(
    "validation_failed",
    `${lastError} No report was saved; earlier reports are unchanged. Try again later.`,
    503
  );
}
