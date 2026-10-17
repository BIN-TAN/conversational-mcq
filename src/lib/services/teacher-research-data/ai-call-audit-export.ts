import type { Prisma } from "@prisma/client";
import { moduleForRole } from "@/lib/llm/assessment-modules";

/**
 * R3 (docs/RESEARCH_DATA_REVIEW_2026-10-17.md): researcher-only AI audit export.
 *
 * Reviewers of AI interpretations (dissertation RQ2, Appendix D) need to see exactly
 * what each model call received and returned, including rejected drafts and retries.
 * These files are produced only when a research export is generated with restricted
 * fields; students never see them, and the ordinary research export never includes
 * them. Covered: every model call recorded against an attempt, and instructor
 * reports for whole-cohort scopes. Teacher-side item-preparation calls (item design,
 * MCQ import) are not attempt data and are not included. Model inputs contain only the allow-listed assessment evidence the
 * application sends to the provider (no names, account IDs or credentials).
 */
export const AI_CALL_AUDIT_FILE = "ai_call_audit.csv";
export const AI_CALL_AUDIT_DICTIONARY_FILE = "ai_call_audit_data_dictionary.csv";
export const AI_CALL_AUDIT_VERSION = "ai-call-audit-v1";

export const AI_CALL_AUDIT_DEFINITIONS: Record<string, string> = {
  ai_call_audit_version: "Version of this audit file's layout.",
  agent_call_public_id: "Stable public identifier of the model call; joins to agent_activity_records.agent_call_public_id.",
  session_public_id: "Attempt join key to sessions.csv; blank for assessment-level calls such as instructor reports.",
  research_student_id: "Pseudonymous student join key; blank for assessment-level calls.",
  assessment_public_id: "Mini-test join key.",
  attempt_number: "Attempt number of the session; blank for assessment-level calls.",
  agent_name: "Application AI role that made the call (see docs/AI_ROLES_AND_MODULES.md).",
  assessment_module: "Dissertation module the role belongs to (item_preparation, item_administration, profiling_and_feedback, formative_conversation, instructor_reporting, utility).",
  provider: "Model provider (openai, or mock for local test output that is never live model evidence).",
  model_name: "Model identifier recorded for the call.",
  reasoning_effort: "Reasoning effort requested, when recorded.",
  max_output_tokens: "Output token limit requested, when recorded.",
  prompt_version: "Version label of the instructions sent with the call.",
  prompt_hash: "Hash of the exact instructions, when recorded; identical hashes mean identical instructions.",
  schema_version: "Version of the structured output contract.",
  agent_version: "Version label of the role implementation.",
  call_status: "Outcome of the call: succeeded, invalid_output (returned but rejected by validation), failed, blocked, refused, incomplete or started.",
  output_validated: "True when the application accepted the output after schema and content validation.",
  validation_error: "Why validation rejected the output, when it did.",
  error_category: "Provider or runtime error category, when the call failed.",
  blocked_reason: "Why the application blocked the call before or after the provider, when it did.",
  retry_count: "Provider retries within this call.",
  input_tokens: "Provider-reported input tokens.",
  output_tokens: "Provider-reported output tokens, including reasoning tokens.",
  latency_ms: "Provider round-trip time in milliseconds, when recorded.",
  created_at: "When the call record was created (server time).",
  completed_at: "When the call finished (server time).",
  input_payload_json: "Exact structured input sent to the model, as JSON; credential-like fragments (such as authorization headers or API keys) are replaced with [masked].",
  raw_output_json: "Model output as received before validation, as JSON; retained for rejected drafts too.",
  validated_output_json: "Output after validation and any application normalisation, as JSON; blank when rejected. Whether it was displayed is not inferred here: join to conversation_turns.csv, feedback_exposure_events.csv and agent_activity_records.csv."
};

export const AI_CALL_AUDIT_COLUMNS = Object.keys(AI_CALL_AUDIT_DEFINITIONS);

const auditSelect = {
  agent_call_public_id: true,
  agent_name: true,
  agent_version: true,
  agent_invocation_key: true,
  provider: true,
  model_name: true,
  reasoning_effort: true,
  max_output_tokens: true,
  prompt_version: true,
  prompt_hash: true,
  schema_version: true,
  call_status: true,
  output_validated: true,
  validation_error: true,
  error_category: true,
  blocked_reason: true,
  retry_count: true,
  input_tokens: true,
  output_tokens: true,
  latency_ms: true,
  created_at: true,
  completed_at: true,
  input_payload: true,
  raw_output: true,
  output_payload: true
} as const;

