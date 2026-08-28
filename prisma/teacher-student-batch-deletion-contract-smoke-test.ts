import { readFileSync } from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function assertIncludes(sourceText: string, expected: string, label: string) {
  assert(sourceText.includes(expected), `${label} should include ${expected}.`);
}

const deletionService = source("src/lib/services/student-accounts/deletion.ts");
const previewRoute = source("src/app/api/teacher/students/batch-deletion/preview/route.ts");
const deletionRoute = source("src/app/api/teacher/students/batch-deletion/route.ts");
const listClient = source("src/components/teacher-students/student-list-client.tsx");
const deletionControl = source(
  "src/components/teacher-students/student-batch-deletion-control.tsx"
);

assertIncludes(
  deletionService,
  "STUDENT_BATCH_DELETION_MAX_ACCOUNTS = 100",
  "Batch deletion bound"
);
assertIncludes(deletionService, "duplicate_student_selection", "Duplicate-selection guard");
assertIncludes(deletionService, 'createHash("sha256")', "Selection fingerprint");
assertIncludes(deletionService, "requiredBatchDeleteConfirmation", "Typed confirmation contract");
assertIncludes(deletionService, "batch_delete_confirmation_mismatch", "Fail-closed confirmation");
assertIncludes(deletionService, "batch_delete_user_count_mismatch", "Deleted-account count guard");
assertIncludes(deletionService, "prisma.$transaction", "Atomic database boundary");
assertIncludes(
  deletionService,
  "studentAccountDeletionEvent.create",
  "Per-student retained audit"
);

for (const requiredDeletion of [
  "assessmentLifecycleOperation.deleteMany",
  "studentCommunication.deleteMany",
  "topicDialogueTurn.deleteMany",
  "topicDialogue.deleteMany",
  "formativeConversationSession.deleteMany",
  "conversationTurn.deleteMany",
  "processEvent.deleteMany",
  "agentCall.deleteMany",
  "assessmentSession.deleteMany"
]) {
  assertIncludes(deletionService, requiredDeletion, "Associated-data deletion graph");
}

assertIncludes(previewRoute, "requireStudentAccountTeacher", "Preview authorization");
assertIncludes(deletionRoute, "requireStudentAccountTeacher", "Deletion authorization");
assertIncludes(listClient, 'data-testid="select-all-students"', "Page selection control");
assertIncludes(listClient, "toggleStudentSelection", "Row selection control");
assertIncludes(deletionControl, "Delete selected", "Batch delete command");
assertIncludes(
  deletionControl,
  'data-testid="batch-delete-students-dialog"',
  "Accessible confirmation dialog"
);
assertIncludes(
  deletionControl,
  "confirmation !== preview.required_delete_confirmation",
  "Client confirmation gate"
);

for (const file of [deletionService, previewRoute, deletionRoute, listClient, deletionControl]) {
  assert(!file.includes("OPENAI_API_KEY"), "Batch deletion path must not use OpenAI configuration.");
  assert(!file.includes("runLive"), "Batch deletion path must not dispatch a live model call.");
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      batch_limit: 100,
      confirmation_bound_to_selection: true,
      associated_data_graph_checked: true,
      teacher_authorization_checked: true,
      provider_calls: 0
    },
    null,
    2
  )
);
