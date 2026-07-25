import { createHash, randomBytes } from "node:crypto";
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
  CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
  type ConceptualEvidenceUpdateSourceInputV1,
  buildConceptualEvidenceUpdateSourceContractV1,
  learningObservationUpdateFlagsFromSourceV1,
  resolveConceptualEvidenceUpdateSourceV1
} from
  "../src/lib/evaluation/formative/conceptual-evidence-update-source-v1";
import {
  type EngagementProfileEvolutionV1,
  type LearningProfileEvolutionV1,
  type LearningProfileSnapshotV1,
  createEngagementProfileSnapshotV1,
  createLearningProfileSnapshotV1,
  decideAdaptiveStoppingV1,
  evolveEngagementProfileV1,
  evolveLearningProfileV1
} from "../src/lib/evaluation/formative/e2a36-longitudinal-contracts";
import { stableHash } from "../src/lib/operational/stable-hash";

const CORRECTION_VERSION =
  "e2a38a-longitudinal-evidence-update-decoupling-v1" as const;
const E2A39_PROTOCOL_VERSION =
  "e2a39-longitudinal-evidence-update-decoupling-canary-v1" as const;
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a38a-longitudinal-evidence-update-decoupling"
);
const HISTORICAL_RUN_ID = "e2a38_20260725104322_25d11b2c";
const HISTORICAL_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a38-integrated-autonomous-session-canary",
  HISTORICAL_RUN_ID
);
const HISTORICAL_STATUS = "e2a38_canary_failed_evidence_accuracy";
const HISTORICAL_PROTOCOL_HASH =
  "84300970cf23afa5f114ec3d367ca9a2096ea074fe9fb78a37e630fc30750911";
const HISTORICAL_COMPOSITE_IDENTITY =
  "4aeae9f504135a99b4d26fd596d0f1796fb59dcf2d85fbc6fc62dc82e850b96a";
const HISTORICAL_FILE_COUNT = 122;
const HISTORICAL_TREE_SHA256 =
  "01217f4ba5b103711577fd4c485d4e6903e82911390044203f3b4e7ad68f4898";
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const EXPECTED_HISTORICAL_HASHES = {
  "canary-summary.json":
    "ad8216c29171aecc0d036a0f53d2a98452dfac5eec8dbcb71af215474c2a5f33",
  "human-review-packet.json":
    "15690e974c2946d7a70efcd1cbb66b1100866e4e6bb1d85c95198fa48482be7c",
  "simulator-provider-outputs.jsonl":
    "9ec431259e2d33ec2faa879dda6743f8631ff4fb014338a868cf7d75b5d8983c",
  "evaluator-provider-outputs.jsonl":
    "2264b384a779238d30feae561fb649e19c84bd0c38a3bdf2a4ea15e784301ff5",
  "autonomous-tutor-provider-outputs.jsonl":
    "7a7314c1300b7d3f296c562a07bb3d0f5643292cc99f41fbb493ccf5d51ea38f",
  "learning-profile-evolution-results.jsonl":
    "7fbce4ac70e765f5bcda59e2d477e88d75b41514302a45aba7b6ab3ac375bca5",
  "adaptive-stopping-decisions.jsonl":
    "664c044e52e592cd03c5cce10be359b960314582bda4356c165aaa33ca117e58",
  "turn-evidence-observations.jsonl":
    "e6b2052b000127ec6b5fb04a8ca957cdf885bbde12cb9f652ae0e88c9c0b58fb",
  "self-correction-evidence-results.jsonl":
    "59eefb96745b2b841b619d652f9cacc373f682a29561f04f658c92b3e97e7296"
} as const;

const EXPECTED_PROTECTED_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/anchor-conclusion-consistency.ts":
    "d7c5c368b3e93f2f5b6f2932184491693d98f502cccec2ad5778f331b2caaf83",
  "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts":
    "98044fed11bd8a1a9ff9151afa21e866e7d0f0624cfdf8cecc455f42700ad941",
  "src/lib/evaluation/formative/trajectory-envelope-v1.ts":
    "95319bb52d087601680e53ce2db9e357764a2b5f5574e125f3b88804c49d4e70"
} as const;

const PAYLOAD_NAMES = [
  "correction-manifest.json",
  "conceptual-evidence-update-source-v1.json",
  "conceptual-evidence-update-calibration.json",
  "deterministic-regressions.json",
  "e2a38-turn5-offline-replay.json",
  "e2a38-historical-integrity-before.json",
  "e2a38-historical-integrity-after.json",
  "protected-source-integrity.json",
  "e2a39-budget.json",
  "e2a39-artifact-contract.json",
  "e2a39-protocol.json",
  "e2a39-protocol.sha256",
  "e2a39-composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json"
] as const;
const ARTIFACT_NAMES = [...PAYLOAD_NAMES, "artifact-validation.json"] as const;

