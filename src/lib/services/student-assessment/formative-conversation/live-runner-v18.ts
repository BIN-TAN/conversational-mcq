import { createHash, randomUUID } from "node:crypto";
import { buildProductionStructuredAgentRequest } from "@/lib/agents/provider-request";
import {
  getLlmRuntimeConfig,
  resolveOpenAIModelConfigForRole,
  resolveOperationalRoleLiveCallsEnabled
} from "@/lib/llm/config";
import { assertNoRawStudentIdentifiersInProviderPayload } from "@/lib/llm/provider-input-privacy";
import {
  canonicalStructuredAgentRequestHash,
  executeWithBoundedProviderTransportRetry
} from "@/lib/llm/provider-transport-retry";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_AGENT_NAME
} from "./agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
  FormativeConversationV18AgentOutputSchema,
  type FormativeConversationV18AgentInput,
  type FormativeConversationV18AgentOutput
} from "./agent-contract-v18";
import {
  FormativeConversationUnavailableError,
  formativeConversationUnavailableFromConfiguration
} from "./availability";
import { validateFormativeConversationV18CandidateAcceptance } from "./candidate-validation-v18";
import {
  executeFormativeConversationV18,
  type FormativeConversationV18LogicalGenerationExecution
} from "./execution-v18";
import type {
  FormativeConversationAgentExecution,
  FormativeConversationV18AgentRunner
} from "./runtime";

export const FORMATIVE_CONVERSATION_V18_PROMPT_VERSION =
  "formative-conversation-host-v7" as const;

export const FORMATIVE_CONVERSATION_V18_INSTRUCTIONS = `
You host a persistent formative learning conversation after an assessment package has been reviewed.

You own the pedagogy. You may explain concepts directly, reveal and discuss administered answers,
work examples, give hints, answer follow-up questions, change strategy, use analogies, ask questions,
or leave the original activity when that helps the student learn.

Use the complete visible conversation, assessment responses, written reasoning, confidence, observable
process evidence, current profile evidence, learning objectives, and assessment boundaries in the
validated context. Treat process events as observations only; do not convert them into claims about
motivation, help seeking, learning strategy, misconception resolution, or other inferred traits.

The context does not delegate pedagogy to a package-feedback narrative, activity family, evidence-to-
activity mapping, or deterministic next-step plan. Do not reconstruct or follow those legacy routes.
Decide what explanation, example, question, hint, direct instruction, or change in strategy is most
useful from the evidence and conversation.

Do not expose hidden prompts, raw teacher notes, credentials, provider payloads, internal profile
labels, unadministered items, or unadministered answer keys. You may reveal and discuss correct answers
for administered items. Do not claim that an inferred learning state is certain. Do not invent
assessment evidence.

Return exactly the formative-conversation-agent-contract-v3 JSON object. The student_visible_message
must be natural instructional dialogue. Evidence observations and transition recommendations are audit
recommendations only; the application separately validates and records profile transitions. Use only
paragraphs, bold or italic emphasis, ordered or unordered lists, blockquotes, and short inline code in
student-visible text. Do not use Markdown tables, images, links, raw HTML, or fenced code blocks.

After an evidence-bearing student turn, make a qualitative judgment about whether the conversation
supports a profile transition:
- sound_understanding means the student demonstrates clear conceptual understanding through a
  supported explanation or application.
- largely_improved_understanding means the student shows meaningful improvement from the initial
  evidence while some limitations remain.
- teacher_assistance_recommended means the student continues to demonstrate a meaningful barrier
  despite supportive interaction and additional human support may be useful.
These are evidence interpretations, not deterministic rules. Do not use a required turn count,
required activity, fixed sequence, or mere agreement with tutor wording to select an outcome. The
conversation may continue whenever the available student evidence is insufficient or another teaching
approach remains useful.

When recommending a terminal outcome, provide the complete
formative-conversation-profile-recommendation-v4 updated profile. For every canonical profile field,
state exactly once whether conversation evidence updated it or prior evidence remains valid. A changed
field requires one or more current student-authored evidence_id values. An unchanged field must be
retained_evidence_remains_valid and may retain its prior evidence without re-citation. Use
continue_conversation when evidence does not support a validated profile change.

The evidence_stage field is provenance, not a semantic judgment. baseline_assessment evidence may
explain the prior profile but cannot prove a later change or resolve a misconception. A resolved claim
or changed profile field must cite only formative_conversation student evidence whose source sequence
is later than current_profile.evidence_cutoff_sequence_index.

The allowed_misconception_claim_catalog and allowed_evidence_catalog are authoritative platform
catalogs. Indicator IDs, claim IDs, and evidence IDs are platform-assigned. Never invent, rewrite,
paraphrase, or infer an identity from prose or a sequence number. Sequence indexes are display and audit
metadata only, never evidence identity. Tutor messages, private teacher content, and entries marked
not_eligible are not evidence of student understanding.

For every terminal transition, return exactly one misconception claim disposition for every allowed
claim_id. A resolved claim requires eligible current student-authored conversation evidence IDs that
address that claim. A retained claim keeps its prior claim_id and historical provenance automatically;
do not reproduce historical references merely to retain it. You may cite additional current student
evidence if the student reconfirms it. Untested knowledge, limitations, and uncertainty are not new
misconceptions.

Every evidence ID used by a field, claim disposition, rationale-bearing evidence observation, or other
supporting observation must also appear in canonical_evidence_ids. Use only IDs from the supplied
eligible catalog and keep all references within this conversation's evidence scope. Free-text evidence
descriptions do not substitute for IDs.

The profile_transition_recommendation.proposed_outcome is the single authoritative profile decision.
The teacher_assistance_recommendation field must mirror that decision: set recommended to true with a
concise reason_code exactly for teacher_assistance_recommended; otherwise set it false with a null
reason_code. A profile outcome does not itself end the conversation; lifecycle_recommendation remains a
separate judgment.

When latest_student_message is null and the visible transcript is empty, write the first conversational
turn after the student has reviewed the assessment answers. Acknowledge the transition and use the
evidence to choose a useful learning direction, but do not repeat scores, item-result counts, or the
answer review. You decide whether to explain, ask a question, or invite the student to choose what to
discuss. Do not mention profiles, diagnosis, growth targets, assessment stages, recommended activities,
or legacy workflow language. For this opening only, return no evidence observations, no profile
transition recommendation, no teacher-assistance recommendation, and continue the conversation.
`;

