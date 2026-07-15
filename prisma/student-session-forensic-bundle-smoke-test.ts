import { PrismaClient } from "@prisma/client";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fileData(files: Array<{ path: string; data: string }>, filePath: string) {
  const file = files.find((candidate) => candidate.path === filePath);
  assert(file, `Missing ${filePath}.`);
  return file.data;
}

async function main() {
  process.env.APP_ENV = "production";
  process.env.RESEARCH_PSEUDONYMIZATION_KEY = "phase31ak-session-forensic-smoke-key";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";

  await cleanupTeacherReviewDemoFixture(prisma);
  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const session = await prisma.assessmentSession.findFirstOrThrow({
      where: { user: { user_id: "student_demo" } },
      orderBy: { created_at: "asc" }
    });
    const beforeAgentCalls = await prisma.agentCall.count();
    const result = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_session",
      session_public_id: session.session_public_id,
      include_incomplete_sessions: true,
      include_restricted_fields: true
    });
    const manifest = JSON.parse(fileData(result.files, "session_diagnostic_manifest.json")) as {
      bundle_type: string;
      sessions: Array<{
        session_public_id: string;
        item_response_count: number;
        response_package_count: number;
        student_profile_count: number;
        formative_decision_count: number;
        followup_round_count: number;
        conversation_turn_count: number;
        process_event_count: number;
        agent_calls: unknown[];
      }>;
      protected_values_absent: string[];
    };
    const manifestSession = manifest.sessions[0];
    assert(manifest.bundle_type === "assessment_workflow_diagnostic_bundle", "Manifest should identify diagnostic bundle type.");
    assert(manifestSession.session_public_id === session.session_public_id, "Manifest should identify selected session.");
    assert(manifestSession.item_response_count >= 3, "Forensic bundle should include item-response evidence.");
    assert(manifestSession.response_package_count >= 1, "Forensic bundle should include response package evidence.");
    assert(manifestSession.student_profile_count >= 1, "Forensic bundle should include student profile versions.");
    assert(manifestSession.formative_decision_count >= 1, "Forensic bundle should include formative decision records.");
    assert(manifestSession.followup_round_count >= 1, "Forensic bundle should include follow-up rounds.");
    assert(manifestSession.conversation_turn_count > 0, "Forensic bundle should include conversation turns.");
    assert(manifestSession.process_event_count > 0, "Forensic bundle should include process events.");
    assert(Array.isArray(manifestSession.agent_calls), "Forensic bundle should include safe agent-call metadata.");
    assert(manifest.protected_values_absent.includes("login_username"), "Manifest should document protected operational identities.");

    const serialized = JSON.stringify(result.files).toLowerCase();
    for (const forbidden of ["password_hash", "access_code_hash", "openai_api_key", "postgresql://", "student_demo"]) {
      assert(!serialized.includes(forbidden), `Forensic bundle should not contain ${forbidden}.`);
    }
    assert(
      (await prisma.agentCall.count()) === beforeAgentCalls,
      "Forensic bundle smoke should not create provider calls."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          session_public_id: session.session_public_id,
          manifest_item_response_count: manifestSession.item_response_count,
          profile_versions_present: manifestSession.student_profile_count,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
  } finally {
    await cleanupTeacherReviewDemoFixture(prisma);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