type JsonRecord = Record<string, unknown>;
type HistoricalSummary = {
  status: string;
  passed: boolean;
  protocol_hash: string;
  frozen_composite_runtime_identity_hash: string;
};
type HistoricalLearningEvolutionRow = {
  turn: number;
  observation: LearningProfileSnapshotV1;
  evolution: LearningProfileEvolutionV1;
  sound_gate_passed: boolean;
};
type HistoricalEngagementEvolutionRow = {
  turn: number;
  evolution: EngagementProfileEvolutionV1;
};
type HistoricalTurnObservationRow = {
  turn: number;
  source_student_turn_id: string;
  source_sequence_index: number;
  interaction_intent: string;
  conceptual_evidence_applicability: string;
  evidence_spans: Array<{ label: string; span: string }>;
  anchor_references_observed: {
    anchor_application: "absent" | "implicit" | "explicit";
    anchor_stance:
      | "not_expressed"
      | "ambiguous"
      | "endorses_distractor"
      | "rejects_distractor";
    anchor_consistency:
      | "not_assessable"
      | "consistent_with_conceptual_reasoning"
      | "contradictory_to_conceptual_reasoning"
      | "unresolved";
  };
  reasoning_evidence_observed: {
    reasoning_quality: "insufficient" | "misconception" | "partial" | "sound";
    misconception_status:
      | "not_assessed"
      | "persists"
      | "uncertain"
      | "resolved_for_current_anchor";
    essential_missing_links: string[];
  };
  contradictions_observed: {
    contradiction_ids: string[];
  };
  profile_update_disposition:
    | "initialize_unresolved_profile"
    | "preserve_prior_profile"
    | "update_from_latest_evidence"
    | "reopen_from_latest_contradiction";
};
type HistoricalSelfCorrectionRow = {
  turn: number;
  resolution: {
    self_correction_intent: boolean;
    conceptual_evidence_update: boolean;
    conceptual_evidence_quality:
      | "none"
      | "answer_revision_only"
      | "copied_insufficient"
      | "misconception"
      | "partial"
      | "sound"
      | "contradictory";
    observable_conceptual_evidence_present: boolean;
    independent_conceptual_evidence_present: boolean;
    profile_update_disposition:
      | "initialize_unresolved_profile"
      | "preserve_prior_profile"
      | "update_from_latest_evidence"
      | "reopen_from_latest_contradiction";
  };
};

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a38a_network_request_prohibited");
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
    "e2a38a_forbidden_secret_detected"
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

