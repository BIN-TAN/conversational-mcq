import type { ChatNativeAssessmentState } from "@/lib/student-assessment/state-machine";

export const INITIAL_ADMIN_PROMPT_GENERATOR_VERSION = "initial-admin-prompt-generator-v1";

export type InitialAdminRequiredEvidence =
  | "answer"
  | "reasoning"
  | "confidence"
  | "tempting_option"
  | "tempting_reason"
  | "package_review"
  | "edit"
  | "repair"
  | "procedural_clarification";

export type InitialAdminPromptKind =
  | "answer_prompt"
  | "reasoning_prompt"
  | "confidence_prompt"
  | "tempting_option_prompt"
  | "tempting_reason_prompt"
  | "package_review_prompt"
  | "repair_prompt"
  | "edit_prompt"
  | "uncertainty_acknowledgement"
  | "procedural_clarification";

export type InitialAdminPromptPacket = {
  assessment_state: ChatNativeAssessmentState;
  item_public_id: string | null;
  item_role: "initial" | "transfer";
  required_evidence_type: InitialAdminRequiredEvidence;
  latest_student_response: string | null;
  selected_option: string | null;
  selected_e_option: boolean;
  indicated_unknown: boolean;
  correctness_feedback_prohibited: true;
  allowed_behavior: string[];
  disallowed_behavior: string[];
};

export type InitialAdminPromptResult = {
  prompt_text: string;
  prompt_kind: InitialAdminPromptKind;
  prompt_variant: string;
  generator_version: typeof INITIAL_ADMIN_PROMPT_GENERATOR_VERSION;
  generation_mode: "deterministic_mock";
  state_packet: InitialAdminPromptPacket;
};

type PromptItem = {
  item_public_id?: string | null;
  item_order: number;
  item_stem: string;
  options: Array<{ label: string; text: string }>;
};

const IDK_OPTION_LABEL = "E";
const IDK_OPTION_TEXT = "I don't know yet.";

const ANSWER_PROMPTS = [
  "Which option would you choose?",
  "What is your answer for this one?",
  "Pick the option that seems best to you.",
  "Choose the option that best matches your current thinking. You can also choose E if you do not know yet."
];

const REASONING_PROMPTS = [
  "What led you to choose {option}? Please explain your reasoning with as much detail as you can.",
  "Why did {option} seem best to you? Try to include detail about the idea or part of the question that shaped your choice.",
  "Give your reason for choosing {option}. The more detail you provide, the more useful my feedback can be.",
  "One or two sentences is enough, but include the detail that mattered most. Why did {option} seem best?"
];

const TEMPTING_PROMPTS = [
  "Was there another option you almost chose? If yes, which one, and why?",
  "Did any other option seem plausible? You can name it, explain briefly, or say No.",
  "Was another option tempting? What made it tempting?"
];

const TEMPTING_REASON_PROMPTS = [
  "What made that option seem tempting?",
  "What about that option almost pulled you toward it?",
  "Say briefly why that option seemed plausible."
];

function deterministicIndex(seed: string, length: number) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return length === 0 ? 0 : hash % length;
}

