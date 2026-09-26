import type { AssessmentQualityCase } from "./assessment-quality-cases";

const options = [
  "High internal consistency proves that the test measures leadership.",
  "Internal consistency alone does not establish the leadership interpretation.",
  "High alpha proves leadership and the same reliability applies in every population.",
  "No interpretation of test scores can ever be justified."
];
const common = {
  focus: "Stance toward supplied explanations, not originality of wording",
  stem: "A leadership scale has high internal consistency. What conclusion is justified?",
  options, correct: "B"
};

// These expectations are inspectable regression hypotheses, not an independent
// human reference standard. Each case states why the expected distinction matters.
export const STANCE_QUALITY_CASES: AssessmentQualityCase[] = [
  { ...common, id: "endorse_correct_reference", selected: "B", reasoning: "I agree with B's explanation.",
    expected_judgments: ["supported_concise"], expected_claim_range: [0, 0],
    expected_interpretations: [{ stance: "endorsed", basis: "supplied_explanation", correctness: "supported", scope: "specific_proposition", option_label: "B" }],
    reviewer_check: "Explicit adoption of a supplied inference is recognition evidence, not absent reasoning or independent transfer." },
  { ...common, id: "endorse_false_reference", selected: "A", reasoning: "I agree with A's explanation.",
    expected_judgments: ["contradictory"], expected_claim_range: [1, 1],
    expected_interpretations: [{ stance: "endorsed", basis: "supplied_explanation", correctness: "contradicted", scope: "specific_proposition", option_label: "A" }],
    reviewer_check: "Explicit adoption supports the false consistency-to-validity inference; retain the short student quote and separately reference A." },
  { ...common, id: "endorse_false_verbatim", selected: "A", reasoning: `I believe this: ${options[0]}`,
    expected_judgments: ["contradictory"], expected_claim_range: [1, 1],
    expected_interpretations: [{ stance: "endorsed", basis: "supplied_explanation", correctness: "contradicted", scope: "specific_proposition", option_label: "A" }],
    reviewer_check: "Verbatim wording does not erase explicit endorsement of an incorrect inference." },
  { ...common, id: "reject_tempting_explanation", selected: "B", reasoning: "Consistency is not enough to justify the leadership interpretation.",
    tempting_reason: "A was tempting, but I reject its claim that consistency proves leadership.",
    expected_judgments: ["supported_concise", "supported_precise"], expected_claim_range: [0, 0],
    expected_interpretations: [{ source_field: "tempting_option_reason", stance: "rejected", correctness: "contradicted", option_label: "A" }],
    reviewer_check: "Do not diagnose a rejected earlier temptation as a current belief." },
  { ...common, id: "uncertain_option_explanation", selected: "B", reasoning: "I cannot tell whether A's explanation is true; I guessed B.",
    expected_judgments: ["insufficient"], expected_claim_range: [0, 0],
    expected_interpretations: [{ stance: "uncertain", correctness: "contradicted", option_label: "A" }],
    reviewer_check: "The proposition is false but the student's commitment is unknown; uncertainty is not endorsement." },
  { ...common, id: "quote_without_commitment", selected: "B", reasoning: `Option A says "${options[0]}". I am only quoting it, not saying it is true.`,
    expected_judgments: ["insufficient"], expected_claim_range: [0, 0],
    expected_interpretations: [{ stance: "quoted", correctness: "contradicted", option_label: "A" }],
    reviewer_check: "Reporting what the option says without commitment does not establish belief or rejection of the proposition." },
  { ...common, id: "compound_agreement_unspecified", selected: "C", reasoning: "I agree with C.",
    expected_judgments: ["insufficient", "partial", "contradictory"], expected_claim_range: [0, 0],
    expected_interpretations: [{ stance: "endorsed", basis: "supplied_explanation", scope: "compound_unspecified", option_label: "C" }],
    reviewer_check: "Retain coarse agreement for a later focused check; do not create two independently evidenced atomic beliefs." },
  { ...common, id: "explicit_two_false_claims", selected: "C",
    reasoning: "I believe alpha proves leadership. I also believe the same reliability holds in every population.",
    expected_judgments: ["contradictory"], expected_claim_range: [2, 2],
    expected_interpretations: [{ stance: "endorsed", correctness: "contradicted", scope: "specific_proposition" }],
    reviewer_check: "Two explicit propositions must not be collapsed into an unexamined compound or lose one misconception." },
  { ...common, id: "true_given_without_inference", selected: "B", reasoning: "The scale has high internal consistency.",
    expected_judgments: ["insufficient"], expected_claim_range: [0, 0],
    expected_interpretations: [{ basis: "fact_restatement", correctness: "supported" }],
    reviewer_check: "A correct supplied fact alone does not explain the selected conclusion and is not an error." },
  { ...common, id: "self_correction_in_same_reply", selected: "B",
    reasoning: "At first I thought high alpha proved leadership. I no longer think that: co-varying items could measure something else.",
    expected_judgments: ["supported_concise", "supported_precise"], expected_claim_range: [0, 0],
    expected_interpretations: [{ stance: "rejected", correctness: "contradicted" }, { stance: "endorsed", correctness: "supported", basis: "student_explanation" }],
    reviewer_check: "Preserve the rejected earlier proposition without diagnosing it as a current error; evaluate the corrective inference." },
  { ...common, id: "selected_letter_only", selected: "B", reasoning: "B",
    expected_judgments: ["insufficient"], expected_claim_range: [0, 0],
    expected_interpretations: [{ basis: "answer_only" }],
    reviewer_check: "A repeated answer letter is not explicit adoption of the option's reasoning." },
  { ...common, id: "endorse_correct_verbatim", selected: "B", reasoning: `I accept this explanation: ${options[1]}`,
    expected_judgments: ["supported_concise"], expected_claim_range: [0, 0],
    expected_interpretations: [{ stance: "endorsed", basis: "supplied_explanation", correctness: "supported", scope: "specific_proposition", option_label: "B" }],
    reviewer_check: "Same-word endorsement and reference-only endorsement should both count as recognition, not independently generated application." }
];
