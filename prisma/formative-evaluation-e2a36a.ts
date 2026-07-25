import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type LlmStudentSimulatorInput,
  type LlmStudentSimulatorOutput
} from "../src/lib/evaluation/formative/e2a-schemas";
import { validateLlmStudentSimulatorOutput } from
  "../src/lib/evaluation/formative/llm-student-simulator-validation";
import {
  SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
  buildSelfCorrectionIntentEnvelopeContractV2,
  resolveSelfCorrectionIntentEnvelopeV2,
  visibleMessageContainsConceptualEvidenceCandidateV2,
  type SelfCorrectionConceptualEvidenceStatusV2
} from
  "../src/lib/evaluation/formative/self-correction-intent-envelope-v2";
import { stableHash } from "../src/lib/operational/stable-hash";

const CORRECTION_VERSION =
  "e2a36a-student-self-correction-intent-envelope-correction-v1" as const;
const E2A37_PROTOCOL_VERSION =
  "e2a37-measurement-longitudinal-self-correction-intent-envelope-canary-v1" as const;
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a36a-self-correction-intent-envelope"
);
const HISTORICAL_RUN_ID = "e2a36_20260725033701_3afd3874";
const HISTORICAL_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a36-measurement-reasoning-longitudinal-canary",
  HISTORICAL_RUN_ID
);
const HISTORICAL_STATUS = "e2a36_canary_failed_stability";
const HISTORICAL_PROTOCOL_HASH =
  "5be98a340d561fc0b4ad0fb6e80e29089189d2c91015e53f856032c7bafddc62";
const HISTORICAL_COMPOSITE_IDENTITY =
  "cb2b765c9a358c7cdf4db71b8b5357de7cb86bc7b2b419ca3fab1c02a32347af";
const HISTORICAL_FILE_COUNT = 113;
const HISTORICAL_TREE_SHA256 =
  "7e2983e517009a179b0f75c7c50cf0031bedcf9b829d2383203d9ae462aceadc";
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const EXPECTED_HISTORICAL_HASHES = {
  "canary-summary.json":
    "5e352f980bc36ebda698eba7ff09bec10834ccf1903745eca529ded6632333ff",
  "human-review-packet.json":
    "52338317ca6186b744cbe5f962227938cde9c47b00d17214d4848fb01dc24375",
  "simulator-provider-outputs.jsonl":
    "d74dd76a4b055124c5503f99ac3dc7d5febb3daf6ee5c49051880b5f74d49ff2",
  "evaluator-provider-outputs.jsonl":
    "3b4fe70292af7957cecea1af16afc99f811af1b3049a0f97643102136031717d",
  "autonomous-tutor-provider-outputs.jsonl":
    "4cf004f9fd3020fade9d71552dc8b02235f4557b41fda98560309664f493a12d"
} as const;

const EXPECTED_PROTECTED_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts":
    "98044fed11bd8a1a9ff9151afa21e866e7d0f0624cfdf8cecc455f42700ad941"
} as const;

const PAYLOAD_NAMES = [
  "correction-manifest.json",
  "self-correction-intent-envelope-v2.json",
  "self-correction-intent-envelope-calibration.json",
  "deterministic-regressions.json",
  "e2a36-turn4-offline-replay.json",
  "e2a36-historical-integrity-before.json",
  "e2a36-historical-integrity-after.json",
  "protected-source-integrity.json",
  "e2a37-budget.json",
  "e2a37-artifact-contract.json",
  "e2a37-protocol.json",
  "e2a37-protocol.sha256",
  "e2a37-composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json"
] as const;
const ARTIFACT_NAMES = [...PAYLOAD_NAMES, "artifact-validation.json"] as const;

type JsonRecord = Record<string, unknown>;
type HistoricalSimulatorRow = {
  session_id: string;
  turn: number;
  attempt: number;
  parsed_structured_output: {
    student_message: string;
    rendered_intent:
      | "task_confusion"
      | "conceptual_confusion"
      | "request_example"
      | "misconception_persistence"
      | "partial_explanation"
      | "substantive_explanation"
      | "unsupported_understanding_claim"
      | "off_topic_response"
      | "reengagement"
      | "revision_evidence"
      | "transfer_response"
      | "direct_answer_request"
      | "prompt_injection_attempt";
    expressed_evidence_level: "none" | "minimal" | "partial" | "substantive";
    mentions_focus_option: boolean;
    claims_understanding: boolean;
  };
};

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a36a_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha(filePath: string) {
  return sha256(readFileSync(filePath));
}

function relativeFileSha(relativePath: string) {
  return fileSha(path.join(process.cwd(), relativePath));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const content = readFileSync(filePath, "utf8").trim();
  return content
    ? content.split(/\r?\n/u).map((line) => JSON.parse(line) as T)
    : [];
}

function assertSafe(value: unknown) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?bearer/iu
  ];
  assert(
    !forbidden.some((pattern) => pattern.test(serialized)),
    "e2a36a_forbidden_secret_detected"
  );
}

