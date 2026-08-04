import type { FormativeConversationAssessmentSpecification } from "./agent-contract";

export const FORMATIVE_CONVERSATION_TEACHER_GUIDANCE_BOUNDARY_VERSION =
  "formative-conversation-teacher-guidance-boundary-v1" as const;

type ItemGuidance =
  FormativeConversationAssessmentSpecification["administered_item_guidance"][number];

const privateMarkerPattern =
  /\b(?:private teacher note|teacher[- ]only|confidential|internal (?:note|comment)|staff only|do not (?:show|share)|not for (?:the )?student)\b/iu;
const studentJudgmentPattern =
  /\b(?:the|this)?\s*student\s+(?:is|was|seems|appears|looks|has been)\s+(?:lazy|unmotivated|dishonest|cheating|careless|not trying|low ability|a weak student|uninterested|disengaged)\b/iu;
const evidenceCautionPattern =
  /\b(?:do not|must not|should not|cannot|is not evidence|avoid|never infer)\b/iu;

function guidanceSegments(value: string) {
  return value
    .split(/\n+|;\s+|(?<=[.!?])\s+(?=[A-Z"'])/u)
    .map((segment) => segment.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

export function normalizeInstructionalTeacherGuidanceText(
  value: string | null
) {
  if (!value) return null;

  const safeSegments = guidanceSegments(value).filter((segment) => {
    if (privateMarkerPattern.test(segment)) return false;
    if (
      studentJudgmentPattern.test(segment) &&
      !evidenceCautionPattern.test(segment)
    ) {
      return false;
    }
    return true;
  });

  return safeSegments.length > 0 ? safeSegments.join(" ") : null;
}

export function normalizeInstructionalTeacherGuidance(
  guidance: ItemGuidance[]
): ItemGuidance[] {
  return guidance.map((item) => ({
    item_public_id: item.item_public_id,
    target_reasoning_note: normalizeInstructionalTeacherGuidanceText(
      item.target_reasoning_note
    ),
    strong_reasoning_should_mention:
      normalizeInstructionalTeacherGuidanceText(
        item.strong_reasoning_should_mention
      ),
    plain_language_distractor_diagnostic_notes:
      normalizeInstructionalTeacherGuidanceText(
        item.plain_language_distractor_diagnostic_notes
      ),
    interpretation_caution: normalizeInstructionalTeacherGuidanceText(
      item.interpretation_caution
    )
  }));
}
