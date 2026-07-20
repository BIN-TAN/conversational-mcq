import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
  AutonomousPedagogyOutputSchema,
  buildAutonomousPedagogyInput,
  buildCompleteVisibleFormativeEpisode,
  createPedagogicalInterventionRecord,
  validateAutonomousPedagogyOutput
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";
import {
  createTopicDialogueTurnEvidenceProfile,
  integrateTopicDialogueEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  mapTargetEvidenceAdjudicationToObservation
} from "@/lib/services/student-assessment/target-evidence-contract";
import {
  buildE2A24CoverageMatrix,
  buildE2A24CrossDomainContracts,
  buildE2A24HeterogeneousCorpus,
  E2A24_ALLOWED_STATUS,
  E2A24_ARTIFACT_NAMES,
  executeE2A24,
  runE2A24NoLiveIntegrationCases,
  validateE2A24Artifacts
} from "@/lib/evaluation/formative/e2a24-autonomous-formative-dialogue";
import {
  evaluateE2A24Candidate
} from "@/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function soundProfileFixture() {
  const contract = buildE2A24CrossDomainContracts()[1]!.contract;
  const message =
    "Option B is too strong because a third factor or reverse direction can produce the association without the claimed cause.";
  const adjudication = {
    evaluator_version: "production-turn-evidence-evaluator-v2" as const,
    target_evidence_contract_version: "target-evidence-contract-v1" as const,
    criterion_results: contract.criteria.map((criterion) => ({
      criterion_id: criterion.criterion_id,
      satisfied: criterion.essential_for_revision,
      exact_evidence_spans: criterion.essential_for_revision
        ? [{ label: criterion.criterion_id, span: message }]
        : [],
      confidence: "high" as const
    })),
    contradiction_results: contract.contradiction_criteria.map(
      (criterion) => ({
        contradiction_id: criterion.contradiction_id,
        present: false,
        exact_evidence_spans: []
      })
    ),
    evidence_quality: "high" as const,
    coherent_conclusion: true,
    limitations: []
  };
  const observation = mapTargetEvidenceAdjudicationToObservation({
    contract,
    adjudication,
    interaction_intent: "ordinary_conceptual_response",
    confidence_evidence: "low"
  });
  const profile = createTopicDialogueTurnEvidenceProfile({
    source_student_turn_id: "student_1",
    source_sequence_index: 2,
    concept_id: contract.concept_id,
    distractor_anchor: `${contract.item_id} option ${contract.distractor_option}`,
    observation,
    created_at: "2026-07-20T22:00:00.000Z"
  });
  return {
    contract,
    profile,
    cumulative: integrateTopicDialogueEvidenceProfile({
      prior: null, current: profile
    })
  };
}

