import assert from "node:assert/strict";
import {
  FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_ISSUE_CODE,
  FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_VERSION,
  validateFormativeConversationTransitionEvidenceClosure
} from "../src/lib/services/student-assessment/formative-conversation/transition-evidence-closure";

type TerminalOutcome =
  | "sound_understanding"
  | "largely_improved_understanding"
  | "teacher_assistance_recommended";

function recommendation(input: {
  outcome: TerminalOutcome;
  canonical: number[];
  fieldEvidence: number[][];
}) {
  return {
    proposed_outcome: input.outcome,
    source_turn_sequence_indexes: input.canonical,
    field_evidence: input.fieldEvidence.map((sourceTurnSequenceIndexes) => ({
      source_turn_sequence_indexes: sourceTurnSequenceIndexes
    }))
  } as const;
}

function main() {
  const closed = validateFormativeConversationTransitionEvidenceClosure({
    recommendation: recommendation({
      outcome: "sound_understanding",
      canonical: [788, 789, 790],
      fieldEvidence: [[789], [788, 790]]
    }),
    evidence_observations: [
      { source_turn_sequence_indexes: [788] },
      { source_turn_sequence_indexes: [790] }
    ]
  });
  assert.equal(closed.valid, true);
  assert.deepEqual(closed.canonical_turn_sequence_indexes, [788, 789, 790]);
  assert.deepEqual(closed.missing_turn_sequence_indexes, []);

  const missingFieldEvidence =
    validateFormativeConversationTransitionEvidenceClosure({
      recommendation: recommendation({
        outcome: "sound_understanding",
        canonical: [788, 790],
        fieldEvidence: [[789]]
      }),
      evidence_observations: [{ source_turn_sequence_indexes: [788, 790] }]
    });
  assert.equal(missingFieldEvidence.valid, false);
  assert.deepEqual(missingFieldEvidence.missing_turn_sequence_indexes, [789]);
  assert.equal(
    missingFieldEvidence.issues[0]?.code,
    FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_ISSUE_CODE
  );
  assert.equal(
    missingFieldEvidence.issues[0]?.field_path,
    "profile_transition_recommendation.field_evidence.0.source_turn_sequence_indexes"
  );

  const unsupportedTeacherAssistance =
    validateFormativeConversationTransitionEvidenceClosure({
      recommendation: recommendation({
        outcome: "teacher_assistance_recommended",
        canonical: [41],
        fieldEvidence: [[42]]
      }),
      evidence_observations: [{ source_turn_sequence_indexes: [41] }]
    });
  assert.equal(unsupportedTeacherAssistance.valid, false);
  assert.deepEqual(
    unsupportedTeacherAssistance.missing_turn_sequence_indexes,
    [42]
  );

  const unsupportedLargelyImproved =
    validateFormativeConversationTransitionEvidenceClosure({
      recommendation: recommendation({
        outcome: "largely_improved_understanding",
        canonical: [51],
        fieldEvidence: [[51]]
      }),
      evidence_observations: [{ source_turn_sequence_indexes: [52] }]
    });
  assert.equal(unsupportedLargelyImproved.valid, false);
  assert.deepEqual(
    unsupportedLargelyImproved.missing_turn_sequence_indexes,
    [52]
  );
  assert.equal(
    unsupportedLargelyImproved.issues[0]?.field_path,
    "evidence_observations.0.source_turn_sequence_indexes"
  );

  const nonterminal = validateFormativeConversationTransitionEvidenceClosure({
    recommendation: {
      proposed_outcome: "continue_conversation",
      source_turn_sequence_indexes: [61],
      field_evidence: [{ source_turn_sequence_indexes: [62] }]
    },
    evidence_observations: [{ source_turn_sequence_indexes: [63] }]
  });
  assert.equal(nonterminal.valid, true);
  assert.deepEqual(nonterminal.canonical_turn_sequence_indexes, []);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        closure_version:
          FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_VERSION,
        closed_transition_accepted: true,
        missing_field_reference_rejected: true,
        unsupported_teacher_assistance_rejected: true,
        unsupported_largely_improved_rejected: true,
        nonterminal_transition_not_forced: true,
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