function writeJson(filePath: string, value: unknown) {
  assertSafe(value);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(filePath) : [filePath];
  }).sort();
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function historicalSnapshot() {
  assert(existsSync(HISTORICAL_RUN_DIR), "e2a36a_historical_run_missing");
  const files = listFiles(HISTORICAL_RUN_DIR).map((filePath) => ({
    path: path.relative(HISTORICAL_RUN_DIR, filePath),
    sha256: fileSha(filePath),
    bytes: statSync(filePath).size,
    owner_writable: (statSync(filePath).mode & 0o200) !== 0
  }));
  const criticalHashes = Object.fromEntries(
    Object.keys(EXPECTED_HISTORICAL_HASHES).map((name) => [
      name,
      fileSha(path.join(HISTORICAL_RUN_DIR, name))
    ])
  );
  const criticalMismatches = Object.entries(EXPECTED_HISTORICAL_HASHES)
    .filter(([name, expected]) => criticalHashes[name] !== expected)
    .map(([name, expected]) => ({
      artifact: name,
      expected_sha256: expected,
      actual_sha256: criticalHashes[name]
    }));
  const summary = readJson<JsonRecord>(
    path.join(HISTORICAL_RUN_DIR, "canary-summary.json")
  );
  const aggregate = stableHash(files.map((entry) => ({
    path: entry.path,
    sha256: entry.sha256,
    bytes: entry.bytes
  })));
  return {
    snapshot_version: "e2a36a-historical-evidence-snapshot-v1",
    historical_run_id: HISTORICAL_RUN_ID,
    historical_status: summary.status,
    historical_passed: summary.passed,
    historical_protocol_hash: summary.protocol_hash,
    historical_composite_runtime_identity_hash:
      summary.frozen_composite_runtime_identity_hash,
    file_count: files.length,
    owner_writable_file_count:
      files.filter((entry) => entry.owner_writable).length,
    aggregate_sha256: aggregate,
    critical_hashes: criticalHashes,
    critical_mismatches: criticalMismatches,
    expected_aggregate_sha256: HISTORICAL_TREE_SHA256,
    files,
    passed:
      summary.status === HISTORICAL_STATUS &&
      summary.passed === false &&
      summary.protocol_hash === HISTORICAL_PROTOCOL_HASH &&
      summary.frozen_composite_runtime_identity_hash ===
        HISTORICAL_COMPOSITE_IDENTITY &&
      files.length === HISTORICAL_FILE_COUNT &&
      files.every((entry) => !entry.owner_writable) &&
      aggregate === HISTORICAL_TREE_SHA256 &&
      criticalMismatches.length === 0
  };
}

function protectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(EXPECTED_PROTECTED_HASHES).map((relativePath) => [
      relativePath,
      relativeFileSha(relativePath)
    ])
  );
  const mismatches = Object.entries(EXPECTED_PROTECTED_HASHES)
    .filter(([relativePath, expected]) => actual[relativePath] !== expected)
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual[relativePath]
    }));
  const candidate = readJson<{ candidate_configuration_hash: string }>(
    path.join(
      process.cwd(),
      "config",
      "candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
    )
  );
  return {
    integrity_version: "e2a36a-protected-source-integrity-v1",
    candidate_configuration_hash:
      candidate.candidate_configuration_hash,
    evaluator_v5_unchanged:
      actual[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ],
    tutor_candidate_unchanged:
      actual[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ],
    learning_profile_and_stopping_policy_unchanged:
      actual[
        "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts"
      ],
    expected_sha256: EXPECTED_PROTECTED_HASHES,
    actual_sha256: actual,
    mismatches,
    passed:
      candidate.candidate_configuration_hash ===
        CANDIDATE_CONFIGURATION_HASH &&
      mismatches.length === 0
  };
}

const calibrationContexts = [
  ["measurement", "reliability", "validity"],
  ["sampling", "volunteers", "population"],
  ["statistics", "p value", "hypothesis probability"],
  ["causal reasoning", "correlation", "causation"],
  ["ecology", "predator removal", "population stability"],
  ["circuits", "current", "voltage"],
  ["thermal physics", "temperature", "heat transfer"],
  ["optics", "image distance", "focal length"],
  ["health sciences", "antibiotic exposure", "resistance"],
  ["algorithms", "sorted input", "search correctness"],
  ["geometry", "equal sides", "equal angles"],
  ["chemistry", "reaction rate", "equilibrium"],
  ["economics", "price change", "demand shift"],
  ["psychology", "association", "mechanism"],
  ["language", "word frequency", "meaning"],
  ["engineering", "repeatability", "accuracy"]
] as const;

type CalibrationArchetype = {
  id: string;
  message: (context: readonly [string, string, string]) => string;
  metadata_intent:
    HistoricalSimulatorRow["parsed_structured_output"]["rendered_intent"];
  evidence_status: SelfCorrectionConceptualEvidenceStatusV2;
  expected_behavior:
    | "self_correction"
    | "reflection_or_uncertainty"
    | "unsupported_understanding_claim"
    | "ordinary_response";
  expected_intent: boolean;
  expected_update: boolean;
  expected_misconception_remains: boolean;
  expected_accepted: boolean;
};

