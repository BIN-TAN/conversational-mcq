import { readFileSync } from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function assertIncludes(sourceText: string, expected: string, label: string) {
  assert(sourceText.includes(expected), `${label} should include ${expected}.`);
}

const sessionService = source("src/lib/services/teacher-review/session-deletion.ts");
const sessionList = source("src/components/teacher-review/session-list-client.tsx");
const sessionControl = source(
  "src/components/teacher-review/session-batch-deletion-control.tsx"
);
const assessmentService = source("src/lib/services/content/assessment-deletion.ts");
const assessmentList = source("src/components/teacher-content/assessment-list-client.tsx");
const assessmentControl = source(
  "src/components/teacher-content/archived-assessment-batch-deletion-control.tsx"
);
const createClient = source("src/components/teacher-content/assessment-form-client.tsx");
const contentHome = source("src/app/teacher/content/page.tsx");

assertIncludes(sessionService, '"completed",', "Completed-session boundary");
assertIncludes(sessionService, '"student_exited"', "Exited-session boundary");
assertIncludes(sessionService, "session_batch_delete_blocked", "Active-session guard");
assertIncludes(sessionService, "selectionFingerprint", "Session selection fingerprint");
assertIncludes(sessionService, "prisma.$transaction", "Atomic session deletion");
assertIncludes(sessionService, "teacher_delete_student_session", "Session deletion audit");
assertIncludes(sessionList, "Select all deletable sessions on this page", "Session selection UI");
assertIncludes(sessionControl, "Delete selected student sessions?", "Session confirmation UI");

assertIncludes(
  assessmentService,
  'graph.assessment.status !== "archived"',
  "Archived-only boundary"
);
assertIncludes(
  assessmentService,
  'deletion_mode: z.enum(["unused_assessment", "assessment_and_all_data"])',
  "Archived batch deletion mode contract"
);
assertIncludes(
  assessmentService,
  "archivedAssessmentSelectionFingerprint",
  "Archived selection fingerprint"
);
assertIncludes(
  assessmentService,
  "deleteArchivedAssessmentsAndAuthoringData",
  "Archived batch deletion service"
);
assertIncludes(
  assessmentService,
  "confirm_delete_all_assessment_data",
  "Archived batch second confirmation"
);
assertIncludes(
  assessmentService,
  "formativeConversationSession.deleteMany",
  "Current formative-conversation cleanup"
);
assertIncludes(
  assessmentService,
  "assessmentLifecycleOperation.deleteMany",
  "Assessment lifecycle cleanup"
);
assertIncludes(
  assessmentControl,
  "Delete selected archived mini tests?",
  "Archived deletion confirmation UI"
);
assertIncludes(
  assessmentControl,
  "Associated student and learning records will also be deleted.",
  "Archived all-data deletion warning"
);
assertIncludes(
  assessmentControl,
  "batch-delete-archived-mini-tests-all-data-confirmation",
  "Archived all-data second confirmation UI"
);
assertIncludes(
  assessmentList,
  'statusFilter === "archived"',
  "Archived filter selection boundary"
);
assert(!assessmentList.includes("Design and generate"), "Assessment library must not expose item design entry.");
assertIncludes(contentHome, "New mini test", "Teacher authoring entry");
assertIncludes(contentHome, 'href="/teacher/content/assessments/new"', "Teacher authoring route");
assertIncludes(createClient, "/item-design", "New mini-test design redirect");
assertIncludes(createClient, "Create and open assistant", "New mini-test design continuation");

for (const file of [
  sessionService,
  sessionList,
  sessionControl,
  assessmentService,
  assessmentList,
  assessmentControl,
  createClient,
  contentHome
]) {
  assert(!file.includes("OPENAI_API_KEY"), "Cleanup and design navigation must not use OpenAI configuration.");
  assert(!file.includes("runLive"), "Cleanup and design navigation must not call a live provider.");
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      session_batch_delete_guarded: true,
      archived_assessment_delete_guarded: true,
      item_design_discoverable: true,
      provider_calls: 0
    },
    null,
    2
  )
);
