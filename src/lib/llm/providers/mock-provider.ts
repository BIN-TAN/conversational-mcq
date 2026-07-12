import { randomUUID } from "node:crypto";
import { AgentName } from "@/lib/agents/names";
import { mockOutputForAgent } from "@/lib/agents/mock-fixtures";
import type {
  LlmProvider,
  SanitizedAgentError,
  StructuredAgentRequest,
  StructuredAgentResult
} from "./types";

export type MockProviderMode =
  | "success"
  | "refusal"
  | "incomplete"
  | "transient_error"
  | "permanent_error"
  | "invalid_output"
  | "item_verification_no_warnings"
  | "item_verification_warning"
  | "item_verification_concept_misalignment"
  | "item_verification_learning_objective_misalignment"
  | "item_verification_ambiguous_stem"
  | "item_verification_multiple_correct_answers"
  | "item_verification_answer_key_inconsistency"
  | "item_verification_weak_distractor"
  | "item_verification_overlapping_options"
  | "item_verification_answer_cue"
  | "item_verification_duplicate_items"
  | "item_verification_insufficient_information"
  | "item_verification_invalid_rewrite"
  | "item_verification_invalid_option"
  | "item_verification_invalid_generated_option"
  | "planning_mapping_deviation"
  | "planning_bad_mapping_deviation"
  | "planning_contradictory_mapping"
  | "followup_opening"
  | "followup_reasoning_refinement"
  | "followup_diagnostic_clarification"
  | "followup_confidence_calibration"
  | "followup_independent_verification"
  | "followup_consolidation_transfer"
  | "followup_off_topic"
  | "followup_prompt_injection"
  | "followup_evidence_trigger"
  | "followup_move_on_offer"
  | "followup_bad_target_formative_value"
  | "response_collection_reasoning"
  | "response_collection_help_request"
  | "response_collection_prompt_injection"
  | "timeout";

const attemptsByRequest = new Map<string, number>();

function failedResult<TOutput>(
  request: StructuredAgentRequest<unknown, TOutput>,
  error: SanitizedAgentError,
  startedAt: number
): StructuredAgentResult<TOutput> {
  return {
    provider: "mock",
    client_request_id: request.client_request_id,
    provider_request_id: `mock_req_${randomUUID()}`,
    provider_response_id: `mock_resp_${randomUUID()}`,
    status: "failed",
    raw_output: { mock_error: error.category },
    latency_ms: Date.now() - startedAt,
    error
  };
}

export class MockLlmProvider implements LlmProvider {
  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const startedAt = Date.now();
    const mode = (request.metadata?.mock_mode ?? "success") as MockProviderMode;
    const attempt = (attemptsByRequest.get(request.client_request_id) ?? 0) + 1;
    attemptsByRequest.set(request.client_request_id, attempt);

