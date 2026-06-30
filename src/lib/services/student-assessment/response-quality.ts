import { createHash } from "node:crypto";
import { z } from "zod";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { getLlmRuntimeConfig, resolveAgentModelConfig } from "@/lib/llm/config";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";

export const ResponseQualitySchema = z.enum([
  "adequate",
  "insufficient_knowledge",
  "incomplete",
  "too_short",
  "off_topic",
  "gibberish",
  "clarification_question",
  "content_question",
  "answer_request",
  "edit_request"
]);
export const ResponseQualityEngagementSignalSchema = z.enum([
  "active",
  "passive",
  "confused",
  "disengaged",
  "unclear"
]);
export const ResponseQualityReasoningSignalSchema = z.enum([
  "usable",
  "weak_but_usable",
  "not_usable",
  "not_applicable"
]);
export const ResponseQualityNextActionSchema = z.enum([
  "continue",
  "ask_for_more_reasoning",
  "answer_clarification",
  "defer_content_help",
  "edit_previous_response",
  "stay_on_current_step"
]);

export const ResponseQualityOutputSchema = z.object({
  response_quality: ResponseQualitySchema,
  should_advance: z.boolean(),
  engagement_signal: ResponseQualityEngagementSignalSchema,
  reasoning_signal: ResponseQualityReasoningSignalSchema,
  student_facing_message: z.string().trim().min(1).max(500),
  next_expected_action: ResponseQualityNextActionSchema
}).strict();

export type ResponseQualityOutput = z.infer<typeof ResponseQualityOutputSchema>;
export type ResponseQualityStage =
  | "initial_item_reasoning"
  | "initial_tempting_reason"
  | "transfer_item_reasoning"
  | "transfer_tempting_reason"
  | "formative_activity_response"
  | "revision_response";

export type ResponseQualityResult = {
  output: ResponseQualityOutput;
  source: "deterministic_mock" | "llm" | "llm_fallback_to_deterministic";
  validation_status: "validated" | "deterministic" | "fallback_after_provider_failure";
  provider: "mock" | "openai";
  prompt_hash: string;
  schema_version: typeof RESPONSE_QUALITY_SCHEMA_VERSION;
  detected_response_language: DetectedResponseLanguage;
};

export const RESPONSE_QUALITY_SCHEMA_VERSION = "chat-native-response-quality-v1";
export const RESPONSE_QUALITY_PROMPT_VERSION = "chat-native-response-quality-v1";
export type DetectedResponseLanguage = "english" | "chinese" | "mixed" | "unclear";

const RESPONSE_QUALITY_INSTRUCTIONS = `
Evaluate only whether the student's latest free-text response is usable for the current app-owned assessment step.
The application owns state transitions. Do not provide correctness, hints, answer keys, distractor rationales, or internal labels.
Return only the required JSON schema.

	Initial item rules:
	- adequate or weak but usable reasoning may advance;
	- too short, incomplete, off-topic, or gibberish responses should not advance;
	- content help or answer requests before the first three-item package should be deferred;
	- edit requests should be identified without changing state.
	- Students may reason in English, Chinese, or mixed English-Chinese. Do not classify meaningful multilingual text as gibberish solely because it is not English.
	- If multilingual meaning is unclear, ask for clarification without requiring translation.

Formative/revision rules:
- unusable, off-topic, or gibberish text should not be praised and should not advance;
- clarification questions may receive a short procedural clarification and re-ask the activity.
`;

export const RESPONSE_QUALITY_PROMPT_HASH = createHash("sha256")
  .update(RESPONSE_QUALITY_INSTRUCTIONS)
  .digest("hex");

const CONTENT_DEFER_MESSAGE =
  "I can explain the concept after the three questions. For now, choose the option that seems best, or choose E if you do not know yet.";
const FORMATIVE_REPAIR_MESSAGE =
  "I could not use that response for the activity. Please answer the current question in your own words.";
