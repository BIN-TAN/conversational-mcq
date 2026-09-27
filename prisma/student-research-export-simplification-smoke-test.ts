import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewAssessmentPublicId
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function source(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function assertIncludes(value: string, expected: string, label: string) {
  assert(value.includes(expected), `${label} should include ${expected}.`);
}

function assertNotIncludes(value: string, unexpected: string, label: string) {
  assert(!value.includes(unexpected), `${label} should not include ${unexpected}.`);
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  const researchPage = source("src/app/teacher/data/research/page.tsx");
  const dataPage = source("src/app/teacher/data/page.tsx");
  const summativeClient = source("src/components/teacher-data/summative-outcomes-client.tsx");
  const client = source("src/components/teacher-data/research-data-exports-client.tsx");
  const explorerRedirect = source("src/app/teacher/data/explorer/page.tsx");
  const exportRedirect = source("src/app/teacher/data/export/page.tsx");

  assertIncludes(client, "Research dataset", "Research export client");
  assertIncludes(client, "Data dictionary", "Research export client");
  assertIncludes(client, "Generate research dataset", "Research export client");
  assertNotIncludes(client, "Download data dictionary CSV", "Research dataset section");
  assertIncludes(client, "Download research variable dictionary CSV", "Data dictionary section");
  assertNotIncludes(client, "View current page JSON", "Research export client");
  assertNotIncludes(client, "Quick summary", "Research export client");
  assertNotIncludes(client, "Analysis-ready dataset", "Research export client");
  assertNotIncludes(client, "Full archive", "Research export client");
  assertNotIncludes(client, "Generate full archive", "Research export client");
  assertNotIncludes(client, "Generate analysis-ready ZIP", "Research export client");
  assertNotIncludes(researchPage, "Download assessment data at the right row grain", "Research export page");
  assertNotIncludes(dataPage, "Download quick summaries", "Data and outcomes page");
  assertNotIncludes(summativeClient, "Upload or paste supervised outcome CSV data", "Summative outcomes page");
  assertIncludes(explorerRedirect, "section=dataset", "Deprecated quick summary route");
  assertIncludes(exportRedirect, "section=dataset", "Deprecated analysis-ready route");

  await cleanupTeacherReviewDemoFixture(prisma);
  await ensureTeacherReviewDemoFixture(prisma);
  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const beforeAgentCalls = await prisma.agentCall.count();
    const result = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_assessment",
      assessment_public_id: teacherReviewAssessmentPublicId
    });
    const expectedFiles = [
      "response_stage_visits.csv",
      "item_behavior_summary.csv",
      "response_stage_events.csv",
      "response_revision_history.csv",
      "feedback_exposure_events.csv",
      "response_stage_data_dictionary.csv",
      "response_stage_notes.txt",
      "sessions.csv",
      "item_responses.csv",
      "process_events.csv",
      "conversation_turns.csv",
      "agent_activity_records.csv",
      "profile_item_evidence.csv",
      "profile_data_dictionary.csv",
      "formative_conversation_sessions.csv",
      "formative_conversation_turns.csv",
      "formative_conversation_events.csv",
      "formative_conversation_llm_calls.csv",
      "formative_conversation_profile_transitions.csv",
      "formative_conversation_interventions.csv",
      "formative_conversation_data_dictionary.csv",
      "assessment_content.csv",
      "assessment_summary.csv",
      "research_data_dictionary.csv",
      "process_event_codebook.csv",
      "attempt_records.csv",
      "attempt_submission_items.csv",
      "attempt_paired_changes.csv",
      "attempt_class_summaries.csv",
      "attempt_data_dictionary.csv",
      "attempt_comparison_notes.txt",
      "data_coverage.csv",
      "data_coverage_notes.txt",
      "README.txt",
      "research_manifest.json"
    ];
    assert(result.filename.includes("research_dataset.zip"), "Research dataset filename should be explicit.");
    assert(result.files.map((file) => file.path).join("|") === expectedFiles.join("|"), "Unexpected research dataset file list.");
    assert(result.no_live_provider_call_made === true, "Research dataset smoke should not call a provider.");
    assert(beforeAgentCalls === await prisma.agentCall.count(), "Research dataset smoke should not create agent calls.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          sections: ["Research dataset", "Data dictionary"],
          file_count: result.files.length,
          old_routes_redirect: true,
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
