import type {
  FormativeConversationV18R2AgentInput,
  FormativeConversationV18R2AgentOutput
} from "./agent-contract-v18r2";

export const LEARNING_SUMMARY_POLICY_VERSION = "learning-summary-evidence-v1";

const summarySections = [
  { type: "learning_summary_understanding", heading: /understanding you demonstrated|本次你已展示的理解/i },
  { type: "learning_summary_progress", heading: /progress supported this time|本次已有证据支持的进步/i },
  { type: "learning_summary_remaining", heading: /still worth working on|仍需澄清的概念/i }
] as const;

// These checks validate provenance, not whether the cited reasoning is substantively
// correct. The semantic judgment remains reviewable alongside the original transcript.
export function learningSummaryEvidenceIssues(
  output: FormativeConversationV18R2AgentOutput,
  context: FormativeConversationV18R2AgentInput
) {
  const issues: string[] = [];
  const evidenceById = new Map(context.allowed_evidence_catalog.evidence.map(entry => [entry.evidence_id, entry]));
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
      if (section.type === "learning_summary_progress") {
        const after = evidence.filter(entry => entry?.evidence_stage === "formative_conversation");
        const hasBeforeAfter = after.some(later => evidence.some(earlier => earlier && later &&
          earlier.evidence_id !== later.evidence_id &&
          (earlier.evidence_stage === "baseline_assessment" ||
           (earlier.source_sequence_index !== null && later.source_sequence_index !== null &&
            earlier.source_sequence_index < later.source_sequence_index))));
        if (!hasBeforeAfter) issues.push("learning_summary.learning_summary_progress.before_and_after_required");
      }
    }
  }
  return [...new Set(issues)];
}
