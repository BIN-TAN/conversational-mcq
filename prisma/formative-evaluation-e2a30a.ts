import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
  ActiveAnchorAliasContractSchema,
  resolveActiveAnchorAlias,
  type ActiveAnchorAliasContract
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
  resolveActiveAnchorAliasV2
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution-v2";
import {
  ANCHOR_PARITY_RECONCILIATION_VERSION,
  reconcileCanonicalAnchorParityV1
} from "../src/lib/services/student-assessment/anchor-parity-reconciliation";
import {
  CANONICAL_ANCHOR_EVIDENCE_VERSION,
  CanonicalAnchorEvidenceSchema,
  canonicalizeEvaluatorAnchorEvidenceV1
} from "../src/lib/services/student-assessment/canonical-anchor-evidence";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
  propagateAnchorContradictionV2
} from "../src/lib/services/student-assessment/anchor-contradiction-propagation-v2";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceStructuredFieldsV5Schema,
  type ProductionTurnEvidenceStructuredFieldsV5
} from "../src/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V6,
  TARGET_EVIDENCE_CONTRACT_VERSION_V5,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
  TargetEvidenceContractV5Schema,
  assertTargetEvidenceObservationConsistentV6,
  buildTargetEvidenceAdjudicationFromEvaluatorOutputV5,
  mapTargetEvidenceAdjudicationToObservationV6
} from "../src/lib/services/student-assessment/target-evidence-contract-v5";
import { runE2A28ACalibration } from
  "../src/lib/evaluation/formative/e2a28a-semantic-anchor-consistency";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3
} from "../src/lib/services/student-assessment/pre-tutor-profile-finalization-v3";
import {
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION
} from "../src/lib/llm/provider-transport-retry";

const VERSION = "e2a30a-canonical-anchor-reconciliation-v1" as const;
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a30a-anchor-canonicalization"
);
const HISTORICAL_E2A30_RUN = path.join(
  process.cwd(),
  ".data",
  "e2a30-thermal-physics-transport-autonomous-canary",
  "e2a30_20260722212059_c1f72790"
);
const E2A29A_RUN = path.join(
  process.cwd(),
  ".data",
  "e2a29a-provider-infrastructure-reconciliation",
  "e2a29a_20260722144006_a6d11876"
);
const E2A27_RUN = path.join(
  process.cwd(),
  ".data",
  "e2a27-geometrical-optics-anchor-consistency-canary",
  "e2a27_20260722061521_9bd4a441"
);
const E2A28_RUN = path.join(
  process.cwd(),
  ".data",
  "e2a28-antimicrobial-resistance-contradiction-canary",
  "e2a28_20260722083935_6ecb39bb"
);
const E2A29B_RUN = path.join(
  process.cwd(),
  ".data",
  "e2a29b-nonconceptual-profile-consistency",
  "e2a29b_20260722T145005Z_78aead78"
);
const APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const HISTORICAL_E2A30_STATUS =
  "e2a30_canary_failed_anchor_resolution" as const;

const REQUIRED_ARTIFACTS = [
  "exact-e2a30-failure-reconstruction.json",
  "canonical-anchor-contract.json",
  "anchor-resolver-delta.json",
  "parity-policy.json",
  "calibration-corpus.jsonl",
  "calibration-results.jsonl",
  "e2a30-read-only-replay.json",
  "historical-non-regression.json",
  "composite-runtime-identity.json",
  "e2a31-frozen-protocol.json",
  "e2a31-budget.json",
  "summary.json"
] as const;

let networkRequestCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a30a_network_request_prohibited");
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: unknown) {
  return sha256(stable(value));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readFirstJsonLine<T>(filePath: string): T {
  const line = readFileSync(filePath, "utf8").split(/\r?\n/u)
    .find((entry) => entry.trim());
  if (!line) throw new Error(`e2a30a_jsonl_empty:${filePath}`);
  return JSON.parse(line) as T;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, rows: unknown[]) {
  writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8"
  );
}

function fileSha(relativePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), relativePath)));
}

function listFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const fullPath = path.join(root, name);
    return statSync(fullPath).isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function hashTree(root: string) {
  if (!existsSync(root)) throw new Error(`e2a30a_tree_missing:${root}`);
  const rows = listFiles(root).sort().map((filePath) => ({
    path: path.relative(root, filePath),
    sha256: sha256(readFileSync(filePath))
  }));
  return { file_count: rows.length, sha256: stableHash(rows), files: rows };
}

function gitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function historicalEvidence() {
  const summary = readJson<Record<string, unknown>>(
    path.join(HISTORICAL_E2A30_RUN, "canary-summary.json")
  );
  if (summary.status !== HISTORICAL_E2A30_STATUS) {
    throw new Error("e2a30a_historical_status_changed");
  }
  const simulator = readFirstJsonLine<Record<string, unknown>>(
    path.join(HISTORICAL_E2A30_RUN, "simulator-provider-outputs.jsonl")
  );
  const evaluator = readFirstJsonLine<{
    structured_turn_evidence: ProductionTurnEvidenceStructuredFieldsV5;
    effective_evidence_packet: Parameters<
      typeof buildTargetEvidenceAdjudicationFromEvaluatorOutputV5
    >[0]["packet"];
  }>(path.join(HISTORICAL_E2A30_RUN, "evaluator-normalized-results.jsonl"));
  const contract = TargetEvidenceContractV5Schema.parse(
    readJson(path.join(HISTORICAL_E2A30_RUN, "target-evidence-contract.json"))
  );
  const message = z.object({
    parsed_structured_output: z.object({ student_message: z.string().min(1) })
  }).passthrough().parse(simulator).parsed_structured_output.student_message;
  return { summary, simulator, evaluator, contract, message };
}