const UNKNOWN_REASON_PATTERNS = [
  /\bi\s*(do not|don't|dont)\s+know\b/,
  /\bi\s*(do not|don't|dont)\s+know\s+(the\s+)?reason\b/,
  /\bnot\s+sure\s+why\b/,
  /\bi\s+cannot\s+explain\b/,
  /\bi\s+can't\s+explain\b/,
  /\bi(?:\s+am|'m)\s+(confused|lost|stuck|unsure)\b/,
  /\bthis\s+is\s+(hard|confusing)\b/,
  /\bi\s+(do not|don't|dont)\s+understand\s+(the\s+)?question\b/,
  /\bi\s*(am|'m)\s+not\s+sure\s+what\s+to\s+write\b/,
  /\bidk\b/,
  /\bno\s+idea\b/
];

function normalized(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

export function detectResponseLanguage(text: string): DetectedResponseLanguage {
  const hasChinese = /[\u3400-\u9fff]/u.test(text);
  const hasEnglish = /[A-Za-z]/.test(text);

  if (hasChinese && hasEnglish) {
    return "mixed";
  }

  if (hasChinese) {
    return "chinese";
  }

  if (hasEnglish) {
    return "english";
  }

  return "unclear";
}

function wordCount(text: string) {
  return normalized(text).split(" ").filter(Boolean).length;
}

function isEditRequest(lower: string) {
  return /\b(edit|change|revise|fix|redo|update)\b/.test(lower) &&
    /\b(answer|reason|reasoning|confidence|tempting|last|response)\b/.test(lower);
}

function asksForAnswer(lower: string) {
  return /\b(correct answer|what is correct|which one is right|tell me the answer|answer key)\b/.test(lower) ||
    /(正确答案|答案是什么|哪个.*(正确|对)|哪一个.*(正确|对))/.test(lower);
}

function asksQuestion(lower: string) {
  return lower.includes("?") ||
    lower.includes("？") ||
    /\b(can you|what does|how do i|what should i|explain|clarify)\b/.test(lower) ||
    /(什么|怎么|如何|解释|可以|能不能)/.test(lower);
}

function isContentQuestion(lower: string) {
  return (
    asksForAnswer(lower) ||
    (asksQuestion(lower) &&
      (/\b(theta|ability|difficulty|discrimination|parameter|irt|icc|information|slope|correct|answer)\b/.test(lower) ||
        /(能力|难度|区分度|参数|题目参数|项目参数|斜率|信息|正确|答案|量表|估计)/.test(lower)))
  );
}

function isProceduralQuestion(lower: string) {
  return asksQuestion(lower) &&
    (/\b(type|write|choose|click|select|do i need|how many|what should i do|format)\b/.test(lower) ||
      /(可以写中文|写几句|怎么写|格式|选择|点击)/.test(lower)) &&
    !isContentQuestion(lower);
}

function isOffTopic(lower: string) {
  return /\b(lunch|weather|movie|game|sports|song|pizza|vacation|unrelated|joke)\b/.test(lower);
}

function isInsufficientKnowledgeStatement(lower: string) {
  return UNKNOWN_REASON_PATTERNS.some((pattern) => pattern.test(lower)) ||
    /(不知道|不清楚|不确定|没想法|不会解释|没有理由)/.test(lower);
}

function isGibberish(text: string) {
  const lower = text.toLowerCase().trim();
  const compact = lower.replace(/[^a-z]/g, "");
  const compactHan = text.replace(/[^\u3400-\u9fff]/gu, "");

  if (compact.length >= 4 && /^([a-z])\1{3,}$/.test(compact)) {
    return true;
  }

  if (compactHan.length >= 4 && /^([\u3400-\u9fff])\1{3,}$/u.test(compactHan)) {
    return true;
  }

  if (/^[a-z]{4,12}$/.test(compact) && wordCount(text) === 1) {
    const knownSingleWords = new Set([
      "theta",
      "difficulty",
      "discrimination",
      "ability",
      "slope",
      "information",
      "precision",
      "guess",
      "unsure",
      "confused"
    ]);
    return !knownSingleWords.has(compact);
  }

  const vowelCount = (compact.match(/[aeiou]/g) ?? []).length;
  return compact.length >= 8 && vowelCount / Math.max(1, compact.length) < 0.15;
}

function hasMultilingualReasoningSignal(text: string) {
  return /(theta|irt|item|parameter|ability|difficulty|discrimination|scale|estimate|person|题目|项目|参数|能力|难度|区分度|量表|估计|人|学生|因为|所以|表示|属于|不变|比较)/i.test(text);
}

function stageIsInitial(stage: ResponseQualityStage) {
  return stage === "initial_item_reasoning" || stage === "initial_tempting_reason";
}

function stageIsTempting(stage: ResponseQualityStage) {
  return stage === "initial_tempting_reason" || stage === "transfer_tempting_reason";
}

function repairPrompt(input: {
  stage: ResponseQualityStage;
  selected_option?: string | null;
  quality: z.infer<typeof ResponseQualitySchema>;
}) {
  if (input.quality === "content_question" || input.quality === "answer_request") {
    return stageIsInitial(input.stage) ? CONTENT_DEFER_MESSAGE : "I can help with the process, but I cannot give the answer. Please respond in your own words.";
  }

  if (input.quality === "clarification_question") {
    return stageIsInitial(input.stage)
      ? "You can write one or two sentences. Try to explain what led you to your answer."
      : "Use your own words for the activity. I am looking for your current thinking, not a perfect answer.";
  }

  if (input.quality === "edit_request") {
    return "You can edit your latest response before continuing.";
  }

  if (input.stage === "formative_activity_response" || input.stage === "revision_response") {
    return FORMATIVE_REPAIR_MESSAGE;
  }

  if (stageIsTempting(input.stage)) {
    return "Please add what made that option seem tempting.";
  }

  return input.selected_option === "E"
    ? "Please add what makes this hard to decide."
    : `I could not use that as a response. What is your reason for choosing ${input.selected_option ?? "that option"}?`;
}

export function deterministicResponseQuality(input: {
  stage: ResponseQualityStage;
  text: string;
  selected_option?: string | null;
}): ResponseQualityOutput {
  const text = normalized(input.text);
  const lower = text.toLowerCase();
  const detectedLanguage = detectResponseLanguage(text);
  const words = wordCount(text);
  const multilingualMeaningful =
    (detectedLanguage === "chinese" || detectedLanguage === "mixed") &&
    hasMultilingualReasoningSignal(text) &&
    text.length >= 8;
  let quality: z.infer<typeof ResponseQualitySchema> = "adequate";
  let reasoningSignal: z.infer<typeof ResponseQualityReasoningSignalSchema> = "usable";
  let engagementSignal: z.infer<typeof ResponseQualityEngagementSignalSchema> = "active";

  if (isInsufficientKnowledgeStatement(lower)) {
    quality = "insufficient_knowledge";
    reasoningSignal = "weak_but_usable";
    engagementSignal = "confused";
  } else if (isEditRequest(lower)) {
    quality = "edit_request";
    reasoningSignal = "not_applicable";
  } else if (asksForAnswer(lower)) {
    quality = "answer_request";
    reasoningSignal = "not_usable";
    engagementSignal = "confused";
  } else if (isContentQuestion(lower)) {
    quality = "content_question";
    reasoningSignal = "not_usable";
    engagementSignal = "confused";
  } else if (isProceduralQuestion(lower)) {
    quality = "clarification_question";
    reasoningSignal = "not_applicable";
    engagementSignal = "active";
  } else if (isOffTopic(lower)) {
    quality = "off_topic";
    reasoningSignal = "not_usable";
    engagementSignal = "disengaged";
  } else if (multilingualMeaningful) {
    quality = text.length >= 18 ? "adequate" : "incomplete";
    reasoningSignal = text.length >= 18 ? "usable" : "weak_but_usable";
    engagementSignal = "active";
  } else if (isGibberish(text)) {
    quality = "gibberish";
    reasoningSignal = "not_usable";
    engagementSignal = "disengaged";
  } else if (words < 3 || text.length < 12) {
    quality = "too_short";
    reasoningSignal = "not_usable";
    engagementSignal = "passive";
  } else if (words < 6 || text.length < 32) {
    quality = "incomplete";
    reasoningSignal = "weak_but_usable";
    engagementSignal = "passive";
  }

  const shouldAdvance =
    quality === "adequate" ||
    quality === "insufficient_knowledge" ||
    reasoningSignal === "weak_but_usable";
  const nextExpectedAction: z.infer<typeof ResponseQualityNextActionSchema> = shouldAdvance
    ? "continue"
    : quality === "content_question" || quality === "answer_request"
      ? "defer_content_help"
      : quality === "clarification_question"
        ? "answer_clarification"
        : quality === "edit_request"
          ? "edit_previous_response"
          : "ask_for_more_reasoning";

  return {
    response_quality: quality,
    should_advance: shouldAdvance,
    engagement_signal: engagementSignal,
    reasoning_signal: reasoningSignal,
    student_facing_message: shouldAdvance
      ? "Thanks."
      : detectedLanguage !== "english" &&
          detectedLanguage !== "unclear" &&
          quality !== "content_question" &&
          quality !== "answer_request"
        ? "I may not have understood that clearly. Could you explain it another way?"
        : repairPrompt({
            stage: input.stage,
            selected_option: input.selected_option,
            quality
          }),
    next_expected_action: nextExpectedAction
  };
}

function liveQualityProviderInput(input: {
  stage: ResponseQualityStage;
  text: string;
  selected_option?: string | null;
  item_public_id?: string | null;
  item_stem?: string | null;
}) {
  return {
    task: "chat_native_response_quality_gate",
    stage: input.stage,
    student_text: input.text,
    selected_option: input.selected_option ?? null,
    item_context: input.item_public_id
      ? {
          item_public_id: input.item_public_id,
          item_stem: input.item_stem ?? null
        }
      : null,
    constraints: {
      app_controls_state_transitions: true,
      no_answer_keys: true,
      no_correctness_feedback: true,
      no_internal_labels_in_student_text: true,
      defer_initial_content_help: stageIsInitial(input.stage)
    }
  };
}

function normalizeLiveOutput(parsed: ResponseQualityOutput, fallback: ResponseQualityOutput) {
  if (parsed.should_advance && parsed.next_expected_action !== "continue") {
    return {
      ...parsed,
      should_advance: false,
      student_facing_message: parsed.student_facing_message || fallback.student_facing_message
    };
  }

  return parsed;
}

export async function evaluateResponseQuality(input: {
  stage: ResponseQualityStage;
  text: string;
  selected_option?: string | null;
  item_public_id?: string | null;
  item_stem?: string | null;
}): Promise<ResponseQualityResult> {
  const fallback = deterministicResponseQuality(input);
  const detectedLanguage = detectResponseLanguage(input.text);

  try {
    const runtime = getLlmRuntimeConfig();

    if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
      return {
        output: fallback,
        source: "deterministic_mock",
        validation_status: "deterministic",
        provider: "mock",
        prompt_hash: RESPONSE_QUALITY_PROMPT_HASH,
        schema_version: RESPONSE_QUALITY_SCHEMA_VERSION,
        detected_response_language: detectedLanguage
      };
    }

    const providerInput = liveQualityProviderInput(input);
    assertNoProhibitedProviderInput(providerInput);
    const provider = createLlmProvider();
    const modelConfig = resolveAgentModelConfig("response_collection_agent");
    const providerResult = await provider.executeStructured({
      agent_name: "response_collection_agent",
      model_config: modelConfig,
      instructions: RESPONSE_QUALITY_INSTRUCTIONS,
      input: providerInput,
      output_schema: ResponseQualityOutputSchema,
      schema_name: RESPONSE_QUALITY_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
      client_request_id: `response_quality_${Date.now()}`,
      timeout_ms: runtime.request_timeout_ms,
      metadata: {
        purpose: "chat_native_response_quality_gate",
        prompt_version: RESPONSE_QUALITY_PROMPT_VERSION,
        schema_version: RESPONSE_QUALITY_SCHEMA_VERSION
      }
    });

    if (providerResult.status === "completed") {
      const parsed = ResponseQualityOutputSchema.safeParse(providerResult.parsed_output);

      if (parsed.success) {
        return {
          output: normalizeLiveOutput(parsed.data, fallback),
          source: "llm",
          validation_status: "validated",
          provider: providerResult.provider,
          prompt_hash: RESPONSE_QUALITY_PROMPT_HASH,
          schema_version: RESPONSE_QUALITY_SCHEMA_VERSION,
          detected_response_language: detectedLanguage
        };
      }
    }
  } catch {
    // Configuration gaps or provider failures fall back to deterministic validation.
  }

  return {
    output: fallback,
    source: "llm_fallback_to_deterministic",
    validation_status: "fallback_after_provider_failure",
    provider: "mock",
    prompt_hash: RESPONSE_QUALITY_PROMPT_HASH,
    schema_version: RESPONSE_QUALITY_SCHEMA_VERSION,
    detected_response_language: detectedLanguage
  };
}

export function responseQualityAllowsAdvance(output: ResponseQualityOutput) {
  return (
    output.should_advance &&
    (output.response_quality === "adequate" ||
      output.response_quality === "insufficient_knowledge" ||
      output.reasoning_signal === "weak_but_usable")
  );
}

export function responseQualityAuditPayload(result: ResponseQualityResult): Record<string, unknown> {
  return redactForAudit({
    response_quality: result.output.response_quality,
    should_advance: result.output.should_advance,
    engagement_signal: result.output.engagement_signal,
    reasoning_signal: result.output.reasoning_signal,
    student_facing_message: result.output.student_facing_message,
    next_expected_action: result.output.next_expected_action,
    validation_status: result.validation_status,
    source: result.source,
    provider: result.provider,
    prompt_hash: result.prompt_hash,
    schema_version: result.schema_version,
    detected_response_language: result.detected_response_language
  }) as Record<string, unknown>;
}
