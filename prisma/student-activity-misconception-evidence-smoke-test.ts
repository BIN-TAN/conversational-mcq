import { readFile } from "node:fs/promises";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
  ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
  assertActivityMisconceptionEvidencePacketIsLiveEvaluatedForProductionUpdate,
  buildNoLiveActivityMisconceptionEvidenceFixture,
  validateActivityMisconceptionEvidencePacket,
  writeRedactedActivityMisconceptionEvidenceReviewArtifact,
  type ActivityMisconceptionEvidencePacketV1,
  type MisconceptionUpdateStatus
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import {
  evaluateActivityMisconceptionEvidenceLivePipeline,
  makeActivityMisconceptionEvidenceAuditForTest,
  makeLiveActivityMisconceptionEvidencePacketForTest
} from "../src/lib/services/student-assessment/activity-misconception-evidence-live";
import { prisma } from "../src/lib/db";
import { assert } from "./student-mvp-smoke-helpers";
import { activityMisconceptionEvidenceFixtureCases } from "./student-activity-misconception-evidence-fixtures";

function clonePacket(packet: ActivityMisconceptionEvidencePacketV1): ActivityMisconceptionEvidencePacketV1 {
  return structuredClone(packet);
}

function assertInvalid(
  packet: unknown,
  expectedRuleCode: string,
  message: string
) {
  const validation = validateActivityMisconceptionEvidencePacket(packet);
  assert(!validation.valid, `${message}: packet should be invalid.`);
  assert(
    validation.issues.some((issue) => issue.rule_code === expectedRuleCode),
    `${message}: expected ${expectedRuleCode}, got ${JSON.stringify(validation.issues)}`
  );
}

function packetByStatus(
  packets: ActivityMisconceptionEvidencePacketV1[],
  status: MisconceptionUpdateStatus
) {
  const packet = packets.find((entry) => entry.misconception_evidence_update.status === status);
  assert(packet, `Expected fixture with status ${status}.`);
  return packet;
}

function makeFutureLivePacket(packet: ActivityMisconceptionEvidencePacketV1) {
  return makeLiveActivityMisconceptionEvidencePacketForTest(packet);
}

function assertProductionGuardRejectsNoLive(packet: ActivityMisconceptionEvidencePacketV1) {
  let rejected = false;
  try {
    assertActivityMisconceptionEvidencePacketIsLiveEvaluatedForProductionUpdate(packet);
  } catch (error) {
    rejected = error instanceof Error &&
      /activity_misconception_evidence_runtime_rejected_no_live_fixture/.test(error.message);
  }
  assert(rejected, "No-live fixture should be rejected by production update guard.");
}