const calibrationArchetypes: CalibrationArchetype[] = [
  {
    id: "evidence_bearing_correction",
    message: ([, mechanism, claim]) =>
      `I was wrong because ${mechanism} does not prove ${claim}.`,
    metadata_intent: "unsupported_understanding_claim",
    evidence_status: "conceptual_update",
    expected_behavior: "self_correction",
    expected_intent: true,
    expected_update: true,
    expected_misconception_remains: false,
    expected_accepted: true
  },
  {
    id: "answer_revision_only",
    message: () => "I was wrong, I choose another option.",
    metadata_intent: "unsupported_understanding_claim",
    evidence_status: "no_conceptual_update",
    expected_behavior: "self_correction",
    expected_intent: true,
    expected_update: false,
    expected_misconception_remains: false,
    expected_accepted: true
  },
  {
    id: "unsupported_understanding",
    message: () => "I understand now.",
    metadata_intent: "unsupported_understanding_claim",
    evidence_status: "no_conceptual_update",
    expected_behavior: "unsupported_understanding_claim",
    expected_intent: false,
    expected_update: false,
    expected_misconception_remains: false,
    expected_accepted: false
  },
  {
    id: "reflection_uncertainty",
    message: () => "Actually, I am not sure anymore.",
    metadata_intent: "partial_explanation",
    evidence_status: "no_conceptual_update",
    expected_behavior: "reflection_or_uncertainty",
    expected_intent: false,
    expected_update: false,
    expected_misconception_remains: false,
    expected_accepted: true
  },
  {
    id: "contradictory_correction",
    message: ([, mechanism, claim]) =>
      `I was wrong, but option D is still correct because ${mechanism} proves ${claim}.`,
    metadata_intent: "revision_evidence",
    evidence_status: "contradictory_conceptual_update",
    expected_behavior: "self_correction",
    expected_intent: true,
    expected_update: true,
    expected_misconception_remains: true,
    expected_accepted: true
  },
  {
    id: "natural_change_what_i_said",
    message: () =>
      "I think I need to change what I said. I was too quick about it.",
    metadata_intent: "unsupported_understanding_claim",
    evidence_status: "no_conceptual_update",
    expected_behavior: "self_correction",
    expected_intent: true,
    expected_update: false,
    expected_misconception_remains: false,
    expected_accepted: true
  },
  {
    id: "restate_with_evidence",
    message: ([, mechanism, claim]) =>
      `Let me revise my answer because ${mechanism} may not establish ${claim}.`,
    metadata_intent: "partial_explanation",
    evidence_status: "conceptual_update",
    expected_behavior: "self_correction",
    expected_intent: true,
    expected_update: true,
    expected_misconception_remains: false,
    expected_accepted: true
  },
  {
    id: "conceptual_update_without_correction_phrase",
    message: ([, mechanism, claim]) =>
      `${mechanism} does not by itself establish ${claim}.`,
    metadata_intent: "partial_explanation",
    evidence_status: "conceptual_update",
    expected_behavior: "ordinary_response",
    expected_intent: false,
    expected_update: true,
    expected_misconception_remains: false,
    expected_accepted: true
  },
  {
    id: "metadata_revision_without_visible_correction",
    message: () => "I understand now.",
    metadata_intent: "revision_evidence",
    evidence_status: "no_conceptual_update",
    expected_behavior: "unsupported_understanding_claim",
    expected_intent: false,
    expected_update: false,
    expected_misconception_remains: false,
    expected_accepted: false
  },
  {
    id: "uncertain_reconsideration",
    message: () => "On second thought, maybe my earlier answer is not right.",
    metadata_intent: "conceptual_confusion",
    evidence_status: "no_conceptual_update",
    expected_behavior: "reflection_or_uncertainty",
    expected_intent: false,
    expected_update: false,
    expected_misconception_remains: false,
    expected_accepted: true
  }
];

function envelopeObservation(input: {
  message: string;
  metadata_intent:
    HistoricalSimulatorRow["parsed_structured_output"]["rendered_intent"];
  evidence_status: SelfCorrectionConceptualEvidenceStatusV2;
}) {
  const update = [
    "conceptual_update",
    "contradictory_conceptual_update"
  ].includes(input.evidence_status);
  return {
    visible_message: input.message,
    simulator_metadata: {
      rendered_intent: input.metadata_intent,
      expressed_evidence_level: update ? "partial" as const : "none" as const,
      claims_understanding:
        input.metadata_intent === "unsupported_understanding_claim"
    },
    conceptual_evidence: {
      status: input.evidence_status,
      source: "deterministic_fixture" as const,
      observable_evidence_present: update,
      independent_application_present: update,
      contradiction_present:
        input.evidence_status === "contradictory_conceptual_update"
    }
  };
}

