import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CanonicalMisconceptionClaimCatalogSchema,
  canonicalMisconceptionClaimTexts
} from "../src/lib/domain/misconception-claim-identity";
import { FORMATIVE_CONVERSATION_V17_OFFLINE_REPLAY_ROOT } from "../src/lib/operational/formative-conversation-v5-evaluation-v17/contracts";
import { FormativeConversationAgentOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  canonicalFormativeConversationProfileFromStudentProfile,
  type FormativeConversationCanonicalProfileSource
} from "../src/lib/services/student-assessment/formative-conversation/profile-update";
import { validateFormativeConversationProfileTransition } from "../src/lib/services/student-assessment/formative-conversation/profile-transition-validator";

const ROOT = path.resolve(
  process.cwd(),
  FORMATIVE_CONVERSATION_V17_OFFLINE_REPLAY_ROOT
);

const CASES = [
  {
    case_id: "fcv5_05_sound_profile_transition",
    fixture_sha256:
      "cde1a337d6a5c049886e99fbf81ecfdd4748d1338b9ee10dfe40e86065f5cf7e",
    transcript_sha256:
      "b1df94aa5de9efd3445d33b9b280a841b121a6f840f3b2496aabbd6a62ad6871"
  },
  {
    case_id: "fcv5_06_largely_improved_temporal",
    fixture_sha256:
      "c4e3c7f3f81f327976081b642f8d1405f94b9a8193a9161091e078f7133af316",
    transcript_sha256:
      "4c7ee7e93b8b44eab72b43a9fd5ee2f5b6012b9684374e6262d39ea6a73fdcc2"
  },
  {
    case_id: "fcv5_08_mixed_resolved_evidence",
    fixture_sha256:
      "125e89924201cc1bbb2840ce67d19d76c3158a50bf7cf07a5598a6b55f6534c8",
    transcript_sha256:
      "963a9db5c5966099705a6784ce36045bb9abd42ab5fc6527cf908682cbfda835"
  }
] as const;

type ReplayFixture = {
  fixture_version: string;
  source: {
    run_id: string;
    case_id: string;
    transcript_sha256: string;
    regenerated_candidate_sha256: string;
  };
  prior_profile_source: FormativeConversationCanonicalProfileSource;
  canonical_claim_catalog: unknown;
  visible_transcript: Array<{
    sequence_index: number;
    actor: "student" | "tutor";
  }>;
  v16_regenerated_candidate: unknown;
  v17_identity_translated_candidate: unknown;
  expected: {
    proposed_outcome: string;
    retained_claim_texts: string[];
    transition_accepted: boolean;
  };
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSubstantiveRecommendationUnchanged(input: {
  v16: unknown;
  v17: unknown;
}) {
  const v16 = structuredClone(input.v16) as Record<string, unknown>;
  const v17 = structuredClone(input.v17) as Record<string, unknown>;
  const v16Recommendation = v16.profile_transition_recommendation as Record<
    string,
    unknown
  >;
  const v17Recommendation = v17.profile_transition_recommendation as Record<
    string,
    unknown
  >;
  v17.contract_version = v16.contract_version;
  v17Recommendation.recommendation_version =
    v16Recommendation.recommendation_version;
  v17Recommendation.misconception_claim_closure =
    v16Recommendation.misconception_claim_closure;
  delete v17Recommendation.misconception_claim_dispositions;
  assert.deepEqual(
    v17,
    v16,
    "V17 replay translation may change only claim identity transport."
  );
}

function main() {
  const results: Array<Record<string, unknown>> = [];
  for (const definition of CASES) {
    const filename = `${definition.case_id}.json`;
    const fixtureText = readFileSync(path.join(ROOT, filename), "utf8");
    assert.equal(sha256(fixtureText), definition.fixture_sha256);
    const fixture = JSON.parse(fixtureText) as ReplayFixture;
    assert.equal(
      fixture.fixture_version,
      "formative-conversation-v17-v16-replay-fixture-v1"
    );
    assert.equal(
      fixture.source.run_id,
      "fcv5v16_provider_20260809170902_7934761a"
    );
    assert.equal(fixture.source.case_id, definition.case_id);
    assert.equal(
      fixture.source.transcript_sha256,
      definition.transcript_sha256
    );
    assert.match(fixture.source.regenerated_candidate_sha256, /^[a-f0-9]{64}$/u);

    assertSubstantiveRecommendationUnchanged({
      v16: fixture.v16_regenerated_candidate,
      v17: fixture.v17_identity_translated_candidate
    });

    const claimCatalog = CanonicalMisconceptionClaimCatalogSchema.parse(
      fixture.canonical_claim_catalog
    );
    const priorProfile = {
      ...canonicalFormativeConversationProfileFromStudentProfile(
        fixture.prior_profile_source
      ),
      misconception_indicators:
        canonicalMisconceptionClaimTexts(claimCatalog)
    };
    const candidate = FormativeConversationAgentOutputSchema.parse(
      fixture.v17_identity_translated_candidate
    );
    assert.equal(
      candidate.profile_transition_recommendation?.proposed_outcome,
      fixture.expected.proposed_outcome
    );
    const validation = validateFormativeConversationProfileTransition({
      recommendation: candidate.profile_transition_recommendation,
      prior_profile: priorProfile,
      prior_misconception_claim_catalog: claimCatalog,
      evidence_observations: candidate.evidence_observations,
      available_turns: fixture.visible_transcript.map((turn) => ({
        sequence_index: turn.sequence_index,
        actor: turn.actor
      }))
    });
    assert.equal(
      validation.valid,
      fixture.expected.transition_accepted,
      validation.issues.map((issue) => `${issue.code}:${issue.message}`).join("\n")
    );
    assert.equal(validation.terminal, true);
    assert.deepEqual(
      validation.updated_profile?.misconception_indicators,
      fixture.expected.retained_claim_texts
    );
    assert.deepEqual(
      canonicalMisconceptionClaimTexts(
        validation.updated_misconception_claim_catalog ??
          (() => {
            throw new Error("v17_replay_updated_catalog_missing");
          })()
      ),
      fixture.expected.retained_claim_texts
    );
    if (definition.case_id === "fcv5_08_mixed_resolved_evidence") {
      assert.equal(
        validation.updated_profile?.misconception_indicators.length,
        0,
        "The resolved SEM claim must leave no current misconception."
      );
      assert(
        validation.updated_profile?.recommended_next_evidence.some((entry) =>
          /validity|evidence/iu.test(entry)
        ),
        "Validity-evidence sufficiency must remain a limitation or next-evidence need."
      );
    }
    results.push({
      case_id: definition.case_id,
      outcome: candidate.profile_transition_recommendation?.proposed_outcome,
      retained_claim_texts: fixture.expected.retained_claim_texts,
      accepted: validation.valid
    });
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        immutable_v16_run_id:
          "fcv5v16_provider_20260809170902_7934761a",
        cases: results,
        substantive_recommendations_changed: false,
        provider_calls: 0,
        model_auth_requests: 0,
        network_requests: 0,
        dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
}

main();