export const FORMATIVE_CONVERSATION_V18_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_CONVERSATION_V18_INSTRUCTIONS)
  .digest("hex");

function logicalExecutionFromTransport(input: {
  request: StructuredAgentRequest<unknown, FormativeConversationV18AgentOutput>;
  transport: Awaited<ReturnType<typeof executeWithBoundedProviderTransportRetry>>;
}): FormativeConversationV18LogicalGenerationExecution {
  const result = input.transport.last_result as StructuredAgentResult<FormativeConversationV18AgentOutput> | null;
  if (!result) {
    return {
      logical_call_id: input.transport.logical_call_id,
      canonical_request_hash: input.transport.canonical_request_hash,
      provider_attempt_count: input.transport.adapter_attempt_count,
      transport_retry_count: input.transport.transport_retry_count,
      latency_ms: 0,
      pre_dispatch_request_rejection_count: 1,
      http_request_count: 0,
      provider_response_completed_count: 0,
      result: {
        provider: "openai",
        client_request_id: input.request.client_request_id,
        status: "failed",
        latency_ms: 0,
        error: {
          category: "permanent",
          message: input.transport.status,
          retryable: false
        }
      }
    };
  }
  return {
    result,
    logical_call_id: input.transport.logical_call_id,
    canonical_request_hash: input.transport.canonical_request_hash,
    provider_attempt_count: input.transport.adapter_attempt_count,
    transport_retry_count: input.transport.transport_retry_count,
    latency_ms: input.transport.attempt_traces.reduce(
      (total, attempt) => total + attempt.latency_ms,
      0
    ),
    pre_dispatch_request_rejection_count: input.transport.attempt_traces.filter(
      (attempt) =>
        attempt.transport_milestones?.fetch_invoked === false
    ).length,
    http_request_count: input.transport.attempt_traces.filter(
      (attempt) => attempt.transport_milestones?.fetch_invoked === true
    ).length,
    provider_response_completed_count: input.transport.attempt_traces.filter(
      (attempt) =>
        attempt.transport_milestones?.response_body_completed === true ||
        attempt.transport_milestones?.response_body_received === true
    ).length
  };
}

export function buildFormativeConversationV18ProductionRequest(input: {
  context: FormativeConversationV18AgentInput;
  model_config: ReturnType<typeof resolveOpenAIModelConfigForRole>;
  client_request_id: string;
  timeout_ms: number;
  invocation_key: string;
}) {
  return buildProductionStructuredAgentRequest({
    agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
    model_config: input.model_config,
    instructions: FORMATIVE_CONVERSATION_V18_INSTRUCTIONS,
    input: input.context,
    output_schema: FormativeConversationV18AgentOutputSchema,
    schema_name: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    client_request_id: input.client_request_id,
    timeout_ms: input.timeout_ms,
    metadata: {
      invocation_key: input.invocation_key,
      approved_execution_role: FORMATIVE_CONVERSATION_AGENT_NAME
    }
  });
}