function runCalibration() {
  const contract = buildSelfCorrectionIntentEnvelopeContractV2();
  const results = calibrationContexts.flatMap((context) =>
    calibrationArchetypes.map((archetype) => {
      const message = archetype.message(context);
      const resolution = resolveSelfCorrectionIntentEnvelopeV2({
        contract,
        observation: envelopeObservation({
          message,
          metadata_intent: archetype.metadata_intent,
          evidence_status: archetype.evidence_status
        })
      });
      return {
        case_id: `${context[0].replace(/\s+/gu, "_")}_${archetype.id}`,
        context: context[0],
        archetype: archetype.id,
        message,
        simulator_metadata_rendered_intent: archetype.metadata_intent,
        conceptual_evidence_status: archetype.evidence_status,
        resolution,
        passed:
          resolution.visible_behavior === archetype.expected_behavior &&
          resolution.self_correction_intent === archetype.expected_intent &&
          resolution.conceptual_evidence_update ===
            archetype.expected_update &&
          resolution.misconception_remains ===
            archetype.expected_misconception_remains &&
          resolution.accepted_by_intent_envelope ===
            archetype.expected_accepted
      };
    })
  );
  return {
    calibration_version:
      "e2a36a-self-correction-intent-envelope-calibration-v1",
    contract_version: contract.contract_version,
    context_count: calibrationContexts.length,
    archetype_count: calibrationArchetypes.length,
    case_count: results.length,
    results,
    passed: results.length >= 150 && results.every((entry) => entry.passed)
  };
}

function revisionSimulatorInput(): LlmStudentSimulatorInput {
  return {
    scenario_id: "e2a36a_intent_envelope_regression",
    scenario_version: "e2a36a-v1",
    expression_variant: 1,
    student_persona: {
      conceptual_state: "partial_understanding",
      task_understanding: "clear",
      engagement: "adequate",
      confidence: "medium",
      communication_style: "direct"
    },
    misconception_context: {
      misconception_id: "generic_concept_boundary",
      student_belief_description: "A synthetic misconception remains active.",
      focus_item_reference: "Item 1",
      focus_option_reference: "D"
    },
    permitted_response: {
      intent: "revision_evidence",
      substantive_evidence_level: "substantive",
      may_show_task_improvement: true,
      may_show_conceptual_improvement: true,
      must_preserve_misconception: false,
      must_remain_off_topic: false,
      must_request_clarification: false,
      must_avoid_claiming_resolution: true
    },
    visible_conversation: [{
      role: "assistant",
      content: "Would you revise what you said?",
      sequence_index: 1
    }],
    latest_assistant_message: "Would you revise what you said?",
    style_constraints: {
      maximum_sentences: 5,
      preferred_length: "short",
      avoid_expert_language: true,
      allow_grammar_imperfection: true,
      avoid_excessive_cooperation: false
    }
  };
}

function simulatorOutput(input: {
  message: string;
  rendered_intent:
    HistoricalSimulatorRow["parsed_structured_output"]["rendered_intent"];
  evidence_level?: "none" | "minimal" | "partial" | "substantive";
  claims_understanding?: boolean;
}): LlmStudentSimulatorOutput {
  return {
    student_message: input.message,
    rendered_intent: input.rendered_intent,
    expressed_evidence_level: input.evidence_level ?? "none",
    mentions_focus_option: /\b(?:option\s+)?D\b/u.test(input.message),
    asks_for_clarification: false,
    claims_understanding: input.claims_understanding ?? false,
    off_topic: false,
    simulator_warnings: []
  };
}

function runRegressions() {
  const contract = buildSelfCorrectionIntentEnvelopeContractV2();
  const required = calibrationArchetypes.slice(0, 5).map((archetype) => {
    const context = calibrationContexts[0];
    const message = archetype.message(context);
    const result = resolveSelfCorrectionIntentEnvelopeV2({
      contract,
      observation: envelopeObservation({
        message,
        metadata_intent: archetype.metadata_intent,
        evidence_status: archetype.evidence_status
      })
    });
    return {
      regression_id: archetype.id,
      message,
      result,
      passed:
        result.self_correction_intent === archetype.expected_intent &&
        result.conceptual_evidence_update === archetype.expected_update &&
        result.misconception_remains ===
          archetype.expected_misconception_remains &&
        result.accepted_by_intent_envelope === archetype.expected_accepted
    };
  });
  const genericAccepted = validateLlmStudentSimulatorOutput({
    simulator_input: revisionSimulatorInput(),
    output: simulatorOutput({
      message:
        "I was wrong because reliability does not prove validity.",
      rendered_intent: "unsupported_understanding_claim",
      evidence_level: "partial"
    })
  });
  const genericRejected = validateLlmStudentSimulatorOutput({
    simulator_input: revisionSimulatorInput(),
    output: simulatorOutput({
      message: "I understand now.",
      rendered_intent: "revision_evidence",
      evidence_level: "minimal",
      claims_understanding: true
    })
  });
  const conceptualCandidateCases = {
    evidence_bearing:
      visibleMessageContainsConceptualEvidenceCandidateV2(
        "I was wrong because reliability does not prove validity."
      ),
    answer_only:
      visibleMessageContainsConceptualEvidenceCandidateV2(
        "I was wrong, I choose another option."
      )
  };
  const sharedValidator = {
    regression_id: "shared_simulator_validator_uses_visible_envelope",
    compatible_metadata_disagreement_issue_codes:
      genericAccepted.issues.map((entry) => entry.rule_code),
    unsupported_claim_issue_codes:
      genericRejected.issues.map((entry) => entry.rule_code),
    passed:
      !genericAccepted.issues.some((entry) =>
        entry.rule_code === "rendered_intent_mismatch"
      ) &&
      genericRejected.issues.some((entry) =>
        entry.rule_code === "rendered_intent_mismatch"
      )
  };
  const candidateSeparation = {
    regression_id: "visible_candidate_does_not_replace_conceptual_evaluation",
    conceptual_candidate_cases: conceptualCandidateCases,
    passed:
      conceptualCandidateCases.evidence_bearing &&
      !conceptualCandidateCases.answer_only
  };
  const results = [...required, sharedValidator, candidateSeparation];
  return {
    suite_version: "e2a36a-deterministic-regressions-v1",
    required_case_count: 5,
    total_case_count: results.length,
    results,
    passed: results.every((entry) => entry.passed)
  };
}

