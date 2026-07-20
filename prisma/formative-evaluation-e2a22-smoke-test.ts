import {
  createTopicDialogueTurnEvidenceProfile,
  integrateTopicDialogueEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TurnEvidenceObservation
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  e2a22BudgetMatchesE2A21Envelope,
  executeE2A22,
  removeTemporaryE2A22ArtifactRoot,
  replayE2A21WithEvidenceFirstProfiles,
  runE2A22DeterministicRoutingTests,
  runE2A22StaleProfileGuardTests,
  temporaryE2A22ArtifactRoot,
  validateE2A22Artifacts,
  validateE2A23Drafts
} from "@/lib/evaluation/formative/e2a22-evidence-first-profile-routing";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function soundObservation(): TurnEvidenceObservation {
  return {
    interaction_intent: "ordinary_conceptual_response",
    reasoning_quality: "sound",
    anchor_application: "explicit",
    misconception_status: "resolved_for_current_anchor",
    essential_missing_links: [],
    contradictions: [],
    observable_evidence_spans: [{
      label: "relationship",
      span: "Information is highest when theta is close to item difficulty."
    }],
    confidence_evidence: null,
    evidence_limitations: []
  };
}

function profile(sequence: number, options: {
  transfer?: boolean;
  completion?: boolean;
} = {}) {
  return createTopicDialogueTurnEvidenceProfile({
    source_student_turn_id: `turn_${sequence}`,
    source_sequence_index: sequence,
    concept_id: "theta_information",
    distractor_anchor: "Item 16 option A",
    observation: soundObservation(),
    transfer_readiness: options.transfer,
    completion_readiness: options.completion,
    created_at: "2026-07-20T12:00:00.000Z"
  });
}

function profileFirstSuite() {
  const result = runE2A22DeterministicRoutingTests();
  assert(result.passed, "e2a22 deterministic profile-first routing failed");
  assert(result.cases.some((entry) =>
    entry.case_id === "sound_first_turn_no_minimum" && entry.passed),
  "e2a22 sound first turn did not request revision");
  assert(result.cases.some((entry) =>
    entry.case_id === "protected_request_after_sound_evidence" && entry.passed),
  "e2a22 protected redirect did not retain sound evidence");
  return result;
}

function staleSuite() {
  const rows = runE2A22StaleProfileGuardTests();
  assert(rows.length === 3 && rows.every((row) => row.passed),
    "e2a22 stale profile guard failed");
  assert(rows.filter((row) => !row.expected_pass).every((row) =>
    !row.guard_passed && row.provider_call_count === 0),
  "e2a22 stale profile did not fail before provider dispatch");
  return rows;
}

function replaySuite() {
  const result = replayE2A21WithEvidenceFirstProfiles();
  assert(result.profiles.length === 6 && result.comparisons.length === 6,
    "e2a22 E2A.21 replay count mismatch");
  assert(result.earliest_revision_readiness.turn_number === 3,
    "e2a22 earliest revision-ready turn mismatch");
  assert(result.counterfactual_boundary.first_divergent_turn === 1,
    "e2a22 first divergence mismatch");
  const quoted = result.profiles.find((row) => row.turn_number === 6);
  const quotedProfile = quoted?.profile as { reasoning_quality?: string;
    revision_readiness?: boolean } | undefined;
  const quotedRoute = quoted?.corrected_route as { selected_mode?: string } | undefined;
  assert(quotedProfile?.reasoning_quality === "sound" &&
    quotedProfile.revision_readiness === true &&
    quotedRoute?.selected_mode === "request_revision",
  "e2a22 quoted E2A.21 response was not revision-ready");
  return result;
}

function idempotencySuite() {
  const first = profile(4);
  const second = profile(4);
  const firstCumulative = integrateTopicDialogueEvidenceProfile({
    prior: null, current: first
  });
  const replayCumulative = integrateTopicDialogueEvidenceProfile({
    prior: firstCumulative, current: second
  });
  const firstRoute = selectEvidenceFirstTopicDialogueRoute({
    profile: first, cumulative: firstCumulative
  });
  const secondRoute = selectEvidenceFirstTopicDialogueRoute({
    profile: second, cumulative: replayCumulative
  });
  assert(first.profile_snapshot_id === second.profile_snapshot_id,
    "e2a22 replay generated duplicate profile identity");
  assert(replayCumulative.historical_profile_snapshot_ids.length === 1,
    "e2a22 replay duplicated cumulative profile history");
  assert(JSON.stringify(firstRoute) === JSON.stringify(secondRoute),
    "e2a22 replay changed effective route");
  return { passed: true, profile_snapshot_id: first.profile_snapshot_id,
    effective_route: firstRoute };
}