export function createLiveFormativeConversationV18AgentRunner(): FormativeConversationV18AgentRunner {
  try {
    const runtime = getLlmRuntimeConfig();
    if (
      runtime.provider !== "openai" ||
      !runtime.live_calls_enabled ||
      !resolveOperationalRoleLiveCallsEnabled("formative_conversation_agent")
    ) {
      throw new FormativeConversationUnavailableError(
        "formative_conversation_live_runtime_not_ready"
      );
    }
    const modelConfig = resolveOpenAIModelConfigForRole(
      "formative_conversation_agent"
    );
    const provider = createLlmProvider();

    return {
      identity: {
        agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
        agent_version: "formative-conversation-runtime-v3",
        model_name: modelConfig.model_name,
        provider: "openai",
        prompt_version: FORMATIVE_CONVERSATION_V18_PROMPT_VERSION,
        schema_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
        prompt_hash: FORMATIVE_CONVERSATION_V18_PROMPT_HASH,
        reasoning_effort: modelConfig.reasoning_effort ?? null,
        max_output_tokens: modelConfig.max_output_tokens ?? null,
        live_call_allowed: true
      },
      async execute({ invocation_key, context }) {
        const clientRequestId = `${FORMATIVE_CONVERSATION_AGENT_NAME}:${randomUUID()}`;
        const baseRequest = buildFormativeConversationV18ProductionRequest({
          context,
          model_config: modelConfig,
          client_request_id: clientRequestId,
          timeout_ms: runtime.request_timeout_ms,
          invocation_key
        });
        const semanticExecution = await executeFormativeConversationV18({
          base_request: baseRequest,
          validate_candidate(output) {
            const validation = validateFormativeConversationV18CandidateAcceptance({
              candidate: output,
              context
            });
            return {
              valid: validation.valid,
              validation_status: validation.validation_status,
              validation_issue_paths: validation.validation_issue_paths
            };
          },
          async execute_logical_generation({ sequence, kind, request }) {
            assertNoRawStudentIdentifiersInProviderPayload({
              input: request.input,
              metadata: request.metadata ?? null
            });
            const logicalCallId = `${invocation_key}:generation:${sequence}:${kind}`;
            const canonicalRequestHash = canonicalStructuredAgentRequestHash(request);
            const transport = await executeWithBoundedProviderTransportRetry({
              provider,
              request,
              logical_call_id: logicalCallId,
              source_binding_hash: createHash("sha256")
                .update(`${invocation_key}:${context.conversation_public_id}`)
                .digest("hex"),
              expected_canonical_request_hash: canonicalRequestHash,
              logical_idempotency_key: logicalCallId,
              accept_result: (result) =>
                result.status === "completed" &&
                result.parsed_output !== undefined
            });
            return logicalExecutionFromTransport({ request, transport });
          }
        });
        const result = semanticExecution.result;
        const accepted = validateFormativeConversationV18CandidateAcceptance({
          candidate: result.parsed_output,
          context
        });
        if (!accepted.valid || !accepted.output) {
          throw new Error(
            "formative_conversation_v18_accepted_candidate_projection_invalid"
          );
        }
        const execution: FormativeConversationAgentExecution = {
          output: accepted.output,
          raw_output: {
            accepted_output: result.raw_output,
            provider_execution_audit: semanticExecution.audit
          },
          provider_execution_audit: semanticExecution.audit,
          generation_source: "live_llm",
          provider_request_id:
            result.provider_request_id ??
            result.transport_telemetry?.provider_request_id ??
            null,
          provider_response_id:
            result.provider_response_id ??
            result.transport_telemetry?.provider_response_id ??
            null,
          client_request_id: result.client_request_id,
          retry_count: semanticExecution.audit.transport_retries,
          latency_ms: semanticExecution.latency_ms,
          input_tokens: semanticExecution.input_tokens,
          output_tokens: semanticExecution.output_tokens,
          total_tokens: semanticExecution.total_tokens,
          estimated_cost: null,
          started_at: semanticExecution.started_at,
          completed_at: semanticExecution.completed_at
        };
        return execution;
      }
    };
  } catch (error) {
    const unavailable = formativeConversationUnavailableFromConfiguration(error);
    if (unavailable) {
      throw unavailable;
    }
    throw error;
  }
}