function replayHistoricalTurn4() {
  const rows = readJsonl<HistoricalSimulatorRow>(
    path.join(HISTORICAL_RUN_DIR, "simulator-provider-outputs.jsonl")
  ).filter((entry) => entry.turn === 4);
  assert(rows.length === 2, "e2a36a_turn4_replay_source_count_mismatch");
  const contract = buildSelfCorrectionIntentEnvelopeContractV2();
  const results = rows.map((row) => {
    const output = row.parsed_structured_output;
    const resolution = resolveSelfCorrectionIntentEnvelopeV2({
      contract,
      observation: {
        visible_message: output.student_message,
        simulator_metadata: {
          rendered_intent: output.rendered_intent,
          expressed_evidence_level: output.expressed_evidence_level,
          claims_understanding: output.claims_understanding
        },
        conceptual_evidence: {
          status: "no_conceptual_update",
          source: "immutable_provider_output_replay",
          observable_evidence_present: false,
          independent_application_present: false,
          contradiction_present: false
        }
      }
    });
    const sharedValidator = validateLlmStudentSimulatorOutput({
      simulator_input: revisionSimulatorInput(),
      output: simulatorOutput({
        message: output.student_message,
        rendered_intent: output.rendered_intent,
        evidence_level: output.expressed_evidence_level,
        claims_understanding: output.claims_understanding
      })
    });
    const sharedValidatorIssueCodes = sharedValidator.issues.map((entry) =>
      entry.rule_code
    );
    return {
      session_id: row.session_id,
      turn: row.turn,
      attempt: row.attempt,
      immutable_student_message: output.student_message,
      immutable_simulator_metadata: {
        rendered_intent: output.rendered_intent,
        expressed_evidence_level: output.expressed_evidence_level,
        claims_understanding: output.claims_understanding
      },
      legacy_exact_metadata_agreement:
        output.rendered_intent === "revision_evidence",
      corrected_resolution: resolution,
      shared_validator_issue_codes: sharedValidatorIssueCodes,
      simulator_validation_mismatch:
        sharedValidatorIssueCodes.includes("rendered_intent_mismatch"),
      passed:
        resolution.self_correction_intent &&
        !resolution.conceptual_evidence_update &&
        resolution.accepted_by_intent_envelope &&
        resolution.metadata_alignment === "compatible_disagreement" &&
        !sharedValidatorIssueCodes.includes("rendered_intent_mismatch")
    };
  });
  return {
    replay_version: "e2a36a-turn4-immutable-offline-replay-v1",
    source_run_id: HISTORICAL_RUN_ID,
    source_run_status: HISTORICAL_STATUS,
    source_artifact: "simulator-provider-outputs.jsonl",
    replay_mode: "immutable_provider_output_no_provider_dispatch",
    source_provider_outputs_modified: false,
    e2a36_passed: false,
    e2a36_rerun: false,
    e2a37_executed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    results,
    passed:
      results.every((entry) => entry.passed) &&
      networkRequestCount === 0
  };
}

function buildBudget() {
  return {
    budget_version: "e2a37-bounded-live-budget-v1",
    protocol_only_not_authorized: true,
    sessions: 1,
    simulator_calls: 9,
    evidence_evaluator_calls: 9,
    initial_tutor_calls: 9,
    tutor_regenerations: 2,
    logical_generation_calls: 29,
    adapter_attempts: 87,
    adapter_attempts_per_logical_call: 3,
    transport_retries_per_logical_call: 2,
    input_tokens: 900000,
    output_tokens: 70000,
    total_tokens: 970000,
    cost_usd: 25,
    provider_concurrency: 1
  };
}

function buildArtifactContract() {
  return {
    artifact_contract_version: "e2a37-artifact-contract-v1",
    preparation_artifacts: [...ARTIFACT_NAMES],
    future_live_artifact_requirements: [
      "dispatch-checkpoint.json",
      "simulator-provider-outputs.jsonl",
      "evaluator-provider-outputs.jsonl",
      "autonomous-tutor-provider-outputs.jsonl",
      "self-correction-intent-envelope-results.jsonl",
      "self-correction-evidence-results.jsonl",
      "provider-attempt-results.jsonl",
      "provider-request-tracing.jsonl",
      "human-review-packet.json",
      "canary-summary.json"
    ],
    immutable_provider_outputs_required: true,
    human_review_required: true,
    provider_dispatch_path_present_in_preparation: false
  };
}

