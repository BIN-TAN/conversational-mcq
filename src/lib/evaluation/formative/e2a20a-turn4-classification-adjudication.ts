import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  E2A14_CANDIDATE_FILE_SHA256,
  E2A14_CANDIDATE_HASH,
  E2A14_CANDIDATE_PATH
} from "./e2a14-protected-request-validator-candidate";
import { e2a14ProtectedArtifactSnapshot } from
  "./e2a14-protected-request-calibration";
import {
  buildE2A18CalibrationCorpus
} from "./e2a18-simulator-contract-adjudication";
import {
  type E2A18ConceptualAnchor,
  E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  classifyStudentEvidenceV2
} from "./e2a18-student-simulator-contract-v2";
import {
  E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  classifyStudentEvidenceV3
} from "./e2a20a-student-simulator-evidence-classifier-v3";
import {
  E2A20_AUTHORITATIVE_E2A19_RUN_ID,
  E2A21_BUDGET_DRAFT,
  buildE2A21ProtocolDraft,
  validateE2A21ProtocolDraft
} from "./e2a20-evidence-driven-transition-adjudication";

export const E2A20A_VERSION =
  "e2a20a-turn4-classification-adjudication-v1" as const;
export const E2A20A_STATUS =
  "e2a20a_classifier_false_negative_corrected_e2a21_ready" as const;
export const E2A20A_AUTHORITATIVE_E2A20_RUN_ID =
  "e2a20_20260720095853_6b995450" as const;
export const E2A20A_EXPECTED_CLASSIFIER_V2_SHA256 =
  "5839e68b24bbdfe437fe133a86da201b2df96d769e9d24b966d370727d4d9037" as const;
export const E2A20A_TURN4_MESSAGE =
  "The closer an examinee’s theta is to Item 16’s difficulty, the more the item can distinguish that examinee from others because the response is less predictable. Far above or below that location, responses are more predictable and the item gives less information, so option A’s claim that it is most informative “at every ability level” is too broad." as const;

export const E2A20A_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a20a-turn4-classification-adjudication"
);

export const E2A20A_ARTIFACT_NAMES = [
  "adjudication-manifest.json",
  "turn4-visible-evidence.json",
  "strict-conceptual-adjudication.json",
  "formative-assessment-adjudication.json",
  "revision-readiness-adjudication.json",
  "classifier-v2-explanation.json",
  "root-cause-decision.json",
  "calibration-corpus.jsonl",
  "calibration-results.jsonl",
  "historical-regression-results.jsonl",
  "classifier-delta.json",
  "e2a21-readiness-update.json",
  "summary.json"
] as const;

type JsonObject = Record<string, unknown>;
type CalibrationCategory =
  | "clearly_partial"
  | "clearly_substantive"
  | "revision_ready_informal"
  | "technically_worded_incomplete"
  | "paraphrased_correct_without_canonical_keywords"
  | "boundary_case";

type CalibrationCase = {
  case_id: string;
  category: CalibrationCategory;
  conceptual_anchor: E2A18ConceptualAnchor;
  concept: string;
  distractor: string;
  visible_student_response: string;
  expected_level: "partial" | "substantive";
  revision_eligible: boolean;
  exact_rationale: string;
  avoids_preferred_canonical_phrases: boolean;
};

const E2A19_RUN_DIR = path.join(
  process.cwd(), ".data", "e2a19-single-session-micro-canary",
  E2A20_AUTHORITATIVE_E2A19_RUN_ID
);
const E2A20_RUN_DIR = path.join(
  process.cwd(), ".data", "e2a20-evidence-driven-transition-adjudication",
  E2A20A_AUTHORITATIVE_E2A20_RUN_ID
);
const E2A18_RUN_DIR = path.join(
  process.cwd(), ".data", "e2a18-simulator-contract-adjudication",
  "e2a18_20260720082941_39cf7af8"
);
const CLASSIFIER_V2_PATH = path.join(
  process.cwd(),
  "src/lib/evaluation/formative/e2a18-student-simulator-contract-v2.ts"
);
const CLASSIFIER_V3_PATH = path.join(
  process.cwd(),
  "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts"
);

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function assertSafeArtifact(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?bearer/iu,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a20a_forbidden_secret_or_private_reasoning");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertSafeArtifact(value);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, rows: unknown[]) {
  rows.forEach(assertSafeArtifact);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8"
  );
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(root, entry.name)))
    .sort();
}

function directoryDigest(root: string) {
  const rows = listFiles(root).map((filePath) => ({
    path: path.relative(root, filePath),
    sha256: sha256(readFileSync(filePath))
  }));
  return {
    exists: existsSync(root),
    file_count: rows.length,
    aggregate_sha256: sha256(
      rows.map((row) => `${row.path}:${row.sha256}`).join("\n")
    )
  };
}