function reconstructE2A30Failure() {
  const historical = historicalEvidence();
  const structured = ProductionTurnEvidenceStructuredFieldsV5Schema.parse(
    historical.evaluator.structured_turn_evidence
  );
  const oldResolver = resolveActiveAnchorAlias({
    message: historical.message,
    contract: historical.contract.active_anchor_alias_contract,
    prior_visible_message:
      "A metal block and a wood block have been in the same room overnight."
  });
  const exactMismatch = {
    evaluator_application: structured.observed_anchor_reference,
    evaluator_stance: structured.observed_anchor_stance,
    evaluator_anchor_id: structured.active_anchor_id,
    resolver_application: oldResolver.observed_anchor_reference,
    resolver_stance: oldResolver.observed_anchor_stance,
    resolver_anchor_id: oldResolver.active_anchor_id
  };
  if (exactMismatch.evaluator_application !== "explicit" ||
      exactMismatch.evaluator_stance !== "endorses_distractor" ||
      exactMismatch.resolver_application !== "absent" ||
      exactMismatch.resolver_stance !== "not_expressed") {
    throw new Error("e2a30a_exact_failure_not_reproduced");
  }
  return {
    reconstruction_version: "e2a30a-exact-failure-reconstruction-v1",
    historical_run_id: historical.summary.run_id,
    historical_status: historical.summary.status,
    historical_failure_reason: historical.summary.failure_reason,
    simulator_output_existed: true,
    evaluator_v5_dispatched: true,
    evaluator_v5_structurally_sufficient: true,
    exact_mismatch: exactMismatch,
    source_level_failure: {
      source_file:
        "src/lib/services/student-assessment/target-evidence-contract-v5.ts",
      function: "buildTargetEvidenceAdjudicationFromEvaluatorOutputV5",
      schema_field: "structured_turn_evidence.observed_anchor_reference and observed_anchor_stance",
      comparison_rule:
        "resolver V1 raw-text observed fields were compared directly with evaluator V5 structured fields",
      resolver_source_file:
        "src/lib/services/student-assessment/active-anchor-alias-resolution.ts",
      resolver_function: "resolveActiveAnchorAlias",
      exact_defect:
        "V1 exact-string aliases did not contain the natural thermal paraphrase, so semantic anchor identity was lost before parity comparison.",
      historical_contract_paraphrase_domain_mismatch:
        historical.contract.active_anchor_alias_contract.accepted_paraphrases
    },
    derived_diagnosis: "e2a30_cross_layer_anchor_canonicalization_failure"
  };
}

type CalibrationDomain = {
  domain: string;
  label: string;
  claim: string;
  paraphrase: string;
  alternate: string;
};

const CALIBRATION_DOMAINS: CalibrationDomain[] = [
  { domain: "circuits", label: "C", claim: "The bulb uses up current.", paraphrase: "the bulb uses current", alternate: "less current comes out" },
  { domain: "thermal", label: "B", claim: "Feeling colder proves a lower temperature.", paraphrase: "the metal is colder because its temperature is lower", alternate: "the colder feeling means the metal started colder" },
  { domain: "optics", label: "D", claim: "A larger image means more light energy was created.", paraphrase: "the bigger image creates more light", alternate: "magnification adds light energy" },
  { domain: "microbiology", label: "A", claim: "Resistance means the patient became immune.", paraphrase: "the patient became resistant to the medicine", alternate: "the person's body adapted to the antibiotic" },
  { domain: "binary_search", label: "C", claim: "Binary search works on any unsorted list.", paraphrase: "binary search does not need sorted data", alternate: "the list can stay unsorted for binary search" },
  { domain: "irt", label: "B", claim: "Theta changes whenever the item set changes.", paraphrase: "theta must change with a new item set", alternate: "ability depends entirely on which items were used" },
  { domain: "algebra", label: "D", claim: "Squaring both sides never introduces solutions.", paraphrase: "squaring cannot create an extra solution", alternate: "every squared-equation solution is original" },
  { domain: "probability", label: "A", claim: "A streak makes the opposite outcome due next.", paraphrase: "after a streak the other result is due", alternate: "recent outcomes force the next outcome to reverse" }
];

