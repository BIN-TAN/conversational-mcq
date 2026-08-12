import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanonicalMisconceptionClaimCatalog } from "../src/lib/domain/misconception-claim-identity";
import { FORMATIVE_CONVERSATION_V17_OFFLINE_REPLAY_ROOT } from "../src/lib/operational/formative-conversation-v5-evaluation-v17/contracts";

const RUN_ID = "fcv5v16_provider_20260809170902_7934761a";
const RUN_ROOT = path.resolve(
  process.cwd(),
  ".data",
  "operational-formative-conversation-v5-evaluation-v16",
  "runs",
  RUN_ID
);
const OUTPUT_ROOT = path.resolve(
  process.cwd(),
  FORMATIVE_CONVERSATION_V17_OFFLINE_REPLAY_ROOT
);

type CaseDefinition = {
  case_id: string;
  transcript_file: string;
  transcript_sha256: string;
  resolved_claim_indexes: number[];
  claims: string[];
  expected_retained_claims: string[];
};

const CASES: CaseDefinition[] = [
  {
    case_id: "fcv5_05_sound_profile_transition",
    transcript_file: "fcv5_05_sound_profile_transition-transcript.json",
    transcript_sha256:
      "b1df94aa5de9efd3445d33b9b280a841b121a6f840f3b2496aabbd6a62ad6871",
    resolved_claim_indexes: [0, 2],
    claims: [
      "High reliability or consistency automatically proves validity.",
      "Standard error of measurement identifies an exact true score.",
      "Validity is a permanent, context-free property of a test."
    ],
    expected_retained_claims: [
      "Standard error of measurement identifies an exact true score."
    ]
  },
  {
    case_id: "fcv5_06_largely_improved_temporal",
    transcript_file: "fcv5_06_largely_improved_temporal-transcript.json",
    transcript_sha256:
      "4c7ee7e93b8b44eab72b43a9fd5ee2f5b6012b9684374e6262d39ea6a73fdcc2",
    resolved_claim_indexes: [0],
    claims: [
      "High reliability automatically proves validity.",
      "Standard error of measurement produces an exact score once measurement error is removed."
    ],
    expected_retained_claims: [
      "Standard error of measurement produces an exact score once measurement error is removed."
    ]
  },
  {
    case_id: "fcv5_08_mixed_resolved_evidence",
    transcript_file: "fcv5_08_mixed_resolved_evidence-transcript.json",
    transcript_sha256:
      "963a9db5c5966099705a6784ce36045bb9abd42ab5fc6527cf908682cbfda835",
    resolved_claim_indexes: [0],
    claims: [
      "Standard error of measurement identifies an exact true score."
    ],
    expected_retained_claims: []
  }
];

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("v17_v16_replay_fixture_record_required");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("v17_v16_replay_fixture_array_required");
  }
  return value;
}