function progressionSuite() {
  const revisionProfile = profile(1);
  const revisionCumulative = integrateTopicDialogueEvidenceProfile({
    prior: null, current: revisionProfile
  });
  const revision = selectEvidenceFirstTopicDialogueRoute({
    profile: revisionProfile, cumulative: revisionCumulative
  });
  const transferProfile = profile(2, { transfer: true });
  const transferCumulative = integrateTopicDialogueEvidenceProfile({
    prior: revisionCumulative, current: transferProfile
  });
  const transfer = selectEvidenceFirstTopicDialogueRoute({
    profile: transferProfile, cumulative: transferCumulative
  });
  const completionProfile = profile(3, { completion: true });
  const completionCumulative = integrateTopicDialogueEvidenceProfile({
    prior: transferCumulative, current: completionProfile
  });
  const completion = selectEvidenceFirstTopicDialogueRoute({
    profile: completionProfile, cumulative: completionCumulative
  });
  assert(revision.selected_mode === "request_revision" &&
    transfer.selected_mode === "present_transfer" &&
    completion.selected_mode === "complete_episode",
  "e2a22 progression stages were conflated");
  assert([revision, transfer, completion].every((route) =>
    route.minimum_turn_requirement_applied === false),
  "e2a22 minimum turn requirement appeared");
  return { passed: true, revision, transfer, completion };
}

function protocolSuite() {
  const result = validateE2A23Drafts();
  assert(result.passed && e2a22BudgetMatchesE2A21Envelope(),
    "e2a23 draft protocol or budget invalid");
  assert(result.protocol.execute_in_e2a22 === false,
    "e2a23 execution was authorized in E2A.22");
  return result;
}

async function artifactSuite(providerGuard = false) {
  const root = temporaryE2A22ArtifactRoot();
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;
  if (providerGuard) {
    globalThis.fetch = (async () => {
      networkAttempts += 1;
      throw new Error("e2a22_provider_call_forbidden");
    }) as typeof fetch;
  }
  try {
    const result = await executeE2A22({ artifactRoot: root });
    const validation = validateE2A22Artifacts(result.runDir);
    assert(validation.passed, "e2a22 artifact validation failed");
    assert(result.summary.provider_calls_made === 0 && networkAttempts === 0,
      "e2a22 made a provider or network call");
    assert(result.compilation.passed,
      "e2a22 all-role request compilation failed");
    return { run_id: result.runId, validation,
      provider_call_count: 0, network_attempt_count: networkAttempts };
  } finally {
    globalThis.fetch = originalFetch;
    removeTemporaryE2A22ArtifactRoot(root);
  }
}

async function main() {
  const suite = argument("--suite") ?? "all";
  const outputs: Record<string, unknown> = {};
  if (["all", "profile-first-routing"].includes(suite)) {
    outputs.profile_first_routing = profileFirstSuite();
  }
  if (["all", "stale-profile-guard"].includes(suite)) {
    outputs.stale_profile_guard = staleSuite();
  }
  if (["all", "e2a21-replay"].includes(suite)) {
    outputs.e2a21_replay = replaySuite();
  }
  if (["all", "idempotency"].includes(suite)) {
    outputs.idempotency = idempotencySuite();
  }
  if (["all", "progression-separation"].includes(suite)) {
    outputs.progression_separation = progressionSuite();
  }
  if (["all", "e2a23-protocol", "e2a23-budget"].includes(suite)) {
    outputs.e2a23 = protocolSuite();
  }
  if (["all", "request-compilation"].includes(suite)) {
    outputs.request_compilation = await artifactSuite(false);
  }
  if (["provider-guard"].includes(suite)) {
    outputs.provider_guard = await artifactSuite(true);
  }
  if (Object.keys(outputs).length === 0) {
    throw new Error(`unknown_e2a22_suite:${suite}`);
  }
  console.log(JSON.stringify({ status: "passed", suite, outputs }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a22_smoke_failed");
  process.exitCode = 1;
});