type AuditCall = Prisma.AgentCallGetPayload<{ select: typeof auditSelect }>;
type Row = Record<string, string | number | boolean | null>;

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

// The export's safety scan refuses the whole bundle when any cell looks like a
// credential. Model inputs and outputs can contain student or teacher text that
// happens to match (for example "Authorization:"), so such fragments are masked here
// instead of blocking the restricted export.
const SECRET_LIKE_FRAGMENTS = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /authorization\s*:/gi,
  /bearer\s+[A-Za-z0-9._-]{10,}/gi,
  /password_hash/gi,
  /access_code_hash/gi,
  /session_secret/gi,
  /database_url/gi,
  /postgresql:\/\//gi
];

function maskSecretLike(text: string) {
  return SECRET_LIKE_FRAGMENTS.reduce((masked, pattern) => masked.replace(pattern, "[masked]"), text);
}

function json(value: unknown) {
  return value === null || value === undefined ? null : maskSecretLike(JSON.stringify(value));
}

function auditRow(call: AuditCall, context: {
  session_public_id: string | null;
  research_student_id: string | null;
  assessment_public_id: string | null;
  attempt_number: number | null;
}): Row {
  return {
    ai_call_audit_version: AI_CALL_AUDIT_VERSION,
    agent_call_public_id: call.agent_call_public_id,
    ...context,
    agent_name: call.agent_name,
    assessment_module: moduleForRole(call.agent_name) ?? "unmapped",
    provider: call.provider,
    model_name: call.model_name,
    reasoning_effort: call.reasoning_effort,
    max_output_tokens: call.max_output_tokens,
    prompt_version: call.prompt_version,
    prompt_hash: call.prompt_hash,
    schema_version: call.schema_version,
    agent_version: call.agent_version,
    call_status: call.call_status,
    output_validated: call.output_validated,
    validation_error: call.validation_error === null ? null : maskSecretLike(call.validation_error),
    error_category: call.error_category,
    blocked_reason: call.blocked_reason,
    retry_count: call.retry_count,
    input_tokens: call.input_tokens,
    output_tokens: call.output_tokens,
    latency_ms: call.latency_ms,
    created_at: iso(call.created_at),
    completed_at: iso(call.completed_at),
    input_payload_json: json(call.input_payload),
    raw_output_json: json(call.raw_output),
    validated_output_json: call.output_validated ? json(call.output_payload) : null
  };
}

/** Every model call recorded for one attempt, oldest first. */
export async function sessionAiCallAuditRows(db: Prisma.TransactionClient, session: {
  session_db_id: string;
  session_public_id: string;
  research_student_id: string;
  assessment_public_id: string;
  attempt_number: number;
}) {
  const calls = await db.agentCall.findMany({
    where: { assessment_session_db_id: session.session_db_id },
    orderBy: [{ created_at: "asc" }, { agent_call_public_id: "asc" }],
    select: auditSelect
  });
  const context = {
    session_public_id: session.session_public_id,
    research_student_id: session.research_student_id,
    assessment_public_id: session.assessment_public_id,
    attempt_number: session.attempt_number
  };
  return calls.map((call) => auditRow(call, context));
}

/**
 * Removes the server-side label index (S1 -> session ID) from stored instructor-report
 * payloads. A report covers a whole class, so its rows are exported only for
 * whole-cohort scopes, and never with raw session identifiers.
 */
function withoutEvidenceIndex(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "evidence_index"));
}

/** Instructor-report calls for the mini tests in scope (assessment-level, no attempt). */
export async function instructorReportAuditRows(db: Prisma.TransactionClient, assessmentPublicIds: string[]) {
  const rows: Row[] = [];
  for (const assessmentPublicId of [...new Set(assessmentPublicIds)].sort()) {
    const calls = await db.agentCall.findMany({
      where: { agent_name: "instructor_report_agent", agent_invocation_key: { startsWith: `instructor-report:${assessmentPublicId}:` } },
      orderBy: [{ created_at: "asc" }, { agent_call_public_id: "asc" }],
      select: auditSelect
    });
    rows.push(...calls.map((call) => auditRow({ ...call,
      input_payload: withoutEvidenceIndex(call.input_payload) as typeof call.input_payload,
      output_payload: withoutEvidenceIndex(call.output_payload) as typeof call.output_payload,
      raw_output: withoutEvidenceIndex(call.raw_output) as typeof call.raw_output
    }, {
      session_public_id: null, research_student_id: null, assessment_public_id: assessmentPublicId, attempt_number: null
    })));
  }
  return rows;
}