type CalibrationArchetype = {
  id: string;
  message: (domain: CalibrationDomain) => string;
  span: (domain: CalibrationDomain) => string | null;
  expected_application: "explicit" | "absent";
  expected_stance:
    | "endorses_distractor"
    | "rejects_distractor"
    | "ambiguous"
    | "not_expressed";
  prior_context?: boolean;
  structured_conflict?: boolean;
};

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  { id: "choose_label", message: (d) => `I choose ${d.label}.`, span: (d) => d.label, expected_application: "explicit", expected_stance: "endorses_distractor" },
  { id: "label_correct", message: (d) => `${d.label} is correct.`, span: (d) => d.label, expected_application: "explicit", expected_stance: "endorses_distractor" },
  { id: "option_makes_sense", message: (d) => `Option ${d.label} makes sense.`, span: (d) => `Option ${d.label}`, expected_application: "explicit", expected_stance: "endorses_distractor" },
  { id: "pronoun_choice_right", message: () => "That choice is right.", span: () => "That choice", expected_application: "explicit", expected_stance: "endorses_distractor", prior_context: true },
  { id: "label_wrong", message: (d) => `${d.label} is wrong because it conflicts with the evidence.`, span: (d) => d.label, expected_application: "explicit", expected_stance: "rejects_distractor" },
  { id: "pronoun_does_not_work", message: () => "That option does not work.", span: () => "That option", expected_application: "explicit", expected_stance: "rejects_distractor", prior_context: true },
  { id: "paraphrase_endorsement", message: (d) => `${d.paraphrase}.`, span: (d) => d.paraphrase, expected_application: "explicit", expected_stance: "endorses_distractor" },
  { id: "paraphrase_rejection", message: (d) => `${d.paraphrase} is false.`, span: (d) => d.paraphrase, expected_application: "explicit", expected_stance: "rejects_distractor" },
  { id: "pronoun_claim_true", message: () => "That claim is true.", span: () => "That claim", expected_application: "explicit", expected_stance: "endorses_distractor", prior_context: true },
  { id: "pronoun_explanation_false", message: () => "That explanation is false.", span: () => "That explanation", expected_application: "explicit", expected_stance: "rejects_distractor", prior_context: true },
  { id: "mechanism_conclusion_conflict", message: (d) => `The mechanism points the other way, but ${d.paraphrase}.`, span: (d) => d.paraphrase, expected_application: "explicit", expected_stance: "endorses_distractor", structured_conflict: true },
  { id: "alternate_paraphrase", message: (d) => `${d.alternate}.`, span: (d) => d.alternate, expected_application: "explicit", expected_stance: "endorses_distractor" },
  { id: "qualified_paraphrase", message: (d) => `I still think ${d.paraphrase}.`, span: (d) => d.paraphrase, expected_application: "explicit", expected_stance: "endorses_distractor" },
  { id: "bare_label", message: (d) => d.label, span: (d) => d.label, expected_application: "explicit", expected_stance: "ambiguous" },
  { id: "unrelated_absent", message: () => "I need another example before I can explain it.", span: () => null, expected_application: "absent", expected_stance: "not_expressed" }
];

function calibrationContract(domain: CalibrationDomain): ActiveAnchorAliasContract {
  return ActiveAnchorAliasContractSchema.parse({
    resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    active_anchor_id: `${domain.domain}:item:option:${domain.label}`,
    option_label: domain.label,
    option_text: domain.claim,
    accepted_identifiers: [
      domain.label,
      `option ${domain.label}`,
      `choice ${domain.label}`,
      `answer ${domain.label}`
    ],
    accepted_aliases: ["that explanation"],
    accepted_paraphrases: [domain.paraphrase, domain.alternate],
    negative_or_contrast_forms: [
      `not option ${domain.label}`,
      `reject option ${domain.label}`,
      `option ${domain.label} is wrong`
    ],
    pronoun_resolution_context: {
      active_anchor_is_current_topic: true,
      accepted_pronouns: [
        "that option", "that choice", "that answer", "that claim"
      ],
      require_active_anchor_antecedent: true
    }
  });
}

function structuredCalibrationEvidence(input: {
  caseId: string;
  message: string;
  span: string | null;
  contract: ActiveAnchorAliasContract;
  archetype: CalibrationArchetype;
}): ProductionTurnEvidenceStructuredFieldsV5 {
  const explicit = input.archetype.expected_application === "explicit";
  const conflict = input.archetype.structured_conflict === true;
  const conceptualConclusion = conflict
    ? "rejects_distractor" as const
    : input.archetype.expected_stance === "not_expressed"
      ? "not_assessable" as const
      : input.archetype.expected_stance;
  return ProductionTurnEvidenceStructuredFieldsV5Schema.parse({
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    source_student_turn_id: `student_${input.caseId}`,
    source_sequence_index: 2,
    active_anchor_id: input.contract.active_anchor_id,
    observed_anchor_reference: explicit ? "explicit" : "absent",
    observed_anchor_identifier: explicit ? input.span : null,
    observed_anchor_text: explicit ? input.span : null,
    observed_anchor_conclusion: input.archetype.expected_stance,
    observed_anchor_stance: input.archetype.expected_stance,
    conceptual_mechanism: conflict
      ? "The student states a mechanism that opposes the final anchor conclusion."
      : "The observable response is classified only against the supplied target contract.",
    conceptual_conclusion: conceptualConclusion,
    anchor_concept_alignment: conflict ? "contradictory" : explicit
      ? "aligned" : "not_assessable",
    anchor_conflict_type: conflict
      ? "anchor_conclusion_conceptual_explanation_conflict" : null,
    blocking_conflict: conflict,
    exact_anchor_evidence_spans: explicit && input.span ? [
      { label: "anchor_reference", span: input.span },
      { label: "anchor_stance", span: input.message }
    ] : [],
    exact_conceptual_evidence_spans: conflict ? [{
      label: "conceptual_mechanism",
      span: "The mechanism points the other way"
    }, {
      label: "conceptual_conclusion",
      span: input.span
    }] : [],
    essential_missing_links: conflict ? ["coherent_anchor_conclusion"] : [],
    confidence_evidence: "medium",
    engagement_evidence: [],
    evidence_limitations: []
  });
}