function historicalSnapshot() {
  assert(existsSync(HISTORICAL_RUN_DIR), "e2a38a_historical_run_missing");
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
  const summary = readJson<HistoricalSummary>(
    path.join(HISTORICAL_RUN_DIR, "canary-summary.json")
  );
  const aggregate = stableHash(files.map((entry) => ({
    path: entry.path,
    sha256: entry.sha256,
    bytes: entry.bytes
  })));
  return {
    snapshot_version: "e2a38a-historical-evidence-snapshot-v1",
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
  return {
    integrity_version: "e2a38a-protected-source-integrity-v1",
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    evaluator_v5_unchanged: mismatches.every((entry) =>
      !entry.relative_path.includes("production-turn-evidence-evaluator-v5")
    ),
    tutor_candidate_unchanged: mismatches.every((entry) =>
      !entry.relative_path.includes("e2a24-autonomous-dialogue-candidate")
    ),
    sound_gate_unchanged: mismatches.every((entry) =>
      !entry.relative_path.includes("anchor-conclusion-consistency")
    ),
    stopping_policy_unchanged: mismatches.every((entry) =>
      !entry.relative_path.includes("e2a36-longitudinal-contracts")
    ),
    trajectory_envelope_unchanged: mismatches.every((entry) =>
      !entry.relative_path.includes("trajectory-envelope-v1")
    ),
    expected_sha256: EXPECTED_PROTECTED_HASHES,
    actual_sha256: actual,
    mismatches,
    passed: mismatches.length === 0
  };
}

function baseEvaluatorEvidence(
  overrides: Partial<
    ConceptualEvidenceUpdateSourceInputV1["evaluator_evidence"]
  > = {}
): ConceptualEvidenceUpdateSourceInputV1["evaluator_evidence"] {
  return {
    validation_status: "accepted",
    conceptual_evidence_applicable: true,
    reasoning_quality: "partial",
    observable_evidence_span_count: 2,
    anchor_application: "explicit",
    anchor_stance: "ambiguous",
    anchor_consistency: "unresolved",
    misconception_status: "uncertain",
    essential_missing_link_count: 1,
    contradiction_count: 0,
    mapped_update_disposition: "update_from_latest_evidence",
    ...overrides
  };
}

function baseSelfCorrectionContext(
  overrides: Partial<
    ConceptualEvidenceUpdateSourceInputV1["self_correction_context"]
  > = {}
): ConceptualEvidenceUpdateSourceInputV1["self_correction_context"] {
  return {
    self_correction_intent: false,
    conceptual_evidence_update: false,
    observable_conceptual_evidence_present: false,
    independent_conceptual_evidence_present: false,
    conceptual_evidence_quality: "none",
    profile_update_disposition: "preserve_prior_profile",
    ...overrides
  };
}

function sourceInput(input: {
  id: string;
  sequence?: number;
  prior?: boolean;
  interaction?:
    ConceptualEvidenceUpdateSourceInputV1["interaction_kind"];
  evaluator?: Partial<
    ConceptualEvidenceUpdateSourceInputV1["evaluator_evidence"]
  >;
  correction?: Partial<
    ConceptualEvidenceUpdateSourceInputV1["self_correction_context"]
  >;
}): ConceptualEvidenceUpdateSourceInputV1 {
  return {
    source_student_turn_id: `student_${input.id}`,
    source_sequence_index: input.sequence ?? 1,
    prior_profile_present: input.prior ?? true,
    interaction_kind: input.interaction ??
      "ordinary_conceptual_response",
    evaluator_evidence: baseEvaluatorEvidence(input.evaluator),
    self_correction_context:
      baseSelfCorrectionContext(input.correction)
  };
}

type CalibrationArchetype = {
  id: string;
  input: Omit<Parameters<typeof sourceInput>[0], "id">;
  expectedUpdate: boolean;
  expectedSound: boolean;
};

function calibration() {
  const archetypes: CalibrationArchetype[] = [
    {
      id: "ordinary_sound",
      input: {
        evaluator: {
          reasoning_quality: "sound",
          anchor_stance: "rejects_distractor",
          anchor_consistency: "consistent_with_conceptual_reasoning",
          misconception_status: "resolved_for_current_anchor",
          essential_missing_link_count: 0
        }
      },
      expectedUpdate: true,
      expectedSound: true
    },
    {
      id: "ordinary_partial",
      input: {},
      expectedUpdate: true,
      expectedSound: false
    },
    {
      id: "ordinary_misconception",
      input: {
        evaluator: {
          reasoning_quality: "misconception",
          anchor_stance: "endorses_distractor",
          anchor_consistency: "consistent_with_conceptual_reasoning",
          misconception_status: "persists",
          essential_missing_link_count: 3
        }
      },
      expectedUpdate: true,
      expectedSound: false
    },
    {
      id: "ordinary_no_evidence",
      input: {
        evaluator: {
          conceptual_evidence_applicable: false,
          observable_evidence_span_count: 0,
          reasoning_quality: "insufficient",
          validation_status: "not_applicable",
          mapped_update_disposition: "preserve_prior_profile"
        }
      },
      expectedUpdate: false,
      expectedSound: false
    },
    {
      id: "ordinary_copied",
      input: {
        evaluator: {
          validation_status: "rejected_copied_language",
          mapped_update_disposition: "preserve_prior_profile"
        }
      },
      expectedUpdate: false,
      expectedSound: false
    },
    {
      id: "self_correction_sound",
      input: {
        interaction: "self_correction",
        evaluator: {
          reasoning_quality: "sound",
          anchor_stance: "rejects_distractor",
          anchor_consistency: "consistent_with_conceptual_reasoning",
          misconception_status: "resolved_for_current_anchor",
          essential_missing_link_count: 0
        },
        correction: {
          self_correction_intent: true,
          conceptual_evidence_update: true,
          observable_conceptual_evidence_present: true,
          independent_conceptual_evidence_present: true,
          conceptual_evidence_quality: "sound",
          profile_update_disposition: "update_from_latest_evidence"
        }
      },
      expectedUpdate: true,
      expectedSound: true
    },
    {
      id: "self_correction_claim_only",
      input: {
        interaction: "self_correction",
        correction: {
          self_correction_intent: true,
          conceptual_evidence_quality: "answer_revision_only"
        }
      },
      expectedUpdate: false,
      expectedSound: false
    },
    {
      id: "self_correction_copied",
      input: {
        interaction: "self_correction",
        evaluator: {
          validation_status: "rejected_copied_language",
          mapped_update_disposition: "preserve_prior_profile"
        },
        correction: {
          self_correction_intent: true,
          conceptual_evidence_quality: "copied_insufficient"
        }
      },
      expectedUpdate: false,
      expectedSound: false
    },
    {
      id: "self_correction_contradiction",
      input: {
        interaction: "self_correction",
        evaluator: {
          reasoning_quality: "partial",
          anchor_stance: "endorses_distractor",
          anchor_consistency: "contradictory_to_conceptual_reasoning",
          misconception_status: "persists",
          contradiction_count: 1,
          mapped_update_disposition: "reopen_from_latest_contradiction"
        },
        correction: {
          self_correction_intent: true,
          conceptual_evidence_update: true,
          observable_conceptual_evidence_present: true,
          independent_conceptual_evidence_present: true,
          conceptual_evidence_quality: "contradictory",
          profile_update_disposition: "reopen_from_latest_contradiction"
        }
      },
      expectedUpdate: true,
      expectedSound: false
    },
    {
      id: "reflection",
      input: {
        interaction: "reflection_or_uncertainty"
      },
      expectedUpdate: false,
      expectedSound: false
    },
    {
      id: "unsupported_claim",
      input: {
        interaction: "unsupported_understanding_claim",
        evaluator: {
          validation_status: "rejected_unsupported_claim",
          mapped_update_disposition: "preserve_prior_profile"
        }
      },
      expectedUpdate: false,
      expectedSound: false
    },
    {
      id: "non_conceptual",
      input: {
        interaction: "non_conceptual_response",
        evaluator: {
          conceptual_evidence_applicable: false,
          observable_evidence_span_count: 0,
          validation_status: "not_applicable",
          mapped_update_disposition: "preserve_prior_profile"
        }
      },
      expectedUpdate: false,
      expectedSound: false
    }
  ];
  const contexts = Array.from(
    { length: 15 },
    (_, index) => `generic_context_${String(index + 1).padStart(2, "0")}`
  );
  const cases = contexts.flatMap((context) =>
    archetypes.map((archetype, index) => {
      const resolution = resolveConceptualEvidenceUpdateSourceV1(sourceInput({
        id: `${context}_${archetype.id}`,
        sequence: index + 1,
        ...archetype.input
      }));
      const passed =
        resolution.conceptual_evidence_update ===
          archetype.expectedUpdate &&
        resolution.sound_update_eligible === archetype.expectedSound &&
        resolution.intent_and_conceptual_evidence_decoupled &&
        resolution.ordinary_evidence_independent_of_self_correction_flags;
      return {
        case_id: `${context}:${archetype.id}`,
        archetype: archetype.id,
        context,
        expected_conceptual_update: archetype.expectedUpdate,
        actual_conceptual_update: resolution.conceptual_evidence_update,
        expected_sound_update: archetype.expectedSound,
        actual_sound_update: resolution.sound_update_eligible,
        conceptual_evidence_source: resolution.conceptual_evidence_source,
        passed
      };
    })
  );
  return {
    calibration_version:
      "conceptual-evidence-update-source-v1-calibration",
    case_count: cases.length,
    archetype_count: archetypes.length,
    context_count: contexts.length,
    passed: cases.every((entry) => entry.passed),
    cases
  };
}

function snapshotFor(input: {
  sequence: number;
  state: "misconception" | "partial" | "sound";
  resolution: ReturnType<typeof resolveConceptualEvidenceUpdateSourceV1>;
}) {
  const sound = input.state === "sound";
  const misconception = input.state === "misconception";
  const flags = learningObservationUpdateFlagsFromSourceV1(input.resolution);
  return createLearningProfileSnapshotV1({
    sequence_index: input.sequence,
    source_student_turn_id: input.resolution.source_student_turn_id,
    concept_family: "reliability_validity",
    conceptual_understanding: input.state,
    misconception_status: sound
      ? "resolved_for_current_anchor"
      : misconception
        ? "persists"
        : "uncertain",
    knowledge_gap: sound
      ? "No essential gap remains for the active anchor."
      : misconception
        ? "The active misconception remains."
        : "The conceptual boundary remains partial.",
    reasoning_quality: input.state,
    anchor_interpretation: sound
      ? {
          application: "explicit",
          stance: "rejects_distractor",
          consistency: "consistent_with_conceptual_reasoning"
        }
      : misconception
        ? {
            application: "explicit",
            stance: "endorses_distractor",
            consistency: "consistent_with_conceptual_reasoning"
          }
        : {
            application: "explicit",
            stance: "ambiguous",
            consistency: "unresolved"
          },
    unresolved_contradictions: [],
    missing_links: sound ? [] : ["active_conceptual_boundary"],
    transfer_readiness: sound,
    confidence_alignment: "not_assessable",
    ...flags,
    created_at: new Date(input.sequence * 1000).toISOString()
  });
}

function engagementFor(sequence: number) {
  return evolveEngagementProfileV1({
    prior: null,
    observation: createEngagementProfileSnapshotV1({
      sequence_index: sequence,
      source_student_turn_id: `student_engagement_${sequence}`,
      participation: "active",
      response_quality_trend: "improving",
      effort: "sustained_observed_effort",
      persistence: "sustained",
      help_seeking: "none",
      frustration: "not_observed",
      disengagement: "not_observed",
      responsiveness_to_intervention: "productive_response",
      strategy_uptake: "clear",
      evidence_basis: ["Synthetic process evidence for no-live regression."],
      created_at: new Date(sequence * 1000).toISOString()
    })
  });
}

function deterministicRegressions() {
  const misconceptionResolution =
    resolveConceptualEvidenceUpdateSourceV1(sourceInput({
      id: "regression_initial_misconception",
      sequence: 1,
      prior: false,
      evaluator: {
        reasoning_quality: "misconception",
        anchor_stance: "endorses_distractor",
        anchor_consistency: "consistent_with_conceptual_reasoning",
        misconception_status: "persists",
        essential_missing_link_count: 3
      }
    }));
  const misconceptionProfile = evolveLearningProfileV1({
    prior: null,
    observation: snapshotFor({
      sequence: 1,
      state: "misconception",
      resolution: misconceptionResolution
    })
  });
  const ordinarySoundResolution =
    resolveConceptualEvidenceUpdateSourceV1(sourceInput({
      id: "ordinary_sound_without_self_correction",
      sequence: 2,
      evaluator: {
        reasoning_quality: "sound",
        anchor_stance: "rejects_distractor",
        anchor_consistency: "consistent_with_conceptual_reasoning",
        misconception_status: "resolved_for_current_anchor",
        essential_missing_link_count: 0
      }
    }));
  const ordinarySoundProfile = evolveLearningProfileV1({
    prior: misconceptionProfile,
    observation: snapshotFor({
      sequence: 2,
      state: "sound",
      resolution: ordinarySoundResolution
    })
  });
  const soundStopping = decideAdaptiveStoppingV1({
    learning_profile: ordinarySoundProfile,
    engagement_profile: engagementFor(2),
    intervention_memory: [],
    session_budget_exhausted: false,
    new_evidence_observed:
      ordinarySoundResolution.conceptual_evidence_update,
    knowledge_gap_narrowing: true,
    strategy_uptake_observed: true,
    expected_benefit: "high",
    unresolved_conceptual_barrier: false
  });

  const intentOnlyResolution =
    resolveConceptualEvidenceUpdateSourceV1(sourceInput({
      id: "self_correction_without_evidence",
      sequence: 2,
      interaction: "self_correction",
      correction: {
        self_correction_intent: true,
        conceptual_evidence_quality: "answer_revision_only"
      }
    }));
  const intentOnlyProfile = evolveLearningProfileV1({
    prior: misconceptionProfile,
    observation: snapshotFor({
      sequence: 2,
      state: "partial",
      resolution: intentOnlyResolution
    })
  });

  const regressionResolution =
    resolveConceptualEvidenceUpdateSourceV1(sourceInput({
      id: "sound_then_regression",
      sequence: 3,
      evaluator: {
        reasoning_quality: "misconception",
        anchor_stance: "endorses_distractor",
        anchor_consistency: "contradictory_to_conceptual_reasoning",
        misconception_status: "persists",
        contradiction_count: 1,
        mapped_update_disposition: "reopen_from_latest_contradiction"
      }
    }));
  const regressedProfile = evolveLearningProfileV1({
    prior: ordinarySoundProfile,
    observation: snapshotFor({
      sequence: 3,
      state: "misconception",
      resolution: regressionResolution
    })
  });

  const partialResolution =
    resolveConceptualEvidenceUpdateSourceV1(sourceInput({
      id: "partial_remains_partial",
      sequence: 2
    }));
  const partialProfile = evolveLearningProfileV1({
    prior: misconceptionProfile,
    observation: snapshotFor({
      sequence: 2,
      state: "partial",
      resolution: partialResolution
    })
  });

  const cases = [
    {
      case_id: "sound_evidence_without_self_correction_updates_profile",
      passed:
        ordinarySoundResolution.self_correction_intent === false &&
        ordinarySoundResolution.conceptual_evidence_update &&
        ordinarySoundProfile.current_profile.reasoning_quality === "sound"
    },
    {
      case_id: "self_correction_without_evidence_does_not_update_profile",
      passed:
        intentOnlyResolution.self_correction_intent &&
        !intentOnlyResolution.conceptual_evidence_update &&
        intentOnlyProfile.current_profile_snapshot_id ===
          misconceptionProfile.current_profile_snapshot_id
    },
    {
      case_id: "sound_then_regression_reopens_profile",
      passed:
        regressedProfile.current_profile.reasoning_quality ===
          "misconception" &&
        regressedProfile.misconception_reopened_count === 1
    },
    {
      case_id: "partial_evidence_remains_partial",
      passed:
        partialResolution.conceptual_evidence_update &&
        partialProfile.current_profile.reasoning_quality === "partial"
    },
    {
      case_id: "stopping_uses_latest_valid_evidence",
      passed:
        ordinarySoundProfile.current_profile.reasoning_quality === "sound" &&
        soundStopping.internal_decision === "stop_formative_dialogue" &&
        soundStopping.revision_ready &&
        !soundStopping.tutor_dispatch_allowed
    }
  ];
  return {
    regression_version:
      "e2a38a-longitudinal-evidence-update-regressions-v1",
    case_count: cases.length,
    cases,
    passed: cases.every((entry) => entry.passed)
  };
}

function turn5Replay() {
  const observations = readJsonl<HistoricalTurnObservationRow>(
    path.join(HISTORICAL_RUN_DIR, "turn-evidence-observations.jsonl")
  );
  const corrections = readJsonl<HistoricalSelfCorrectionRow>(
    path.join(HISTORICAL_RUN_DIR, "self-correction-evidence-results.jsonl")
  );
  const learningRows = readJsonl<HistoricalLearningEvolutionRow>(
    path.join(
      HISTORICAL_RUN_DIR,
      "learning-profile-evolution-results.jsonl"
    )
  );
  const engagementRows = readJsonl<HistoricalEngagementEvolutionRow>(
    path.join(
      HISTORICAL_RUN_DIR,
      "engagement-profile-evolution-results.jsonl"
    )
  );
  const turn5 = observations.find((row) => row.turn === 5);
  const correction = corrections.find((row) => row.turn === 5);
  const turn4Learning = learningRows.find((row) => row.turn === 4);
  const turn5Learning = learningRows.find((row) => row.turn === 5);
  const turn5Engagement = engagementRows.find((row) => row.turn === 5);
  assert(turn5, "e2a38a_turn5_observation_missing");
  assert(correction, "e2a38a_turn5_self_correction_context_missing");
  assert(turn4Learning, "e2a38a_turn4_learning_profile_missing");
  assert(turn5Learning, "e2a38a_turn5_learning_profile_missing");
  assert(turn5Engagement, "e2a38a_turn5_engagement_profile_missing");

  const resolution = resolveConceptualEvidenceUpdateSourceV1({
    source_student_turn_id: turn5.source_student_turn_id,
    source_sequence_index: turn5.source_sequence_index,
    prior_profile_present: true,
    interaction_kind: "ordinary_conceptual_response",
    evaluator_evidence: {
      validation_status: "accepted",
      conceptual_evidence_applicable:
        turn5.conceptual_evidence_applicability === "applicable",
      reasoning_quality:
        turn5.reasoning_evidence_observed.reasoning_quality,
      observable_evidence_span_count: turn5.evidence_spans.length,
      anchor_application:
        turn5.anchor_references_observed.anchor_application,
      anchor_stance: turn5.anchor_references_observed.anchor_stance,
      anchor_consistency:
        turn5.anchor_references_observed.anchor_consistency,
      misconception_status:
        turn5.reasoning_evidence_observed.misconception_status,
      essential_missing_link_count:
        turn5.reasoning_evidence_observed.essential_missing_links.length,
      contradiction_count:
        turn5.contradictions_observed.contradiction_ids.length,
      mapped_update_disposition: turn5.profile_update_disposition
    },
    self_correction_context: {
      self_correction_intent:
        correction.resolution.self_correction_intent,
      conceptual_evidence_update:
        correction.resolution.conceptual_evidence_update,
      observable_conceptual_evidence_present:
        correction.resolution.observable_conceptual_evidence_present,
      independent_conceptual_evidence_present:
        correction.resolution.independent_conceptual_evidence_present,
      conceptual_evidence_quality:
        correction.resolution.conceptual_evidence_quality,
      profile_update_disposition:
        correction.resolution.profile_update_disposition
    }
  });
  const correctedObservation = createLearningProfileSnapshotV1({
    ...turn5Learning.observation,
    snapshot_id: undefined,
    ...learningObservationUpdateFlagsFromSourceV1(resolution)
  });
  const correctedEvolution = evolveLearningProfileV1({
    prior: turn4Learning.evolution,
    observation: correctedObservation
  });
  const correctedStopping = decideAdaptiveStoppingV1({
    learning_profile: correctedEvolution,
    engagement_profile: turn5Engagement.evolution,
    intervention_memory: [],
    session_budget_exhausted: false,
    new_evidence_observed: resolution.conceptual_evidence_update,
    knowledge_gap_narrowing: true,
    strategy_uptake_observed: true,
    expected_benefit: "high",
    unresolved_conceptual_barrier: false
  });
  const replay = {
    replay_version: "e2a38a-turn5-offline-replay-v1",
    historical_run_id: HISTORICAL_RUN_ID,
    source_artifacts: {
      turn_evidence_observations:
        EXPECTED_HISTORICAL_HASHES[
          "turn-evidence-observations.jsonl"
        ],
      self_correction_evidence:
        EXPECTED_HISTORICAL_HASHES[
          "self-correction-evidence-results.jsonl"
        ],
      learning_profile_evolution:
        EXPECTED_HISTORICAL_HASHES[
          "learning-profile-evolution-results.jsonl"
        ],
      adaptive_stopping_decisions:
        EXPECTED_HISTORICAL_HASHES[
          "adaptive-stopping-decisions.jsonl"
        ]
    },
    before: {
      sound_gate_passed: turn5Learning.sound_gate_passed,
      longitudinal_current_reasoning_quality:
        turn5Learning.evolution.current_profile.reasoning_quality,
      longitudinal_current_profile_snapshot_id:
        turn5Learning.evolution.current_profile_snapshot_id,
      expected_stopping_decision_from_failure:
        "continue_dialogue",
      historical_status: HISTORICAL_STATUS
    },
    source_resolution: resolution,
    after: {
      sound_gate_passed: turn5Learning.sound_gate_passed,
      longitudinal_current_reasoning_quality:
        correctedEvolution.current_profile.reasoning_quality,
      longitudinal_current_profile_snapshot_id:
        correctedEvolution.current_profile_snapshot_id,
      stopping_decision: correctedStopping.internal_decision,
      revision_ready: correctedStopping.revision_ready,
      tutor_dispatch_allowed: correctedStopping.tutor_dispatch_allowed
    },
    evaluator_v5_modified: false,
    sound_gate_modified: false,
    stopping_policy_modified: false,
    tutor_candidate_modified: false,
    provider_calls_made: 0,
    network_requests_made: 0,
    e2a38_reclassified_as_passed: false,
    passed:
      turn5Learning.sound_gate_passed &&
      turn5Learning.evolution.current_profile.reasoning_quality ===
        "partial" &&
      resolution.conceptual_evidence_source ===
        "ordinary_evaluator_evidence" &&
      resolution.conceptual_evidence_update &&
      correctedEvolution.current_profile.reasoning_quality === "sound" &&
      correctedStopping.internal_decision === "stop_formative_dialogue" &&
      correctedStopping.revision_ready &&
      !correctedStopping.tutor_dispatch_allowed
  };
  assert(replay.passed, "e2a38a_turn5_offline_replay_failed");
  return replay;
}

function e2a39Budget() {
  return {
    budget_version: "e2a39-prepared-budget-v1",
    maximum_isolated_sessions: 1,
    maximum_simulator_calls: 9,
    maximum_evidence_evaluator_calls: 9,
    maximum_initial_tutor_calls: 9,
    maximum_tutor_regenerations: 2,
    maximum_logical_generation_calls: 29,
    maximum_adapter_attempts: 87,
    maximum_adapter_attempts_per_logical_call: 3,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_cost_usd_when_pricing_metadata_available: 25,
    provider_concurrency: 1
  };
}

function e2a39Preparation(input: {
  contractHash: string;
  sourceHash: string;
  protectedIntegrity: ReturnType<typeof protectedSourceIntegrity>;
  regressions: ReturnType<typeof deterministicRegressions>;
  replay: ReturnType<typeof turn5Replay>;
}) {
  const budget = e2a39Budget();
  const artifactContract = {
    artifact_contract_version: "e2a39-artifact-contract-v1",
    status: "prepared_not_authorized_not_executable",
    required_artifacts: [
      "protocol.json",
      "protocol.sha256",
      "composite-runtime-identity.json",
      "conceptual-evidence-update-source-results.jsonl",
      "learning-profile-evolution-results.jsonl",
      "adaptive-stopping-decisions.jsonl",
      "provider-attempt-results.jsonl",
      "human-review-packet.json",
      "artifact-validation.json"
    ],
    immutable_after_execution: true,
    execution_available_in_this_phase: false
  };
  const protocolCore = {
    protocol_version: E2A39_PROTOCOL_VERSION,
    status: "prepared_not_authorized_not_executable",
    predecessor: {
      correction_version: CORRECTION_VERSION,
      historical_e2a38_run_id: HISTORICAL_RUN_ID,
      historical_e2a38_status: HISTORICAL_STATUS,
      historical_e2a38_remains_failed: true
    },
    purpose:
      "Verify ordinary and self-correction conceptual evidence update sources before longitudinal stopping.",
    source_contract: {
      version: CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
      contract_hash: input.contractHash,
      source_hash: input.sourceHash
    },
    required_boundaries: [
      "ordinary_sound_evidence_updates_current_profile",
      "self_correction_intent_only_preserves_current_profile",
      "self_correction_with_evidence_updates_current_profile",
      "sound_then_regression_reopens_profile",
      "partial_evidence_remains_partial",
      "latest_valid_evidence_reaches_adaptive_stopping"
    ],
    protected_components: {
      evaluator_v5_unchanged:
        input.protectedIntegrity.evaluator_v5_unchanged,
      tutor_candidate_unchanged:
        input.protectedIntegrity.tutor_candidate_unchanged,
      sound_gate_unchanged: input.protectedIntegrity.sound_gate_unchanged,
      stopping_policy_unchanged:
        input.protectedIntegrity.stopping_policy_unchanged,
      trajectory_envelope_unchanged:
        input.protectedIntegrity.trajectory_envelope_unchanged,
      hashes: input.protectedIntegrity.actual_sha256
    },
    verification: {
      deterministic_regressions_passed: input.regressions.passed,
      e2a38_turn5_offline_replay_passed: input.replay.passed,
      exact_turn_oracle_authoritative: false,
      evidence_drives_progression: true
    },
    budget,
    execution: {
      authorized: false,
      live_entrypoint_present: false,
      provider_dispatch_available: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }
  };
  const protocolHash = stableHash(protocolCore);
  const protocol = {
    ...protocolCore,
    protocol_hash: protocolHash
  };
  const compositeCore = {
    identity_version: "e2a39-composite-runtime-identity-v1",
    protocol_hash: protocolHash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    conceptual_evidence_update_source_version:
      CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
    conceptual_evidence_update_source_contract_hash: input.contractHash,
    conceptual_evidence_update_source_implementation_hash:
      input.sourceHash,
    historical_e2a38_tree_hash: HISTORICAL_TREE_SHA256,
    protected_source_hashes: input.protectedIntegrity.actual_sha256,
    budget_hash: stableHash(budget),
    artifact_contract_hash: stableHash(artifactContract)
  };
  return {
    budget,
    artifactContract,
    protocol,
    compositeRuntimeIdentity: {
      ...compositeCore,
      composite_runtime_identity_hash: stableHash(compositeCore)
    }
  };
}

function artifactValidation(runDirectory: string) {
  const files = PAYLOAD_NAMES.map((name) => {
    const filePath = path.join(runDirectory, name);
    return {
      name,
      exists: existsSync(filePath),
      sha256: existsSync(filePath) ? fileSha(filePath) : null,
      bytes: existsSync(filePath) ? statSync(filePath).size : null
    };
  });
  const missing = files.filter((entry) => !entry.exists)
    .map((entry) => entry.name);
  return {
    validation_version: "e2a38a-artifact-validation-v1",
    expected_payload_count: PAYLOAD_NAMES.length,
    actual_payload_count: files.filter((entry) => entry.exists).length,
    missing,
    files,
    passed: missing.length === 0
  };
}

function execute(runDirectory: string) {
  const requestCountBefore = networkRequestCount;
  const before = historicalSnapshot();
  const protectedIntegrity = protectedSourceIntegrity();
  const contract = buildConceptualEvidenceUpdateSourceContractV1();
  const contractHash = stableHash(contract);
  const sourceHash = relativeFileSha(
    "src/lib/evaluation/formative/conceptual-evidence-update-source-v1.ts"
  );
  const calibrationResult = calibration();
  const regressions = deterministicRegressions();
  const replay = turn5Replay();
  const e2a39 = e2a39Preparation({
    contractHash,
    sourceHash,
    protectedIntegrity,
    regressions,
    replay
  });
  const after = historicalSnapshot();
  assert(before.passed, "e2a38a_historical_integrity_before_failed");
  assert(after.passed, "e2a38a_historical_integrity_after_failed");
  assert(
    before.aggregate_sha256 === after.aggregate_sha256,
    "e2a38a_historical_evidence_changed"
  );
  assert(protectedIntegrity.passed, "e2a38a_protected_source_changed");
  assert(calibrationResult.passed, "e2a38a_calibration_failed");
  assert(regressions.passed, "e2a38a_regressions_failed");
  assert(replay.passed, "e2a38a_replay_failed");
  assert(
    networkRequestCount === requestCountBefore,
    "e2a38a_provider_call_guard_detected_network_request"
  );

  mkdirSync(runDirectory, { recursive: true });
  const manifest = {
    correction_version: CORRECTION_VERSION,
    generated_at: new Date().toISOString(),
    conceptual_evidence_update_source_version:
      CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
    conceptual_evidence_update_source_contract_hash: contractHash,
    conceptual_evidence_update_source_implementation_hash: sourceHash,
    historical_e2a38_run_id: HISTORICAL_RUN_ID,
    historical_e2a38_remains_failed: true,
    e2a38_rerun: false,
    e2a39_status: e2a39.protocol.status,
    provider_calls_made: 0,
    network_requests_made: 0
  };
  const providerCallGuard = {
    guard_version: "e2a38a-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    provider_calls_made: 0,
    network_requests_made:
      networkRequestCount - requestCountBefore,
    e2a38_rerun: false,
    e2a39_executed: false,
    passed:
      networkRequestCount === requestCountBefore
  };
  const summary = {
    summary_version: "e2a38a-correction-summary-v1",
    correction_version: CORRECTION_VERSION,
    conceptual_evidence_update_source_version:
      CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
    calibration_case_count: calibrationResult.case_count,
    deterministic_regression_count: regressions.case_count,
    historical_e2a38_run_id: HISTORICAL_RUN_ID,
    historical_e2a38_status: HISTORICAL_STATUS,
    historical_e2a38_reclassified_as_passed: false,
    historical_evidence_unchanged:
      before.aggregate_sha256 === after.aggregate_sha256,
    protected_components_unchanged: protectedIntegrity.passed,
    replay_corrected_current_profile:
      replay.after.longitudinal_current_reasoning_quality,
    replay_corrected_stopping_decision:
      replay.after.stopping_decision,
    e2a39_protocol_version: e2a39.protocol.protocol_version,
    e2a39_protocol_hash: e2a39.protocol.protocol_hash,
    e2a39_composite_runtime_identity_hash:
      e2a39.compositeRuntimeIdentity.composite_runtime_identity_hash,
    e2a39_execution_authorized: false,
    e2a39_live_execution_performed: false,
    candidate_approved: false,
    candidate_activated: false,
    provider_calls_made: 0,
    network_requests_made: 0,
    passed:
      before.passed &&
      after.passed &&
      protectedIntegrity.passed &&
      calibrationResult.passed &&
      regressions.passed &&
      replay.passed &&
      providerCallGuard.passed
  };

  writeJson(path.join(runDirectory, "correction-manifest.json"), manifest);
  writeJson(
    path.join(
      runDirectory,
      "conceptual-evidence-update-source-v1.json"
    ),
    {
      contract,
      contract_hash: contractHash,
      implementation_hash: sourceHash
    }
  );
  writeJson(
    path.join(
      runDirectory,
      "conceptual-evidence-update-calibration.json"
    ),
    calibrationResult
  );
  writeJson(
    path.join(runDirectory, "deterministic-regressions.json"),
    regressions
  );
  writeJson(
    path.join(runDirectory, "e2a38-turn5-offline-replay.json"),
    replay
  );
  writeJson(
    path.join(runDirectory, "e2a38-historical-integrity-before.json"),
    before
  );
  writeJson(
    path.join(runDirectory, "e2a38-historical-integrity-after.json"),
    after
  );
  writeJson(
    path.join(runDirectory, "protected-source-integrity.json"),
    protectedIntegrity
  );
  writeJson(path.join(runDirectory, "e2a39-budget.json"), e2a39.budget);
  writeJson(
    path.join(runDirectory, "e2a39-artifact-contract.json"),
    e2a39.artifactContract
  );
  writeJson(path.join(runDirectory, "e2a39-protocol.json"), e2a39.protocol);
  writeJson(path.join(runDirectory, "e2a39-protocol.sha256"), {
    protocol_version: e2a39.protocol.protocol_version,
    protocol_hash: e2a39.protocol.protocol_hash
  });
  writeJson(
    path.join(runDirectory, "e2a39-composite-runtime-identity.json"),
    e2a39.compositeRuntimeIdentity
  );
  writeJson(
    path.join(runDirectory, "provider-call-guard.json"),
    providerCallGuard
  );
  writeJson(path.join(runDirectory, "summary.json"), summary);
  const validation = artifactValidation(runDirectory);
  assert(validation.passed, "e2a38a_artifact_validation_failed");
  writeJson(
    path.join(runDirectory, "artifact-validation.json"),
    validation
  );
  for (const name of ARTIFACT_NAMES) {
    chmodSync(path.join(runDirectory, name), 0o444);
  }
  chmodSync(runDirectory, 0o555);
  return {
    summary,
    validation,
    calibration: calibrationResult,
    regressions,
    replay,
    e2a39
  };
}

function runId() {
  const timestamp = new Date().toISOString().replace(/[-:.]/gu, "");
  return `e2a38a_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function latestRunDirectory() {
  assert(existsSync(ARTIFACT_ROOT), "e2a38a_artifact_root_missing");
  const latest = readdirSync(ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a38a_"))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  assert(latest, "e2a38a_artifact_run_missing");
  return path.join(ARTIFACT_ROOT, latest);
}

function inspect(runDirectory: string) {
  const summary = readJson<JsonRecord>(
    path.join(runDirectory, "summary.json")
  );
  const validation = readJson<JsonRecord>(
    path.join(runDirectory, "artifact-validation.json")
  );
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary,
    artifact_validation: validation,
    artifact_count: readdirSync(runDirectory).length,
    read_only: readdirSync(runDirectory).every((name) =>
      (statSync(path.join(runDirectory, name)).mode & 0o222) === 0
    ),
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function runSmoke(suite: string) {
  const runDirectory = mkdtempSync(
    path.join(tmpdir(), "e2a38a-conceptual-source-")
  );
  try {
    rmSync(runDirectory, { recursive: true, force: true });
    const result = execute(runDirectory);
    const checks: Record<string, boolean> = {
      all:
        result.summary.passed &&
        result.validation.passed &&
        result.calibration.passed &&
        result.regressions.passed &&
        result.replay.passed,
      contract:
        result.summary.conceptual_evidence_update_source_version ===
          CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
      calibration:
        result.calibration.passed &&
        result.calibration.case_count === 180,
      regressions:
        result.regressions.passed &&
        result.regressions.case_count === 5,
      replay:
        result.replay.passed &&
        result.replay.after.stopping_decision ===
          "stop_formative_dialogue",
      historical:
        result.summary.historical_evidence_unchanged,
      "e2a39-protocol":
        result.e2a39.protocol.status ===
          "prepared_not_authorized_not_executable" &&
        !result.e2a39.protocol.execution.authorized &&
        !result.e2a39.protocol.execution.live_entrypoint_present,
      artifact:
        result.validation.passed &&
        readdirSync(runDirectory).length === ARTIFACT_NAMES.length,
      "provider-call-guard":
        result.summary.provider_calls_made === 0 &&
        result.summary.network_requests_made === 0 &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a38a_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a38a_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      correction_version: CORRECTION_VERSION,
      conceptual_evidence_update_source_version:
        CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
      calibration_case_count: result.calibration.case_count,
      deterministic_regression_count: result.regressions.case_count,
      e2a38_historical_status: HISTORICAL_STATUS,
      e2a38_reclassified_as_passed: false,
      e2a39_protocol_hash: result.e2a39.protocol.protocol_hash,
      e2a39_composite_runtime_identity_hash:
        result.e2a39.compositeRuntimeIdentity
          .composite_runtime_identity_hash,
      e2a39_execution_authorized: false,
      e2a39_live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: networkRequestCount
    }, null, 2));
  } finally {
    if (existsSync(runDirectory)) {
      chmodSync(runDirectory, 0o755);
      for (const name of readdirSync(runDirectory)) {
        chmodSync(path.join(runDirectory, name), 0o644);
      }
    }
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    mkdirSync(ARTIFACT_ROOT, { recursive: true });
    const runDirectory = path.join(ARTIFACT_ROOT, runId());
    const result = execute(runDirectory);
    console.log(JSON.stringify({
      ...result.summary,
      artifact_directory: path.relative(process.cwd(), runDirectory),
      artifact_count: ARTIFACT_NAMES.length
    }, null, 2));
    return;
  }
  if (command === "report") {
    const runIndex = process.argv.indexOf("--run");
    const runDirectory = runIndex >= 0
      ? path.join(
          ARTIFACT_ROOT,
          process.argv[runIndex + 1] ?? "missing_e2a38a_run_identifier"
        )
      : latestRunDirectory();
    console.log(JSON.stringify(inspect(runDirectory), null, 2));
    return;
  }
  if (command === "smoke") {
    const suiteIndex = process.argv.indexOf("--suite");
    runSmoke(
      suiteIndex >= 0
        ? process.argv[suiteIndex + 1] ?? "all"
        : "all"
    );
    return;
  }
  throw new Error(`e2a38a_unknown_command:${command}`);
}

main();
