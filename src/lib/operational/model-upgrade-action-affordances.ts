import type {
  ModelUpgradeExpectedActionType,
  ModelUpgradeFixtureOutputContract
} from "@/lib/operational/model-upgrade-output-contracts";

export const MODEL_UPGRADE_ACTION_AFFORDANCE_REGISTRY_VERSION =
  "model-upgrade-action-affordances-v1";

export type ModelUpgradeActionAdjudicationStatus =
  | "action_present"
  | "action_absent"
  | "action_uncertain";

type ActionSignal = Exclude<ModelUpgradeExpectedActionType, "no_student_action_required">;

export const MODEL_UPGRADE_ACTION_AFFORDANCE_REGISTRY = {
  explain_reasoning: {
    compatible_signals: ["explain_reasoning", "answer_probe", "complete_response_template"]
  },
  complete_response_template: {
    compatible_signals: ["complete_response_template"]
  },
  select_option: {
    compatible_signals: ["select_option"]
  },
  revise_response: {
    compatible_signals: ["revise_response"]
  },
  answer_probe: {
    compatible_signals: ["answer_probe", "explain_reasoning"]
  },
  confirm_choice: {
    compatible_signals: ["confirm_choice"]
  },
  ask_topic_question: {
    compatible_signals: ["ask_topic_question", "answer_probe"]
  },
  no_student_action_required: {
    compatible_signals: []
  }
} as const satisfies Record<
  ModelUpgradeExpectedActionType,
  { compatible_signals: readonly ActionSignal[] }
>;

export type ModelUpgradeActionEvidenceStatus =
  | "compatible"
  | "incompatible"
  | "missing"
  | "uncertain"
  | "not_required";

export type ModelUpgradeActionAdjudication = {
  status: ModelUpgradeActionAdjudicationStatus;
  expected_action_type: ModelUpgradeExpectedActionType;
  adjudication_applicable: boolean;
  structured_next_action_status: ModelUpgradeActionEvidenceStatus;
  rendered_student_request_status: ModelUpgradeActionEvidenceStatus;
  structured_action_signals: ActionSignal[];
  rendered_action_signals: ActionSignal[];
  rendered_request_present: boolean;
  structured_next_action_present: boolean;
  reason_codes: string[];
  registry_version: string;
};

function actionSignals(text: string) {
  const signals = new Set<ActionSignal>();
  if (
    /_{2,}|\b(?:complet(?:e|es)|fill(?:s|ed)?(?:\s+in)?|finish(?:es|ed)?)\b.{0,100}\b(?:blanks?|templates?|sentences?|responses?|forms?)\b|\b(?:blanks?|templates?)\b/iu.test(text)
  ) {
    signals.add("complete_response_template");
  }
  if (/\b(?:explain(?:s|ed)?|reason|reasoning|why|key idea|what made you|how did you decide)\b/iu.test(text)) {
    signals.add("explain_reasoning");
  }
  if (/\b(?:select(?:s|ed)?|choos(?:e|es)|pick(?:s|ed)?|click(?:s|ed)?)\b.{0,60}\b(?:option|answer|choice|[A-D])\b/iu.test(text)) {
    signals.add("select_option");
  }
  if (/\b(?:revis(?:e|es|ed)|rewrit(?:e|es|ten)|correct(?:s|ed)?|update(?:s|d)?|change(?:s|d)?|improve(?:s|d)?)\b.{0,100}\b(?:response|answer|reason|reasoning|explanation|option|sentence|statement|claim|it)\b/iu.test(text)) {
    signals.add("revise_response");
  }
  if (
    /\b(?:answer|respond|reply|tell me|say|describe)\b/iu.test(text) ||
    /\b(?:what|how|why|which)\b[^?]{0,160}\?/iu.test(text)
  ) {
    signals.add("answer_probe");
  }
  if (/\b(?:confirm(?:s|ed)?|is that your final|final answer|are you sure|keep this choice)\b/iu.test(text)) {
    signals.add("confirm_choice");
  }
  if (/\b(?:ask(?:s|ed)?|question|want to know|wondering)\b.{0,100}\b(?:topic|idea|concept|assessment|question|about)\b/iu.test(text)) {
    signals.add("ask_topic_question");
  }
  return [...signals];
}