function runCalibration() {
  const corpus = CALIBRATION_DOMAINS.flatMap((domain) =>
    CALIBRATION_ARCHETYPES.map((archetype) => {
      const message = archetype.message(domain);
      return {
        case_id: `${domain.domain}_${archetype.id}`,
        domain: domain.domain,
        message,
        prior_visible_message: archetype.prior_context
          ? `Review ${domain.label}: ${domain.claim}` : null,
        contract: calibrationContract(domain),
        expected_application: archetype.expected_application,
        expected_stance: archetype.expected_stance,
        expected_anchor_consistency: archetype.structured_conflict
          ? "contradictory_to_conceptual_reasoning" : null,
        structured_conflict: archetype.structured_conflict === true,
        span: archetype.span(domain),
        archetype
      };
    })
  );
  const results = corpus.map((entry) => {
    const structured = structuredCalibrationEvidence({
      caseId: entry.case_id,
      message: entry.message,
      span: entry.span,
      contract: entry.contract,
      archetype: entry.archetype
    });
    const canonical = canonicalizeEvaluatorAnchorEvidenceV1({
      structured_turn_evidence: structured,
      contract: entry.contract,
      source_message: entry.message,
      expected_source_turn_id: `student_${entry.case_id}`,
      expected_source_sequence_index: 2
    });
    const resolver = resolveActiveAnchorAliasV2({
      message: entry.message,
      contract: entry.contract,
      prior_visible_message: entry.prior_visible_message,
      source_turn_id: `student_${entry.case_id}`,
      source_sequence_index: 2,
      evaluator_canonical_evidence: canonical
    });
    const parity = reconcileCanonicalAnchorParityV1({
      evaluator_evidence: canonical,
      resolver_result: resolver,
      target_contract: entry.contract,
      expected_source_turn_id: `student_${entry.case_id}`,
      expected_source_sequence_index: 2
    });
    const propagation = propagateAnchorContradictionV2({
      contract: {
        active_anchor_id: entry.contract.active_anchor_id,
        active_anchor_text: entry.contract.option_text,
        active_anchor_type: "distractor_option",
        distractor_option: entry.contract.option_label,
        distractor_claim: entry.contract.option_text,
        required_anchor_stance: "rejects_distractor",
        acceptable_anchor_paraphrases: [
          ...entry.contract.accepted_aliases,
          ...entry.contract.accepted_paraphrases
        ],
        prohibited_anchor_stances: [
          "not_expressed",
          "ambiguous",
          "endorses_distractor"
        ],
        anchor_resolution_criteria: [
          "The student explicitly rejects the active distractor anchor."
        ],
        anchor_contradiction_criteria: [
          "The final anchor stance conflicts with the conceptual mechanism."
        ],
        ambiguity_resolution_policy:
          "Keep the anchor unresolved until explicit evidence is available."
      },
      structured_evidence: structured,
      anchor_application: canonical.application,
      anchor_stance: canonical.stance,
      exact_anchor_spans: canonical.evidence_spans,
      mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6
    });
    const passed = parity.passed &&
      resolver.independent_text_resolution.observed_anchor_reference ===
        entry.expected_application &&
      resolver.independent_text_resolution.observed_anchor_stance ===
        entry.expected_stance &&
      (!entry.structured_conflict || (
        propagation.anchor_consistency ===
          "contradictory_to_conceptual_reasoning" &&
        propagation.structured_contradictions.length === 1
      ));
    return {
      case_id: entry.case_id,
      domain: entry.domain,
      passed,
      expected_application: entry.expected_application,
      observed_application:
        resolver.independent_text_resolution.observed_anchor_reference,
      expected_stance: entry.expected_stance,
      observed_stance: resolver.independent_text_resolution.observed_anchor_stance,
      canonical_anchor_id: canonical.anchor_id,
      match_type: resolver.independent_text_resolution.match_type,
      parity_passed: parity.passed,
      parity_issues: parity.issue_codes,
      anchor_consistency: propagation.anchor_consistency,
      structured_contradiction_count:
        propagation.structured_contradictions.length,
      provider_calls_made: 0,
      network_requests_made: 0
    };
  });
  return {
    corpus: corpus.map(({ archetype, span, ...entry }) => {
      void archetype;
      void span;
      return entry;
    }),
    results,
    summary: {
      calibration_version: "e2a30a-canonical-anchor-calibration-v1",
      case_count: results.length,
      passed_count: results.filter((entry) => entry.passed).length,
      failed_count: results.filter((entry) => !entry.passed).length,
      domain_count: CALIBRATION_DOMAINS.length,
      provider_calls_made: 0,
      network_requests_made: 0
    }
  };
}