function buildProtocol(input: {
  historical: ReturnType<typeof historicalSnapshot>;
  protectedIntegrity: ReturnType<typeof protectedSourceIntegrity>;
  calibration: ReturnType<typeof runCalibration>;
  regressions: ReturnType<typeof runRegressions>;
  replay: ReturnType<typeof replayHistoricalTurn4>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const envelopeContract =
    buildSelfCorrectionIntentEnvelopeContractV2();
  const core = {
    protocol_version: E2A37_PROTOCOL_VERSION,
    protocol_state: "prepared_not_authorized_not_executable",
    source_stage: "e2a36a_no_live_correction",
    source_historical_run_id: HISTORICAL_RUN_ID,
    source_historical_run_status: HISTORICAL_STATUS,
    source_historical_run_passed: false,
    historical_evidence_unchanged: input.historical.passed,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    contract_versions: {
      self_correction_intent_envelope:
        SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
      evaluator: "production-turn-evidence-evaluator-v5",
      tutor_candidate: "e2a24-autonomous-dialogue-candidate-v1",
      learning_profile: "learning_profile_evolution_v1",
      stopping_policy: "adaptive-stopping-policy-v1"
    },
    contract_hashes: {
      self_correction_intent_envelope: stableHash(envelopeContract),
      self_correction_intent_envelope_source: relativeFileSha(
        "src/lib/evaluation/formative/self-correction-intent-envelope-v2.ts"
      ),
      shared_simulator_validator: relativeFileSha(
        "src/lib/evaluation/formative/llm-student-simulator-validation.ts"
      ),
      evaluator_v5:
        input.protectedIntegrity.actual_sha256[
          "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
        ],
      tutor_candidate:
        input.protectedIntegrity.actual_sha256[
          "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
        ],
      learning_profile_and_stopping_policy:
        input.protectedIntegrity.actual_sha256[
          "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts"
        ]
    },
    authority_boundary: {
      visible_interaction_behavior_primary: true,
      simulator_metadata_non_authoritative: true,
      conceptual_evidence_separate: true,
      exact_metadata_equality_required: false
    },
    frozen_source_scenario: {
      protocol_hash: HISTORICAL_PROTOCOL_HASH,
      composite_runtime_identity_hash: HISTORICAL_COMPOSITE_IDENTITY,
      domain: "educational_measurement_measurement_theory",
      scenario_reused_only_for_corrected_boundary_verification: true
    },
    gates: {
      calibration_case_count: input.calibration.case_count,
      calibration_passed: input.calibration.passed,
      deterministic_regressions_passed: input.regressions.passed,
      immutable_turn4_replay_passed: input.replay.passed,
      protected_sources_unchanged: input.protectedIntegrity.passed,
      historical_evidence_unchanged: input.historical.passed,
      provider_call_guard_required: true
    },
    budget: input.budget,
    artifact_contract_hash: stableHash(input.artifactContract),
    execution_authorized: false,
    live_execution_performed: false,
    provider_dispatch_path_present: false,
    candidate_approved: false,
    candidate_activated: false
  };
  return {
    ...core,
    protocol_hash: stableHash(core),
    passed:
      Object.values(core.gates).every((value) =>
        typeof value === "number" ? value >= 150 : value === true
      )
  };
}

function buildCompositeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  historical: ReturnType<typeof historicalSnapshot>;
  protectedIntegrity: ReturnType<typeof protectedSourceIntegrity>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const identity = {
    identity_version: "e2a37-composite-runtime-identity-v1",
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    self_correction_intent_envelope_version:
      SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
    self_correction_intent_envelope_source_sha256: relativeFileSha(
      "src/lib/evaluation/formative/self-correction-intent-envelope-v2.ts"
    ),
    shared_simulator_validator_sha256: relativeFileSha(
      "src/lib/evaluation/formative/llm-student-simulator-validation.ts"
    ),
    evaluator_v5_sha256:
      input.protectedIntegrity.actual_sha256[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ],
    tutor_candidate_sha256:
      input.protectedIntegrity.actual_sha256[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ],
    learning_profile_and_stopping_policy_sha256:
      input.protectedIntegrity.actual_sha256[
        "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts"
      ],
    historical_e2a36_tree_sha256: input.historical.aggregate_sha256,
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract)
  };
  return {
    ...identity,
    composite_runtime_identity_hash: stableHash(identity)
  };
}

function validateArtifacts(runDirectory: string) {
  const files = readdirSync(runDirectory).sort();
  const missing = ARTIFACT_NAMES.filter((name) =>
    name !== "artifact-validation.json" && !files.includes(name)
  );
  const unexpected = files.filter((name) =>
    !ARTIFACT_NAMES.includes(name as typeof ARTIFACT_NAMES[number])
  );
  const artifacts = files.map((name) => ({
    name,
    sha256: fileSha(path.join(runDirectory, name)),
    bytes: statSync(path.join(runDirectory, name)).size
  }));
  return {
    validation_version: "e2a36a-artifact-validation-v1",
    expected_artifact_count: ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: files.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    artifacts,
    passed:
      missing.length === 0 &&
      unexpected.length === 0 &&
      files.length === ARTIFACT_NAMES.length - 1
  };
}

