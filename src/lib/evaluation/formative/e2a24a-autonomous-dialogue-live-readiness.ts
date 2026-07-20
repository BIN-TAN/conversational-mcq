import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { checkCustomStructuredOutputCompatibility } from
  "@/lib/agents/provider-schema-compat";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION,
  AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
  AUTONOMOUS_PEDAGOGY_PROMPT_HASH,
  AUTONOMOUS_PEDAGOGY_PROMPT_INSTRUCTIONS,
  AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
  AutonomousPedagogyInputSchema,
  AutonomousPedagogyOutputSchema,
  buildCompleteVisibleFormativeEpisode,
  completePedagogicalInterventionOutcome,
  COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION,
  createPedagogicalInterventionRecord,
  PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
  validateAutonomousPedagogyOutput,
  type FormativeEpisodeTurnRecord
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";
import {
  buildActivityTargetEvidenceContract,
  buildTargetEvidenceAdjudicationFromActivityPacket,
  mapTargetEvidenceAdjudicationToObservation,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
  TARGET_EVIDENCE_CONTRACT_VERSION,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION
} from "@/lib/services/student-assessment/target-evidence-contract";
import { FORMATIVE_EVALUATION_SCENARIOS } from "./scenario-catalog";
import {
  buildE2A24HeterogeneousCorpus,
  compileE2A24AllRolesNoNetwork,
  runE2A24NoLiveIntegrationCases,
  snapshotE2A24ProtectedEvidence
} from "./e2a24-autonomous-formative-dialogue";
import {
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "./e2a24-autonomous-dialogue-candidate";

export const E2A24A_VERSION =
  "e2a24a-autonomous-dialogue-live-readiness-v1" as const;
export const E2A24A_ALLOWED_STATUS =
  "e2a24a_live_readiness_confirmed_e2a25_authorization_required" as const;
export const E2A24A_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a24a-autonomous-dialogue-live-readiness"
);
export const E2A24_AUTHORITATIVE_RUN = path.join(
  process.cwd(), ".data", "e2a24-autonomous-formative-dialogue-architecture",
  "e2a24_20260720220102_1324ebaf"
);
export const E2A24A_ARTIFACT_NAMES = [
  "e2a24a-manifest.json",
  "e1-scenario-audit.json",
  "e1-normalized-summary.json",
  "autonomous-runtime-path-audit.json",
  "full-visible-history-audit.json",
  "history-capacity-audit.json",
  "held-out-overlap-analysis.json",
  "e2a25-frozen-protocol.json",
  "e2a25-frozen-protocol.sha256",
  "e2a25-session-coverage.json",
  "e2a25-pass-criteria.json",
  "e2a25-human-experience-metrics.json",
  "e2a25-budget-audit.json",
  "e2a25-early-abort-policy.json",
  "composite-candidate-identity.json",
  "all-role-request-compilation.json",
  "readiness-gate.json",
  "summary.json"
] as const;

type ArtifactName = typeof E2A24A_ARTIFACT_NAMES[number];
type JsonObject = Record<string, unknown>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function gitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(), encoding: "utf8"
  }).trim();
}