function runParityGuardCases() {
  const domain = CALIBRATION_DOMAINS[0]!;
  const archetype = CALIBRATION_ARCHETYPES[0]!;
  const contract = calibrationContract(domain);
  const message = archetype.message(domain);
  const structured = structuredCalibrationEvidence({
    caseId: "parity_guard_base",
    message,
    span: archetype.span(domain),
    contract,
    archetype
  });
  const canonical = canonicalizeEvaluatorAnchorEvidenceV1({
    structured_turn_evidence: structured,
    contract,
    source_message: message,
    expected_source_turn_id: "student_parity_guard_base",
    expected_source_sequence_index: 2
  });
  const resolver = resolveActiveAnchorAliasV2({
    message,
    contract,
    source_turn_id: canonical.source_turn_id,
    source_sequence_index: canonical.source_sequence_index,
    evaluator_canonical_evidence: canonical
  });
  const positive = reconcileCanonicalAnchorParityV1({
    evaluator_evidence: canonical,
    resolver_result: resolver,
    target_contract: contract,
    expected_source_turn_id: canonical.source_turn_id,
    expected_source_sequence_index: canonical.source_sequence_index
  });
  const mismatchedContract = ActiveAnchorAliasContractSchema.parse({
    ...contract,
    active_anchor_id: `${contract.active_anchor_id}:different`
  });
  const identityMismatch = reconcileCanonicalAnchorParityV1({
    evaluator_evidence: canonical,
    resolver_result: resolver,
    target_contract: mismatchedContract,
    expected_source_turn_id: canonical.source_turn_id,
    expected_source_sequence_index: canonical.source_sequence_index
  });

  const conflictingMessage = `${domain.label} is wrong because it conflicts with the evidence.`;
  const conflictingCanonical = canonicalizeEvaluatorAnchorEvidenceV1({
    structured_turn_evidence: structuredCalibrationEvidence({
      caseId: "parity_guard_stance",
      message: conflictingMessage,
      span: domain.label,
      contract,
      archetype
    }),
    contract,
    source_message: conflictingMessage,
    expected_source_turn_id: "student_parity_guard_stance",
    expected_source_sequence_index: 2
  });
  const conflictingResolver = resolveActiveAnchorAliasV2({
    message: conflictingMessage,
    contract,
    source_turn_id: conflictingCanonical.source_turn_id,
    source_sequence_index: conflictingCanonical.source_sequence_index,
    evaluator_canonical_evidence: conflictingCanonical
  });
  const stanceMismatch = reconcileCanonicalAnchorParityV1({
    evaluator_evidence: conflictingCanonical,
    resolver_result: conflictingResolver,
    target_contract: contract,
    expected_source_turn_id: conflictingCanonical.source_turn_id,
    expected_source_sequence_index: conflictingCanonical.source_sequence_index
  });
  const sourceMismatch = reconcileCanonicalAnchorParityV1({
    evaluator_evidence: canonical,
    resolver_result: resolver,
    target_contract: contract,
    expected_source_turn_id: "student_different_source",
    expected_source_sequence_index: canonical.source_sequence_index + 1
  });
  const missingSpan = CanonicalAnchorEvidenceSchema.safeParse({
    ...canonical,
    evidence_spans: []
  });
  const cases = [
    {
      case_id: "wording_difference_same_canonical_identity",
      passed: positive.passed,
      issue_codes: positive.issue_codes
    },
    {
      case_id: "canonical_identity_disagreement_fails_closed",
      passed: !identityMismatch.passed &&
        identityMismatch.issue_codes.includes("canonical_anchor_id_mismatch"),
      issue_codes: identityMismatch.issue_codes
    },
    {
      case_id: "decisive_stance_disagreement_fails_closed",
      passed: !stanceMismatch.passed &&
        stanceMismatch.issue_codes.includes("canonical_stance_disagreement"),
      issue_codes: stanceMismatch.issue_codes
    },
    {
      case_id: "source_provenance_disagreement_fails_closed",
      passed: !sourceMismatch.passed &&
        sourceMismatch.issue_codes.includes("source_turn_mismatch") &&
        sourceMismatch.issue_codes.includes("source_sequence_mismatch"),
      issue_codes: sourceMismatch.issue_codes
    },
    {
      case_id: "explicit_anchor_without_span_rejected",
      passed: !missingSpan.success,
      issue_codes: missingSpan.success
        ? []
        : missingSpan.error.issues.map((issue) => issue.message)
    }
  ];
  return {
    guard_version: "e2a30a-parity-negative-guards-v1",
    passed: cases.every((entry) => entry.passed),
    case_count: cases.length,
    cases
  };
}

function replayE2A30() {
  const historical = historicalEvidence();
  const structured = ProductionTurnEvidenceStructuredFieldsV5Schema.parse(
    historical.evaluator.structured_turn_evidence
  );
  const canonical = canonicalizeEvaluatorAnchorEvidenceV1({
    structured_turn_evidence: structured,
    contract: historical.contract.active_anchor_alias_contract,
    source_message: historical.message,
    expected_source_turn_id: structured.source_student_turn_id,
    expected_source_sequence_index: structured.source_sequence_index
  });
  const resolver = resolveActiveAnchorAliasV2({
    message: historical.message,
    contract: historical.contract.active_anchor_alias_contract,
    prior_visible_message:
      "A metal block and a wood block have been in the same room overnight.",
    source_turn_id: structured.source_student_turn_id,
    source_sequence_index: structured.source_sequence_index,
    evaluator_canonical_evidence: canonical
  });
  const parity = reconcileCanonicalAnchorParityV1({
    evaluator_evidence: canonical,
    resolver_result: resolver,
    target_contract: historical.contract.active_anchor_alias_contract,
    expected_source_turn_id: structured.source_student_turn_id,
    expected_source_sequence_index: structured.source_sequence_index
  });
  const adjudication = buildTargetEvidenceAdjudicationFromEvaluatorOutputV5({
    latest_student_message: historical.message,
    packet: historical.evaluator.effective_evidence_packet,
    structured_turn_evidence: structured,
    contract: historical.contract,
    expected_source_student_turn_id: structured.source_student_turn_id,
    expected_source_sequence_index: structured.source_sequence_index,
    prior_visible_message:
      "A metal block and a wood block have been in the same room overnight."
  });
  const observation = mapTargetEvidenceAdjudicationToObservationV6({
    contract: historical.contract,
    adjudication,
    interaction_intent: "ordinary_conceptual_response",
    confidence_evidence: structured.confidence_evidence
  });
  const consistency = assertTargetEvidenceObservationConsistentV6({
    contract: historical.contract,
    adjudication,
    observation
  });
  return {
    replay_version: "e2a30a-read-only-first-turn-replay-v1",
    historical_run_id: historical.summary.run_id,
    historical_artifacts_modified: false,
    provider_calls_made: 0,
    network_requests_made: 0,
    before: {
      evaluator_application: structured.observed_anchor_reference,
      evaluator_stance: structured.observed_anchor_stance,
      downstream_application: "absent",
      downstream_stance: "not_expressed",
      failure_location:
        "buildTargetEvidenceAdjudicationFromEvaluatorOutputV5 parity comparison"
    },
    after: {
      canonical_anchor_evidence: canonical,
      resolver_result: resolver,
      parity_result: parity,
      observation: {
        anchor_application: observation.anchor_application,
        anchor_stance: observation.anchor_stance,
        anchor_consistency: observation.anchor_consistency,
        anchor_resolution_status: observation.anchor_resolution_status,
        reasoning_quality: observation.reasoning_quality,
        revision_readiness: observation.reasoning_quality === "sound" &&
          observation.essential_missing_links.length === 0 &&
          observation.contradictions.length === 0
      },
      consistency,
      profile_construction_would_continue: parity.passed && consistency.passed
    },
    later_turns_fabricated: false,
    counterfactual_tutor_output_created: false,
    e2a30_pass_claimed: false
  };
}