function buildAndWriteArtifacts(outputDirectory: string) {
  assert(
    !existsSync(outputDirectory) || readdirSync(outputDirectory).length === 0,
    "e2a36a_artifact_directory_not_empty"
  );
  mkdirSync(outputDirectory, { recursive: true });
  const historicalBefore = historicalSnapshot();
  const protectedIntegrity = protectedSourceIntegrity();
  const contract = buildSelfCorrectionIntentEnvelopeContractV2();
  const calibration = runCalibration();
  const regressions = runRegressions();
  const replay = replayHistoricalTurn4();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const protocol = buildProtocol({
    historical: historicalBefore,
    protectedIntegrity,
    calibration,
    regressions,
    replay,
    budget,
    artifactContract
  });
  const composite = buildCompositeIdentity({
    protocol,
    historical: historicalBefore,
    protectedIntegrity,
    budget,
    artifactContract
  });
  const historicalAfter = historicalSnapshot();
  const historicalUnchanged =
    historicalBefore.aggregate_sha256 === historicalAfter.aggregate_sha256 &&
    historicalBefore.file_count === historicalAfter.file_count &&
    historicalBefore.passed &&
    historicalAfter.passed;
  const providerGuard = {
    guard_version: "e2a36a-provider-call-guard-v1",
    execution_mode: "deterministic_no_live",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    fetch_requests_observed: networkRequestCount,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed: networkRequestCount === 0
  };
  const summary = {
    summary_version: "e2a36a-summary-v1",
    status:
      protocol.passed &&
      historicalUnchanged &&
      providerGuard.passed
        ? "e2a36a_correction_verified_e2a37_protocol_prepared"
        : "e2a36a_correction_not_ready",
    correction_version: CORRECTION_VERSION,
    contract_version: contract.contract_version,
    calibration_case_count: calibration.case_count,
    calibration_passed: calibration.passed,
    regressions_passed: regressions.passed,
    historical_replay_passed: replay.passed,
    e2a36_historical_run_id: HISTORICAL_RUN_ID,
    e2a36_historical_status: HISTORICAL_STATUS,
    e2a36_historical_passed: false,
    e2a36_historical_evidence_unchanged: historicalUnchanged,
    e2a36_rerun: false,
    e2a37_protocol_version: protocol.protocol_version,
    e2a37_protocol_hash: protocol.protocol_hash,
    e2a37_composite_runtime_identity_hash:
      composite.composite_runtime_identity_hash,
    e2a37_execution_authorized: false,
    e2a37_live_execution_performed: false,
    evaluator_v5_unchanged: protectedIntegrity.evaluator_v5_unchanged,
    tutor_candidate_unchanged: protectedIntegrity.tutor_candidate_unchanged,
    learning_profile_unchanged:
      protectedIntegrity.learning_profile_and_stopping_policy_unchanged,
    stopping_policy_unchanged:
      protectedIntegrity.learning_profile_and_stopping_policy_unchanged,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed:
      protocol.passed &&
      historicalUnchanged &&
      providerGuard.passed
  };

  writeJson(path.join(outputDirectory, "correction-manifest.json"), {
    correction_version: CORRECTION_VERSION,
    execution_mode: "deterministic_no_live_correction",
    application_git_commit: currentCommit(),
    correction_source_sha256: relativeFileSha(
      "src/lib/evaluation/formative/self-correction-intent-envelope-v2.ts"
    ),
    e2a36_rerun: false,
    e2a37_executed: false,
    evaluator_v5_modified: false,
    tutor_candidate_modified: false,
    learning_profile_modified: false,
    stopping_policy_modified: false,
    provider_calls_made: 0
  });
  writeJson(
    path.join(outputDirectory, "self-correction-intent-envelope-v2.json"),
    contract
  );
  writeJson(
    path.join(
      outputDirectory,
      "self-correction-intent-envelope-calibration.json"
    ),
    calibration
  );
  writeJson(
    path.join(outputDirectory, "deterministic-regressions.json"),
    regressions
  );
  writeJson(
    path.join(outputDirectory, "e2a36-turn4-offline-replay.json"),
    replay
  );
  writeJson(
    path.join(outputDirectory, "e2a36-historical-integrity-before.json"),
    historicalBefore
  );
  writeJson(
    path.join(outputDirectory, "e2a36-historical-integrity-after.json"),
    historicalAfter
  );
  writeJson(
    path.join(outputDirectory, "protected-source-integrity.json"),
    protectedIntegrity
  );
  writeJson(path.join(outputDirectory, "e2a37-budget.json"), budget);
  writeJson(
    path.join(outputDirectory, "e2a37-artifact-contract.json"),
    artifactContract
  );
  writeJson(path.join(outputDirectory, "e2a37-protocol.json"), protocol);
  writeFileSync(
    path.join(outputDirectory, "e2a37-protocol.sha256"),
    `${protocol.protocol_hash}\n`,
    "utf8"
  );
  writeJson(
    path.join(outputDirectory, "e2a37-composite-runtime-identity.json"),
    composite
  );
  writeJson(
    path.join(outputDirectory, "provider-call-guard.json"),
    providerGuard
  );
  writeJson(path.join(outputDirectory, "summary.json"), summary);

  const validation = validateArtifacts(outputDirectory);
  writeJson(
    path.join(outputDirectory, "artifact-validation.json"),
    validation
  );
  const finalFiles = readdirSync(outputDirectory).sort();
  const complete =
    finalFiles.length === ARTIFACT_NAMES.length &&
    ARTIFACT_NAMES.every((name) => finalFiles.includes(name));
  assert(
    summary.passed,
    `e2a36a_deterministic_gates_failed:${JSON.stringify({
      historical_passed: historicalBefore.passed,
      protected_integrity_passed: protectedIntegrity.passed,
      calibration_passed: calibration.passed,
      calibration_failures: calibration.results
        .filter((entry) => !entry.passed)
        .slice(0, 8),
      regressions,
      replay,
      protocol,
      provider_guard: providerGuard
    })}`
  );
  assert(validation.passed, "e2a36a_artifact_validation_failed");
  assert(complete, "e2a36a_artifact_set_incomplete");

  for (const filePath of listFiles(outputDirectory)) {
    chmodSync(filePath, 0o444);
  }
  chmodSync(outputDirectory, 0o555);
  return {
    run_directory: outputDirectory,
    summary,
    protocol,
    composite,
    validation: {
      ...validation,
      final_artifact_count: finalFiles.length,
      complete
    }
  };
}