async function main() {
  const agentCallsBefore = await prisma.agentCall.count();
  const fixtures = activityMisconceptionEvidenceFixtureCases();
  const packets = fixtures.map((fixture) => buildNoLiveActivityMisconceptionEvidenceFixture(fixture));

  assert(packets.length >= 16, "Representative no-live fixture set should include at least the required scenario family cases.");
  assert(
    packets.every((packet) => packet.schema_version === ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION),
    "Every packet should use student-activity-misconception-evidence-v1."
  );
  assert(
    packets.every((packet) => packet.evaluator_agent_name === ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME),
    "Every packet should declare formative_activity_response_evaluator_agent."
  );
  assert(
    packets.every((packet) =>
      packet.evaluation_source === "no_live_fixture" &&
      packet.review_only === true &&
      packet.runtime_servable_to_student === false
    ),
    "No-live fixture packets must be review-only and not student runtime servable."
  );

  for (const packet of packets) {
    const validation = validateActivityMisconceptionEvidencePacket(packet);
    assert(validation.valid, `${packet.activity_attempt_id} should validate: ${JSON.stringify(validation.issues)}`);
    assertProductionGuardRejectsNoLive(packet);
  }

  assert(
    packetByStatus(packets, "conceptual_entry_gap_remains").student_activity_response.response_kind === "partial",
    "Weak conceptual entry should remain a partial response."
  );
  assert(
    packetByStatus(packets, "conceptual_entry_improved").misconception_evidence_update.evidence_quality === "high",
    "Clear basic distinction should improve conceptual entry with high-quality evidence."
  );
  assert(
    packetByStatus(packets, "ready_for_distractor_probe").recommended_next_diagnostic_purpose === "distractor_misconception_probe",
    "Improved entry concept can become ready for a distractor probe."
  );
  assert(
    packetByStatus(packets, "no_actionable_misconception_evidence").evidence_elicited.student_identified_hidden_assumption === "yes",
    "Strong distractor response should identify the hidden assumption."
  );
  assert(
    packetByStatus(packets, "misconception_weakened").evidence_elicited.student_identified_hidden_assumption === "partial",
    "Partial hidden assumption should weaken rather than resolve the hypothesis."
  );
  assert(
    packetByStatus(packets, "misconception_persisted").evidence_elicited.student_explained_target_boundary === "no",
    "Repeated distractor logic should preserve a persisted misconception hypothesis."
  );
  assert(
    packetByStatus(packets, "boundary_understanding_improved").evidence_elicited.student_repaired_reasoning_link === "yes",
    "Reasoning boundary repair should record repaired reasoning link evidence."
  );
  assert(
    packetByStatus(packets, "reasoning_boundary_still_blurred").evidence_elicited.student_explained_target_boundary === "no",
    "Blurred boundary case should not pretend the target boundary was explained."
  );
  assert(
    packetByStatus(packets, "independent_evidence_supported").evidence_elicited.student_reconstructed_concept_independently === "yes" ||
      packetByStatus(packets, "independent_evidence_supported").evidence_elicited.student_generated_plausible_distractor === "yes",
    "Strong independent evidence should support either reconstruction or generated distractor evidence."
  );
  assert(
    packetByStatus(packets, "insufficient_new_evidence").misconception_evidence_update.evidence_quality === "insufficient",
    "Low-information responses should remain insufficient evidence."
  );
  assert(
    packets.some((packet) =>
      packet.activity_attempt_id.includes("activity_evidence_016") &&
      packet.misconception_evidence_update.limitations.includes("process_context_is_evidence_quality_context_only")
    ),
    "Process/engagement context should be represented as reliability context, not direct misconception evidence."
  );
  assert(
    packetByStatus(packets, "student_chose_move_on").student_activity_response.response_kind === "move_on",
    "Move-on response should preserve student_chose_move_on."
  );
  assert(
    packetByStatus(packets, "student_requested_alternative_activity").student_activity_response.response_kind === "choose_other_activity",
    "Alternative-activity request should preserve student_requested_alternative_activity."
  );

  const base = packets[0]!;
  const missingAgentName = { ...base, evaluator_agent_name: "wrong_agent" };
  assertInvalid(missingAgentName, "schema_invalid", "Schema should require the evaluator agent name.");

  const answerKeyLeak = clonePacket(base);
  answerKeyLeak.student_safe_feedback.message = "The answer key says the correct option is A.";
  assertInvalid(answerKeyLeak, "answer_key_leak_detected", "Answer-key language should be rejected.");
  assertInvalid(answerKeyLeak, "correct_option_value_leak_detected", "Correct-option language should be rejected.");
  assertInvalid(answerKeyLeak, "correctness_label_detected", "Correctness labels should be rejected.");

  const metadataLeak = clonePacket(base);
  metadataLeak.student_activity_response.student_response_text_redacted_or_safe_summary =
    "Synthetic summary includes distractor metadata and misconception_id=mis_123.";
  assertInvalid(metadataLeak, "raw_distractor_metadata_exposed", "Raw distractor metadata should be rejected.");
  assertInvalid(metadataLeak, "raw_misconception_id_exposed", "Raw misconception IDs should be rejected.");

  const engagementLeak = clonePacket(base);
  engagementLeak.student_safe_feedback.message = "Your engagement category and AI assistance signal changed.";
  assertInvalid(engagementLeak, "engagement_or_ai_label_exposed", "Engagement or AI labels should be rejected.");

  const misconductLeak = clonePacket(base);
  misconductLeak.student_safe_feedback.message = "This looks suspicious and raises integrity concerns.";
  assertInvalid(misconductLeak, "misconduct_language_detected", "Misconduct language should be rejected.");

  const deterministicDecisionFlag = {
    ...makeFutureLivePacket(base),
    safety_check: {
      ...base.safety_check,
      deterministic_final_diagnostic_decision_used: true
    }
  };
  assertInvalid(
    deterministicDecisionFlag,
    "deterministic_final_diagnostic_decision_used",
    "Production-like packets must reject deterministic final diagnostic decisions."
  );

  const noActionableOverclaim = clonePacket(packetByStatus(packets, "no_actionable_misconception_evidence"));
  noActionableOverclaim.student_safe_feedback.message = "There are no misconceptions now.";
  assertInvalid(noActionableOverclaim, "invalid_no_actionable_claim", "No-actionable evidence must not claim no misconceptions.");

  const futureLivePacket = makeFutureLivePacket(packetByStatus(packets, "no_actionable_misconception_evidence"));
  const futureLiveValidation = validateActivityMisconceptionEvidencePacket(futureLivePacket);
  assert(futureLiveValidation.valid, `Future live packet should validate: ${JSON.stringify(futureLiveValidation.issues)}`);
  assertActivityMisconceptionEvidencePacketIsLiveEvaluatedForProductionUpdate(futureLivePacket);

  const liveAudit = makeActivityMisconceptionEvidenceAuditForTest();
  const livePipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: futureLivePacket,
    evaluator_audit: liveAudit
  });
  assert(livePipeline.status === "accepted", "Live-shaped packet with complete provider audit should be accepted.");
  assert(
    livePipeline.status === "accepted" && livePipeline.packet.evaluation_source === "live_llm",
    "Accepted live-shaped packet must use evaluation_source=live_llm."
  );

  const noLivePipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: base,
    evaluator_audit: liveAudit,
    repair_packet: futureLivePacket,
    repair_audit: makeActivityMisconceptionEvidenceAuditForTest()
  });
  assert(noLivePipeline.status === "rejected", "No-live fixture must not count as live success.");
  assert(noLivePipeline.repair_attempted === false, "No-live source mismatch must not be repaired.");

  const deterministicLivePacket = {
    ...futureLivePacket,
    safety_check: {
      ...futureLivePacket.safety_check,
      deterministic_final_diagnostic_decision_used: true
    }
  };
  const deterministicPipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: deterministicLivePacket,
    evaluator_audit: liveAudit,
    repair_packet: futureLivePacket,
    repair_audit: makeActivityMisconceptionEvidenceAuditForTest()
  });
  assert(deterministicPipeline.status === "rejected", "Deterministic final diagnostic decision must be rejected.");
  assert(deterministicPipeline.repair_attempted === false, "Deterministic final diagnostic decision must not be repaired.");

  for (const [label, audit] of [
    ["missing provider metadata", makeActivityMisconceptionEvidenceAuditForTest({
      provider_request_id: undefined,
      provider_response_id: undefined
    })],
    ["missing token usage", makeActivityMisconceptionEvidenceAuditForTest({
      input_tokens: undefined,
      output_tokens: undefined,
      total_tokens: undefined
    })],
    ["missing audit metadata", makeActivityMisconceptionEvidenceAuditForTest({
      agent_call_id: undefined,
      client_request_id: undefined
    })]
  ] as const) {
    const auditPipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
      candidate_packet: futureLivePacket,
      evaluator_audit: audit
    });
    assert(auditPipeline.status === "rejected", `${label} should reject live pipeline.`);
    assert(auditPipeline.repair_attempted === false, `${label} should not trigger repair.`);
  }

  const protectedLeakLivePacket = makeFutureLivePacket(base);
  protectedLeakLivePacket.student_safe_feedback.message = "The correct answer is A.";
  const protectedLeakPipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: protectedLeakLivePacket,
    evaluator_audit: liveAudit,
    repair_packet: futureLivePacket,
    repair_audit: makeActivityMisconceptionEvidenceAuditForTest()
  });
  assert(protectedLeakPipeline.status === "rejected", "Protected content leakage must reject live pipeline.");
  assert(protectedLeakPipeline.repair_attempted === false, "Protected content leakage must not be repaired.");

  const genericFeedbackLivePacket = makeFutureLivePacket(base);
  genericFeedbackLivePacket.student_safe_feedback.message = "Good job.";
  const repairMissingPipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: genericFeedbackLivePacket,
    evaluator_audit: liveAudit
  });
  assert(repairMissingPipeline.status === "rejected", "Repairable generic feedback should reject without repair packet.");
  assert(
    repairMissingPipeline.blocked_reason === "activity_misconception_evidence_repair_missing",
    "Repairable generic feedback should request one repair."
  );

  const repairedPipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: genericFeedbackLivePacket,
    evaluator_audit: liveAudit,
    repair_packet: futureLivePacket,
    repair_audit: makeActivityMisconceptionEvidenceAuditForTest()
  });
  assert(repairedPipeline.status === "accepted", "Valid live LLM repair should be accepted.");
  assert(repairedPipeline.repair_attempted === true, "Repair success should record repair_attempted=true.");

  const repairFailurePipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
    candidate_packet: genericFeedbackLivePacket,
    evaluator_audit: liveAudit,
    repair_packet: genericFeedbackLivePacket,
    repair_audit: makeActivityMisconceptionEvidenceAuditForTest()
  });
  assert(repairFailurePipeline.status === "rejected", "Invalid repair should fail closed.");
  assert(repairFailurePipeline.repair_attempted === true, "Invalid repair should record repair attempt.");

  const processOnlyPersisted = makeFutureLivePacket(packetByStatus(packets, "insufficient_new_evidence"));
  processOnlyPersisted.misconception_evidence_update.status = "misconception_persisted";
  processOnlyPersisted.misconception_evidence_update.limitations = [
    "process_context_is_evidence_quality_context_only",
    "no_direct_misconception_update_from_process_data"
  ];
  assertInvalid(
    processOnlyPersisted,
    "process_context_only_misconception_claim",
    "Process context alone should not create persisted misconception evidence."
  );

  const understandNowNoActionable = makeFutureLivePacket(packetByStatus(packets, "insufficient_new_evidence"));
  understandNowNoActionable.student_activity_response.student_response_text_redacted_or_safe_summary =
    "Student only says I understand now.";
  understandNowNoActionable.misconception_evidence_update.status = "no_actionable_misconception_evidence";
  assertInvalid(
    understandNowNoActionable,
    "invalid_no_actionable_claim",
    "Low-information understand-now response should not become no-actionable evidence."
  );

  const artifactPath = await writeRedactedActivityMisconceptionEvidenceReviewArtifact({
    packets: packets.slice(0, 6)
  });
  assert(
    artifactPath.includes(".data/activity-misconception-evidence-review"),
    "Review artifact should be written under ignored activity evidence review path."
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    evaluator_schema_version?: string;
    no_live_provider_call_made?: boolean;
    packets?: Array<{
      validation?: { passed?: boolean };
      student_response_safe_summary?: string;
      student_safe_feedback?: { message?: string };
      limitations?: string[];
    }>;
  };
  assert(artifact.no_live_provider_call_made === true, "Artifact should state no live provider call was made.");
  assert(artifact.packets?.length === 6, "Artifact should include six review packets.");
  assert(
    artifact.packets.every((packet) => packet.validation?.passed === true),
    "All artifact packets should validate."
  );
  assert(
    JSON.stringify(artifact).includes(ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION),
    "Artifact should expose future evaluator schema version."
  );
  assert(
    artifact.packets.every((packet) =>
      !/answer key|correct option|correct answer|distractor metadata|misconception_id|api key|authorization header/i.test([
        packet.student_response_safe_summary,
        packet.student_safe_feedback?.message,
        ...(packet.limitations ?? [])
      ].join("\n"))
    ),
    "Artifact safe response and feedback fields should not expose protected labels or secrets."
  );

  const agentCallsAfter = await prisma.agentCall.count();
  assert(agentCallsAfter === agentCallsBefore, "No-live smoke should not create agent_calls.");
  console.log(JSON.stringify({
    status: "passed",
    no_live_provider_call_made: true,
    fixture_count: packets.length,
    schema_version: ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
    evaluator_agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    evaluator_schema_version: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
    statuses_covered: Array.from(new Set(packets.map((packet) => packet.misconception_evidence_update.status))).sort(),
    artifact_path: artifactPath
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