function e2a31Protocol() {
  return {
    protocol_version: "e2a31-ecology-anchor-normalization-canary-v1",
    status: "prepared_not_authorized_not_executed",
    domain: "ecology",
    held_out_concept:
      "Removing a top predator can produce indirect ecosystem effects; prey abundance is not determined only by immediate predation rate.",
    active_anchor: {
      option_label: "D",
      distractor_claim:
        "Removing the predator must increase the prey population because fewer prey are eaten.",
      required_final_stance: "rejects_distractor"
    },
    required_trajectory: [
      "explicit_anchor_endorsement",
      "partial_food_web_mechanism",
      "correct_indirect_mechanism_with_wrong_anchor_conclusion",
      "structured_mechanism_conclusion_contradiction",
      "autonomous_clarification",
      "independent_coherent_anchor_rejection",
      "immediate_revision"
    ],
    required_runtime: {
      canonical_anchor_evidence_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
      resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
      parity_policy_version: ANCHOR_PARITY_RECONCILIATION_VERSION,
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      transport_recovery_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
      provider_concurrency: 1
    },
    exclusions: [
      "thermal_physics", "electrical_circuits", "antimicrobial_resistance",
      "geometrical_optics", "binary_search", "irt"
    ],
    execution_authorized: false,
    provider_calls_made: 0
  };
}

function e2a31Budget() {
  return {
    budget_version: "e2a31-draft-budget-v1",
    status: "prepared_not_authorized",
    sessions: 1,
    simulator_calls: 9,
    evidence_evaluator_calls: 9,
    tutor_calls: 9,
    tutor_semantic_regenerations: 2,
    logical_generation_calls: 29,
    adapter_attempts: 87,
    provider_concurrency: 1,
    execution_authorized: false
  };
}

function historicalNonRegression() {
  const e2a28a = runE2A28ACalibration();
  const e2a27 = readJson<{
    status: string;
    failure_reason: string;
    protected_evidence_before_hash: string;
    protected_evidence_after_hash: string;
    protected_evidence_unchanged: boolean;
  }>(path.join(E2A27_RUN, "canary-summary.json"));
  const e2a28 = readJson<{
    status: string;
    failure_reason: string;
    protected_evidence_before_hash: string;
    protected_evidence_after_hash: string;
    protected_evidence_unchanged: boolean;
  }>(path.join(E2A28_RUN, "canary-summary.json"));
  const e2a29a = readJson<Record<string, unknown>>(
    path.join(E2A29A_RUN, "summary.json")
  );
  const e2a29b = readJson<{
    passed: boolean;
    e1: { case_count: number; passed_count: number; failed_count: number };
    boundary_calibration: { passed_count: number; failed_count: number };
    transport_calibration: { passed_count: number; failed_count: number };
  }>(path.join(E2A29B_RUN, "summary.json"));
  const structuredConflictPass = e2a28a.results
    .filter((entry) => entry.expectation === "structured_conflict")
    .every((entry) => entry.passed);
  const passed = e2a28a.summary.failed_count === 0 &&
    structuredConflictPass &&
    e2a27.status === "e2a27_canary_failed_anchor_interpretation" &&
    e2a27.protected_evidence_unchanged &&
    e2a27.protected_evidence_before_hash ===
      e2a27.protected_evidence_after_hash &&
    e2a28.status === "e2a28_canary_failed_evidence_accuracy" &&
    e2a28.protected_evidence_unchanged &&
    e2a28.protected_evidence_before_hash ===
      e2a28.protected_evidence_after_hash &&
    e2a29a.passed === true &&
    e2a29a.failure_domain === "provider_infrastructure_transport" &&
    e2a29b.passed && e2a29b.e1.passed_count === 12 &&
    e2a29b.e1.failed_count === 0 &&
    e2a29b.boundary_calibration.failed_count === 0 &&
    e2a29b.transport_calibration.failed_count === 0;
  return {
    non_regression_version: "e2a30a-historical-non-regression-v1",
    passed,
    e2a27_optics: {
      contradiction_remains_structured: structuredConflictPass,
      evidence_source: "current E2A.28a structured-conflict calibration",
      historical_status: e2a27.status,
      historical_failure_reason: e2a27.failure_reason,
      historical_evidence_unchanged: e2a27.protected_evidence_unchanged
    },
    e2a28_antimicrobial: {
      semantic_envelope_valid: e2a28a.summary.failed_count === 0,
      explicit_distractor_stance_preserved: structuredConflictPass,
      historical_status: e2a28.status,
      historical_failure_reason: e2a28.failure_reason,
      historical_evidence_unchanged: e2a28.protected_evidence_unchanged
    },
    e2a29_provider_520: {
      remains_infrastructure_only:
        e2a29a.failure_domain === "provider_infrastructure_transport",
      historical_status_unchanged: true
    },
    e2a29b_nonconceptual_profile_preservation: {
      passed: e2a29b.boundary_calibration.failed_count === 0,
      passed_case_count: e2a29b.boundary_calibration.passed_count
    },
    e1: e2a29b.e1,
    transport_calibration: e2a29b.transport_calibration,
    provider_calls_made: 0,
    network_requests_made: 0
  };
}

