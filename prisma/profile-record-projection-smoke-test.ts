import assert from "node:assert/strict";
import { PrismaClient, type Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createCanonicalMisconceptionClaimCatalog } from "../src/lib/domain/misconception-claim-identity";
import { profileRecordProvenance, profileEvidenceCounts, profileItemEvidence, profileReassessmentStatus } from "../src/lib/services/student-assessment/profile-record";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import { buildTeacherResearchBulkExport } from "../src/lib/services/teacher-research-export/service";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import { ensureTeacherReviewDemoFixture, cleanupTeacherReviewDemoFixture } from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();
const catalog = createCanonicalMisconceptionClaimCatalog({
  identity_scope: "synthetic-profile-audit",
  indicators: [{
    indicator: "Synthetic misconception", evidence_reference: "synthetic-evidence", confidence: "medium",
    rationale: "Synthetic fixture only", atomic_claims: [
      { claim_text: "First synthetic claim", source_evidence_references: ["synthetic-evidence"] },
      { claim_text: "Second synthetic claim", source_evidence_references: ["synthetic-evidence"] }
    ]
  }]
});
const unit = {
  id: "fixture-profile", profile_type: "initial", confidence_alignment: "well_calibrated",
  item_level_evidence: [{ item_public_id: "fixture-item", reasoning_quality: "supported", confidence_rating: "high" }],
  misconception_indicators: catalog, process_interpretation_cautions: [],
  based_on_agent_call: {
    agent_name: "student_profiling_agent", call_status: "succeeded", output_validated: true,
    agent_call_public_id: "fixture-call", schema_version: "student-profile-output-v4"
  }
};

