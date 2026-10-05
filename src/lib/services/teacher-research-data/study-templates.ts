import { createHash } from "node:crypto";
import type { AttemptObservation } from "../teacher-dashboard/attempt-comparison";
import { researchCsv } from "./csv-contract";

export const STUDY_TEMPLATE_VERSION = "research-study-templates-v1";

// Empty researcher-entered fields are deliberate: exports never manufacture
// consent decisions, reference diagnoses, experimental assignments or outcomes.
export function researchStudyTemplateFiles(input: {
  attempts: AttemptObservation[]; snapshot_at: string; pseudonym: (student: string) => string;
}) {
  const definitions: Record<string, string> = {
    research_student_id: "Existing pseudonymous account key. Account count is not research participant count; use the approved cohort and never insert login names or email addresses.",
    snapshot_at: "Database snapshot time of this export; not observation or consent time.",
    template_version: "Version of this unfilled study worksheet, not a runtime collection version.",
    study_participant_id: "Optional external pseudonymous participant key assigned under the study protocol.",
    consent_status: "Researcher-entered consent/withdrawal status from the approved study records. Blank means not reviewed, not consent granted.",
    cohort_role: "Researcher-confirmed participant, instructor, demo, or other protocol-defined role. Not inferred from account names or performance.",
    include_in_analysis: "Researcher decision: true or false after eligibility review; blank means undecided. Never defaults to included.",
    exclusion_reason: "Protocol-defined reason for exclusion; do not include identifying personal details.",
    eligibility_reviewed_at: "ISO 8601 timestamp of the external eligibility review.",
    annotation_case_id: "case_ plus SHA-256 of JSON [session_public_id, item_snapshot_key]; stable across re-export of the same sealed initial item.",
    session_public_id: "Attempt join key. Separate attempts and students in analysis; repeated rows are not independent participants.",
    assessment_public_id: "Assessment identity join key, not a version identifier. Use administered snapshot IDs for content/version comparisons, not title alone.",
    item_public_id: "Administered item join key, used with session_public_id.",
    item_snapshot_key: "Exact sealed item/version/content fingerprint from attempt_submission_items.csv.",
    initial_submitted_at: "Time of the sealed initial package, before this attempt's feedback. Not necessarily before any prior attempt or clarification.",
    review_status: "Starts as not_reviewed. This row is a worksheet, not an existing human judgment.",
    rater_id: "Pseudonymous human reviewer identifier. Duplicate a case row for each independent rater; preserve separate judgments before adjudication.",
    rubric_version: "Version of the prespecified human coding rubric; record categories, examples and adjudication rules externally.",
    reviewed_at: "ISO 8601 timestamp when the human judgment was recorded.",
    blinded_to_ai: "Researcher-entered true/false indicating whether the reviewer was actually blinded to AI labels. Blank does not establish blinding.",
    reasoning_rating: "Human-coded reasoning category under the rubric. Do not copy an AI profile label or infer from answer correctness alone.",
    misconception_codes: "Human-coded, rubric-defined misconception hypotheses supported by the response; distinguish endorsement, rejection, uncertainty and questions.",
    evidence_references: "Source item/turn references supporting this judgment. Separate pre-feedback evidence from later tutor-supported responses.",
    rating_notes: "Human interpretation notes. Review free text for identifying content before sharing.",
    outcome_record_id: "External unique observation identifier; one row per actually administered outcome measure/timepoint.",
    measure_name: "Independent outcome instrument or task name, not an AI profile or conversation completion label.",
    measure_version: "Version of the outcome items/instrument and scoring specification.",
    timepoint: "Protocol-defined observation timepoint, such as immediate or delayed; record actual administered_at separately.",
    administered_at: "Actual ISO 8601 outcome administration time, not export time.",
    outcome_value: "Observed external outcome value; blank when not collected. Never use an AI judgment as an independent reference outcome.",
    outcome_unit: "Scale/unit and denominator for outcome_value, such as correct out of 6 or a rubric category.",
    assistance_condition: "Actual assistance/re-exposure conditions during outcome administration, including prior item exposure and available hints.",
    study_condition: "Condition assigned by the approved external study protocol, not inferred from tutor wording or model versions.",
    allocation_method: "Document actual assignment method and unit (e.g. randomized student, randomized item, observational). The application does not randomize through this template.",
    protocol_version: "Approved protocol version defining eligibility, assignment, outcomes and analysis; no protocol is created by this export.",
    source_reference: "Controlled external source record reference; no credentials, direct identifiers or public links to identifiable responses."
  };
  const metadata = ["snapshot_at", "template_version"];
  const cohortColumns = ["research_student_id", "study_participant_id", "consent_status", "cohort_role", "include_in_analysis", "exclusion_reason", "eligibility_reviewed_at", ...metadata];
  const reviewColumns = ["annotation_case_id", "research_student_id", "assessment_public_id", "session_public_id", "item_public_id", "item_snapshot_key", "initial_submitted_at", "review_status", "rater_id", "rubric_version", "reviewed_at", "blinded_to_ai", "reasoning_rating", "misconception_codes", "evidence_references", "rating_notes", ...metadata];
  const outcomeColumns = ["outcome_record_id", "research_student_id", "assessment_public_id", "session_public_id", "measure_name", "measure_version", "rubric_version", "timepoint", "administered_at", "outcome_value", "outcome_unit", "assistance_condition", "study_condition", "allocation_method", "protocol_version", "source_reference", ...metadata];
  const stamp = { snapshot_at: input.snapshot_at, template_version: STUDY_TEMPLATE_VERSION };
  const tables = [
    { path: "research_cohort_template.csv", columns: cohortColumns, rows: [...new Set(input.attempts.map(a => input.pseudonym(a.student_key)))].map(id => ({ research_student_id: id, ...stamp })) },
    { path: "human_review_template.csv", columns: reviewColumns, rows: input.attempts.flatMap(a => a.items.map(item => ({
      annotation_case_id: `case_${createHash("sha256").update(JSON.stringify([a.session_public_id, item.item_key])).digest("hex")}`,
      research_student_id: input.pseudonym(a.student_key), assessment_public_id: a.assessment_public_id,
      session_public_id: a.session_public_id, item_public_id: item.item_public_id, item_snapshot_key: item.item_key,
      initial_submitted_at: item.submitted_at, review_status: "not_reviewed", ...stamp
    }))) },
    { path: "external_outcomes_template.csv", columns: outcomeColumns, rows: [] }
  ];
  return [
    ...tables.map(t => ({ path: t.path, data: researchCsv(t.rows, t.columns) })),
    { path: "study_template_dictionary.csv", data: researchCsv(tables.flatMap(t => t.columns.map(variable_name => ({
      dataset: t.path, variable_name, definition: definitions[variable_name],
      source: metadata.includes(variable_name) || ["annotation_case_id", "research_student_id", "assessment_public_id", "session_public_id", "item_public_id", "item_snapshot_key", "initial_submitted_at", "review_status"].includes(variable_name)
        ? "Export identity or worksheet status; not a new measurement" : "To be supplied by the authorized research team; never inferred by the application",
      missing_values: "Empty means unfilled/unavailable, not false, zero, consent, or absence of a misconception."
    })))) },
    { path: "research_study_notes.txt", data: [
      "Study worksheets, not collected data",
      "The three *_template.csv files are optional offline research worksheets. No import, random assignment, student record update, consent decision, rating or outcome collection is performed. They are excluded from data_coverage.csv.",
      "1. Complete the cohort worksheet from approved consent and eligibility records; exclude instructor/demo accounts as appropriate. Do not infer consent from system use. Keep the identity crosswalk separately under access control.",
      "2. For human review, join human_review_template.csv to attempt_submission_items.csv by session_public_id and item_snapshot_key. Join original administered content by session_public_id/item_public_id through item_responses.csv to assessment_content.csv using both snapshot IDs. Never join by title or option label alone.",
      "Use the first sealed initial package (responses finalized for submission), including the sealed tempting alternative, for pre-feedback coding. Current item_responses and later conversations are different observation stages. Review original turns to distinguish the first utterance from first accepted reasoning. A prior attempt may already have exposed answers.",
      "Give blinded reviewers only the evidence allowed by the protocol, excluding AI labels, profile categories and later feedback. These templates contain no AI labels or copied student text. Blinding must be implemented in the review material, not merely asserted here.",
      "Keep one case/rater/rubric record per independent judgment and adjudicate separately. Agreement supports coding reliability; a criterion derived from the same reasoning text does not independently establish underlying knowledge or learning transfer.",
      "3. The outcomes worksheet is header-only until independent observations are collected. Prespecify comparison conditions, assignment unit, new-item outcome rubric and follow-up timing. Retesting an exposed item is not an independent transfer measure. Do not require additional student tasks without the study/teaching protocol.",
      "Pseudonymous exports may still contain identifying free text in source tables. Apply approved access, retention and disclosure controls; do not email identifiable transcript bundles.",
      "Counts, pauses, latency and displayed feedback describe observations. They do not measure motivation, learning gain or causal effectiveness by themselves. Small repeated samples support feasibility and descriptive work, not many independent participants.",
      "Record source prompt/model versions for historical analyses. Re-export updates serialization and projections only; it does not regenerate profiles, fill missing historical measurements, or validate a hypothesis."
    ].join("\n") + "\n" }
  ];
}