function makeRunId() {
  const timestamp = new Date().toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `e2a36a_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function latestRunDirectory() {
  assert(existsSync(ARTIFACT_ROOT), "e2a36a_artifact_root_missing");
  const latest = readdirSync(ARTIFACT_ROOT)
    .map((name) => path.join(ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  assert(latest, "e2a36a_artifact_run_missing");
  return latest;
}

function runSmoke(suite: string) {
  const tempRoot = mkdtempSync(path.join(
    tmpdir(),
    "e2a36a-intent-envelope-"
  ));
  const runDirectory = path.join(tempRoot, "run");
  try {
    const result = buildAndWriteArtifacts(runDirectory);
    const checks: Record<string, boolean> = {
      calibration:
        result.summary.calibration_case_count >= 150 &&
        result.summary.calibration_passed,
      regressions: result.summary.regressions_passed,
      replay:
        result.summary.historical_replay_passed &&
        !result.summary.e2a36_historical_passed,
      historical:
        result.summary.e2a36_historical_evidence_unchanged &&
        !result.summary.e2a36_rerun,
      "e2a37-protocol":
        result.protocol.passed &&
        !result.protocol.execution_authorized &&
        !result.protocol.live_execution_performed &&
        !result.protocol.provider_dispatch_path_present,
      artifact:
        result.validation.complete &&
        result.validation.final_artifact_count === ARTIFACT_NAMES.length,
      "provider-call-guard":
        result.summary.provider_calls_made === 0 &&
        result.summary.network_requests_made === 0
    };
    checks.all = Object.values(checks).every(Boolean);
    assert(suite in checks, `e2a36a_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a36a_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      checks,
      calibration_case_count: result.summary.calibration_case_count,
      e2a36_historical_status: result.summary.e2a36_historical_status,
      e2a36_historical_passed: false,
      e2a36_rerun: false,
      e2a37_protocol_hash: result.protocol.protocol_hash,
      e2a37_composite_runtime_identity_hash:
        result.composite.composite_runtime_identity_hash,
      e2a37_execution_authorized: false,
      e2a37_live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }, null, 2));
  } finally {
    if (existsSync(runDirectory)) chmodSync(runDirectory, 0o755);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command === "run") {
    mkdirSync(ARTIFACT_ROOT, { recursive: true });
    const result = buildAndWriteArtifacts(
      path.join(ARTIFACT_ROOT, makeRunId())
    );
    console.log(JSON.stringify({
      status: result.summary.status,
      run_directory: result.run_directory,
      calibration_case_count: result.summary.calibration_case_count,
      e2a36_historical_evidence_unchanged:
        result.summary.e2a36_historical_evidence_unchanged,
      e2a36_rerun: false,
      e2a37_protocol_hash: result.protocol.protocol_hash,
      e2a37_composite_runtime_identity_hash:
        result.composite.composite_runtime_identity_hash,
      e2a37_execution_authorized: false,
      e2a37_live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }, null, 2));
    return;
  }
  if (command === "report") {
    const runFlag = args.indexOf("--run");
    const runDirectory = runFlag >= 0 && args[runFlag + 1]
      ? path.join(ARTIFACT_ROOT, args[runFlag + 1])
      : latestRunDirectory();
    console.log(JSON.stringify({
      run_directory: runDirectory,
      summary: readJson(path.join(runDirectory, "summary.json")),
      protocol: readJson(path.join(runDirectory, "e2a37-protocol.json")),
      composite: readJson(path.join(
        runDirectory,
        "e2a37-composite-runtime-identity.json"
      )),
      artifact_validation: readJson(path.join(
        runDirectory,
        "artifact-validation.json"
      ))
    }, null, 2));
    return;
  }
  if (command === "smoke") {
    const suiteFlag = args.indexOf("--suite");
    runSmoke(suiteFlag >= 0 ? args[suiteFlag + 1] ?? "all" : "all");
    return;
  }
  throw new Error(`e2a36a_unknown_command:${command}`);
}

main();
