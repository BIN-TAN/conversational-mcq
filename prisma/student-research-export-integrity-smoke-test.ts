import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  buildResearchExportIntegrityReview,
  REQUIRED_RESEARCH_EXPORT_FILES,
  runCorrectnessInflationFixtureAssertions
} from "../src/lib/services/teacher-research-export/integrity-review";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewSessionPublicId
} from "./demo-teacher-review-fixture";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function addUnansweredPromptForLatencyLimitTest() {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: teacherReviewSessionPublicId },
    select: {
      id: true,
      concept_unit_sessions: {
        take: 1,
        select: { id: true }
      }
    }
  });
  const conceptUnitSession = session.concept_unit_sessions[0];
  assert(conceptUnitSession, "Fixture missing concept-unit session.");

  await prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      phase: "followup_active",
      actor_type: "agent",
      agent_name: "formative_activity_dialogue_agent",
      message_text: "What would you try next?",
      structured_payload: { prompt_type: "activity_prompt" },
      created_at: new Date("2026-06-19T15:00:00.000Z")
    }
  });
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await ensureTeacherReviewDemoFixture(prisma);
  await addUnansweredPromptForLatencyLimitTest();

  try {
    const beforeCounts = {
      sessions: await prisma.assessmentSession.count(),
      agent_calls: await prisma.agentCall.count(),
      activity_attempts: await prisma.activityRuntimeAttempt.count(),
      evidence_records: await prisma.activityMisconceptionEvidenceRecord.count(),
      snapshots: await prisma.postActivityDiagnosticSnapshot.count()
    };

    const review = await buildResearchExportIntegrityReview({ write_artifact: true });
    assert(review.summary.status !== "failed", `Integrity review failed: ${JSON.stringify(review.findings, null, 2)}`);
    assert(review.summary.required_files_present, "Required export files should be present.");
    assert(review.summary.manifest_present, "Manifest should be present.");
    assert(review.summary.data_dictionary_present, "Data dictionary should be present.");
    assert(review.summary.row_count_consistency_passed, "Manifest row counts should match actual row counts.");
    assert(review.summary.joinability_passed, "Public-ID joins should pass.");
    assert(review.summary.latency_checks_passed, "Latency checks should pass.");
    assert(review.summary.process_feature_checks_passed, "Process feature checks should pass.");
    assert(review.summary.correctness_inflation_feature_checks_passed, "Correctness-inflation checks should pass.");
    assert(review.summary.safety_check_passed, "Safety scan should pass.");
    assert(review.no_live_provider_call_made, "Integrity review should make no OpenAI/provider call.");
    assert(review.summary.export_artifact_path, "Review artifact path should be recorded.");
    assert(review.summary.analysis_readiness_summary_path, "Analysis-readiness summary path should be recorded.");
    assert(
      review.summary.analysis_readiness === "ready" || review.summary.analysis_readiness === "ready_with_limitations",
      "Synthetic fixture export should be ready or ready with limitations."
    );
    assert(
      REQUIRED_RESEARCH_EXPORT_FILES.every((file) => Object.prototype.hasOwnProperty.call(review.row_counts_manifest, file)),
      "Manifest should contain every required file."
    );
    assert(
      review.findings.every((finding) => finding.severity !== "failure"),
      `Integrity smoke should have no failure findings: ${JSON.stringify(review.findings, null, 2)}`
    );

    const artifact = JSON.parse(await readFile(review.summary.export_artifact_path, "utf8")) as {
      findings: Array<{ code: string; severity: string }>;
      missingness_summary: {
        sessions_with_no_activity_runtime_data: string[];
        sessions_with_no_post_activity_evidence: string[];
        sessions_with_null_turn_latency_rows: string[];
      };
    };
    assert(Array.isArray(artifact.findings), "Review artifact should include findings.");
    assert(
      artifact.missingness_summary.sessions_with_null_turn_latency_rows.includes(teacherReviewSessionPublicId),
      "Null latency rows should be represented in missingness summary."
    );

    const summaryMarkdown = await readFile(review.summary.analysis_readiness_summary_path, "utf8");
    assert(
      summaryMarkdown.includes("Correctness alone is not evidence of understanding"),
      "Analysis readiness summary should include correctness-inflation caveat."
    );
    assert(
      summaryMarkdown.includes("Process features are evidence-quality context only"),
      "Analysis readiness summary should include process-data caveat."
    );

    const correctnessFixture = runCorrectnessInflationFixtureAssertions();
    assert(
      correctnessFixture.unsupported_correct_response_count >= 1,
      "Correctness-inflation fixture should include unsupported correct evidence."
    );
    assert(
      correctnessFixture.uncertainty_marker_types.length > 0,
      "Correctness-inflation fixture should detect uncertainty markers."
    );

    const afterCounts = {
      sessions: await prisma.assessmentSession.count(),
      agent_calls: await prisma.agentCall.count(),
      activity_attempts: await prisma.activityRuntimeAttempt.count(),
      evidence_records: await prisma.activityMisconceptionEvidenceRecord.count(),
      snapshots: await prisma.postActivityDiagnosticSnapshot.count()
    };
    assert(
      afterCounts.sessions === beforeCounts.sessions &&
        afterCounts.agent_calls === beforeCounts.agent_calls &&
        afterCounts.activity_attempts === beforeCounts.activity_attempts &&
        afterCounts.evidence_records === beforeCounts.evidence_records &&
        afterCounts.snapshots === beforeCounts.snapshots,
      "Integrity review should not mutate operational evidence records."
    );

    const outputDir = path.join(process.cwd(), ".data", "research-export-integrity-smoke");
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, "latest-smoke-summary.json"),
      `${JSON.stringify({
        status: review.summary.status,
        analysis_readiness: review.summary.analysis_readiness,
        findings: review.findings.map((finding) => finding.code),
        artifact_path: review.summary.export_artifact_path,
        no_live_provider_call_made: review.no_live_provider_call_made
      }, null, 2)}\n`,
      "utf8"
    );

    console.log("Student research export integrity smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    await cleanupTeacherReviewDemoFixture(prisma);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