async function main() {
  const suite = argument("--suite") ?? "all";
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a24_smoke_network_request_prohibited");
  }) as typeof fetch;
  const artifactRoot = path.join(
    os.tmpdir(), `e2a24-smoke-${process.pid}-${Date.now()}`
  );
  try {
    const candidate = evaluateE2A24Candidate();
    assert.equal(
      candidate.candidate_configuration_hash,
      "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b"
    );
    assert.equal(candidate.candidate_approved, false);
    assert.equal(candidate.candidate_activated, false);
    assert.equal(candidate.changed_unrelated_roles.length, 0);
    assert.equal(Object.keys(candidate.unchanged_role_hashes).length, 16);

    const contracts = buildE2A24CrossDomainContracts();
    const corpus = buildE2A24HeterogeneousCorpus();
    const coverage = buildE2A24CoverageMatrix();
    assert.equal(contracts.length, 4);
    assert.equal(corpus.length, 120);
    assert.equal(coverage.passed, true);
    assert.ok(new Set(corpus.map((row) => row.student_response)).size >= 100);
    const genericSource = readFileSync(path.join(
      process.cwd(),
      "src/lib/services/student-assessment/autonomous-formative-dialogue.ts"
    ), "utf8");
    assert.ok(!/item_16|theta|reliability_validity|correlation_causation/iu
      .test(genericSource));

    const episode = buildCompleteVisibleFormativeEpisode({
      activity_attempt_public_id: "activity",
      dialogue_public_id: "dialogue",
      latest_student_turn_id: "student_1",
      latest_student_sequence_index: 2,
      turns: [
        {
          visible_turn_id: "activity_1", sequence_index: 1,
          dialogue_turn_number: 0, actor_type: "agent",
          message_text: "Initial distractor activity", visibility_status: "shown",
          activity_attempt_public_id: "activity", topic_dialogue_public_id: null
        },
        {
          visible_turn_id: "hidden_draft", sequence_index: 99,
          dialogue_turn_number: 1, actor_type: "agent",
          message_text: "Hidden draft", visibility_status: "draft",
          activity_attempt_public_id: "activity", topic_dialogue_public_id: "dialogue"
        },
        {
          visible_turn_id: "student_1", sequence_index: 2,
          dialogue_turn_number: 1, actor_type: "student",
          message_text: "The relationship needs another explanation.",
          visibility_status: "shown", activity_attempt_public_id: "activity",
          topic_dialogue_public_id: "dialogue"
        }
      ]
    });
    assert.deepEqual(episode.visible_turns.map((turn) => turn.visible_turn_id), [
      "activity_1", "student_1"
    ]);
    assert.equal(episode.raw_turn_truncation_applied, false);

    const integrations = await runE2A24NoLiveIntegrationCases();
    assert.ok(integrations.length >= 17);
    assert.ok(integrations.every((entry) => entry.passed));
    const soundFirst = integrations.find((entry) =>
      entry.case_id === "sound_first_formative_turn_no_minimum"
    );
    assert.equal(soundFirst?.selected_mode, "request_revision");
    assert.equal(soundFirst?.tutor_called, false);
    const protectedAfterSound = integrations.find((entry) =>
      entry.case_id === "protected_request_after_sound_retains_profile"
    );
    assert.ok(protectedAfterSound &&
      "current_misconception_status" in protectedAfterSound);
    assert.equal(protectedAfterSound?.current_misconception_status,
      "resolved_for_current_anchor");
    assert.equal(protectedAfterSound?.revision_readiness, true);
    assert.equal(protectedAfterSound?.cumulative_revision_readiness, true);
    assert.equal(protectedAfterSound?.next_ordinary_mode, "request_revision");
    const adaptation = integrations.find((entry) =>
      entry.case_id === "strategy_adaptation_after_no_improvement"
    );
    assert.ok(adaptation && "updated_prior_intervention_count" in adaptation);
    assert.equal(adaptation?.updated_prior_intervention_count, 0);
    const frustration = integrations.find((entry) =>
      entry.case_id === "frustration_unsound_acknowledged"
    );
    assert.ok(frustration && "effective_message" in frustration);
    assert.match(frustration.effective_message, /feels repetitive/iu);
    assert.match(frustration.effective_message, /third factor/iu);

    const fixture = soundProfileFixture();
    assert.throws(() => buildAutonomousPedagogyInput({
      complete_episode: episode,
      latest_profile: fixture.profile,
      cumulative_profile: fixture.cumulative,
      target_evidence_contract: fixture.contract,
      intervention_history: [],
      current_student_turn: 1,
      maximum_student_turns: 8
    }), /autonomous_tutor_prohibited_after_sound_profile/u);

    const partialObservation = {
      interaction_intent: "ordinary_conceptual_response" as const,
      reasoning_quality: "partial" as const,
      anchor_application: "explicit" as const,
      misconception_status: "uncertain" as const,
      essential_missing_links: ["required_mechanism"],
      contradictions: [],
      observable_evidence_spans: [{
        label: "relationship", span: "The concepts differ."
      }],
      confidence_evidence: "medium" as const,
      evidence_limitations: []
    };
    const partialProfile = createTopicDialogueTurnEvidenceProfile({
      source_student_turn_id: "student_1",
      source_sequence_index: 2,
      concept_id: fixture.contract.concept_id,
      distractor_anchor: "active option",
      observation: partialObservation,
      created_at: "2026-07-20T22:00:00.000Z"
    });
    const partialCumulative = integrateTopicDialogueEvidenceProfile({
      prior: null, current: partialProfile
    });
    const tutorInput = buildAutonomousPedagogyInput({
      complete_episode: episode,
      latest_profile: partialProfile,
      cumulative_profile: partialCumulative,
      target_evidence_contract: fixture.contract,
      intervention_history: [],
      current_student_turn: 1,
      maximum_student_turns: 8
    });
    const output = AutonomousPedagogyOutputSchema.parse({
      schema_version: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
      source_profile_snapshot_id: partialProfile.profile_snapshot_id,
      source_student_turn_id: partialProfile.source_student_turn_id,
      primary_learning_gap: "required_mechanism",
      pedagogical_goal: "Elicit the missing causal alternative.",
      pedagogical_strategy: "contrast case",
      why_this_strategy_fits_now: "The relationship is present but the mechanism is missing.",
      prior_interventions_considered: [],
      repetition_risk: "low",
      evidence_sought_from_next_response: ["required_mechanism"],
      student_facing_message:
        "What third factor could make both variables change without one causing the other?",
      requires_student_response: true
    });
    assert.equal(validateAutonomousPedagogyOutput({
      candidate_output: output, request: tutorInput
    }).runtime_acceptance, "accepted");
    const intervention = createPedagogicalInterventionRecord({
      output, created_at: "2026-07-20T22:01:00.000Z"
    });
    const repeatedInput = buildAutonomousPedagogyInput({
      complete_episode: episode,
      latest_profile: partialProfile,
      cumulative_profile: partialCumulative,
      target_evidence_contract: fixture.contract,
      intervention_history: [intervention],
      current_student_turn: 2,
      maximum_student_turns: 8
    });
    const soft = validateAutonomousPedagogyOutput({
      candidate_output: {
        ...output,
        student_facing_message:
          "Use a different example to show how a third factor could affect both variables.",
        repetition_risk: "moderate"
      },
      request: repeatedInput
    });
    assert.equal(soft.runtime_acceptance, "accepted_with_review_flags");
    assert.equal(soft.regeneration_required, false);
    const hard = validateAutonomousPedagogyOutput({
      candidate_output: {
        ...output,
        student_facing_message: "Your assessment is complete."
      },
      request: tutorInput
    });
    assert.equal(hard.runtime_acceptance, "hard_rejected");
    assert.equal(hard.regeneration_required, true);

    const runtimeSource = readFileSync(path.join(
      process.cwd(),
      "src/lib/services/student-assessment/activity-runtime-ui.ts"
    ), "utf8");
    assert.ok(runtimeSource.includes("completeVisibleEpisodeForRuntime"));
    assert.ok(runtimeSource.includes("active_formative_episode"));
    assert.ok(runtimeSource.includes("pedagogical_intervention"));
    assert.ok(runtimeSource.indexOf("formative_turn_evidence_packet_missing") <
      runtimeSource.indexOf("complete_visible_formative_conversation"));

    if (["all", "artifact", "candidate", "compilation", "protocol", "budget"]
      .includes(suite)) {
      const result = await executeE2A24({ root: artifactRoot });
      assert.equal(result.summary.status, E2A24_ALLOWED_STATUS);
      assert.equal(result.summary.provider_call_count, 0);
      assert.equal(result.summary.network_request_count, 0);
      assert.equal(result.summary.e2a25_executed, false);
      assert.equal(result.summary.candidate_approved, false);
      assert.equal(result.summary.candidate_activated, false);
      assert.equal(result.summary.heterogeneous_specimen_count, 120);
      assert.equal(result.summary.cross_domain_contract_count, 4);
      assert.equal(result.summary.all_role_request_compilation_passed, true);
      assert.equal(E2A24_ARTIFACT_NAMES.length, 24);
      assert.equal(validateE2A24Artifacts(result.runDir).passed, true);
      const budget = JSON.parse(readFileSync(path.join(
        result.runDir, "e2a25-budget-draft.json"
      ), "utf8")) as Record<string, unknown>;
      assert.equal(budget.maximum_logical_generation_calls, 78);
      assert.equal(budget.maximum_adapter_attempts, 234);
      assert.equal(budget.execution_authorized, false);
    }
    assert.equal(networkRequestCount, 0);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      candidate_configuration_hash: candidate.candidate_configuration_hash,
      candidate_file_sha256: candidate.candidate_file_sha256,
      cross_domain_contract_count: contracts.length,
      heterogeneous_specimen_count: corpus.length,
      integration_case_count: integrations.length,
      integration_pass_count: integrations.filter((entry) => entry.passed).length,
      provider_call_count: 0,
      network_request_count: networkRequestCount,
      e2a25_executed: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(artifactRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a24_smoke_failed");
  process.exitCode = 1;
});