async function main() {
  assert(["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname), "Local database only");
  assert.notEqual(process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE, "true");
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  assert.equal(profileRecordProvenance(unit).profile_validation_status, "validated");
  assert.equal(profileEvidenceCounts(unit).misconception_indicator_count, 1);
  assert.equal(profileEvidenceCounts(unit).misconception_claim_count, 2);
  assert.equal(profileEvidenceCounts({ ...unit, misconception_indicators: ["legacy"] }).misconception_indicator_count, 1);
  assert.equal(profileEvidenceCounts({ ...unit, misconception_indicators: { unsupported: [] } }).misconception_indicator_count, null);
  assert.equal(profileEvidenceCounts({ ...unit, misconception_indicators: [] }).misconception_indicator_count, 0);
  assert.equal(profileRecordProvenance({ ...unit, based_on_agent_call: null }).profile_validation_status, "unverified");
  const fallback = { ...unit, process_interpretation_cautions: ["Fallback-derived profile; do not interpret as validated student profiling output."] };
  assert.equal(profileRecordProvenance(fallback).profile_valid_for_learning_analysis, false);
  assert.equal(profileEvidenceCounts(fallback).misconception_indicator_count, null);
  assert.equal(profileItemEvidence(fallback).length, 0);
  const legacyEvidence = { evidence_integrated_profile_v2: {
    profile_schema_version: "legacy-v2", reasoning_quality: { value: "partial" },
    item_evidence: [{ item_public_id: "fixture-item", reasoning_quality: "partial", confidence: "medium" }]
  } };
  assert.equal(profileRecordProvenance({ ...unit, item_level_evidence: legacyEvidence }).profile_record_role, "intermediate");
  assert.equal(profileItemEvidence({ ...unit, item_level_evidence: legacyEvidence })[0].confidence_rating, "medium");
  assert.equal(profileReassessmentStatus({ validated_transition_count: 0, student_turn_count: 0, conversation_status: "active" }), "not_reassessed");
  for (const conversation_status of ["active", "paused", "ended"]) {
    assert.equal(profileReassessmentStatus({ validated_transition_count: 0, student_turn_count: 1, conversation_status }), "reassessment_incomplete");
    assert.equal(profileReassessmentStatus({ validated_transition_count: 1, student_turn_count: 1, conversation_status }), "validated_reassessment");
  }

  await cleanupTeacherReviewDemoFixture(prisma);
  const fixture = await ensureTeacherReviewDemoFixture(prisma);
  try {
    const base: Prisma.StudentProfileUncheckedCreateInput = {
      concept_unit_session_db_id: fixture.conceptUnitSession.id, profile_type: "initial",
      ability_profile: "mostly_correct_understanding", ability_pattern_flags: [],
      engagement_profile: "adequate_engagement", engagement_pattern_flags: [],
      integrated_diagnostic_profile: "robust_understanding_ready_for_transfer", integrated_profile_confidence: "medium",
      integrated_profile_rationale: "Synthetic rationale", evidence_sufficiency: "adequate", confidence_alignment: "well_calibrated",
      independence_interpretability: "not_applicable", misconception_indicators: catalog,
      item_level_evidence: unit.item_level_evidence.map((entry) => ({ ...entry, item_public_id: fixture.items[0].item_public_id })),
      reasoning_quality_summary: "Synthetic summary", engagement_summary: "Synthetic summary",
      process_interpretation_cautions: [], profile_confidence: "medium", rationale: "Synthetic rationale", recommended_next_evidence: []
    };
    const call = await prisma.agentCall.create({ data: {
      assessment_session_db_id: fixture.session.id, concept_unit_session_db_id: fixture.conceptUnitSession.id,
      agent_name: "student_profiling_agent", agent_version: "test", model_name: "mock", provider: "mock",
      prompt_version: "test", schema_version: "student-profile-output-v4", input_payload: {},
      call_status: "succeeded", output_validated: true
    } });
    const initial = await prisma.studentProfile.create({ data: { ...base, based_on_agent_call_db_id: call.id } });
    const laterIntermediate = await prisma.studentProfile.create({ data: {
      ...base, item_level_evidence: legacyEvidence, misconception_indicators: []
    } });
    await prisma.conceptUnitSession.update({ where: { id: fixture.conceptUnitSession.id }, data: { latest_student_profile_db_id: laterIntermediate.id } });
    const conversation = await prisma.formativeConversationSession.create({ data: {
      assessment_session_db_id: fixture.session.id, concept_unit_session_db_id: fixture.conceptUnitSession.id,
      initial_student_profile_db_id: initial.id, current_student_profile_db_id: initial.id
    } });
    const readBundle = () => buildAnalysisReadyResearchDataBundle({ teacher_user_db_id: fixture.teacher.id, scope: "selected_session", session_public_id: fixture.session.session_public_id });
    const rows = (bundle: { files: Array<{ path: string; data: string | Buffer }> }, name: string) => {
      const file = bundle.files.find((entry) => entry.path === name);
      assert(file, name);
      return parse(String(file.data), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    };
    const bundle = await readBundle();
    assert.equal(rows(bundle, "sessions.csv")[0].profile_record_id, profileRecordProvenance({ ...unit, id: initial.id }).profile_record_id, "Canonical baseline beats a later intermediate pointer");
    assert.equal(rows(bundle, "sessions.csv")[0].profile_native_confidence_alignment, "well_calibrated");
    const artifacts = rows(bundle, "agent_activity_records.csv").filter((row) => row.record_type === "profile_result");
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts.filter((row) => row.profile_valid_for_learning_analysis === "true").length, 1);
    assert.equal(artifacts.find((row) => row.profile_record_role === "intermediate")?.reasoning_quality_category, "partial");
    assert.equal(rows(bundle, "profile_item_evidence.csv").length, 2);
    assert.equal(rows(bundle, "formative_conversation_sessions.csv")[0].profile_reassessment_status, "not_reassessed");
    assert.equal(rows(bundle, "formative_conversation_sessions.csv")[0].initial_profile_record_id, rows(bundle, "sessions.csv")[0].profile_record_id);
    assert.equal(rows(bundle, "formative_conversation_sessions.csv")[0].current_profile_record_id, rows(bundle, "sessions.csv")[0].profile_record_id);
    const legacy = await buildTeacherResearchBulkExport({ session_public_id: fixture.session.session_public_id });
    const legacyFile = legacy.files.find((entry) => entry.path === "misconception_diagnosis_or_profile_packets.jsonl");
    assert(legacyFile);
    const legacyRows = String(legacyFile.data).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(legacyRows.find((row) => row.profile_record_id === artifacts.find((row) => row.profile_record_role === "baseline")?.profile_record_id)?.misconception_claim_count, 2);
    const failedCall = await prisma.agentCall.create({ data: {
      ...{ assessment_session_db_id: fixture.session.id, concept_unit_session_db_id: fixture.conceptUnitSession.id,
        agent_name: "student_profiling_agent", agent_version: "test", model_name: "mock", provider: "mock", prompt_version: "test", schema_version: "student-profile-output-v4", input_payload: {} },
      call_status: "invalid_output", output_validated: false
    } });
    const failed = await prisma.studentProfile.create({ data: { ...base,
      based_on_agent_call_db_id: failedCall.id,
      integrated_diagnostic_profile: "insufficient_evidence_for_formative_decision",
      process_interpretation_cautions: fallback.process_interpretation_cautions, item_level_evidence: [], misconception_indicators: []
    } });
    await prisma.formativeConversationSession.update({ where: { id: conversation.id }, data: { initial_student_profile_db_id: failed.id, current_student_profile_db_id: failed.id, status: "ended", lifecycle_reason: "student_ended_conversation" } });
    const failedBundle = await readBundle();
    assert.equal(rows(failedBundle, "sessions.csv")[0].latest_student_safe_status, "Profile unavailable");
    assert.equal(rows(failedBundle, "sessions.csv")[0].misconception_indicator_count, "");
    assert.equal(rows(failedBundle, "formative_conversation_sessions.csv")[0].profile_reassessment_status, "reassessment_incomplete");
    const detail = await getTeacherReviewSessionDetail(fixture.session.session_public_id);
    assert.equal(detail.formative_conversations[0].initial_learning_profile?.profile_validation_status, "fallback");
    assert.equal(detail.formative_conversations[0].profile_reassessment_status, "reassessment_incomplete");
    assert.equal(await prisma.studentProfile.count({ where: { concept_unit_session_db_id: fixture.conceptUnitSession.id } }), 3, "Read/export cannot mutate profiles");
    console.log("PASS profile projection: formats, provenance, canonical selection, fallback, receipts-free opening, ended reassessment, current and legacy exports, teacher parity, and no profile mutation");
  } finally {
    await prisma.formativeConversationSession.deleteMany({ where: { assessment_session_db_id: fixture.session.id } });
    await cleanupTeacherReviewDemoFixture(prisma);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