export function studentIndicatedReasoningUncertainty(text: string | null | undefined) {
  const lower = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  return (
    /\bi\s*(do not|don't|dont)\s+know\b/.test(lower) ||
    /\bnot\s+sure\s+why\b/.test(lower) ||
    /\bunsure\s+about\s+the\s+reason\b/.test(lower) ||
    /\bi(?:\s+am|'m)\s+(confused|lost|stuck|unsure)\b/.test(lower) ||
    /\bthis\s+is\s+(hard|confusing)\b/.test(lower) ||
    /\bno\s+idea\b/.test(lower) ||
    /\bidk\b/.test(lower)
  );
}

function requiredEvidenceForKind(kind: InitialAdminPromptKind): InitialAdminRequiredEvidence {
  if (kind === "answer_prompt") {
    return "answer";
  }

  if (kind === "reasoning_prompt") {
    return "reasoning";
  }

  if (kind === "confidence_prompt") {
    return "confidence";
  }

  if (kind === "tempting_option_prompt") {
    return "tempting_option";
  }

  if (kind === "tempting_reason_prompt") {
    return "tempting_reason";
  }

  if (kind === "package_review_prompt") {
    return "package_review";
  }

  if (kind === "edit_prompt") {
    return "edit";
  }

  if (kind === "procedural_clarification") {
    return "procedural_clarification";
  }

  return "repair";
}

export function buildInitialAdminPrompt(input: {
  kind: InitialAdminPromptKind;
  assessmentState: ChatNativeAssessmentState;
  itemPublicId?: string | null;
  itemOrder?: number | null;
  itemRole?: "initial" | "transfer";
  selectedOption?: string | null;
  latestStudentResponse?: string | null;
  indicatedUnknown?: boolean;
}) {
  const selectedOption = input.selectedOption ?? null;
  const selectedE = selectedOption === IDK_OPTION_LABEL;
  const indicatedUnknown =
    selectedE || (input.indicatedUnknown ?? studentIndicatedReasoningUncertainty(input.latestStudentResponse));
  const seed = [
    input.kind,
    input.itemPublicId ?? "no-item",
    input.itemOrder ?? "no-order",
    selectedOption ?? "no-option"
  ].join(":");
  let promptText = "";
  let promptVariant = "default";

  if (input.kind === "answer_prompt") {
    const index =
      input.itemOrder && Number.isInteger(input.itemOrder)
        ? Math.abs(input.itemOrder - 1) % ANSWER_PROMPTS.length
        : deterministicIndex(seed, ANSWER_PROMPTS.length);
    promptText = ANSWER_PROMPTS[index] ?? ANSWER_PROMPTS[0];
    promptVariant = `answer_${index + 1}`;
  } else if (input.kind === "reasoning_prompt") {
    if (selectedE) {
      promptText =
        "That's okay. What makes this hard to decide? You do not need to invent a reason; this helps me understand what feedback may be useful later.";
      promptVariant = "reasoning_uncertainty";
    } else {
      const index = deterministicIndex(seed, REASONING_PROMPTS.length);
      promptText = (REASONING_PROMPTS[index] ?? REASONING_PROMPTS[0]).replace(
        "{option}",
        selectedOption ?? "that option"
      );
      promptVariant = `reasoning_${index + 1}`;
    }
  } else if (input.kind === "confidence_prompt") {
    if (selectedE) {
      promptText =
        "Since you indicated uncertainty, Low is a reasonable confidence choice, but choose the level that best matches how you feel right now.";
      promptVariant = "confidence_selected_e";
    } else if (indicatedUnknown) {
      promptText =
        "That's okay. I'll record that you are unsure about the reason. Low is a reasonable confidence choice, but choose the level that best matches how you feel right now.";
      promptVariant = "confidence_reason_uncertain";
    } else {
      promptText = "How confident are you: Low, Medium, or High?";
      promptVariant = "confidence_standard";
    }
  } else if (input.kind === "tempting_option_prompt") {
    const index = deterministicIndex(seed, TEMPTING_PROMPTS.length);
    promptText = TEMPTING_PROMPTS[index] ?? TEMPTING_PROMPTS[0];
    promptVariant = `tempting_${index + 1}`;
  } else if (input.kind === "tempting_reason_prompt") {
    const index = deterministicIndex(seed, TEMPTING_REASON_PROMPTS.length);
    promptText = TEMPTING_REASON_PROMPTS[index] ?? TEMPTING_REASON_PROMPTS[0];
    promptVariant = `tempting_reason_${index + 1}`;
  } else if (input.kind === "package_review_prompt") {
    promptText = "I have your three responses. You can review or edit them before continuing to feedback.";
    promptVariant = "package_review";
  } else if (input.kind === "edit_prompt") {
    promptText = "You can edit your latest response before continuing.";
    promptVariant = "edit";
  } else if (input.kind === "procedural_clarification") {
    promptText =
      "That is okay. For now, use the current prompt: choose an option, write a brief reason, or say you do not know yet.";
    promptVariant = "procedural_clarification";
  } else {
    promptText = indicatedUnknown
      ? "You do not need to invent a reason. I will record this as uncertainty."
      : "Please add a little more so I can record your current thinking.";
    promptVariant = indicatedUnknown ? "repair_uncertainty" : "repair_more";
  }

  const result: InitialAdminPromptResult = {
    prompt_text: promptText,
    prompt_kind: input.kind,
    prompt_variant: promptVariant,
    generator_version: INITIAL_ADMIN_PROMPT_GENERATOR_VERSION,
    generation_mode: "deterministic_mock",
    state_packet: {
      assessment_state: input.assessmentState,
      item_public_id: input.itemPublicId ?? null,
      item_role: input.itemRole ?? "initial",
      required_evidence_type: requiredEvidenceForKind(input.kind),
      latest_student_response: input.latestStudentResponse ?? null,
      selected_option: selectedOption,
      selected_e_option: selectedE,
      indicated_unknown: indicatedUnknown,
      correctness_feedback_prohibited: true,
      allowed_behavior: [
        "ask_for_required_evidence",
        "acknowledge_uncertainty",
        "give_procedural_clarification",
        "defer_content_help"
      ],
      disallowed_behavior: [
        "reveal_correctness",
        "reveal_answer_key",
        "give_content_hint",
        "change_state",
        "skip_required_evidence",
        "use_internal_labels"
      ]
    }
  };

  return result;
}

export function promptAuditPayload(prompt: InitialAdminPromptResult) {
  return {
    prompt_generation_source: prompt.generation_mode,
    prompt_generator_version: prompt.generator_version,
    prompt_kind: prompt.prompt_kind,
    prompt_variant: prompt.prompt_variant,
    prompt_state_packet: prompt.state_packet
  };
}

export function answerOptionsWithUncertainty(item: PromptItem) {
  return [
    ...item.options,
    {
      label: IDK_OPTION_LABEL,
      text: IDK_OPTION_TEXT
    }
  ];
}

export function formatInitialAdminItemMessage(input: {
  item: PromptItem;
  questionLabel: string;
  itemRole?: "initial" | "transfer";
}) {
  const prompt = buildInitialAdminPrompt({
    kind: "answer_prompt",
    assessmentState: input.itemRole === "transfer" ? "TRANSFER_ITEM" : "AWAIT_ANSWER",
    itemPublicId: input.item.item_public_id ?? null,
    itemOrder: input.item.item_order,
    itemRole: input.itemRole ?? "initial"
  });
  const options = answerOptionsWithUncertainty(input.item)
    .map((option) => `${option.label}. ${option.text}`)
    .join("\n");

  return [
    input.questionLabel,
    "",
    input.item.item_stem,
    "",
    options,
    "",
    prompt.prompt_text
  ].join("\n");
}