function evidenceStatus(input: {
  text: string;
  expected: ModelUpgradeExpectedActionType;
  signals: ActionSignal[];
}) : ModelUpgradeActionEvidenceStatus {
  if (!input.text.trim()) return "missing";
  const compatible = MODEL_UPGRADE_ACTION_AFFORDANCE_REGISTRY[input.expected].compatible_signals;
  if (input.signals.some((signal) => (compatible as readonly string[]).includes(signal))) {
    return /\b(?:could|might|may want to|consider|perhaps)\b/iu.test(input.text)
      ? "uncertain"
      : "compatible";
  }
  if (input.signals.length > 0) return "incompatible";
  return /\b(?:please|continue|next|do|try|could|might|may|consider|perhaps)\b/iu.test(input.text)
    ? "uncertain"
    : "incompatible";
}

export function adjudicateModelUpgradeActionRequest(input: {
  contract: ModelUpgradeFixtureOutputContract;
  output: Record<string, unknown> | null;
}): ModelUpgradeActionAdjudication {
  const expected = input.contract.expected_action_type;
  if (expected === "no_student_action_required") {
    return {
      status: "action_present",
      expected_action_type: expected,
      adjudication_applicable: false,
      structured_next_action_status: "not_required",
      rendered_student_request_status: "not_required",
      structured_action_signals: [],
      rendered_action_signals: [],
      rendered_request_present: false,
      structured_next_action_present: false,
      reason_codes: [],
      registry_version: MODEL_UPGRADE_ACTION_AFFORDANCE_REGISTRY_VERSION
    };
  }

  const structuredText = typeof input.output?.next_action === "string"
    ? input.output.next_action
    : "";
  const renderedText = typeof input.output?.student_facing_text === "string"
    ? input.output.student_facing_text
    : "";
  const structuredSignals = actionSignals(structuredText);
  const renderedSignals = actionSignals(renderedText);
  const structuredStatus = evidenceStatus({
    text: structuredText,
    expected,
    signals: structuredSignals
  });
  const renderedStatus = evidenceStatus({
    text: renderedText,
    expected,
    signals: renderedSignals
  });

  let status: ModelUpgradeActionAdjudicationStatus;
  if (structuredStatus === "compatible" && renderedStatus === "compatible") {
    status = "action_present";
  } else if (
    structuredStatus === "missing" ||
    renderedStatus === "missing" ||
    structuredStatus === "incompatible" ||
    renderedStatus === "incompatible"
  ) {
    status = "action_absent";
  } else {
    status = "action_uncertain";
  }

  return {
    status,
    expected_action_type: expected,
    adjudication_applicable: true,
    structured_next_action_status: structuredStatus,
    rendered_student_request_status: renderedStatus,
    structured_action_signals: structuredSignals,
    rendered_action_signals: renderedSignals,
    rendered_request_present: Boolean(renderedText.trim()),
    structured_next_action_present: Boolean(structuredText.trim()),
    reason_codes: status === "action_present"
      ? []
      : status === "action_uncertain"
        ? ["action_request_review_required"]
        : [
            ...(structuredStatus === "missing" ? ["structured_next_action_missing"] : []),
            ...(renderedStatus === "missing" ? ["rendered_student_action_request_missing"] : []),
            ...(structuredStatus === "incompatible" ? ["structured_next_action_incompatible"] : []),
            ...(renderedStatus === "incompatible" ? ["rendered_student_action_request_incompatible"] : []),
            "required_student_action_absent"
          ],
    registry_version: MODEL_UPGRADE_ACTION_AFFORDANCE_REGISTRY_VERSION
  };
}
