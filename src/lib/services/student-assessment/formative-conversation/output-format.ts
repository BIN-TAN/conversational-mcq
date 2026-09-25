import type {
  FormativeConversationAgentInput,
  FormativeConversationAgentOutput
} from "./agent-contract";
import {
  validateFormativeConversationProfileTransition,
  type FormativeConversationProfileTransitionValidationIssue
} from "./profile-transition-validator";

export const FORMATIVE_CONVERSATION_STUDENT_OUTPUT_FORMAT_VERSION: string =
  "formative-conversation-student-output-format-v2";

export type FormativeConversationOutputValidationIssue = {
  code:
    | "student_output_markdown_table_unsupported"
    | "student_output_fenced_code_unsupported"
    | "student_output_image_unsupported"
    | "student_output_link_unsupported"
    | "student_output_raw_html_unsupported"
    | "student_output_concrete_answer_example"
    | FormativeConversationProfileTransitionValidationIssue["code"];
  field_path: string;
  message: string;
};

function markdownTableDetected(value: string) {
  const lines = value.split(/\r?\n/);
  return lines.some((line, index) => {
    const separator = lines[index + 1];
    return (
      line.includes("|") &&
      Boolean(
        separator?.match(
          /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/
        )
      )
    );
  });
}

export function validateFormativeConversationStudentOutputFormat(
  value: string,
  fieldPath = "student_visible_message"
): FormativeConversationOutputValidationIssue[] {
  const issues: FormativeConversationOutputValidationIssue[] = [];
  // Input-format examples must not contain choices that could expose a new key.
  const plain = value.replace(/[*_`]/g, "");
  if (/(?:\b(?:respond|reply|type|enter|submit|answer|format)\b[^\n]{0,180}?(?:such as|for example|e\.g\.|like|with|format\s*:)|(?:例如|比如|回复格式)[：:]?)[^\n]{0,35}?(?:\b\d{1,2}\s*[.):=-]?\s*[A-E]\b|["'“][A-E]["'”])/i.test(plain)) {
    issues.push({
      code: "student_output_concrete_answer_example", field_path: fieldPath,
      message: "Do not include concrete answer letters as response-format examples. Ask for the question number and chosen letter without an example answer."
    });
  }
  if (markdownTableDetected(value)) {
    issues.push({
      code: "student_output_markdown_table_unsupported",
      field_path: fieldPath,
      message:
        "Student-visible tutor output must use paragraphs or lists instead of Markdown tables."
    });
  }
  if (/^\s*(```|~~~)/m.test(value)) {
    issues.push({
      code: "student_output_fenced_code_unsupported",
      field_path: fieldPath,
      message:
        "Student-visible tutor output must not contain fenced code blocks."
    });
  }
  if (/!\[[^\]]*\]\([^)]*\)/.test(value)) {
    issues.push({
      code: "student_output_image_unsupported",
      field_path: fieldPath,
      message: "Student-visible tutor output must not contain Markdown images."
    });
  }
  if (/\[[^\]]+\]\((?:https?:\/\/|mailto:|\/)[^)]*\)/i.test(value)) {
    issues.push({
      code: "student_output_link_unsupported",
      field_path: fieldPath,
      message:
        "Student-visible tutor output must not contain arbitrary Markdown links."
    });
  }
  if (/<\/?[a-z][^>]*>/i.test(value)) {
    issues.push({
      code: "student_output_raw_html_unsupported",
      field_path: fieldPath,
      message: "Student-visible tutor output must not contain raw HTML."
    });
  }
  return issues;
}

export function validateFormativeConversationAgentOutputForContext(input: {
  output: FormativeConversationAgentOutput;
  context: FormativeConversationAgentInput;
}) {
  const issues: FormativeConversationOutputValidationIssue[] = [
    ...validateFormativeConversationStudentOutputFormat(
      input.output.student_visible_message
    ),
    ...(input.output.teaching_artifact
      ? validateFormativeConversationStudentOutputFormat(
          input.output.teaching_artifact.student_visible_content,
          "teaching_artifact.student_visible_content"
        )
      : [])
  ];
  const transition = validateFormativeConversationProfileTransition({
    recommendation: input.output.profile_transition_recommendation,
    prior_profile: input.context.current_profile.canonical_profile,
    prior_misconception_claim_catalog:
      input.context.allowed_misconception_claim_catalog,
    evidence_observations: input.output.evidence_observations,
    available_turns: input.context.visible_transcript.map((turn) => ({
      sequence_index: turn.sequence_index,
      actor: turn.actor
    }))
  });
  if (!transition.valid) {
    issues.push(...transition.issues);
  }
  return {
    valid: issues.length === 0,
    issues,
    transition
  };
}