    if (mode === "refusal") {
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "refused",
        refusal: "Mock refusal.",
        raw_output: { refusal: "Mock refusal." },
        latency_ms: Date.now() - startedAt
      };
    }

    if (mode === "incomplete") {
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "incomplete",
        incomplete_reason: "mock_incomplete",
        raw_output: { incomplete_reason: "mock_incomplete" },
        latency_ms: Date.now() - startedAt
      };
    }

    if (mode === "permanent_error") {
      return failedResult(
        request,
        {
          category: "invalid_request",
          message: "Mock permanent provider error.",
          retryable: false
        },
        startedAt
      );
    }

    if (mode === "timeout") {
      return failedResult(
        request,
        {
          category: "timeout",
          message: "Mock timeout.",
          retryable: true
        },
        startedAt
      );
    }

    if (mode === "transient_error") {
      const failuresBeforeSuccess = Number(
        request.metadata?.mock_transient_failures_before_success ?? 1
      );

      if (attempt <= failuresBeforeSuccess) {
        return failedResult(
          request,
          {
            category: "rate_limit",
            message: "Mock transient provider error.",
            retryable: true
          },
          startedAt
        );
      }
    }

    if (mode === "invalid_output") {
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "completed",
        parsed_output: {
          agent_name: request.agent_name,
          status: "old_field_should_not_validate"
        } as unknown as TOutput,
        raw_output: {
          agent_name: request.agent_name,
          status: "old_field_should_not_validate"
        },
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          raw: { mock: true }
        },
        latency_ms: Date.now() - startedAt
      };
    }

    if (request.agent_name === "item_verification_agent") {
      const input = request.input as {
        items?: Array<{ item_public_id: string; options?: Array<{ label: string }> }>;
      };
      const firstItemPublicId = input.items?.[0]?.item_public_id ?? "mock-item-1";
      const firstOptionLabel = input.items?.[0]?.options?.[1]?.label ?? "B";
      const baseOutput = {
        agent_name: request.agent_name,
        agent_version: "7d-draft",
        prompt_version: "mock-item-verification-v1",
        schema_version: "mock-item-verification-output-v1",
        output_status: "ok",
        warnings: [
          "Mock provider output for infrastructure testing only; not a validated item-quality judgment."
        ],
        verification_status: "verified_no_warnings",
        set_level_findings: [],
        item_results: (input.items ?? []).map((item) => ({
          item_public_id: item.item_public_id,
          findings: [],
          teacher_review_required: false
        })),
        teacher_review_required: false
      } as Record<string, unknown>;

      const warningByMode: Partial<Record<MockProviderMode, {
        issue_code: string;
        location: string;
        option_label?: string;
        brief_explanation: string;
        set_level?: boolean;
      }>> = {
        item_verification_warning: {
          issue_code: "possible_ambiguity",
          location: "item_stem",
          brief_explanation:
            "The wording in the stem may allow more than one interpretation."
        },
        item_verification_concept_misalignment: {
          issue_code: "possible_concept_misalignment",
          location: "item_stem",
          brief_explanation:
            "The item may not directly target the teacher-defined concept."
        },
        item_verification_learning_objective_misalignment: {
          issue_code: "possible_learning_objective_misalignment",
          location: "item_stem",
          brief_explanation:
            "The item may not provide clear evidence for the stated learning objective."
        },
        item_verification_ambiguous_stem: {
          issue_code: "possible_ambiguity",
          location: "item_stem",
          brief_explanation:
            "The wording in the stem may allow more than one interpretation."
        },
        item_verification_multiple_correct_answers: {
          issue_code: "possible_multiple_correct_answers",
          location: "option",
          option_label: firstOptionLabel,
          brief_explanation:
            "More than one option may be reasonably defensible from the stem."
        },
        item_verification_answer_key_inconsistency: {
          issue_code: "possible_answer_key_inconsistency",
          location: "correct_option",
          brief_explanation:
            "The teacher-selected correct option may not align with the stem and options."
        },
        item_verification_weak_distractor: {
          issue_code: "weak_or_implausible_distractor",
          location: "distractor_rationale",
          option_label: firstOptionLabel,
          brief_explanation:
            "A distractor may be too implausible to provide useful diagnostic evidence."
        },
        item_verification_overlapping_options: {
          issue_code: "overlapping_or_indistinguishable_options",
          location: "option",
          option_label: firstOptionLabel,
          brief_explanation:
            "Two options may be difficult to distinguish based on the stem."
        },
        item_verification_answer_cue: {
          issue_code: "possible_answer_cue",
          location: "item_stem",
          brief_explanation:
            "The stem or option pattern may contain an unintended cue."
        },
        item_verification_duplicate_items: {
          issue_code: "substantially_duplicate_item",
          location: "item_set",
          brief_explanation:
            "Two items in the set may ask for substantially the same evidence.",
          set_level: true
        },
        item_verification_insufficient_information: {
          issue_code: "insufficient_information_to_verify",
          location: "concept_unit",
          brief_explanation:
            "The supplied concept metadata may be insufficient for semantic verification.",
          set_level: true
        }
      };

      if (mode === "item_verification_invalid_rewrite") {
        baseOutput.verification_status = "verified_with_warnings";
        baseOutput.item_results = [
          {
            item_public_id: firstItemPublicId,
            findings: [
              {
                issue_code: "possible_ambiguity",
                item_public_id: firstItemPublicId,
                location: "item_stem",
                option_label: null,
                brief_explanation: "Rewrite as: this is a prohibited replacement wording."
              }
            ],
            teacher_review_required: true
          }
        ];
        baseOutput.teacher_review_required = true;
      } else if (
        mode === "item_verification_invalid_option" ||
        mode === "item_verification_invalid_generated_option"
      ) {
        baseOutput.verification_status = "verified_with_warnings";
        baseOutput.item_results = [
          {
            item_public_id: firstItemPublicId,
            findings: [
              {
                issue_code: "weak_or_implausible_distractor",
                item_public_id: firstItemPublicId,
                location: "option",
                option_label: firstOptionLabel,
                brief_explanation: "Replace with a generated option, which is not allowed."
              }
            ],
            teacher_review_required: true
          }
        ];
        baseOutput.teacher_review_required = true;
      } else if (warningByMode[mode]) {
        const warning = warningByMode[mode]!;
        const finding = {
          issue_code: warning.issue_code,
          item_public_id: warning.set_level ? null : firstItemPublicId,
          location: warning.location,
          option_label: warning.option_label ?? null,
          brief_explanation: warning.brief_explanation
        };

        baseOutput.verification_status =
          mode === "item_verification_insufficient_information"
            ? "unable_to_verify"
            : "verified_with_warnings";
        baseOutput.set_level_findings = warning.set_level ? [finding] : [];
        baseOutput.item_results = warning.set_level
          ? baseOutput.item_results
          : [
              {
                item_public_id: firstItemPublicId,
                findings: [finding],
                teacher_review_required: true
              }
            ];
        baseOutput.teacher_review_required = true;
      }

      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "completed",
        parsed_output: baseOutput as TOutput,
        raw_output: baseOutput,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          raw: { mock: true }
        },
        latency_ms: Date.now() - startedAt
      };
    }

    if (
      request.agent_name === "formative_value_and_planning_agent" &&
      (mode === "planning_mapping_deviation" ||
        mode === "planning_bad_mapping_deviation" ||
        mode === "planning_contradictory_mapping")
    ) {
      const output = {
        agent_name: request.agent_name,
        agent_version: "6a-draft",
        prompt_version: "mock-prompt-v1",
        schema_version: "mock-schema-v1",
        output_status: "ok",
        warnings: [
          "Mock provider output for infrastructure testing only; not validated educational guidance."
        ],
        formative_value: "reasoning_refinement",
        formative_action_plan:
          "Mock plan only. Ask the future Follow-up Agent to request a short explanation that connects the selected option to the key concept.",
        target_evidence: [
          "Student can explain why the selected option follows from the concept evidence."
        ],
        success_criteria: [
          "Student gives a concept-linked reason without relying only on option wording."
        ],
        followup_prompt_constraints: [
          "Do not reveal correctness.",
          "Ask for reasoning evidence only; do not tutor."
        ],
        profile_update_triggers: [
          "Update profile only if new reasoning substantially clarifies the integrated diagnostic profile."
        ],
        rationale:
          "Mock deviation fixture. The selected value differs from the default because the provided evidence suggests a reasoning-focused next step would be more informative.",
        mapping_followed: mode === "planning_contradictory_mapping",
        mapping_deviation_reason:
          mode === "planning_bad_mapping_deviation"
            ? ""
            : "The default mapping points to diagnostic clarification, but the evidence in this synthetic fixture already identifies the diagnostic issue and needs reasoning refinement."
      } as unknown as TOutput;

      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "completed",
        parsed_output: output,
        raw_output: output,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          raw: { mock: true }
        },
        latency_ms: Date.now() - startedAt
      };
    }

    if (request.agent_name === "followup_agent") {
      const input = request.input as Record<string, unknown>;
      const decision = input.latest_formative_decision as Record<string, unknown> | undefined;
      const studentMessage =
        typeof input.student_message === "string" ? input.student_message : "";
      const targetFormativeValue =
        typeof decision?.formative_value === "string"
          ? decision.formative_value
          : "diagnostic_clarification";
      const badTarget =
        targetFormativeValue === "diagnostic_clarification"
          ? "reasoning_refinement"
          : "diagnostic_clarification";
      const modeToAction: Record<string, string> = {
        followup_reasoning_refinement: "reasoning_refinement_prompt",
        followup_diagnostic_clarification: "clarification_prompt",
        followup_confidence_calibration: "confidence_calibration_prompt",
        followup_independent_verification: "independent_verification_prompt",
        followup_consolidation_transfer: "transfer_task",
        followup_off_topic: "off_topic_redirect",
        followup_prompt_injection: "off_topic_redirect",
        followup_evidence_trigger: "clarification_prompt",
        followup_move_on_offer: "move_on_offer"
      };
      const action = modeToAction[mode] ?? "clarification_prompt";
      const opening = input.turn_type === "opening";
      const lowerStudentMessage = studentMessage.toLowerCase();
      const nonsubstantive =
        opening ||
        mode === "followup_off_topic" ||
        mode === "followup_prompt_injection" ||
        /^(ok|okay|thanks|thank you|idk|i don't know|not sure)\.?$/.test(
          lowerStudentMessage.trim()
        );
      const evidenceTriggerReasons = opening
        ? []
        : mode === "followup_move_on_offer" || /\b(move on|next|done|finished)\b/.test(lowerStudentMessage)
          ? ["move_on_request"]
          : mode === "followup_consolidation_transfer" || /\b(apply|another case|transfer)\b/.test(lowerStudentMessage)
            ? ["transfer_application"]
            : mode === "followup_reasoning_refinement" || /\b(revise|changed my reasoning|now i think)\b/.test(lowerStudentMessage)
              ? ["reasoning_revision"]
              : mode === "followup_evidence_trigger"
                ? ["substantive_explanation"]
                : nonsubstantive
                  ? []
                  : ["substantive_explanation"];
      const studentTurnSubstantive =
        evidenceTriggerReasons.length > 0 && !evidenceTriggerReasons.every((reason) => reason === "move_on_request");
      const output = {
        agent_name: request.agent_name,
        agent_version: "6d2b-draft",
        prompt_version: "mock-followup-v3",
        schema_version: "mock-followup-output-v3",
        output_status: "ok",
        warnings: [
          "Mock provider output for infrastructure testing only; not validated formative guidance."
        ],
        assistant_message: opening
          ? "Let's look at your thinking for this concept together. Start by explaining what part of the question felt most important to your choice."
          : mode === "followup_off_topic"
            ? "Let's bring this back to the concept we are working on. What part of the original idea can you explain in your own words?"
            : mode === "followup_prompt_injection"
              ? "I can only continue with this learning conversation. Please describe your reasoning about the concept in your own words."
              : `Thanks for your response${studentMessage ? `: "${studentMessage.slice(0, 80)}"` : ""}. What evidence from the concept supports that thinking?`,
        followup_action_type: action,
        target_formative_value:
          mode === "followup_bad_target_formative_value" ? badTarget : targetFormativeValue,
        evidence_request:
          mode === "followup_move_on_offer"
            ? null
            : "Explain the reasoning evidence that supports your current thinking.",
        expects_student_response: mode !== "followup_move_on_offer",
        evidence_trigger_candidate:
          mode === "followup_evidence_trigger" || mode === "followup_move_on_offer",
        student_turn_substantive: studentTurnSubstantive,
        evidence_trigger_reasons: evidenceTriggerReasons,
        should_offer_move_on: mode === "followup_move_on_offer",
        off_topic_detected: mode === "followup_off_topic" || mode === "followup_prompt_injection",
        events_to_log:
          mode === "followup_off_topic"
            ? [
                {
	                  event_type: "off_topic_followup",
	                  event_category: "followup",
	                  event_source: "agent",
	                  payload: {
	                    detail: "Mock off-topic follow-up redirect.",
	                    reason: null,
	                    item_public_id: null,
	                    followup_round_index: null,
	                    event_count: null
	                  }
                }
              ]
            : mode === "followup_prompt_injection"
              ? [
                  {
	                    event_type: "prompt_injection_attempt",
	                    event_category: "followup",
	                    event_source: "agent",
	                    payload: {
	                      detail: "Mock prompt-injection redirect.",
	                      reason: null,
	                      item_public_id: null,
	                      followup_round_index: null,
	                      event_count: null
	                    }
                  }
                ]
              : mode === "followup_evidence_trigger"
                ? [
                    {
	                      event_type: "followup_task_assigned",
	                      event_category: "followup",
	                      event_source: "agent",
	                      payload: {
	                        detail: "Mock follow-up evidence task.",
	                        reason: null,
	                        item_public_id: null,
	                        followup_round_index: null,
	                        event_count: null
	                      }
                    }
                  ]
                : []
      } as unknown as TOutput;

      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "completed",
        parsed_output: output,
        raw_output: output,
        usage: {
          input_tokens: 12,
          output_tokens: 24,
          total_tokens: 36,
          raw: { mock: true }
        },
        latency_ms: Date.now() - startedAt
      };
    }

    const knownAgent = AgentName.safeParse(request.agent_name);
    if (!knownAgent.success) {
      return {
        provider: "mock",
        client_request_id: request.client_request_id,
        provider_request_id: `mock_req_${randomUUID()}`,
        provider_response_id: `mock_resp_${randomUUID()}`,
        status: "completed",
        parsed_output: {
          agent_name: request.agent_name,
          output_status: "ok",
          warnings: ["Generic mock output for a custom provider-facing agent."]
        } as unknown as TOutput,
        raw_output: {
          agent_name: request.agent_name,
          output_status: "ok",
          warnings: ["Generic mock output for a custom provider-facing agent."]
        },
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          raw: { mock: true }
        },
        latency_ms: Date.now() - startedAt
      };
    }

    const output = mockOutputForAgent(knownAgent.data) as Record<string, unknown>;

    if (request.agent_name === "response_collection_agent") {
      const input = request.input as Record<string, unknown>;
      const message = typeof input.student_message === "string" ? input.student_message : "";
      const lower = message.toLowerCase();
      const helpRequested =
        mode === "response_collection_help_request" ||
        /\b(correct|answer|hint|explain|explanation|help me solve|which option|tell me)\b/.test(lower);
      const promptInjection =
        mode === "response_collection_prompt_injection" ||
        /\b(ignore (the )?(rules|instructions)|system prompt|developer message|jailbreak)\b/.test(lower);
      const optionText = /\b(i choose|my answer is|answer is|option)\s+[a-f]\b/i.test(message);
      const confidenceText = /\b(low|medium|high)\s+confidence\b/i.test(message);
      const helpBoundary = (() => {
        const patterns = [
          /\bam i\b/i,
          /\bcan you\b/i,
          /\btell me\b/i,
          /\bwhat is\b/i,
          /\bwhich option\b/i,
          /\bgive me\b/i,
          /\bhint\b/i,
          /\bexplain\b/i,
          /\bcorrect\b/i
        ];
        const indexes = patterns
          .map((pattern) => pattern.exec(message)?.index ?? -1)
          .filter((index) => index > 0);

        return indexes.length ? Math.min(...indexes) : -1;
      })();
      const reasoningCandidate =
        helpBoundary > 0 ? message.slice(0, helpBoundary).trim().replace(/[.!?]\s*$/, ".") : message.trim();
      const reasoningSegment =
        !promptInjection && reasoningCandidate.length > 0 && !/^(am i|can you|tell me|what is|which option|hint|explain|correct)\b/i.test(reasoningCandidate)
          ? reasoningCandidate
          : "";

      output.agent_version = "7c-draft";
      output.prompt_version = "mock-response-collection-v2";
      output.schema_version = "mock-response-collection-output-v2";
      output.assistant_message = helpRequested || promptInjection
        ? "I can't provide hints, explanations, answer checks, or answer choices during the initial questions. Use the option buttons to choose an answer and the confidence buttons to report confidence."
        : reasoningSegment
          ? "I saved the reasoning you provided. Use the option buttons to choose an answer and the confidence buttons to report confidence."
          : "Use the option buttons to choose an answer and the confidence buttons to report confidence.";
      output.blocked_content_help = helpRequested || promptInjection;
      output.recognized_intents = [
        ...(reasoningSegment ? ["reasoning_submission"] : []),
        ...(helpRequested || promptInjection ? ["invalid_help_request"] : []),
        ...(helpRequested && /\b(correct|incorrect|am i)\b/i.test(message) ? ["correctness_request"] : []),
        ...(helpRequested && /\bhint\b/i.test(message) ? ["hint_request"] : []),
        ...(helpRequested && /\b(explain|explanation)\b/i.test(message) ? ["explanation_request"] : []),
        ...(promptInjection ? ["prompt_injection_attempt"] : []),
        ...(optionText ? ["reasoning_submission"] : []),
        ...(confidenceText ? ["procedural_clarification"] : []),
        ...(!reasoningSegment && !helpRequested && !promptInjection ? ["unclear"] : [])
      ];
      output.reasoning_capture_status = reasoningSegment ? "new_reasoning" : "none";
      output.reasoning_evidence_segments = reasoningSegment ? [reasoningSegment] : [];
      {
        const missingState = input.missing_evidence_state as Record<string, unknown> | undefined;
        const rawMissingFields = Array.isArray(missingState?.missing_fields)
          ? missingState.missing_fields
          : Array.isArray(missingState?.missing)
            ? missingState.missing
            : [];
        const missingFields = rawMissingFields
          .filter((field): field is string => typeof field === "string")
          .map((field) => {
            const normalized = field.trim().toLowerCase();

            if (["option", "selected_option", "selected option"].includes(normalized)) {
              return "answer";
            }

            if (["confidence_rating", "confidence rating"].includes(normalized)) {
              return "confidence";
            }

            if (["reasoning_text", "reasoning text"].includes(normalized)) {
              return "reasoning";
            }

            return normalized;
          });

        output.missing_evidence_status =
          missingFields.length === 0
            ? "complete"
            : missingFields.length > 1
              ? "multiple_missing_fields"
              : missingFields[0] === "answer"
                ? "missing_answer"
                : missingFields[0] === "reasoning"
                  ? "missing_reasoning"
                  : missingFields[0] === "confidence"
                    ? "missing_confidence"
                    : "multiple_missing_fields";
      }
      output.requires_option_button = optionText;
      output.requires_confidence_control = confidenceText;
      output.requested_control_action = /\b(save|exit)\b/i.test(message)
        ? "save_and_exit"
        : /\bskip\b/i.test(message)
          ? "skip_item"
          : "none";
      output.recommended_interaction_outcome =
        output.requested_control_action === "save_and_exit"
          ? "offer_save_and_exit"
          : output.requested_control_action === "skip_item"
            ? "offer_skip"
            : "stay_current_step";
      output.events_to_log = [
        ...(helpRequested
          ? [
              {
	                event_type: "invalid_help_request",
	                event_category: "initial_administration",
	                event_source: "agent",
	                payload: {
	                  detail: "Mock invalid help request.",
	                  reason: null,
	                  item_public_id: null,
	                  followup_round_index: null,
	                  event_count: null
	                }
              }
            ]
          : []),
        ...(promptInjection
          ? [
              {
	                event_type: "invalid_help_request",
	                event_category: "initial_administration",
	                event_source: "agent",
	                payload: {
	                  detail: "Mock prompt injection invalid help request.",
	                  reason: null,
	                  item_public_id: null,
	                  followup_round_index: null,
	                  event_count: null
	                }
	              },
	              {
	                event_type: "prompt_injection_attempt",
	                event_category: "initial_administration",
	                event_source: "agent",
	                payload: {
	                  detail: "Mock prompt injection attempt.",
	                  reason: null,
	                  item_public_id: null,
	                  followup_round_index: null,
	                  event_count: null
	                }
	              }
            ]
          : [])
      ];
    }

    if (request.agent_name === "student_profiling_agent") {
      const input = request.input as Record<string, unknown>;

      if (input.profile_type === "updated") {
        output.profile_type = "updated";
        output.integrated_profile_rationale =
          "Mock updated output only. Follow-up evidence was included to exercise iterative profile updating infrastructure.";
        output.reasoning_quality_summary =
          "Mock updated output only. Follow-up transcript evidence is treated as additional evidence, not a direct proof of ability.";
        output.engagement_summary =
          "Mock updated output only. Follow-up participation is contextual engagement evidence, not misconduct evidence.";
        output.rationale = "Mock updated provider fixture for Phase 6D2B infrastructure testing.";
      }
    }

    return {
      provider: "mock",
      client_request_id: request.client_request_id,
      provider_request_id: `mock_req_${randomUUID()}`,
      provider_response_id: `mock_resp_${randomUUID()}`,
      status: "completed",
      parsed_output: output as unknown as TOutput,
      raw_output: output,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        raw: { mock: true }
      },
      latency_ms: Date.now() - startedAt
    };
  }
}