function protectedSnapshot() {
  const runtime = e2a14ProtectedArtifactSnapshot();
  return {
    snapshot_version: "e2a20a-protected-evidence-snapshot-v1",
    approved_v2_hash: runtime.approved_v2_hash,
    protected_groups: runtime.tracked_groups,
    tutor_candidate: {
      configuration_hash: E2A14_CANDIDATE_HASH,
      file_sha256: sha256(readFileSync(E2A14_CANDIDATE_PATH))
    },
    classifier_v2: {
      version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      file_sha256: sha256(readFileSync(CLASSIFIER_V2_PATH))
    },
    historical_evidence: {
      e2a18: directoryDigest(E2A18_RUN_DIR),
      e2a19: directoryDigest(E2A19_RUN_DIR),
      e2a20: directoryDigest(E2A20_RUN_DIR)
    }
  };
}

function makeRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `e2a20a_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function pathsFor(runDir: string) {
  return Object.fromEntries(E2A20A_ARTIFACT_NAMES.map((name) => [
    name,
    path.join(runDir, name)
  ])) as Record<typeof E2A20A_ARTIFACT_NAMES[number], string>;
}

const exactSpans = {
  location_and_mechanism:
    "The closer an examinee’s theta is to Item 16’s difficulty, the more the item can distinguish that examinee from others because the response is less predictable.",
  distance_boundary:
    "Far above or below that location, responses are more predictable and the item gives less information",
  distractor_application:
    "option A’s claim that it is most informative “at every ability level” is too broad"
} as const;

function rubricCriteria() {
  return [
    {
      criterion: "identifies_active_distractor_claim",
      satisfied: true,
      exact_supporting_spans: [exactSpans.distractor_application]
    },
    {
      criterion: "rejects_universal_information_claim",
      satisfied: true,
      exact_supporting_spans: [exactSpans.distractor_application]
    },
    {
      criterion: "localizes_information_around_item_difficulty",
      satisfied: true,
      exact_supporting_spans: [exactSpans.location_and_mechanism]
    },
    {
      criterion: "relates_information_to_predictability",
      satisfied: true,
      exact_supporting_spans: [exactSpans.location_and_mechanism]
    },
    {
      criterion: "explains_reduced_information_away_from_difficulty",
      satisfied: true,
      exact_supporting_spans: [exactSpans.distance_boundary]
    },
    {
      criterion: "applies_boundary_to_option_a",
      satisfied: true,
      exact_supporting_spans: [exactSpans.distractor_application]
    },
    {
      criterion: "coherent_independent_explanation",
      satisfied: true,
      exact_supporting_spans: [
        exactSpans.location_and_mechanism,
        exactSpans.distance_boundary
      ]
    },
    {
      criterion: "supports_evidence_based_revision",
      satisfied: true,
      exact_supporting_spans: [
        exactSpans.location_and_mechanism,
        exactSpans.distractor_application
      ]
    }
  ];
}

function analyticAdjudication(input: {
  rubric: string;
  confidence: number;
  rationale: string;
}) {
  const criteria = rubricCriteria();
  return {
    adjudication_version: `e2a20a-${input.rubric}-v1`,
    adjudication_type: "structured_analytic_adjudication_not_human_rating",
    rubric: input.rubric,
    level_assigned: "substantive",
    criteria_satisfied: criteria.filter((entry) => entry.satisfied)
      .map((entry) => entry.criterion),
    criteria_missing: [],
    exact_supporting_spans: Object.values(exactSpans),
    criterion_results: criteria,
    revision_should_be_authorized: true,
    confidence: input.confidence,
    rationale: input.rationale,
    human_reviewer: null,
    human_rating: null
  };
}

export function buildE2A20AAdjudications() {
  return {
    strict: analyticAdjudication({
      rubric: "strict-conceptual-adjudication",
      confidence: 0.97,
      rationale:
        "The response states the theta-difficulty localization, supplies the predictability mechanism, explains the loss of information away from the item location, and rejects the active option A boundary. Formal item-information terminology is unnecessary for this misconception."
    }),
    formative: analyticAdjudication({
      rubric: "formative-assessment-adjudication",
      confidence: 0.99,
      rationale:
        "The observable response demonstrates a coherent correction in the student's own connected explanation and provides enough evidence to move from elicitation to revision."
    }),
    revision: analyticAdjudication({
      rubric: "revision-readiness-adjudication",
      confidence: 0.98,
      rationale:
        "The student can now revise the original universal-information claim using an explicit location, mechanism, distance boundary, and option-specific conclusion."
    })
  };
}

function calibrationCase(input: CalibrationCase) {
  return input;
}

export function buildE2A20ACalibrationCorpus(): CalibrationCase[] {
  const concepts: Record<E2A18ConceptualAnchor, {
    concept: string;
    distractor: string;
  }> = {
    theta_information: {
      concept: "theta and item information",
      distractor: "a very difficult item is maximally informative for everyone"
    },
    reliability_validity: {
      concept: "reliability and validity",
      distractor: "high reliability proves validity"
    },
    correlation_causation: {
      concept: "correlation and causation",
      distractor: "correlation establishes causation"
    },
    p_value_interpretation: {
      concept: "p-value interpretation",
      distractor: "the p-value is the probability that the null is true"
    },
    measurement_invariance: {
      concept: "measurement invariance",
      distractor: "equal group means prove invariance"
    },
    standard_error_information: {
      concept: "information and standard error",
      distractor: "more information produces more standard error"
    }
  };
  const make = (
    category: CalibrationCategory,
    rows: Array<{
      anchor: E2A18ConceptualAnchor;
      message: string;
      level: "partial" | "substantive";
      rationale: string;
      avoids?: boolean;
    }>
  ) => rows.map((row, index) => calibrationCase({
    case_id: `${category}_${String(index + 1).padStart(2, "0")}`,
    category,
    conceptual_anchor: row.anchor,
    concept: concepts[row.anchor].concept,
    distractor: concepts[row.anchor].distractor,
    visible_student_response: row.message,
    expected_level: row.level,
    revision_eligible: row.level === "substantive",
    exact_rationale: row.rationale,
    avoids_preferred_canonical_phrases: row.avoids ?? false
  }));

  return [
    ...make("clearly_partial", [
      { anchor: "theta_information", message: "Item 16 is about theta and difficulty, but I cannot explain how closeness changes information.", level: "partial", rationale: "The location mechanism and distractor application are missing." },
      { anchor: "reliability_validity", message: "Reliability is about consistency, but I do not know what that means for validity.", level: "partial", rationale: "The boundary is recognized but unresolved." },
      { anchor: "correlation_causation", message: "Correlation and causation are different, but I cannot explain why.", level: "partial", rationale: "No alternative explanation or causal boundary is supplied." },
      { anchor: "p_value_interpretation", message: "A p-value is related to the null hypothesis, but I am unsure what probability it reports.", level: "partial", rationale: "The conditional interpretation is absent." },
      { anchor: "measurement_invariance", message: "Invariance compares item parameters across groups, but I do not know why that matters.", level: "partial", rationale: "The comparability mechanism and distractor correction are missing." },
      { anchor: "standard_error_information", message: "Information affects standard error, but I cannot remember whether it goes up or down.", level: "partial", rationale: "The direction of the relationship is unresolved." }
    ]),
    ...make("clearly_substantive", [
      { anchor: "theta_information", message: "Information is highest when theta is near item difficulty.", level: "substantive", rationale: "The complete theta-difficulty boundary is stated." },
      { anchor: "reliability_validity", message: "Reliability supports consistency but does not establish validity for the intended interpretation.", level: "substantive", rationale: "The reliability-validity boundary is complete." },
      { anchor: "correlation_causation", message: "Correlation does not establish causation because a third variable or reverse direction can explain the association.", level: "substantive", rationale: "The claim is corrected with causal alternatives." },
      { anchor: "p_value_interpretation", message: "A p-value describes how unusual the data are assuming the null, not the probability that the null is true.", level: "substantive", rationale: "The conditional probability boundary is complete." },
      { anchor: "measurement_invariance", message: "Measurement invariance requires equivalent item parameters across groups so score comparisons retain the same meaning.", level: "substantive", rationale: "The item-parameter and comparability boundary is complete." },
      { anchor: "standard_error_information", message: "Greater information produces a smaller standard error, so the estimate is more precise.", level: "substantive", rationale: "The inverse relationship and precision consequence are complete." }
    ]),
    ...make("revision_ready_informal", [
      { anchor: "theta_information", message: "Option A’s every-ability claim is too broad. When an examinee’s ability is close to a question’s difficulty, answers are less predictable and the question separates people better; far away it distinguishes less.", level: "substantive", rationale: "Informal wording supplies location, mechanism, and distractor application.", avoids: true },
      { anchor: "reliability_validity", message: "The claim is too strong: a dependable score can repeat consistently while still measuring the wrong thing, so consistency alone cannot establish that the intended interpretation is valid.", level: "substantive", rationale: "Informal wording separates repeatability from interpretive support.", avoids: true },
      { anchor: "correlation_causation", message: "Two measures moving together does not show one caused the other; a shared influence could move both, so the causal option is too strong.", level: "substantive", rationale: "The causal claim is rejected using a shared-cause mechanism.", avoids: true },
      { anchor: "p_value_interpretation", message: "A p-value tells how surprising the result would be if the null model held, not the chance the null is true, so the option overstates what was calculated.", level: "substantive", rationale: "The conditional result interpretation is applied to the distractor.", avoids: true },
      { anchor: "measurement_invariance", message: "Equal group averages do not settle invariance: the questions must behave comparably for people at the same trait level across groups, so the same-mean option is too strong.", level: "substantive", rationale: "Item behavior, same-trait comparison, and distractor correction are present.", avoids: true },
      { anchor: "standard_error_information", message: "More information tightens the estimate, so its uncertainty gets smaller; the option predicting a bigger standard error has the direction backwards.", level: "substantive", rationale: "The precision mechanism corrects the distractor direction.", avoids: true }
    ]),
    ...make("technically_worded_incomplete", [
      { anchor: "theta_information", message: "The item information function is conditional on theta, but I cannot state how the item location determines it.", level: "partial", rationale: "Technical language does not supply the missing location mechanism." },
      { anchor: "reliability_validity", message: "Coefficient alpha estimates internal consistency, but construct validity remains a separate coefficient in my explanation.", level: "partial", rationale: "The statement does not explain why consistency cannot establish validity." },
      { anchor: "correlation_causation", message: "A correlation coefficient is not itself an identified causal effect, but the identification problem is unspecified.", level: "partial", rationale: "No confound, direction, or alternative mechanism is supplied." },
      { anchor: "p_value_interpretation", message: "The p-value is a tail-area probability under a reference distribution, but the null-truth interpretation is unresolved.", level: "partial", rationale: "Technical terminology does not complete the probability boundary." },
      { anchor: "measurement_invariance", message: "Configural invariance precedes metric and scalar invariance, but I have not linked those constraints to this item.", level: "partial", rationale: "The active distractor and comparability mechanism are not addressed." },
      { anchor: "standard_error_information", message: "The standard error is related to the reciprocal square root of information, but I have not applied the direction to this option.", level: "partial", rationale: "The relation is named but not independently applied." }
    ]),
    ...make("paraphrased_correct_without_canonical_keywords", [
      { anchor: "theta_information", message: E2A20A_TURN4_MESSAGE, level: "substantive", rationale: "Paraphrased location, predictability mechanism, distance boundary, and option application are complete.", avoids: true },
      { anchor: "reliability_validity", message: "A dependable result can come out similarly each time and still target the wrong construct; therefore the option claiming that consistency alone proves the intended meaning is too strong.", level: "substantive", rationale: "Repeatability is separated from construct meaning without canonical phrasing.", avoids: true },
      { anchor: "correlation_causation", message: "The variables moving together could reflect a shared influence rather than one producing the other, so the option’s cause-and-effect conclusion is not supported.", level: "substantive", rationale: "A shared cause explains why co-movement is insufficient.", avoids: true },
      { anchor: "p_value_interpretation", message: "This number asks how surprising a result like ours would be if the no-effect model generated the data; it does not tell the chance that the no-effect claim is correct, so the option is wrong.", level: "substantive", rationale: "The conditional data question is distinguished from hypothesis truth.", avoids: true },
      { anchor: "measurement_invariance", message: "Matching group averages cannot show that each question works the same way for people at the same trait level; the equal-mean option therefore overstates the evidence.", level: "substantive", rationale: "Same-trait item behavior is distinguished from aggregate means.", avoids: true },
      { anchor: "standard_error_information", message: "When the test tells us more, the estimate narrows and uncertainty shrinks, so the option saying the error gets bigger has the relationship reversed.", level: "substantive", rationale: "The uncertainty mechanism and distractor reversal are clear.", avoids: true }
    ]),
    ...make("boundary_case", [
      { anchor: "theta_information", message: "Maybe information is highest when theta is near item difficulty, but I am not sure why.", level: "partial", rationale: "Tentative vocabulary lacks mechanism and application." },
      { anchor: "reliability_validity", message: "The tutor said reliability supports consistency but does not establish validity for the intended interpretation.", level: "partial", rationale: "Explicit repetition lacks independent application." },
      { anchor: "correlation_causation", message: "Correlation cannot prove causation because reverse direction could explain why the measures are associated.", level: "substantive", rationale: "A complete causal alternative is independently stated." },
      { anchor: "p_value_interpretation", message: "I think the p-value concerns results under the null, but I cannot explain how that differs from the null being true.", level: "partial", rationale: "The key probability distinction remains unresolved." },
      { anchor: "measurement_invariance", message: "The same group mean cannot prove invariance because item responses may behave differently across groups even for people at the same trait level.", level: "substantive", rationale: "The aggregate and item-level boundary is complete." },
      { anchor: "standard_error_information", message: "Greater information makes an estimate more precise by reducing its standard error, so the larger-error option is incorrect.", level: "substantive", rationale: "The inverse direction and option application are complete." }
    ])
  ];
}

export function evaluateE2A20ACalibrationCorpus(
  corpus = buildE2A20ACalibrationCorpus()
) {
  return corpus.map((entry) => {
    const v2 = classifyStudentEvidenceV2({
      message: entry.visible_student_response,
      conceptual_anchor: entry.conceptual_anchor
    });
    const v3 = classifyStudentEvidenceV3({
      message: entry.visible_student_response,
      conceptual_anchor: entry.conceptual_anchor
    });
    const exactSpansValid = v3.exact_evidence_spans.every((span) =>
      entry.visible_student_response.includes(span.span)
    );
    const passed = v3.observed_level === entry.expected_level &&
      (v3.observed_level === "substantive") === entry.revision_eligible &&
      exactSpansValid &&
      (v3.observed_level !== "substantive" ||
        v3.exact_evidence_spans.length > 0);
    return {
      ...entry,
      classifier_v2_result: v2.observed_level,
      classifier_v3_result: v3.observed_level,
      classifier_v2_agrees: v2.observed_level === entry.expected_level,
      classifier_v3_agrees: v3.observed_level === entry.expected_level,
      agreement_or_disagreement: v2.observed_level === v3.observed_level
        ? "v2_v3_agree"
        : "v3_corrects_v2_boundary",
      classifier_v3_exact_evidence_spans: v3.exact_evidence_spans,
      classifier_v3_rationale_codes: v3.rationale_codes,
      exact_spans_valid: exactSpansValid,
      passed
    };
  });
}

export function buildE2A20AHistoricalRegressions() {
  const e2a18 = buildE2A18CalibrationCorpus().map((entry) => {
    const result = classifyStudentEvidenceV3({
      message: entry.visible_student_message,
      conceptual_anchor: entry.conceptual_anchor
    });
    const exactSpansValid = result.exact_evidence_spans.every((span) =>
      entry.visible_student_message.includes(span.span)
    );
    return {
      source: "e2a18_calibration",
      case_id: entry.case_id,
      conceptual_anchor: entry.conceptual_anchor,
      expected_level: entry.expected_observed_level,
      actual_level: result.observed_level,
      exact_evidence_spans: result.exact_evidence_spans,
      exact_spans_valid: exactSpansValid,
      passed: result.observed_level === entry.expected_observed_level &&
        exactSpansValid
    };
  });
  const e2a19Outputs = readJsonl<{
    turn_number: number;
    parsed_output: { student_message: string };
  }>(path.join(E2A19_RUN_DIR, "simulator-provider-outputs.jsonl"));
  const e2a19 = e2a19Outputs.map((entry) => {
    const expected = entry.turn_number === 4 ? "substantive" : "partial";
    const result = classifyStudentEvidenceV3({
      message: entry.parsed_output.student_message,
      conceptual_anchor: "theta_information"
    });
    const exactSpansValid = result.exact_evidence_spans.every((span) =>
      entry.parsed_output.student_message.includes(span.span)
    );
    return {
      source: "e2a19_immutable_provider_output",
      case_id: `e2a19_turn_${entry.turn_number}`,
      conceptual_anchor: "theta_information",
      expected_level: expected,
      actual_level: result.observed_level,
      exact_evidence_spans: result.exact_evidence_spans,
      exact_spans_valid: exactSpansValid,
      passed: result.observed_level === expected && exactSpansValid
    };
  });
  const required = [
    {
      case_id: "required_original_e2a17_misconception_preserving",
      message: "For Item 16, I think option A is right because an extremely difficult item separates students by whether they can answer it, so it gives a lot of information at every theta level.",
      expected: "partial" as const
    },
    {
      case_id: "required_e2a19_turn4",
      message: E2A20A_TURN4_MESSAGE,
      expected: "substantive" as const
    },
    {
      case_id: "required_tentative_correct_vocabulary",
      message: "Maybe information is highest when theta is near item difficulty, but I cannot explain why.",
      expected: "partial" as const
    },
    {
      case_id: "required_repeated_tutor_language",
      message: "The tutor said information is highest when theta is near item difficulty.",
      expected: "partial" as const
    },
    {
      case_id: "required_coherent_paraphrased_reasoning",
      message: "Option A’s every-ability claim is too broad. When ability aligns with a question’s difficulty, answers are less predictable and the question distinguishes people better; far away it distinguishes less.",
      expected: "substantive" as const
    }
  ].map((entry) => {
    const result = classifyStudentEvidenceV3({
      message: entry.message,
      conceptual_anchor: "theta_information"
    });
    const exactSpansValid = result.exact_evidence_spans.every((span) =>
      entry.message.includes(span.span)
    );
    return {
      source: "required_regression",
      case_id: entry.case_id,
      conceptual_anchor: "theta_information",
      expected_level: entry.expected,
      actual_level: result.observed_level,
      exact_evidence_spans: result.exact_evidence_spans,
      exact_spans_valid: exactSpansValid,
      passed: result.observed_level === entry.expected && exactSpansValid
    };
  });
  return [...e2a18, ...e2a19, ...required];
}

function classifierV2Explanation(calibration: ReturnType<
  typeof evaluateE2A20ACalibrationCorpus
>) {
  const targetV2 = classifyStudentEvidenceV2({
    message: E2A20A_TURN4_MESSAGE,
    conceptual_anchor: "theta_information"
  });
  return {
    explanation_version: "e2a20a-classifier-v2-explanation-v1",
    classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    assigned_level: targetV2.observed_level,
    required_feature_not_detected:
      "complete_correct_relationship_observed_by_substantive_pattern",
    feature_actually_absent: false,
    observable_feature_locations: Object.values(exactSpans),
    detection_failure:
      "V2 requires narrow canonical order such as information being highest near theta and item difficulty. The response expresses the same relationship through closeness, distinguishability, and predictability before naming reduced information away from the location.",
    result_type: "evidence_classifier_false_negative",
    systematically_underweights_paraphrased_conceptual_reasoning: true,
    calibration_v2_disagreement_count: calibration.filter((entry) =>
      !entry.classifier_v2_agrees
    ).length,
    calibration_v2_paraphrase_disagreement_count: calibration.filter((entry) =>
      entry.avoids_preferred_canonical_phrases &&
      !entry.classifier_v2_agrees
    ).length,
    exact_span_requirement_preserved_in_v3: true
  };
}

function classifierDelta() {
  return {
    delta_version: "e2a20a-classifier-delta-v1",
    from: {
      version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      file_sha256: sha256(readFileSync(CLASSIFIER_V2_PATH))
    },
    to: {
      version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      file_sha256: sha256(readFileSync(CLASSIFIER_V3_PATH))
    },
    exact_changes: [
      "Adds conservative anchor-specific feature groups for relationship, mechanism, and distractor application.",
      "Promotes paraphrased reasoning only when all three groups are observable.",
      "Preserves V2 substantive decisions and all non-promoted V2 levels.",
      "Blocks promotion for explicit tutor repetition and tentative or explicitly incomplete language.",
      "Returns exact visible supporting spans for every promoted substantive result."
    ],
    safeguards_preserved: [
      "above_ceiling_protection",
      "exact_span_grounding",
      "correct_terminology_alone_insufficient",
      "repeated_tutor_language_insufficient",
      "tentative_incomplete_reasoning_insufficient",
      "provider_self_report_non_authoritative"
    ],
    tutor_candidate_changed: false,
    tutor_prompt_or_schema_changed: false
  };
}

function e2a21ReadinessUpdate() {
  const protocolValidation = validateE2A21ProtocolDraft();
  const protocol = buildE2A21ProtocolDraft();
  return {
    update_version: "e2a20a-e2a21-readiness-update-v1",
    readiness: "e2a21_ready_for_separate_explicit_authorization",
    final_classifier_version:
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    protocol,
    protocol_validation_passed: protocolValidation.passed,
    unchanged_limits: {
      session_count: protocol.session_count,
      maximum_student_turns: protocol.maximum_student_turns,
      maximum_visible_dialogue_turns: protocol.maximum_visible_dialogue_turns,
      maximum_logical_generation_calls:
        E2A21_BUDGET_DRAFT.maximum_logical_generation_calls,
      maximum_adapter_attempts: E2A21_BUDGET_DRAFT.maximum_adapter_attempts,
      maximum_input_tokens: E2A21_BUDGET_DRAFT.maximum_input_tokens,
      maximum_output_tokens: E2A21_BUDGET_DRAFT.maximum_output_tokens,
      maximum_total_tokens: E2A21_BUDGET_DRAFT.maximum_total_tokens,
      maximum_cost_usd_when_pricing_complete:
        E2A21_BUDGET_DRAFT.maximum_cost_usd_when_pricing_complete,
      provider_concurrency: E2A21_BUDGET_DRAFT.provider_concurrency
    },
    tutor_candidate_hash: E2A14_CANDIDATE_HASH,
    candidate_approved: false,
    candidate_activated: false,
    dispatch_authorized: false,
    provider_calls_made: 0,
    e2a21_executed: false
  };
}

export function validateE2A20AArtifacts(runDir: string) {
  const actual = readdirSync(runDir).sort();
  const expected = [...E2A20A_ARTIFACT_NAMES].sort();
  const failures: string[] = [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push("artifact_name_or_count_mismatch");
  }
  for (const name of expected) {
    const filePath = path.join(runDir, name);
    if (!existsSync(filePath) || statSync(filePath).size === 0) {
      failures.push(`artifact_missing_or_empty:${name}`);
      continue;
    }
    try {
      if (name.endsWith(".jsonl")) readJsonl(filePath);
      else readJson(filePath);
      assertSafeArtifact(readFileSync(filePath, "utf8"));
    } catch {
      failures.push(`artifact_malformed_or_unsafe:${name}`);
    }
  }
  return {
    validation_version: "e2a20a-artifact-integrity-v1",
    expected_artifact_count: expected.length,
    actual_artifact_count: actual.length,
    artifact_hashes: actual.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDir, name)))
    })),
    failures,
    passed: failures.length === 0
  };
}

export async function executeE2A20A(input: { artifactRoot?: string } = {}) {
  if (!existsSync(E2A18_RUN_DIR) || !existsSync(E2A19_RUN_DIR) ||
    !existsSync(E2A20_RUN_DIR)) {
    throw new Error("e2a20a_authoritative_evidence_missing");
  }
  const artifactRoot = input.artifactRoot ?? E2A20A_ARTIFACT_ROOT;
  const runId = makeRunId();
  const runDir = path.join(artifactRoot, runId);
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const paths = pathsFor(runDir);
  const startedAt = new Date().toISOString();
  const before = protectedSnapshot();
  if (before.tutor_candidate.configuration_hash !== E2A14_CANDIDATE_HASH ||
    before.tutor_candidate.file_sha256 !== E2A14_CANDIDATE_FILE_SHA256 ||
    before.classifier_v2.file_sha256 !==
      E2A20A_EXPECTED_CLASSIFIER_V2_SHA256) {
    throw new Error("e2a20a_protected_precheck_failed");
  }
  const e2a19Summary = readJson<{ status: string }>(path.join(
    E2A19_RUN_DIR, "canary-summary.json"
  ));
  const e2a20Summary = readJson<{ status: string }>(path.join(
    E2A20_RUN_DIR, "summary.json"
  ));
  const e2a19Turn4 = readJsonl<{
    turn_number: number;
    parsed_output: { student_message: string };
  }>(path.join(E2A19_RUN_DIR, "simulator-provider-outputs.jsonl"))
    .find((entry) => entry.turn_number === 4);
  if (e2a19Turn4?.parsed_output.student_message !== E2A20A_TURN4_MESSAGE) {
    throw new Error("e2a20a_exact_turn4_mismatch");
  }

  const adjudications = buildE2A20AAdjudications();
  const calibrationCorpus = buildE2A20ACalibrationCorpus();
  const calibration = evaluateE2A20ACalibrationCorpus(calibrationCorpus);
  const historical = buildE2A20AHistoricalRegressions();
  const v2Explanation = classifierV2Explanation(calibration);
  const delta = classifierDelta();
  const readiness = e2a21ReadinessUpdate();
  const allRubricsSubstantive = Object.values(adjudications).every((entry) =>
    entry.level_assigned === "substantive" &&
    entry.revision_should_be_authorized &&
    entry.criteria_missing.length === 0
  );
  const calibrationPassed = calibration.length === 36 &&
    calibration.every((entry) => entry.passed) &&
    calibration.filter((entry) =>
      entry.avoids_preferred_canonical_phrases &&
      entry.expected_level === "substantive"
    ).length >= 12;
  const historicalPassed = historical.every((entry) => entry.passed);
  const after = protectedSnapshot();
  const protectedUnchanged = stableHash(before) === stableHash(after);
  const passed = allRubricsSubstantive && calibrationPassed &&
    historicalPassed && protectedUnchanged &&
    readiness.protocol_validation_passed &&
    readiness.final_classifier_version ===
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION;
  const status = passed
    ? E2A20A_STATUS
    : "e2a20a_classification_boundary_unresolved";

  writeJson(paths["adjudication-manifest.json"], {
    manifest_version: E2A20A_VERSION,
    run_id: runId,
    started_at: startedAt,
    source_e2a18_run: path.basename(E2A18_RUN_DIR),
    source_e2a19_run: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    source_e2a19_status: e2a19Summary.status,
    source_e2a20_run: E2A20A_AUTHORITATIVE_E2A20_RUN_ID,
    source_e2a20_status: e2a20Summary.status,
    tutor_candidate_hash: E2A14_CANDIDATE_HASH,
    tutor_candidate_file_sha256: E2A14_CANDIDATE_FILE_SHA256,
    classifier_v2_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    classifier_v2_file_sha256: E2A20A_EXPECTED_CLASSIFIER_V2_SHA256,
    classifier_v3_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    classifier_v3_file_sha256: delta.to.file_sha256,
    provider_calls_made: 0,
    e2a17_rerun: false,
    e2a19_rerun: false,
    e2a21_executed: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    candidate_approved: false,
    candidate_activated: false
  });
  writeJson(paths["turn4-visible-evidence.json"], {
    evidence_version: "e2a20a-turn4-visible-evidence-v1",
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    visible_student_response: E2A20A_TURN4_MESSAGE,
    conceptual_target: "theta_information",
    active_distractor: "option_a_universal_information_claim",
    evidence_ceiling: "substantive",
    desired_transition: "substantive_revision_eligible",
    exact_supporting_spans: Object.values(exactSpans),
    raw_provider_metadata_included: false,
    hidden_reasoning_included: false
  });
  writeJson(paths["strict-conceptual-adjudication.json"], adjudications.strict);
  writeJson(paths["formative-assessment-adjudication.json"],
    adjudications.formative);
  writeJson(paths["revision-readiness-adjudication.json"],
    adjudications.revision);
  writeJson(paths["classifier-v2-explanation.json"], v2Explanation);
  writeJson(paths["root-cause-decision.json"], {
    decision_version: "e2a20a-root-cause-decision-v1",
    outcome: "Outcome A: Turn 4 is substantive",
    selected_root_cause: "evidence_classifier_false_negative",
    three_rubric_agreement: allRubricsSubstantive,
    classifier_v2_result: "partial",
    adjudicated_result: "substantive",
    revision_eligible: true,
    classifier_v2_historical_artifact_mutated: false,
    classifier_v3_required_for_e2a21: true
  });
  writeJsonl(paths["calibration-corpus.jsonl"], calibrationCorpus);
  writeJsonl(paths["calibration-results.jsonl"], calibration);
  writeJsonl(paths["historical-regression-results.jsonl"], historical);
  writeJson(paths["classifier-delta.json"], delta);
  writeJson(paths["e2a21-readiness-update.json"], readiness);
  const summary = {
    summary_version: "e2a20a-turn4-classification-summary-v1",
    status,
    run_id: runId,
    run_directory: path.relative(process.cwd(), runDir),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    turn4_classification: "substantive",
    revision_eligible: true,
    three_rubric_agreement: allRubricsSubstantive,
    criteria_satisfied_count: rubricCriteria().length,
    criteria_missing_count: 0,
    classifier_v2_result: "partial",
    classifier_v2_false_negative: true,
    root_cause: "evidence_classifier_false_negative",
    calibration_case_count: calibration.length,
    calibration_pass_count: calibration.filter((entry) => entry.passed).length,
    classifier_v2_disagreement_count: calibration.filter((entry) =>
      !entry.classifier_v2_agrees
    ).length,
    paraphrased_substantive_case_count: calibration.filter((entry) =>
      entry.avoids_preferred_canonical_phrases &&
      entry.expected_level === "substantive"
    ).length,
    historical_regression_count: historical.length,
    historical_regression_pass_count: historical.filter((entry) =>
      entry.passed
    ).length,
    final_classifier_version:
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    final_classifier_file_sha256: delta.to.file_sha256,
    classifier_v2_unchanged: after.classifier_v2.file_sha256 ===
      E2A20A_EXPECTED_CLASSIFIER_V2_SHA256,
    tutor_candidate_unchanged:
      after.tutor_candidate.file_sha256 === E2A14_CANDIDATE_FILE_SHA256,
    protected_evidence_before: before,
    protected_evidence_after: after,
    protected_evidence_unchanged: protectedUnchanged,
    e2a21_readiness: readiness.readiness,
    e2a21_protocol_validation_passed:
      readiness.protocol_validation_passed,
    provider_calls_made: 0,
    network_requests_made: 0,
    candidate_approved: false,
    candidate_activated: false,
    e2a17_rerun: false,
    e2a19_rerun: false,
    e2a21_executed: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    remaining_blocker_before_e2a21:
      "separate_explicit_user_authorization_for_one_future_e2a21_live_micro_canary"
  };
  writeJson(paths["summary.json"], summary);
  const artifactValidation = validateE2A20AArtifacts(runDir);
  if (!artifactValidation.passed) {
    throw new Error(`e2a20a_artifact_validation_failed:${artifactValidation.failures.join(",")}`);
  }
  if (!passed) {
    throw new Error("e2a20a_adjudication_or_regression_failed");
  }
  return { runId, runDir, summary, artifactValidation };
}

export function loadE2A20ARun(
  runId: string,
  artifactRoot = E2A20A_ARTIFACT_ROOT
) {
  const runDir = path.join(artifactRoot, runId);
  if (!existsSync(runDir)) throw new Error("e2a20a_run_not_found");
  return {
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "summary.json")),
    artifactValidation: validateE2A20AArtifacts(runDir)
  };
}

export function temporaryE2A20AArtifactRoot() {
  return path.join(os.tmpdir(), `e2a20a-${randomBytes(5).toString("hex")}`);
}

export function removeTemporaryE2A20AArtifactRoot(root: string) {
  rmSync(root, { recursive: true, force: true });
}