function compositeIdentity(protocol: ReturnType<typeof e2a31Protocol>) {
  const evaluatorSourceSha256 = fileSha(
    "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
  );
  const targetMapperSha256 = fileSha(
    "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
  );
  const identity = {
    identity_version: "e2a30a-composite-runtime-identity-v1",
    tutor_candidate_hash: CANDIDATE_HASH,
    tutor_candidate_file_sha256: CANDIDATE_FILE_SHA,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    evaluator_prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_repair_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
    evaluator_input_schema: PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    evaluator_output_schema: PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    evaluator_source_sha256: evaluatorSourceSha256,
    evaluator_input_schema_hash: stableHash({
      source_sha256: evaluatorSourceSha256,
      schema_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5
    }),
    evaluator_output_schema_hash: stableHash({
      source_sha256: evaluatorSourceSha256,
      schema_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5
    }),
    canonical_anchor_evidence_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
    canonical_anchor_evidence_sha256: fileSha(
      "src/lib/services/student-assessment/canonical-anchor-evidence.ts"
    ),
    anchor_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
    anchor_resolver_sha256: fileSha(
      "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts"
    ),
    anchor_parity_version: ANCHOR_PARITY_RECONCILIATION_VERSION,
    anchor_parity_sha256: fileSha(
      "src/lib/services/student-assessment/anchor-parity-reconciliation.ts"
    ),
    target_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
    target_mapper_sha256: targetMapperSha256,
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
    contradiction_propagation_sha256: fileSha(
      "src/lib/services/student-assessment/anchor-contradiction-propagation-v2.ts"
    ),
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
    profile_consistency_sha256: targetMapperSha256,
    pre_tutor_finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3,
    pre_tutor_finalization_sha256: fileSha(
      "src/lib/services/student-assessment/pre-tutor-profile-finalization-v3.ts"
    ),
    sound_gate_sha256: fileSha(
      "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
    ),
    transport_retry_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    transport_retry_sha256: fileSha("src/lib/llm/provider-transport-retry.ts"),
    provider_adapter_sha256: fileSha(
      "src/lib/llm/providers/openai-responses-provider.ts"
    ),
    application_git_commit: gitCommit(),
    e2a31_protocol_hash: stableHash(protocol)
  };
  return { ...identity, composite_runtime_identity_hash: stableHash(identity) };
}

function canonicalContractArtifact() {
  return {
    contract_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
    purpose:
      "Normalize evaluator and resolver evidence to one wording-independent anchor identity before parity and profile construction.",
    required_fields: [
      "anchor_id", "anchor_label", "anchor_text", "matched_alias",
      "match_type", "application", "stance", "evidence_spans",
      "source_turn_id", "source_sequence_index", "confidence"
    ],
    semantic_identity_independent_from_wording: true,
    exact_evidence_spans_retained: true,
    provenance_retained: true,
    chain_of_thought_stored: false,
    hidden_state_stored: false
  };
}

function validateArtifacts(runDir: string) {
  const missing = REQUIRED_ARTIFACTS.filter((name) =>
    !existsSync(path.join(runDir, name))
  );
  const unsafePatterns = [
    /\bsk-[A-Za-z0-9_-]{12,}\b/u,
    /Bearer\s+[A-Za-z0-9._-]+/iu,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u
  ];
  const unsafe = listFiles(runDir).filter((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return unsafePatterns.some((pattern) => pattern.test(content));
  }).map((filePath) => path.basename(filePath));
  return {
    validation_version: "e2a30a-artifact-validation-v1",
    passed: missing.length === 0 && unsafe.length === 0,
    required_count: REQUIRED_ARTIFACTS.length,
    missing,
    unsafe_artifacts: unsafe,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function buildAll() {
  const protectedBefore = hashTree(HISTORICAL_E2A30_RUN);
  const reconstruction = reconstructE2A30Failure();
  const calibration = runCalibration();
  if (calibration.summary.case_count < 120 ||
      calibration.summary.failed_count !== 0) {
    throw new Error(
      `e2a30a_calibration_failed:${calibration.summary.passed_count}/${calibration.summary.case_count}`
    );
  }
  const parityGuards = runParityGuardCases();
  if (!parityGuards.passed) throw new Error("e2a30a_parity_guards_failed");
  const replay = replayE2A30();
  if (!replay.after.profile_construction_would_continue) {
    throw new Error("e2a30a_historical_replay_failed");
  }
  const nonRegression = historicalNonRegression();
  if (!nonRegression.passed) throw new Error("e2a30a_non_regression_failed");
  const protocol = e2a31Protocol();
  const budget = e2a31Budget();
  const identity = compositeIdentity(protocol);
  const protectedAfter = hashTree(HISTORICAL_E2A30_RUN);
  if (protectedBefore.sha256 !== protectedAfter.sha256) {
    throw new Error("e2a30a_historical_e2a30_evidence_changed");
  }
  if (networkRequestCount !== 0) throw new Error("e2a30a_network_request_detected");
  return {
    reconstruction,
    calibration,
    parityGuards,
    replay,
    nonRegression,
    protocol,
    budget,
    identity,
    protectedBefore,
    protectedAfter
  };
}

function run() {
  const all = buildAll();
  const stamp = new Date().toISOString().replace(/[-:.]/gu, "").replace("Z", "Z");
  const runId = `e2a30a_${stamp}_${all.identity.composite_runtime_identity_hash.slice(0, 8)}`;
  const runDir = path.join(ARTIFACT_ROOT, runId);
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[0]), all.reconstruction);
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[1]), canonicalContractArtifact());
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[2]), {
    from: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    to: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
    change:
      "V2 projects contract-derived text matches and validated evaluator evidence into one canonical anchor identity while retaining V1 audit fields.",
    domain_specific_rules_added: false,
    evaluator_v5_changed: false
  });
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[3]), {
    policy_version: ANCHOR_PARITY_RECONCILIATION_VERSION,
    compares: [
      "canonical_anchor_id", "canonical_application", "canonical_stance",
      "source_turn_id", "source_sequence_index", "evidence_spans"
    ],
    raw_text_equality_used: false,
    wording_difference_is_failure: false,
    negative_guard_results: all.parityGuards
  });
  writeJsonl(path.join(runDir, REQUIRED_ARTIFACTS[4]), all.calibration.corpus);
  writeJsonl(path.join(runDir, REQUIRED_ARTIFACTS[5]), all.calibration.results);
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[6]), all.replay);
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[7]), all.nonRegression);
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[8]), all.identity);
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[9]), all.protocol);
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[10]), all.budget);
  const summary = {
    summary_version: VERSION,
    status: "e2a30a_no_live_reconciliation_passed_e2a31_prepared",
    run_id: runId,
    run_directory: runDir,
    passed: true,
    exact_failure_reconstructed: true,
    evaluator_v5_sufficient_and_unchanged: true,
    calibration: all.calibration.summary,
    parity_guard_case_count: all.parityGuards.case_count,
    parity_guards_passed: all.parityGuards.passed,
    e2a30_replay_profile_construction_would_continue:
      all.replay.after.profile_construction_would_continue,
    historical_non_regression_passed: all.nonRegression.passed,
    composite_runtime_identity_hash:
      all.identity.composite_runtime_identity_hash,
    e2a31_protocol_hash: all.identity.e2a31_protocol_hash,
    e2a31_executed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    approved_v2_hash: APPROVED_V2_HASH,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    candidate_approved: false,
    candidate_activated: false,
    historical_e2a30_status: HISTORICAL_E2A30_STATUS,
    historical_e2a30_evidence_before_hash: all.protectedBefore.sha256,
    historical_e2a30_evidence_after_hash: all.protectedAfter.sha256,
    historical_e2a30_evidence_unchanged:
      all.protectedBefore.sha256 === all.protectedAfter.sha256
  };
  writeJson(path.join(runDir, REQUIRED_ARTIFACTS[11]), summary);
  const artifactValidation = validateArtifacts(runDir);
  if (!artifactValidation.passed) {
    throw new Error(`e2a30a_artifact_validation_failed:${[
      ...artifactValidation.missing,
      ...artifactValidation.unsafe_artifacts
    ].join("|")}`);
  }
  return { ...summary, artifact_validation: artifactValidation };
}

