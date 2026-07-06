import { readFile } from "node:fs/promises";
import {
  buildNoLiveActivityMisconceptionEvidenceFixture,
  validateActivityMisconceptionEvidencePacket,
  type ActivityMisconceptionEvidencePacketV1,
  type MisconceptionUpdateStatus
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import {
  buildPostActivityDiagnosticSnapshotPayload,
  persistActivityMisconceptionEvidenceUpdate,
  validateActivityMisconceptionEvidencePersistence,
  writePostActivityMisconceptionUpdateReview
} from "../src/lib/services/student-assessment/activity-misconception-update";
import {
  makeActivityMisconceptionEvidenceAuditForTest,
  makeLiveActivityMisconceptionEvidencePacketForTest
} from "../src/lib/services/student-assessment/activity-misconception-evidence-live";
import { prisma } from "../src/lib/db";
import { assert } from "./student-mvp-smoke-helpers";
import { activityMisconceptionEvidenceFixtureCases } from "./student-activity-misconception-evidence-fixtures";

const SMOKE_PREFIX = "activity_attempt_phase30d_smoke";

function packetByStatus(
  packets: ActivityMisconceptionEvidencePacketV1[],
  status: MisconceptionUpdateStatus
) {
  const packet = packets.find((entry) => entry.misconception_evidence_update.status === status);
  assert(packet, `Expected packet with status ${status}.`);
  return packet;
}

function makePacketForSmoke(
  packet: ActivityMisconceptionEvidencePacketV1,
  suffix: string
) {
  return makeLiveActivityMisconceptionEvidencePacketForTest(packet, {
    session_public_id: `sess_phase30d_smoke_${suffix}`,
    student_public_id: "student_phase30d_smoke",
    assessment_public_id: "assessment_phase30d_smoke",
    concept_unit_id: "concept_phase30d_smoke",
    activity_attempt_id: `${SMOKE_PREFIX}_${suffix}`
  });
}

function assertAllowedBeforePersistence(input: {
  packet: ActivityMisconceptionEvidencePacketV1;
  allowedStatuses: string[];
  label: string;
}) {
  assert(
    input.allowedStatuses.includes(input.packet.misconception_evidence_update.status),
    `${input.label}: disallowed live evaluator status must fail before persistence.`
  );
}

async function createSyntheticAgentCall(suffix: string, overrides: {
  provider_request_id?: string | null;
  provider_response_id?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  call_status?: "succeeded" | "failed" | "invalid_output";
  output_validated?: boolean;
} = {}) {
  return prisma.agentCall.create({
    data: {
      agent_name: "formative_activity_response_evaluator_agent",
      agent_version: "formative-activity-response-evaluator-v1",
      model_name: "synthetic-openai-live-shaped",
      provider: "openai",
      provider_request_id: overrides.provider_request_id === null
        ? undefined
        : overrides.provider_request_id ?? `req_phase30d_${suffix}`,
      provider_response_id: overrides.provider_response_id === null
        ? undefined
        : overrides.provider_response_id ?? `resp_phase30d_${suffix}`,
      client_request_id: `client_phase30d_${suffix}`,
      prompt_version: "formative-activity-response-evaluator-prompt-v6",
      schema_version: "formative-activity-response-evaluation-v1",
      input_payload: { smoke: true, redacted: true },
      raw_output: { synthetic: true, redacted: true },
      output_payload: { synthetic: true, redacted: true },
      output_validated: overrides.output_validated ?? true,
      live_call_allowed: true,
      call_status: overrides.call_status ?? "succeeded",
      input_tokens: overrides.input_tokens === null ? undefined : overrides.input_tokens ?? 11,
      output_tokens: overrides.output_tokens === null ? undefined : overrides.output_tokens ?? 17,
      total_tokens: overrides.total_tokens === null ? undefined : overrides.total_tokens ?? 28,
      token_usage: { input_tokens: overrides.input_tokens ?? 11, output_tokens: overrides.output_tokens ?? 17, total_tokens: overrides.total_tokens ?? 28 },
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

async function cleanup() {
  const records = await prisma.activityMisconceptionEvidenceRecord.findMany({
    where: { activity_attempt_id: { startsWith: SMOKE_PREFIX } },
    select: { id: true }
  });
  await prisma.postActivityDiagnosticSnapshot.deleteMany({
    where: { evidence_record_db_id: { in: records.map((record) => record.id) } }
  });
  await prisma.activityMisconceptionEvidenceRecord.deleteMany({
    where: { activity_attempt_id: { startsWith: SMOKE_PREFIX } }
  });
  await prisma.agentCall.deleteMany({
    where: { client_request_id: { startsWith: "client_phase30d_" } }
  });
}

async function expectGuardRejects(input: {
  packet: ActivityMisconceptionEvidencePacketV1;
  agentCall?: Awaited<ReturnType<typeof createSyntheticAgentCall>>;
  auditOverrides?: Parameters<typeof makeActivityMisconceptionEvidenceAuditForTest>[0];
  expectedRule: string;
  label: string;
}) {
  const audit = input.agentCall
    ? makeActivityMisconceptionEvidenceAuditForTest({
        agent_call_id: input.agentCall.id,
        provider: "openai",
        model_name: input.agentCall.model_name,
        client_request_id: input.agentCall.client_request_id ?? undefined,
        provider_request_id: input.agentCall.provider_request_id ?? undefined,
        provider_response_id: input.agentCall.provider_response_id ?? undefined,
        input_tokens: input.agentCall.input_tokens ?? undefined,
        output_tokens: input.agentCall.output_tokens ?? undefined,
        total_tokens: input.agentCall.total_tokens ?? undefined,
        ...input.auditOverrides
      })
    : makeActivityMisconceptionEvidenceAuditForTest(input.auditOverrides);
  const guard = await validateActivityMisconceptionEvidencePersistence({
    packet: input.packet,
    evaluator_audit: audit,
    mode: "production_diagnosis"
  });
  assert(!guard.passed, `${input.label}: guard should reject.`);
  assert(
    guard.issues.some((issue) => issue.rule_code === input.expectedRule),
    `${input.label}: expected ${input.expectedRule}, got ${JSON.stringify(guard.issues)}`
  );
}

async function main() {
  await cleanup();
  const profileCountBefore = await prisma.studentProfile.count();
  const decisionCountBefore = await prisma.formativeDecision.count();
  const followupCountBefore = await prisma.followupRound.count();
  const fixtures = activityMisconceptionEvidenceFixtureCases();
  const noLivePackets = fixtures.map((fixture) => buildNoLiveActivityMisconceptionEvidenceFixture(fixture));
  const validPacket = makePacketForSmoke(
    packetByStatus(noLivePackets, "misconception_weakened"),
    "valid_production"
  );
  const validation = validateActivityMisconceptionEvidencePacket(validPacket);
  assert(validation.valid, `Valid live-shaped packet should validate: ${JSON.stringify(validation.issues)}`);

  const agentCall = await createSyntheticAgentCall("valid_production");
  const audit = makeActivityMisconceptionEvidenceAuditForTest({
    agent_call_id: agentCall.id,
    provider: "openai",
    model_name: agentCall.model_name,
    client_request_id: agentCall.client_request_id ?? undefined,
    provider_request_id: agentCall.provider_request_id ?? undefined,
    provider_response_id: agentCall.provider_response_id ?? undefined,
    input_tokens: agentCall.input_tokens ?? undefined,
    output_tokens: agentCall.output_tokens ?? undefined,
    total_tokens: agentCall.total_tokens ?? undefined
  });

  const persisted = await persistActivityMisconceptionEvidenceUpdate({
    packet: validPacket,
    evaluator_audit: audit,
    mode: "production_diagnosis",
    source_activity_packet_ref: {
      activity_attempt_id: validPacket.activity_attempt_id,
      source_activity_family: validPacket.source_activity_family
    },
    pre_activity_diagnostic_state: "pre_activity_suspected_distractor_boundary_issue"
  });
  assert(persisted.guard.passed, "Production persistence guard should pass for a valid live-shaped packet.");
  assert(persisted.record.source_activity_packet_ref !== null, "Source activity packet safe reference should be retained.");
  assert(persisted.snapshot, "A post-activity diagnostic snapshot should be created.");
  assert(
    persisted.snapshot?.pre_activity_diagnostic_state === "pre_activity_suspected_distractor_boundary_issue",
    "Snapshot should preserve pre-activity state without overwriting it."
  );
  assert(
    persisted.snapshot?.post_activity_diagnostic_state === validPacket.misconception_evidence_update.status,
    "Snapshot should expose post-activity diagnostic state from evaluator status."
  );
  assert(
    persisted.record.source_evaluator_agent_call_db_id === agentCall.id,
    "Evidence record should reference the source evaluator agent call."
  );

  const idempotent = await persistActivityMisconceptionEvidenceUpdate({
    packet: validPacket,
    evaluator_audit: audit,
    mode: "production_diagnosis",
    pre_activity_diagnostic_state: "pre_activity_suspected_distractor_boundary_issue"
  });
  assert(
    idempotent.record.id === persisted.record.id,
    "Repeated persistence of the same packet/audit/mode should reuse the existing evidence record."
  );

  await expectGuardRejects({
    packet: makePacketForSmoke(packetByStatus(noLivePackets, "misconception_weakened"), "missing_agent_id"),
    auditOverrides: { agent_call_id: undefined },
    expectedRule: "missing_evaluator_agent_call_id",
    label: "missing evaluator agent call id"
  });

  const missingMetadataAgentCall = await createSyntheticAgentCall("missing_metadata", {
    provider_request_id: null,
    provider_response_id: null
  });
  await expectGuardRejects({
    packet: makePacketForSmoke(packetByStatus(noLivePackets, "misconception_weakened"), "missing_metadata"),
    agentCall: missingMetadataAgentCall,
    auditOverrides: { provider_request_id: undefined, provider_response_id: undefined },
    expectedRule: "missing_provider_metadata",
    label: "missing provider metadata"
  });

  const missingUsageAgentCall = await createSyntheticAgentCall("missing_usage", {
    input_tokens: null,
    output_tokens: null,
    total_tokens: null
  });
  await expectGuardRejects({
    packet: makePacketForSmoke(packetByStatus(noLivePackets, "misconception_weakened"), "missing_usage"),
    agentCall: missingUsageAgentCall,
    auditOverrides: { input_tokens: undefined, output_tokens: undefined, total_tokens: undefined },
    expectedRule: "missing_token_usage",
    label: "missing token usage"
  });

  await expectGuardRejects({
    packet: noLivePackets[0]!,
    agentCall,
    expectedRule: "no_live_fixture_rejected_for_production",
    label: "no-live fixture production diagnosis"
  });

  const reviewOnlyPacket = makeLiveActivityMisconceptionEvidencePacketForTest(noLivePackets[0]!, {
    activity_attempt_id: `${SMOKE_PREFIX}_review_only`,
    review_only: true
  });
  await expectGuardRejects({
    packet: reviewOnlyPacket,
    agentCall,
    expectedRule: "review_only_rejected_for_production",
    label: "review-only packet production diagnosis"
  });

  const deterministicPacket = makePacketForSmoke(noLivePackets[0]!, "deterministic_flag");
  deterministicPacket.safety_check.deterministic_final_diagnostic_decision_used =
    true as unknown as false;
  await expectGuardRejects({
    packet: deterministicPacket,
    agentCall,
    expectedRule: "deterministic_final_diagnostic_decision_used",
    label: "deterministic final diagnostic flag"
  });

  const unsafeFeedbackPacket = makePacketForSmoke(noLivePackets[0]!, "unsafe_feedback");
  unsafeFeedbackPacket.student_safe_feedback.message = "The correct answer is A.";
  await expectGuardRejects({
    packet: unsafeFeedbackPacket,
    agentCall,
    expectedRule: "correct_option_value_leak_detected",
    label: "unsafe student-safe feedback"
  });

  let disallowedStatusBlocked = false;
  try {
    assertAllowedBeforePersistence({
      packet: makePacketForSmoke(packetByStatus(noLivePackets, "misconception_persisted"), "disallowed_status"),
      allowedStatuses: ["misconception_weakened", "misconception_unsupported", "no_actionable_misconception_evidence"],
      label: "disallowed strong distractor outcome"
    });
  } catch (error) {
    disallowedStatusBlocked = error instanceof Error &&
      /disallowed live evaluator status/.test(error.message);
  }
  assert(disallowedStatusBlocked, "Live evaluator output with disallowed status should fail before persistence.");

  const failedAgentCall = await createSyntheticAgentCall("failed_call", {
    call_status: "failed",
    output_validated: false
  });
  await expectGuardRejects({
    packet: makePacketForSmoke(packetByStatus(noLivePackets, "misconception_weakened"), "failed_call"),
    agentCall: failedAgentCall,
    expectedRule: "evaluator_agent_call_failed",
    label: "failed evaluator call"
  });

  const reviewModeRecord = await persistActivityMisconceptionEvidenceUpdate({
    packet: {
      ...noLivePackets[1]!,
      activity_attempt_id: `${SMOKE_PREFIX}_review_mode_fixture`
    },
    mode: "review_artifact",
    pre_activity_diagnostic_state: "review_only_pre_state"
  });
  assert(
    reviewModeRecord.record.production_mode === "review_artifact",
    "No-live fixture may be persisted only in explicit review-artifact mode."
  );
  assert(
    reviewModeRecord.record.evaluation_source === "no_live_fixture",
    "Review-artifact persistence should preserve no_live_fixture source."
  );

  for (const status of ["student_chose_move_on", "student_requested_alternative_activity"] as const) {
    const payload = buildPostActivityDiagnosticSnapshotPayload({
      packet: makePacketForSmoke(packetByStatus(noLivePackets, status), status),
      pre_activity_diagnostic_state: "pre_activity_hypothesis"
    });
    assert(
      payload.post_activity_diagnostic_state === status,
      `${status} should not be converted into diagnostic improvement.`
    );
    assert(
      payload.interpretation_boundaries.includes("student_choice_does_not_force_diagnostic_improvement"),
      `${status} should include student-choice interpretation boundary.`
    );
  }

  const noActionablePayload = buildPostActivityDiagnosticSnapshotPayload({
    packet: makePacketForSmoke(packetByStatus(noLivePackets, "no_actionable_misconception_evidence"), "no_actionable")
  });
  assert(
    noActionablePayload.interpretation_boundaries.includes("current_hypothesis_only_not_global_absence_of_misconceptions"),
    "No-actionable status should be framed as current-hypothesis evidence, not global absence."
  );

  const processContextPayload = buildPostActivityDiagnosticSnapshotPayload({
    packet: makePacketForSmoke(
      noLivePackets.find((packet) =>
        packet.misconception_evidence_update.limitations.includes("process_context_is_evidence_quality_context_only")
      )!,
      "process_context"
    )
  });
  assert(
    processContextPayload.interpretation_boundaries.includes("process_context_is_evidence_quality_context_not_misconception_signal"),
    "Process context should be preserved as evidence-quality context only."
  );

  const reviewSummary = await writePostActivityMisconceptionUpdateReview({
    session_public_id: validPacket.session_public_id
  });
  assert(reviewSummary.records_reviewed >= 1, "Review command should find persisted evidence for the valid smoke session.");
  assert(reviewSummary.evidence_record_source === "live_llm", "Review summary should expose live_llm record source.");
  assert(reviewSummary.post_activity_snapshot_generated, "Review summary should report generated post-activity snapshot.");
  assert(reviewSummary.student_safe_feedback_present, "Review summary should report student-safe feedback availability.");
  const reviewArtifact = JSON.parse(await readFile(reviewSummary.artifact_path, "utf8")) as unknown;
  const serializedArtifact = JSON.stringify(reviewArtifact);
  assert(
    !/answer key|correct option|correct answer|raw provider output|raw prompt|api key|authorization header|bearer token|session secret|database url|mis_[a-z0-9_]+/i.test(serializedArtifact),
    "Review artifact must remain redacted while allowing safety-flag labels."
  );

  assert(await prisma.studentProfile.count() === profileCountBefore, "Persistence should not create or overwrite student profiles.");
  assert(await prisma.formativeDecision.count() === decisionCountBefore, "Persistence should not create formative decisions.");
  assert(await prisma.followupRound.count() === followupCountBefore, "Persistence should not create follow-up rounds.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call_made: true,
    production_record_public_id: persisted.record.evidence_public_id,
    snapshot_public_id: persisted.snapshot?.snapshot_public_id,
    review_artifact_path: reviewSummary.artifact_path,
    guard_version: persisted.guard.guard_version,
    schema_version: persisted.record.schema_version
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
