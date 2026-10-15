import type {
  FormativeConversationV18R2AgentInput,
  FormativeConversationV18R2AgentOutput
} from "./agent-contract-v18r2";
import { isRecognitionQualification } from "./assistance-history";

export const LEARNING_SUMMARY_POLICY_VERSION = "learning-summary-evidence-v2";

const summarySections = [
  { type: "learning_summary_understanding", heading: /understanding you demonstrated|本次你已展示的理解/i },
  { type: "learning_summary_progress", heading: /progress supported this time|本次已有证据支持的进步/i },
  { type: "learning_summary_remaining", heading: /still worth working on|仍需澄清的概念/i }
] as const;

// Preserve recorded assistance qualifications, not an irreversible student label.
// Reconsideration binds the same source IDs; its substantive explanation still needs review.
function recognitionQualifiedIds(
  output: FormativeConversationV18R2AgentOutput,
  context: FormativeConversationV18R2AgentInput
) {
  const qualified = new Set<string>();
  const evidenceById = new Map(context.allowed_evidence_catalog.evidence.map(entry => [entry.evidence_id, entry]));
  const reconsiderationIsBound = (ids: string[]) => ids.length > 0 && ids.every(id => {
    const entry = evidenceById.get(id);
    return entry?.source_role === "student" && entry.eligibility === "student_understanding" &&
      ["assessment_reasoning", "assessment_distractor_reasoning", "formative_student_turn"].includes(entry.evidence_kind) &&
      (entry.evidence_stage !== "formative_conversation" || entry.conversation_public_id === context.conversation_public_id);
  });
  const apply = (observations: FormativeConversationV18R2AgentOutput["evidence_observations"]) => {
    for (const observation of observations) {
      if (observation.evidence_type === "assistance_context_reconsidered" && reconsiderationIsBound(observation.evidence_ids)) {
        observation.evidence_ids.forEach(id => qualified.delete(id));
      }
    }
    // A same-call qualification wins over a conflicting reconsideration, irrespective of array order.
    for (const observation of observations) {
      if (isRecognitionQualification(observation.evidence_type)) observation.evidence_ids.forEach(id => qualified.add(id));
    }
  };
  const history = context.assistance_history?.observations ?? [];
  for (const sequence of [...new Set(history.map(entry => entry.source_tutor_sequence_index))].sort((a, b) => a - b)) {
    apply(history.filter(entry => entry.source_tutor_sequence_index === sequence));
  }
  apply(output.evidence_observations);
  return qualified;
}

// These checks validate provenance and consistency with recorded assistance, not
// whether reasoning or reconsideration is substantively correct.
export function learningSummaryEvidenceIssues(
  output: FormativeConversationV18R2AgentOutput,
  context: FormativeConversationV18R2AgentInput
) {
  const issues: string[] = [];
  const evidenceById = new Map(context.allowed_evidence_catalog.evidence.map(entry => [entry.evidence_id, entry]));
  const qualifiedIds = recognitionQualifiedIds(output, context);
  if (/discussed,?\s+(?:but\s+)?(?:awaiting|pending)\s+confirmation|已讨论[，,、\s]*尚待确认/i.test(output.student_visible_message)) {
    issues.push("learning_summary.omit_discussed_awaiting_confirmation");
  }
  for (const section of summarySections) {
    const observations = output.evidence_observations.filter(entry => entry.evidence_type === section.type);
    if (section.heading.test(output.student_visible_message) && !observations.length) {
      issues.push(`learning_summary.${section.type}.evidence_required`);
    }
    for (const observation of observations) {
      const evidence = observation.evidence_ids.map(id => evidenceById.get(id));
      if (!evidence.length || evidence.some(entry => !entry || entry.source_role !== "student" ||
          entry.eligibility !== "student_understanding" ||
          !["assessment_reasoning", "assessment_distractor_reasoning", "formative_student_turn"].includes(entry.evidence_kind) ||
          (entry.evidence_stage === "formative_conversation" && entry.conversation_public_id !== context.conversation_public_id))) {
        issues.push(`learning_summary.${section.type}.student_reasoning_required`);
        continue;
      }
      if (section.type === "learning_summary_understanding" && observation.evidence_ids.some(id => qualifiedIds.has(id))) {
        issues.push("learning_summary.learning_summary_understanding.recognition_requires_reconsideration");
      }
      if (section.type === "learning_summary_progress") {
        const after = evidence.filter(entry => entry?.evidence_stage === "formative_conversation");
        const hasBeforeAfter = after.some(later => evidence.some(earlier => earlier && later &&
          earlier.evidence_id !== later.evidence_id &&
          (earlier.evidence_stage === "baseline_assessment" ||
           (earlier.source_sequence_index !== null && later.source_sequence_index !== null &&
            earlier.source_sequence_index < later.source_sequence_index))));
        if (!hasBeforeAfter) issues.push("learning_summary.learning_summary_progress.before_and_after_required");
        const latestSequence = Math.max(...after.map(entry => entry?.source_sequence_index ?? -Infinity));
        const latest = after.filter(entry => entry?.source_sequence_index === null || entry?.source_sequence_index === latestSequence);
        if (latest.some(entry => entry && qualifiedIds.has(entry.evidence_id))) {
          issues.push("learning_summary.learning_summary_progress.recognition_requires_reconsideration");
        }
      }
    }
  }
  return [...new Set(issues)];
}