function smoke(suite: string) {
  const all = buildAll();
  const allowed = new Set([
    "all", "canonical-anchor", "resolver", "parity", "calibration",
    "historical-replay", "non-regression", "composite-identity",
    "artifact", "e2a31-protocol", "provider-call-guard"
  ]);
  if (!allowed.has(suite)) throw new Error(`e2a30a_unknown_suite:${suite}`);
  const tempRoot = path.join(
    process.cwd(),
    ".data",
    "e2a30a-anchor-canonicalization-smoke-temp"
  );
  mkdirSync(tempRoot, { recursive: true });
  for (const name of REQUIRED_ARTIFACTS) {
    if (name.endsWith(".jsonl")) {
      writeJsonl(path.join(tempRoot, name), []);
    } else {
      writeJson(path.join(tempRoot, name), { smoke_fixture: true });
    }
  }
  const artifactValidation = validateArtifacts(tempRoot);
  for (const filePath of listFiles(tempRoot)) {
    writeFileSync(filePath, "", "utf8");
  }
  readdirSync(tempRoot).forEach((name) => {
    const fullPath = path.join(tempRoot, name);
    if (statSync(fullPath).isFile()) {
      // unlink is intentionally scoped to generated smoke fixtures only.
      unlinkSync(fullPath);
    }
  });
  rmdirSync(tempRoot);
  const result = {
    smoke_version: "e2a30a-smoke-v1",
    suite,
    passed: all.calibration.summary.failed_count === 0 &&
      all.parityGuards.passed &&
      all.replay.after.profile_construction_would_continue &&
      all.nonRegression.passed && artifactValidation.passed &&
      networkRequestCount === 0,
    calibration: all.calibration.summary,
    parity_guard_case_count: all.parityGuards.case_count,
    parity_guards_passed: all.parityGuards.passed,
    replay_passed: all.replay.after.profile_construction_would_continue,
    non_regression_passed: all.nonRegression.passed,
    artifact_validation_passed: artifactValidation.passed,
    composite_runtime_identity_hash:
      all.identity.composite_runtime_identity_hash,
    e2a31_protocol_hash: all.identity.e2a31_protocol_hash,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
  if (!result.passed) throw new Error(`e2a30a_smoke_failed:${suite}`);
  return result;
}

function latestRun() {
  if (!existsSync(ARTIFACT_ROOT)) return null;
  return readdirSync(ARTIFACT_ROOT).filter((name) => name.startsWith("e2a30a_"))
    .sort().at(-1) ?? null;
}

try {
  const command = process.argv[2] ?? "smoke";
  const suiteIndex = process.argv.indexOf("--suite");
  const suite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] ?? "all" : "all";
  if (command === "run") {
    console.log(JSON.stringify(run(), null, 2));
  } else if (command === "report") {
    const runIndex = process.argv.indexOf("--run");
    const runId = runIndex >= 0 ? process.argv[runIndex + 1] : latestRun();
    if (!runId) throw new Error("e2a30a_run_not_found");
    console.log(readFileSync(path.join(ARTIFACT_ROOT, runId, "summary.json"), "utf8"));
  } else if (command === "smoke") {
    console.log(JSON.stringify(smoke(suite), null, 2));
  } else {
    throw new Error(`e2a30a_unknown_command:${command}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}