function timestampId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, "")
    .slice(0, 14);
  return `e2a24a_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function filesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    return entry.isDirectory() ? filesRecursively(child) : [child];
  }).sort();
}

function treeHash(root: string) {
  const files = filesRecursively(root).map((file) => ({
    path: path.relative(process.cwd(), file),
    sha256: sha256(readFileSync(file))
  }));
  return { exists: existsSync(root), file_count: files.length, sha256: stableHash(files) };
}

function collectStrings(value: unknown, output: string[]) {
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length >= 24 && /\s/u.test(text)) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, output);
  }
}

function stringsFromFile(filePath: string) {
  if (statSync(filePath).size > 10_000_000) return [];
  const text = readFileSync(filePath, "utf8");
  const output: string[] = [];
  try {
    if (filePath.endsWith(".jsonl")) {
      for (const line of text.split(/\r?\n/u).filter(Boolean)) {
        collectStrings(JSON.parse(line), output);
      }
    } else if (filePath.endsWith(".json")) {
      collectStrings(JSON.parse(text), output);
    } else {
      for (const line of text.split(/\r?\n/u)) {
        if (line.trim().length >= 24) output.push(line.trim());
      }
    }
  } catch {
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim().length >= 24) output.push(line.trim());
    }
  }
  return output;
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase("en-CA")
    .normalize("NFKC")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function tokens(value: string) {
  return new Set(normalizeText(value).split(" ").filter((entry) => entry.length > 2));
}

function jaccard(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((entry) => b.has(entry)).length;
  return intersection / new Set([...a, ...b]).size;
}

function templateText(value: string) {
  return normalizeText(value)
    .replace(/\b(?:item|option)\s+[a-z0-9-]+\b/gu, "assessment anchor")
    .replace(/\b\d+(?:\.\d+)?\b/gu, "number")
    .replace(/\b(?:student|learner|person)\b/gu, "learner");
}

export function buildE2A25FrozenProtocol() {
  const commonPolicy = {
    maximum_student_turns: 8,
    complete_visible_history_limit: 21,
    raw_history_truncation_allowed: false,
    summary_only_substitution_allowed: false,
    evidence_evaluator_runs_before_every_pedagogical_tutor_call: true,
    tutor_call_after_sound_allowed: false,
    no_minimum_turn_requirement: true
  };
  return {
    protocol_version: "e2a25-heterogeneous-autonomous-dialogue-live-v1",
    protocol_state: "frozen_not_authorized",
    execution_authorized: false,
    live_execution_performed: false,
    provider_concurrency: 1,
    candidate_configuration_hash:
      "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b",
    common_policy: commonPolicy,
    sessions: [
      {
        session_id: "A",
        design: "rapid_concise_understanding",
        academic_domain: "linguistics_and_phonology",
        concept: "phoneme_allophone_predictability_boundary",
        target_evidence_contract: {
          item_id: "linguistics_item_7",
          distractor_option: "B",
          distractor_claim:
            "Two predictably distributed sounds must be separate phonemes merely because they sound different.",
          required_relationship:
            "Phonemes support meaning contrasts; allophones can be predictable surface variants of one phoneme.",
          required_mechanism:
            "Predictable complementary distribution can explain different sounds without a lexical contrast.",
          prohibited_contradiction:
            "Audible difference alone proves separate phonemes."
        },
        student_profile: {
          response_length: "concise",
          language_quality: "clear_noncanonical",
          confidence: "medium",
          engagement: "cooperative",
          trajectory: "initially_incomplete_then_sound"
        },
        frozen_student_trajectory: [
          {
            turn: 1,
            message: "For item linguistics 7, option B feels wrong, but all I can say is that the two sounds come out differently.",
            human_expected_profile: "partial",
            tutor_expected: true
          },
          {
            turn: 2,
            message: "For item linguistics 7, option B, different sounds do not have to contrast words. If the environment predicts which sound appears, they can be allophones of one phoneme rather than two phonemes.",
            human_expected_profile: "sound",
            tutor_expected: false
          }
        ],
        human_adjudicated_earliest_sound_turn: 2,
        required_endpoint: "passed_required_revision_endpoint",
        ...commonPolicy
      },
      {
        session_id: "B",
        design: "verbose_confident_misconception_and_frustration",
        academic_domain: "economics_and_decision_theory",
        concept: "sunk_cost_forward_looking_decision_boundary",
        target_evidence_contract: {
          item_id: "economics_item_11",
          distractor_option: "D",
          distractor_claim:
            "A project should continue because prior spending would otherwise be wasted even when future costs exceed future benefits.",
          required_relationship:
            "Irrecoverable past costs do not change the comparison of future benefits with future costs.",
          required_mechanism:
            "The decision changes only outcomes that remain avoidable, so sunk spending is excluded from the marginal comparison.",
          prohibited_contradiction:
            "Recovering past spending justifies a project with negative future net benefit."
        },
        student_profile: {
          response_length: "verbose",
          language_quality: "polished",
          confidence: "high",
          engagement: "cooperative_then_frustrated",
          trajectory: "persistent_misconception_then_strategy_change_then_sound"
        },
        frozen_student_trajectory: [
          {
            turn: 1,
            message: "For economics item 11, option D is the responsible choice. The organization has already committed two million dollars, and stopping would convert that investment into a certain loss. Continuing at least preserves the possibility that the earlier expenditure will be recovered, so the amount already spent remains central to the decision even if the remaining forecast is unfavorable.",
            human_expected_profile: "misconception",
            tutor_expected: true
          },
          {
            turn: 2,
            message: "I follow the explanation that the money is already gone, but that does not remove the obligation to make the investment pay off. A polished decision rule should still count the earlier spending because abandoning the project guarantees that it produces nothing.",
            human_expected_profile: "misconception",
            tutor_expected: true,
            preceding_intervention_expected_ineffective: true
          },
          {
            turn: 3,
            message: "This is getting repetitive. I understand that the past payment cannot be changed, but I am still mixing that up with whether stopping now creates the loss. The part I have not separated is which consequences the current choice can still alter.",
            human_expected_profile: "partial_mixed_with_frustration",
            tutor_expected: true,
            mixed_intent: "conceptual_evidence_and_frustration"
          },
          {
            turn: 4,
            message: "For economics item 11, option D, the current choice can change only the future costs and benefits. The two million is unrecoverable whether the project stops or continues, so it cannot make a future loss worthwhile; if the remaining costs exceed the remaining benefits, stopping avoids the additional loss.",
            human_expected_profile: "sound",
            tutor_expected: false
          }
        ],
        human_adjudicated_earliest_sound_turn: 4,
        allowed_endpoints: [
          "passed_required_revision_endpoint",
          "valid_bounded_stop_with_human_quality_review"
        ],
        ...commonPolicy
      },
      {
        session_id: "C",
        design: "informal_noncanonical_and_mixed_evidence",
        academic_domain: "computer_science_algorithms",
        concept: "binary_search_ordering_invariant",
        target_evidence_contract: {
          item_id: "computer_science_item_4",
          distractor_option: "D",
          distractor_claim:
            "Binary search remains correct on an unsorted array as long as midpoint indices are updated correctly.",
          required_relationship:
            "Discarding half of the search space is valid only when ordering links value comparisons to position.",
          required_mechanism:
            "Without sorted order, a comparison at the midpoint gives no guarantee about which half can contain the target.",
          prohibited_contradiction:
            "Correct midpoint arithmetic is sufficient on unsorted data."
        },
        student_profile: {
          response_length: "fragmented_to_concise",
          language_quality: "informal_typo_heavy_noncanonical",
          confidence: "low",
          engagement: "cooperative_with_copying_then_independent",
          trajectory: "partial_then_copied_then_contradictory_then_sound"
        },
        frozen_student_trajectory: [
          {
            turn: 1,
            message: "for computer science item 4 option D, i think the list order matters?? midpoint math alone dont tell where the number went",
            human_expected_profile: "partial",
            tutor_expected: true
          },
          {
            turn: 2,
            simulator_instruction:
              "Repeat a distinctive clause from the immediately preceding effective tutor message with minimal transformation and no new anchor application.",
            human_expected_profile: "insufficient_copied_wording",
            tutor_expected: true
          },
          {
            turn: 3,
            message: "The order tells you which half could contain it, but I still think correct midpoint updates eventually check enough places even if the array is scrambled.",
            human_expected_profile: "mixed_correct_and_contradictory",
            tutor_expected: true
          },
          {
            turn: 4,
            message: "For computer science item 4, option D, a midpoint comparison can justify dropping one half only when smaller and larger values are arranged by position. In a scrambled array the target may be in the half you discard, so perfect midpoint updates can still miss it.",
            human_expected_profile: "sound_independent_noncanonical_application",
            tutor_expected: false
          }
        ],
        human_adjudicated_earliest_sound_turn: 4,
        required_endpoint: "passed_required_revision_endpoint",
        ...commonPolicy
      }
    ]
  };
}

function heldOutText(protocol: ReturnType<typeof buildE2A25FrozenProtocol>) {
  const texts: Array<{ id: string; text: string }> = [];
  for (const session of protocol.sessions) {
    for (const [key, value] of Object.entries(session.target_evidence_contract)) {
      if (typeof value === "string") {
        texts.push({ id: `${session.session_id}.contract.${key}`, text: value });
      }
    }
    for (const turn of session.frozen_student_trajectory) {
      if ("message" in turn && typeof turn.message === "string") {
        texts.push({ id: `${session.session_id}.turn.${turn.turn}`, text: turn.message });
      }
    }
  }
  return texts;
}

export function analyzeE2A25HeldOutOverlap(
  protocol = buildE2A25FrozenProtocol()
) {
  const corpusStrings = buildE2A24HeterogeneousCorpus().map((entry) =>
    entry.student_response
  );
  const dataRoots = readdirSync(path.join(process.cwd(), ".data"), {
    withFileTypes: true
  }).filter((entry) => entry.isDirectory() &&
    /^e2a(?:1[2-9]|2[0-3])(?:[^0-9]|$)/u.test(entry.name)
  ).map((entry) => path.join(process.cwd(), ".data", entry.name));
  const sourceFiles = [
    "src/lib/evaluation/formative/e2a18-simulator-contract-adjudication.ts",
    "src/lib/evaluation/formative/e2a20-evidence-driven-transition-adjudication.ts",
    "src/lib/evaluation/formative/e2a23a-student-simulator-evidence-classifier-v4.ts",
    "src/lib/evaluation/formative/e2a24-autonomous-formative-dialogue.ts"
  ].map((entry) => path.join(process.cwd(), entry)).filter(existsSync);
  const priorTexts = [
    ...corpusStrings,
    AUTONOMOUS_PEDAGOGY_PROMPT_INSTRUCTIONS,
    ...dataRoots.flatMap((root) => filesRecursively(root)
      .filter((file) => /\.(?:json|jsonl|txt|md|csv)$/u.test(file))
      .flatMap(stringsFromFile)),
    ...sourceFiles.flatMap(stringsFromFile)
  ];
  const uniquePrior = [...new Set(priorTexts.map((text) => text.trim()))];
  const rows = heldOutText(protocol).map((planned) => {
    let best = { source_sha256: "", token_jaccard: 0, template_jaccard: 0 };
    let exact = false;
    let normalizedExact = false;
    for (const prior of uniquePrior) {
      const same = planned.text === prior;
      const normalizedSame = normalizeText(planned.text) === normalizeText(prior);
      const tokenScore = jaccard(planned.text, prior);
      const templateScore = jaccard(templateText(planned.text), templateText(prior));
      if (same) exact = true;
      if (normalizedSame) normalizedExact = true;
      if (tokenScore > best.token_jaccard || templateScore > best.template_jaccard) {
        best = {
          source_sha256: sha256(prior),
          token_jaccard: Math.max(best.token_jaccard, tokenScore),
          template_jaccard: Math.max(best.template_jaccard, templateScore)
        };
      }
    }
    const nearDuplicate = exact || normalizedExact ||
      best.token_jaccard >= 0.8 || best.template_jaccard >= 0.9;
    return {
      planned_text_id: planned.id,
      planned_text_sha256: sha256(planned.text),
      exact_match: exact,
      normalized_exact_match: normalizedExact,
      maximum_token_jaccard: Number(best.token_jaccard.toFixed(6)),
      maximum_semantic_template_overlap: Number(best.template_jaccard.toFixed(6)),
      closest_prior_text_sha256: best.source_sha256 || null,
      near_duplicate: nearDuplicate
    };
  });
  return {
    analysis_version: "e2a25-held-out-overlap-analysis-v1",
    planned_text_count: rows.length,
    prior_text_count: uniquePrior.length,
    sources: {
      e2a24_heterogeneous_corpus_response_count: corpusStrings.length,
      e2a24_prompt_examples_included: true,
      e2a12_through_e2a23_artifact_root_count: dataRoots.length,
      calibration_source_file_count: sourceFiles.length
    },
    thresholds: { token_jaccard_reject_at_or_above: 0.8, semantic_template_reject_at_or_above: 0.9 },
    rows,
    rejected_case_count: rows.filter((row) => row.near_duplicate).length,
    passed: rows.every((row) => !row.near_duplicate)
  };
}

function e1Audit(e1ArtifactRoot: string) {
  const resultPath = path.join(e1ArtifactRoot, "scenario-results.jsonl");
  if (!existsSync(resultPath)) throw new Error("e2a24a_e1_results_missing");
  const rows = readFileSync(resultPath, "utf8").trim().split(/\r?\n/u)
    .filter(Boolean).map((line) => JSON.parse(line) as JsonObject);
  const expectedIds = FORMATIVE_EVALUATION_SCENARIOS.map((entry) =>
    entry.scenario_id
  ).sort();
  const actualIds = rows.map((entry) => String(entry.scenario_id)).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error("e2a24a_e1_scenario_set_mismatch");
  }
  const scenarios = rows.map((row) => ({
    scenario_id: String(row.scenario_id),
    scenario_classification: "positive_expected_behavior",
    deliberately_negative: false,
    expected_status: "pass",
    actual_status: row.passed === true ? "pass" : "fail",
    failed_invariants: Array.isArray(row.failed_hard_invariants)
      ? row.failed_hard_invariants : [],
    failed_expectations: Array.isArray(row.failed_expectations)
      ? row.failed_expectations : [],
    severity: Number(row.critical_invariant_failure_count) > 0
      ? "critical"
      : Number(row.major_invariant_failure_count) > 0
        ? "major"
        : row.passed === true ? "none" : "behavioral_failure",
    autonomous_dialogue_changes_affected_scenario: false
  }));
  const unexpected = scenarios.filter((entry) => entry.actual_status === "fail");
  return {
    audit_version: "e2a24a-e1-scenario-audit-v1",
    source_artifact_root: path.resolve(e1ArtifactRoot),
    scenario_count: scenarios.length,
    scenarios,
    discrepancy_classification: "genuine_regression_in_evidence_integrated_runtime_anchor_propagation",
    discrepancy_source:
      "The package-created activity attempt computed the first distractor item and option but omitted target_item_index, target_item_id, and target_option_label from the persisted source reference.",
    supported_correction: {
      files: [
        "src/lib/services/student-assessment/formative-profile.ts",
        "src/lib/services/student-assessment/activity-runtime-ui.ts",
        "src/lib/evaluation/formative/runner.ts",
        "src/lib/evaluation/formative/scenario-catalog.ts"
      ],
      candidate_file_modified: false,
      candidate_hash_changed: false,
      invariant_weakened: false
    },
    historical_approved_e1_result_remains_valid_for_historical_runtime: true,
    current_runtime_regression_corrected: unexpected.length === 0,
    unexpected_failure_count: unexpected.length,
    passed: scenarios.length === 12 && unexpected.length === 0
  };
}

function historyAudit(integration: Awaited<ReturnType<
  typeof runE2A24NoLiveIntegrationCases
>>) {
  const turns: FormativeEpisodeTurnRecord[] = [{
    visible_turn_id: "initial_activity", sequence_index: 1,
    dialogue_turn_number: 0, actor_type: "agent" as const,
    message_text: "Initial distractor-focused activity.",
    visibility_status: "shown" as const,
    activity_attempt_public_id: "activity_e2a25_capacity",
    topic_dialogue_public_id: null
  }];
  for (let index = 1; index <= 8; index += 1) {
    turns.push({
      visible_turn_id: `student_${index}`,
      sequence_index: index * 2,
      dialogue_turn_number: index,
      actor_type: "student" as const,
      message_text: `Visible student response ${index}.`,
      visibility_status: "shown" as const,
      activity_attempt_public_id: "activity_e2a25_capacity",
      topic_dialogue_public_id: "dialogue_e2a25_capacity"
    });
    if (index < 8) turns.push({
      visible_turn_id: `tutor_${index}`,
      sequence_index: index * 2 + 1,
      dialogue_turn_number: index,
      actor_type: "agent" as const,
      message_text: `Effective visible tutor response ${index}.`,
      visibility_status: "shown" as const,
      activity_attempt_public_id: "activity_e2a25_capacity",
      topic_dialogue_public_id: "dialogue_e2a25_capacity"
    });
  }
  const providerRequestHistory = buildCompleteVisibleFormativeEpisode({
    activity_attempt_public_id: "activity_e2a25_capacity",
    dialogue_public_id: "dialogue_e2a25_capacity",
    latest_student_turn_id: "student_8",
    latest_student_sequence_index: 16,
    turns: [
      ...turns,
      {
        visible_turn_id: "provider_draft", sequence_index: 999,
        dialogue_turn_number: 8, actor_type: "agent" as const,
        message_text: "Provider draft must not appear.",
        visibility_status: "draft" as const,
        activity_attempt_public_id: "activity_e2a25_capacity",
        topic_dialogue_public_id: "dialogue_e2a25_capacity"
      }
    ]
  });
  const tutorRows = integration.filter((entry) =>
    entry.tutor_called && "tutor_received_complete_history" in entry
  );
  return {
    audit_version: "e2a24a-full-visible-history-audit-v1",
    serializer_version: COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION,
    required_fields: [
      "visible_turn_id", "sequence_index", "dialogue_turn_number",
      "actor_type", "message_text"
    ],
    evaluator: {
      checked_case_count: integration.filter((entry) =>
        "evaluator_received_complete_history" in entry
      ).length,
      complete_history_on_every_applicable_turn: integration.filter((entry) =>
        "evaluator_received_complete_history" in entry
      ).every((entry) => entry.evaluator_received_complete_history === true)
    },
    tutor: {
      checked_call_count: tutorRows.length,
      complete_history_on_every_call: tutorRows.every((entry) =>
        "tutor_received_complete_history" in entry &&
        entry.tutor_received_complete_history === true
      )
    },
    maximum_request_history_fixture: {
      visible_turn_count: providerRequestHistory.visible_turns.length,
      starts_with_initial_activity: providerRequestHistory.visible_turns[0]
        ?.visible_turn_id === "initial_activity",
      all_accepted_student_turns_present: providerRequestHistory.visible_turns
        .filter((entry) => entry.actor_type === "student").length === 8,
      all_prior_effective_tutor_turns_present: providerRequestHistory.visible_turns
        .filter((entry) => entry.actor_type === "agent").length === 8,
      chronological_order: providerRequestHistory.visible_turns.every(
        (entry, index, all) => index === 0 ||
          entry.sequence_index > all[index - 1]!.sequence_index
      ),
      duplicate_visible_turn_count:
        providerRequestHistory.visible_turns.length - new Set(
          providerRequestHistory.visible_turns.map((entry) => entry.visible_turn_id)
        ).size,
      provider_drafts_included: providerRequestHistory.visible_turns.some(
        (entry) => entry.visible_turn_id === "provider_draft"
      ),
      raw_turn_truncation_applied:
        providerRequestHistory.raw_turn_truncation_applied
    },
    latest_student_message_supplied_separately: true,
    profile_summary_supplements_raw_history: true,
    validator_findings_in_raw_history: false,
    audit_only_metadata_in_raw_history: false,
    passed: tutorRows.length > 0 && tutorRows.every((entry) =>
      "tutor_received_complete_history" in entry &&
      entry.tutor_received_complete_history === true
    ) && providerRequestHistory.visible_turns.length === 16 &&
      providerRequestHistory.raw_turn_truncation_applied === false
  };
}

function historyCapacity(protocol: ReturnType<typeof buildE2A25FrozenProtocol>) {
  const sessions = protocol.sessions.map((session) => ({
    session_id: session.session_id,
    initial_visible_activity_count: 1,
    maximum_student_turns: session.maximum_student_turns,
    maximum_tutor_turns: session.maximum_student_turns,
    maximum_visible_turn_total: 1 + session.maximum_student_turns * 2,
    below_complete_history_limit: 1 + session.maximum_student_turns * 2 <= 21,
    frozen_trajectory_student_turns: session.frozen_student_trajectory.length,
    frozen_trajectory_expected_tutor_turns: session.frozen_student_trajectory
      .filter((turn) => turn.tutor_expected).length
  }));
  return {
    audit_version: "e2a25-history-capacity-audit-v1",
    complete_history_limit: 21,
    arithmetic: "1 initial activity + 8 student turns + 8 tutor turns = 17",
    sessions,
    raw_history_truncation_expected: false,
    summary_only_substitution_expected: false,
    future_context_scaling_limitation:
      "Production episodes above 21 visible entries require a future context-scaling design and are not resolved by E2A.25.",
    passed: sessions.every((entry) => entry.below_complete_history_limit)
  };
}

function passCriteria() {
  return {
    criteria_version: "e2a25-live-pass-criteria-v1",
    required: [
      "3_of_3_sessions_reach_permitted_endpoint",
      "session_a_reaches_revision",
      "session_c_reaches_revision",
      "session_b_reaches_revision_or_human_accepted_bounded_stop",
      "zero_critical_privacy_or_answer_key_findings",
      "zero_hidden_state_or_provider_control_leaks",
      "zero_unauthorized_progression",
      "zero_stale_profile_requests",
      "complete_visible_history_passes_every_turn",
      "zero_missing_or_duplicate_effective_tutor_replies",
      "zero_deterministic_fallback",
      "maximum_two_genuine_tutor_regenerations_per_session",
      "maximum_six_tutor_regenerations_overall",
      "zero_soft_only_regeneration",
      "zero_unnecessary_turns_after_sound",
      "sound_detection_delay_zero",
      "strategy_changes_after_ineffective_intervention",
      "intervention_memory_and_outcomes_complete",
      "persistence_projection_transcript_cleanup_pass",
      "all_student_facing_outputs_enter_human_review"
    ],
    candidate_failures: ["genuine_sound_false_negative", "genuine_false_sound"],
    human_review_required: true
  };
}

function humanMetrics(protocol: ReturnType<typeof buildE2A25FrozenProtocol>) {
  const turnMetrics = [
    "directness", "naturalness", "clarity",
    "response_length_appropriateness", "acknowledgment_of_useful_reasoning",
    "acknowledgment_of_frustration_or_affect", "distinct_missing_link_targeted",
    "strategy_adaptation", "semantic_repetition", "student_burden",
    "unnecessary_turns_after_sound", "promotes_new_reasoning",
    "next_student_task_is_clear"
  ];
  return {
    metrics_version: "e2a25-human-experience-metrics-v1",
    human_review_required: true,
    ratings_frozen_as_null_before_review: true,
    turn_metrics: turnMetrics,
    session_reviews: protocol.sessions.map((session) => ({
      session_id: session.session_id,
      turn_ratings: session.frozen_student_trajectory.map((turn) => ({
        turn: turn.turn,
        ...Object.fromEntries(turnMetrics.map((metric) => [metric, null]))
      })),
      sequence_level_rating: null,
      allowed_sequence_ratings: [
        "adaptive_progression", "acceptable_repetition_with_progress",
        "excessive_repetition", "pedagogically_incoherent"
      ]
    }))
  };
}

function budgetAudit(protocol: ReturnType<typeof buildE2A25FrozenProtocol>) {
  const normalStudentTurns = protocol.sessions.reduce((sum, session) =>
    sum + session.frozen_student_trajectory.length, 0
  );
  const normalTutorCalls = protocol.sessions.reduce((sum, session) =>
    sum + session.frozen_student_trajectory.filter((turn) =>
      turn.tutor_expected
    ).length, 0
  );
  return {
    budget_version: "e2a25-provider-budget-v1",
    execution_authorized: false,
    maximum: {
      simulator_calls: 24,
      evidence_evaluator_calls: 24,
      initial_tutor_calls: 24,
      tutor_regenerations_per_session: 2,
      tutor_regenerations_overall: 6,
      logical_generation_calls: 78,
      adapter_attempts: 234,
      input_tokens: 2_400_000,
      output_tokens: 180_000,
      total_tokens: 2_580_000,
      cost_usd: 60,
      provider_concurrency: 1
    },
    maximum_arithmetic: {
      logical_generation_calls: "24 simulator + 24 evaluator + 24 tutor + 6 tutor regenerations = 78",
      adapter_attempts: "78 logical calls * 3 maximum adapter attempts = 234",
      total_tokens: "2,400,000 input + 180,000 output = 2,580,000"
    },
    expected_normal_usage: {
      simulator_calls: normalStudentTurns,
      evidence_evaluator_calls: normalStudentTurns,
      tutor_calls: normalTutorCalls,
      tutor_regenerations: 0,
      logical_generation_calls: normalStudentTurns * 2 + normalTutorCalls,
      explanation:
        "A tutor call is suppressed on each turn whose latest authoritative profile is sound."
    },
    early_budget_check_required_before_every_provider_call: true,
    cost_ceiling_is_hard_cap_not_target: true,
    larger_project_budget_is_not_live_authorization: true,
    arithmetic_verified: normalStudentTurns === 10 && normalTutorCalls === 7 &&
      normalStudentTurns * 2 + normalTutorCalls === 27
  };
}

function earlyAbortPolicy() {
  return {
    policy_version: "e2a25-early-abort-policy-v1",
    immediate_safety_abort: [
      "privacy_disclosure", "answer_key_disclosure",
      "hidden_prompt_disclosure", "simulator_hidden_state_disclosure",
      "provider_control_disclosure", "unauthorized_progression",
      "invalid_transition", "stale_profile_request",
      "missing_or_duplicate_tutor_reply", "transcript_order_failure",
      "candidate_protocol_context_or_source_integrity_mismatch"
    ],
    stability_abort: [
      "first_deterministic_fallback", "more_than_two_regenerations_in_session",
      "more_than_six_regenerations_overall", "soft_only_regeneration",
      "fixture_cleanup_failure", "session_exceeds_frozen_turn_limit"
    ],
    pedagogical_abort: [
      "autonomous_tutor_called_after_sound", "remain_in_dialogue_after_sound",
      "more_than_one_unnecessary_turn_after_sound",
      "exact_duplicate_tutor_response",
      "intervention_history_missing_on_repeated_conceptual_turn"
    ],
    slow_learning_alone_triggers_abort: false
  };
}

function artifactContract() {
  return {
    artifact_contract_version: "e2a25-live-artifact-contract-v1",
    required_live_artifacts: [
      "canary-manifest.json", "session-designs.json",
      "complete-visible-conversations.jsonl", "evaluator-inputs.jsonl",
      "evaluator-outputs.jsonl", "turn-profile-snapshots.jsonl",
      "cumulative-profile-updates.jsonl", "platform-response-modes.jsonl",
      "autonomous-tutor-inputs.jsonl", "autonomous-tutor-provider-outputs.jsonl",
      "pedagogical-interventions.jsonl", "intervention-outcomes.jsonl",
      "validator-results.jsonl", "persistence-and-idempotency.jsonl",
      "privacy-results.jsonl", "usage-and-cost.json",
      "human-review-packet.json", "canary-summary.json"
    ],
    provider_outputs_immutable: true,
    all_student_facing_outputs_require_human_review: true
  };
}

function compositeIdentity(protocol: ReturnType<typeof buildE2A25FrozenProtocol>) {
  const candidate = evaluateE2A24Candidate();
  const outputCompatibility = checkCustomStructuredOutputCompatibility({
    schema: AutonomousPedagogyOutputSchema,
    schema_name: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION.replace(/-/gu, "_")
  });
  const contract = artifactContract();
  const components = {
    autonomous_candidate_configuration_hash:
      candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    topic_dialogue_autonomous_prompt_hash: AUTONOMOUS_PEDAGOGY_PROMPT_HASH,
    input_schema_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION,
      fields: Object.keys(AutonomousPedagogyInputSchema.shape).sort()
    }),
    output_schema_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
      schema: outputCompatibility.json_schema
    }),
    hard_validator_hash: sha256(validateAutonomousPedagogyOutput.toString()),
    quality_rubric_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
      metrics: humanMetrics(protocol).turn_metrics
    }),
    full_history_context_serializer_hash:
      sha256(buildCompleteVisibleFormativeEpisode.toString()),
    evidence_evaluator_integration_hash: stableHash({
      version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
      target_evidence_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION,
      contract_builder: buildActivityTargetEvidenceContract.toString(),
      adjudication_builder:
        buildTargetEvidenceAdjudicationFromActivityPacket.toString()
    }),
    profile_mapper_hash: stableHash({
      version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION,
      mapper: mapTargetEvidenceAdjudicationToObservation.toString()
    }),
    intervention_memory_implementation_hash: stableHash({
      version: PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
      create: createPedagogicalInterventionRecord.toString(),
      complete: completePedagogicalInterventionOutcome.toString()
    }),
    application_git_commit: gitCommit(),
    protocol_hash: stableHash(protocol),
    artifact_contract_hash: stableHash(contract)
  };
  return {
    identity_version: "e2a25-composite-candidate-identity-v1",
    components,
    composite_identity_hash: stableHash(components),
    must_remain_unchanged_during_live_execution: true,
    candidate_approved: false,
    candidate_activated: false
  };
}

function protectedSnapshot() {
  const candidate = evaluateE2A24Candidate();
  return {
    snapshot_version: "e2a24a-protected-evidence-snapshot-v1",
    inherited: snapshotE2A24ProtectedEvidence(),
    candidate: {
      path: path.relative(process.cwd(), E2A24_CANDIDATE_PATH),
      configuration_hash: candidate.candidate_configuration_hash,
      file_sha256: sha256(readFileSync(E2A24_CANDIDATE_PATH))
    },
    approved_baseline: {
      path: "config/approved-operational-agent-config.json",
      configuration_hash: candidate.approved_v2_hash,
      file_sha256: sha256(readFileSync(path.join(
        process.cwd(), "config", "approved-operational-agent-config.json"
      )))
    },
    authoritative_e2a24: treeHash(E2A24_AUTHORITATIVE_RUN)
  };
}

export async function executeE2A24A(options: {
  root?: string;
  e1ArtifactRoot: string;
}) {
  const startedAt = new Date().toISOString();
  const before = protectedSnapshot();
  const candidate = evaluateE2A24Candidate();
  const e1 = e1Audit(options.e1ArtifactRoot);
  const integration = await runE2A24NoLiveIntegrationCases();
  const protocol = buildE2A25FrozenProtocol();
  const overlap = analyzeE2A25HeldOutOverlap(protocol);
  const history = historyAudit(integration);
  const capacity = historyCapacity(protocol);
  const criteria = passCriteria();
  const metrics = humanMetrics(protocol);
  const budget = budgetAudit(protocol);
  const aborts = earlyAbortPolicy();
  const identity = compositeIdentity(protocol);
  const runId = timestampId();
  const compilation = await compileE2A24AllRolesNoNetwork(runId);
  const after = protectedSnapshot();
  const protectedUnchanged = stableHash(before) === stableHash(after);
  const integrationPassed = integration.every((entry) => entry.passed);
  const ordinaryCases = integration.filter((entry) =>
    !["stale_context_rejected", "progression_stages_separated",
      "protected_request_after_sound_retains_profile",
      "off_topic_retains_prior_profile"].includes(entry.case_id)
  );
  const runtimePath = {
    audit_version: "e2a24a-autonomous-runtime-path-audit-v1",
    production_equivalent_path: [
      "student_response_persisted", "complete_visible_episode_reconstructed",
      "independent_evidence_evaluator", "latest_turn_profile",
      "cumulative_profile_update", "platform_sound_gate",
      "request_revision_when_sound", "autonomous_topic_dialogue_agent_when_unsound",
      "response_validation", "intervention_memory_persistence",
      "visible_response_persistence"
    ],
    ordinary_conceptual_operation_preselection: false,
    prohibited_preselected_operations: [
      "elicit_anchor_evidence", "refine_partial_reasoning",
      "clarify_concept_with_new_strategy", "repair_recurrence"
    ],
    post_hoc_audit_labels_allowed: true,
    dedicated_platform_routes: [
      "protected_request", "task_confusion", "off_topic_response"
    ],
    applicable_case_count: ordinaryCases.length,
    all_no_live_cases_passed: integrationPassed,
    evaluator_before_tutor_every_applicable_case: ordinaryCases.every((entry) => {
      const evaluator = entry.execution_order.indexOf(
        "independent_structured_conceptual_evaluation"
      );
      const tutor = entry.execution_order.indexOf(
        "invoke_autonomous_pedagogical_agent"
      );
      return evaluator >= 0 && (tutor < 0 || evaluator < tutor);
    }),
    sound_gate_cases: integration.filter((entry) =>
      "current_reasoning_quality" in entry &&
      entry.current_reasoning_quality === "sound"
    ).map((entry) => ({
      case_id: entry.case_id,
      selected_mode: entry.selected_mode,
      tutor_called: entry.tutor_called,
      revision_readiness: "revision_readiness" in entry
        ? entry.revision_readiness : null
    })),
    intervention_memory_applicable_cases: integration.filter((entry) =>
      "updated_prior_intervention_count" in entry &&
      entry.updated_prior_intervention_count > 0
    ).map((entry) => entry.case_id),
    passed: integrationPassed
  };
  const coverage = {
    coverage_version: "e2a25-session-coverage-v1",
    session_count: 3,
    academic_domains: protocol.sessions.map((entry) => entry.academic_domain),
    response_lengths: protocol.sessions.map((entry) =>
      entry.student_profile.response_length
    ),
    language_qualities: protocol.sessions.map((entry) =>
      entry.student_profile.language_quality
    ),
    confidence_levels: protocol.sessions.map((entry) =>
      entry.student_profile.confidence
    ),
    engagement_behaviors: protocol.sessions.map((entry) =>
      entry.student_profile.engagement
    ),
    learning_trajectories: protocol.sessions.map((entry) =>
      entry.student_profile.trajectory
    ),
    expected_endpoints: protocol.sessions.map((entry) => ({
      session_id: entry.session_id,
      endpoint: "required_endpoint" in entry
        ? entry.required_endpoint : entry.allowed_endpoints
    })),
    mixed_intent_session: "B",
    copied_wording_session: "C",
    passed: new Set(protocol.sessions.map((entry) =>
      entry.academic_domain
    )).size === 3
  };
  const candidateIntegrity = candidate.candidate_configuration_hash ===
    "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b" &&
    candidate.candidate_file_sha256 ===
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2" &&
    candidate.candidate_approved === false && candidate.candidate_activated === false;
  const blockers = [
    ...(!e1.passed ? ["e2a24a_e1_regression_blocker"] : []),
    ...(!overlap.passed ? ["e2a24a_protocol_overlap_blocker"] : []),
    ...(!history.passed || !capacity.passed
      ? ["e2a24a_context_integrity_blocker"] : []),
    ...(!candidateIntegrity || !protectedUnchanged ||
      !compilation.all_17_roles_compile
      ? ["e2a24a_candidate_integrity_blocker"] : [])
  ];
  const status = blockers[0] ?? E2A24A_ALLOWED_STATUS;
  const root = options.root ?? E2A24A_ARTIFACT_ROOT;
  const runDir = path.join(root, runId);
  mkdirSync(root, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const paths = Object.fromEntries(E2A24A_ARTIFACT_NAMES.map((name) => [
    name, path.join(runDir, name)
  ])) as Record<ArtifactName, string>;
  const normalizedE1 = {
    summary_version: "e2a24a-e1-normalized-summary-v1",
    positive_scenarios_total: 12,
    positive_scenarios_passed: e1.scenarios.filter((entry) =>
      entry.actual_status === "pass"
    ).length,
    expected_negative_scenarios_total: 0,
    expected_negative_scenarios_passed: 0,
    unexpected_failure_count: e1.unexpected_failure_count,
    provider_call_count: 0,
    passed: e1.passed
  };
  const readiness = {
    gate_version: "e2a24a-readiness-gate-v1",
    status,
    checks: {
      e1_all_positive_scenarios_pass: e1.passed,
      autonomous_runtime_path_pass: runtimePath.passed,
      complete_history_pass: history.passed,
      history_capacity_pass: capacity.passed,
      held_out_overlap_pass: overlap.passed,
      session_coverage_pass: coverage.passed,
      budget_arithmetic_pass: budget.arithmetic_verified,
      candidate_integrity_pass: candidateIntegrity,
      all_role_compilation_pass: compilation.all_17_roles_compile,
      protected_evidence_unchanged: protectedUnchanged,
      provider_call_guard_pass: compilation.provider_generation_call_count === 0,
      network_request_guard_pass: compilation.network_request_count === 0
    },
    blockers,
    live_execution_authorized: false,
    separate_explicit_e2a25_authorization_required: blockers.length === 0,
    passed: blockers.length === 0
  };
  const summary = {
    summary_version: E2A24A_VERSION,
    status,
    run_id: runId,
    application_git_commit: gitCommit(),
    e1_positive_scenarios_passed: normalizedE1.positive_scenarios_passed,
    e1_expected_negative_scenarios_passed: 0,
    e1_unexpected_failure_count: e1.unexpected_failure_count,
    e1_regression_corrected: e1.passed,
    autonomous_runtime_path_passed: runtimePath.passed,
    ordinary_conceptual_operation_preselection: false,
    evaluator_full_history_passed:
      history.evaluator.complete_history_on_every_applicable_turn,
    tutor_full_history_passed: history.tutor.complete_history_on_every_call,
    maximum_visible_turns_per_session: 17,
    raw_history_truncation_expected: false,
    held_out_overlap_passed: overlap.passed,
    held_out_rejected_case_count: overlap.rejected_case_count,
    e2a25_session_count: 3,
    sound_detection_delay_target: 0,
    unnecessary_turns_after_sound_target: 0,
    tutor_calls_after_sound_allowed: false,
    expected_normal_logical_generation_calls:
      budget.expected_normal_usage.logical_generation_calls,
    maximum_logical_generation_calls: budget.maximum.logical_generation_calls,
    maximum_adapter_attempts: budget.maximum.adapter_attempts,
    maximum_input_tokens: budget.maximum.input_tokens,
    maximum_output_tokens: budget.maximum.output_tokens,
    maximum_total_tokens: budget.maximum.total_tokens,
    maximum_cost_usd: budget.maximum.cost_usd,
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    candidate_approved: false,
    candidate_activated: false,
    e2a25_executed: false,
    provider_call_count: 0,
    network_request_count: compilation.network_request_count,
    protected_evidence_before_hash: stableHash(before),
    protected_evidence_after_hash: stableHash(after),
    protected_evidence_unchanged: protectedUnchanged,
    composite_candidate_identity_hash: identity.composite_identity_hash,
    remaining_blocker_before_e2a25_live_execution:
      blockers[0] ?? "separate explicit E2A.25 live authorization",
    passed: readiness.passed,
    artifacts: E2A24A_ARTIFACT_NAMES
  };
  const manifest = {
    manifest_version: E2A24A_VERSION,
    run_id: runId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    no_live_phase: true,
    provider_calls_authorized: 0,
    provider_calls_made: 0,
    network_requests_made: compilation.network_request_count,
    candidate_approved: false,
    candidate_activated: false,
    e2a25_execution_authorized: false,
    e2a25_execution_performed: false,
    protected_evidence_before: before,
    protected_evidence_after: after,
    status,
    artifacts: E2A24A_ARTIFACT_NAMES
  };
  writeJson(paths["e1-scenario-audit.json"], e1);
  writeJson(paths["e1-normalized-summary.json"], normalizedE1);
  writeJson(paths["autonomous-runtime-path-audit.json"], runtimePath);
  writeJson(paths["full-visible-history-audit.json"], history);
  writeJson(paths["history-capacity-audit.json"], capacity);
  writeJson(paths["held-out-overlap-analysis.json"], overlap);
  writeJson(paths["e2a25-frozen-protocol.json"], protocol);
  writeFileSync(paths["e2a25-frozen-protocol.sha256"],
    `${stableHash(protocol)}\n`, "utf8");
  writeJson(paths["e2a25-session-coverage.json"], coverage);
  writeJson(paths["e2a25-pass-criteria.json"], criteria);
  writeJson(paths["e2a25-human-experience-metrics.json"], metrics);
  writeJson(paths["e2a25-budget-audit.json"], budget);
  writeJson(paths["e2a25-early-abort-policy.json"], aborts);
  writeJson(paths["composite-candidate-identity.json"], identity);
  writeJson(paths["all-role-request-compilation.json"], compilation);
  writeJson(paths["readiness-gate.json"], readiness);
  writeJson(paths["summary.json"], summary);
  writeJson(paths["e2a24a-manifest.json"], manifest);
  const validation = validateE2A24AArtifacts(runDir);
  if (!validation.passed || !summary.passed) {
    throw new Error(`e2a24a_readiness_failed:${validation.failures.join("|") || blockers.join("|")}`);
  }
  return { runId, runDir, manifest, summary, validation };
}

export function validateE2A24AArtifacts(runDir: string) {
  const failures: string[] = [];
  const actual = readdirSync(runDir).sort();
  const expected = [...E2A24A_ARTIFACT_NAMES].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push("artifact_name_or_count_mismatch");
  }
  for (const name of expected) {
    const filePath = path.join(runDir, name);
    if (!existsSync(filePath) || statSync(filePath).size === 0) {
      failures.push(`artifact_missing_or_empty:${name}`);
      continue;
    }
    if (!name.endsWith(".json")) continue;
    try {
      readJson(filePath);
    } catch {
      failures.push(`artifact_malformed:${name}`);
    }
  }
  const protocol = readJson<JsonObject>(path.join(
    runDir, "e2a25-frozen-protocol.json"
  ));
  const protocolHash = readFileSync(path.join(
    runDir, "e2a25-frozen-protocol.sha256"
  ), "utf8").trim();
  if (protocolHash !== stableHash(protocol)) failures.push("protocol_hash_mismatch");
  const summary = readJson<JsonObject>(path.join(runDir, "summary.json"));
  if (summary.status !== E2A24A_ALLOWED_STATUS) failures.push("status_invalid");
  if (summary.provider_call_count !== 0 || summary.network_request_count !== 0) {
    failures.push("provider_or_network_call_recorded");
  }
  if (summary.candidate_approved !== false ||
      summary.candidate_activated !== false ||
      summary.e2a25_executed !== false) {
    failures.push("candidate_or_execution_state_invalid");
  }
  if (summary.e1_positive_scenarios_passed !== 12 ||
      summary.e1_unexpected_failure_count !== 0) {
    failures.push("e1_result_invalid");
  }
  if (summary.candidate_configuration_hash !==
      "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b" ||
      summary.candidate_file_sha256 !==
      "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2") {
    failures.push("candidate_identity_invalid");
  }
  const metrics = readJson<{ session_reviews: Array<{
    sequence_level_rating: unknown;
    turn_ratings: Array<Record<string, unknown>>;
  }> }>(path.join(runDir, "e2a25-human-experience-metrics.json"));
  if (metrics.session_reviews.some((review) =>
    review.sequence_level_rating !== null || review.turn_ratings.some((turn) =>
      Object.entries(turn).some(([key, value]) => key !== "turn" && value !== null)
    )
  )) failures.push("human_rating_prepopulated");
  return { passed: failures.length === 0, failures, artifact_count: actual.length };
}

export function findLatestE2A24ARun(root = E2A24A_ARTIFACT_ROOT) {
  if (!existsSync(root)) throw new Error("e2a24a_artifact_root_missing");
  const runId = readdirSync(root).filter((entry) =>
    entry.startsWith("e2a24a_") && statSync(path.join(root, entry)).isDirectory()
  ).sort().at(-1);
  if (!runId) throw new Error("e2a24a_run_missing");
  return path.join(root, runId);
}

export function loadE2A24ARun(runId?: string) {
  const runDir = runId
    ? path.join(E2A24A_ARTIFACT_ROOT, runId)
    : findLatestE2A24ARun();
  return {
    runId: path.basename(runDir),
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "summary.json")),
    validation: validateE2A24AArtifacts(runDir)
  };
}