async function materializeCase(definition: CaseDefinition) {
  const transcriptPath = path.join(
    RUN_ROOT,
    "cases",
    definition.transcript_file
  );
  const transcriptText = await readFile(transcriptPath, "utf8");
  if (sha256(transcriptText) !== definition.transcript_sha256) {
    throw new Error(`v16_transcript_hash_mismatch:${definition.case_id}`);
  }
  const transcriptArtifact = asRecord(JSON.parse(transcriptText));
  const agentCalls = asArray(transcriptArtifact.agent_calls);
  const finalCall = asRecord(agentCalls.at(-1));
  const invalidEvidence = asRecord(finalCall.safe_invalid_output_evidence);
  const semanticAttempt = asArray(invalidEvidence.attempts)
    .map(asRecord)
    .find((attempt) => attempt.kind === "semantic_regeneration");
  if (!semanticAttempt) {
    throw new Error(`v16_semantic_regeneration_missing:${definition.case_id}`);
  }
  const candidateEvidence = asRecord(
    semanticAttempt.safe_invalid_output_evidence
  );
  const candidate = asRecord(candidateEvidence.candidate_json);
  const recommendation = asRecord(
    candidate.profile_transition_recommendation
  );

  const fixturePath = path.resolve(
    process.cwd(),
    "config",
    "operational-candidates",
    "formative-conversation-host-v5-executable-v16",
    "fixtures",
    `${definition.case_id}.json`
  );
  const v16FixtureText = await readFile(fixturePath, "utf8");
  const v16Fixture = asRecord(JSON.parse(v16FixtureText));
  const initialProfileSource = asRecord(v16Fixture.initial_profile_source);
  const initialProfile = asRecord(initialProfileSource.profile);
  const priorIndicators = asArray(initialProfile.misconception_indicators);
  if (priorIndicators.length !== 1) {
    throw new Error(`v16_prior_indicator_shape_invalid:${definition.case_id}`);
  }
  const priorIndicator = asRecord(priorIndicators[0]);
  const evidenceReference = String(priorIndicator.evidence_reference);
  const catalog = createCanonicalMisconceptionClaimCatalog({
    identity_scope: `v17-v16-replay:${definition.case_id}`,
    indicators: [
      {
        indicator: String(priorIndicator.indicator),
        evidence_reference: evidenceReference,
        confidence: String(priorIndicator.confidence) as
          | "low"
          | "medium"
          | "high",
        rationale:
          typeof priorIndicator.rationale === "string"
            ? priorIndicator.rationale
            : null,
        atomic_claims: definition.claims.map((claimText) => ({
          claim_text: claimText,
          source_evidence_references: [evidenceReference]
        }))
      }
    ]
  });
  const supportingStudentTurns = new Set(
    asArray(recommendation.source_turn_sequence_indexes).map(Number)
  );
  const primaryStudentTurn = Math.max(...supportingStudentTurns);
  const dispositions = catalog.indicators[0].claims.map((claim, index) => {
    const resolved = definition.resolved_claim_indexes.includes(index);
    return {
      identity_version: catalog.identity_version,
      indicator_id: catalog.indicators[0].indicator_id,
      claim_id: claim.claim_id,
      disposition: resolved ? "resolved" : "retained",
      evidence_basis: resolved
        ? "conversation_evidence"
        : "prior_profile_evidence",
      evidence_summary: resolved
        ? `The frozen V16 regenerated recommendation cites student turn ${primaryStudentTurn} as evidence resolving this claim.`
        : "The frozen V16 regenerated recommendation preserves this claim because the conversation did not resolve it.",
      source_turn_sequence_indexes: resolved ? [primaryStudentTurn] : []
    };
  });
  const translatedCandidate = {
    ...candidate,
    contract_version: "formative-conversation-agent-contract-v2",
    profile_transition_recommendation: {
      ...recommendation,
      recommendation_version:
        "formative-conversation-profile-recommendation-v3",
      misconception_claim_closure: [],
      misconception_claim_dispositions: dispositions
    }
  };
  const output = {
    fixture_version: "formative-conversation-v17-v16-replay-fixture-v1",
    source: {
      run_id: RUN_ID,
      case_id: definition.case_id,
      transcript_path: `cases/${definition.transcript_file}`,
      transcript_sha256: definition.transcript_sha256,
      regenerated_candidate_sha256: candidateEvidence.candidate_hash
    },
    prior_profile_source: initialProfile,
    canonical_claim_catalog: catalog,
    visible_transcript: transcriptArtifact.transcript,
    v16_regenerated_candidate: candidate,
    v17_identity_translated_candidate: translatedCandidate,
    expected: {
      proposed_outcome: "largely_improved_understanding",
      retained_claim_texts: definition.expected_retained_claims,
      transition_accepted: true
    }
  };
  await writeFile(
    path.join(OUTPUT_ROOT, `${definition.case_id}.json`),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );
}

export async function materializeFormativeConversationV17V16ReplayFixtures() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  for (const definition of CASES) {
    await materializeCase(definition);
  }
  process.stdout.write(
    `${JSON.stringify({ materialized: CASES.length, provider_calls: 0 })}\n`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  materializeFormativeConversationV17V16ReplayFixtures().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
