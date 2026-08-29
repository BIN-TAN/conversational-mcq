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

const list = source("src/components/teacher-students/student-list-client.tsx");
const control = source(
  "src/components/teacher-students/student-password-reset-control.tsx"
);
const api = source("src/components/teacher-students/api.ts");
const route = source(
  "src/app/api/teacher/students/[userId]/reset-password/route.ts"
);
const service = source("src/lib/services/student-accounts/service.ts");

assertIncludes(list, "StudentPasswordResetControl", "Student list");
assertIncludes(list, "accountStatus={student.account_status}", "Student list reset action");
assertIncludes(list, "onReset={load}", "Student list reset refresh");
assertIncludes(control, "Reset password", "Password reset control");
assertIncludes(
  control,
  'data-testid="reset-student-password-dialog"',
  "Password reset dialog"
);
assertIncludes(
  control,
  'data-testid="confirm-reset-student-password"',
  "Password reset confirmation"
);
assertIncludes(control, "generate_password: true", "Generated one-time password request");
assertIncludes(control, "active login sessions will stop working", "Session invalidation notice");
assertIncludes(control, "cannot be displayed again", "One-time credential notice");
assertIncludes(control, "temporary-student-password", "One-time credential display");
assertIncludes(control, "Copy password", "One-time credential copy action");
assertIncludes(control, "Download CSV", "One-time credential download action");
assertIncludes(control, "const shouldRefresh = credentials !== null", "Post-display list refresh");
assertIncludes(control, "void onReset?.()", "Deferred list refresh");
assert(
  !control.includes("await onReset?.()"),
  "List refresh must not hide the one-time password before the teacher records it."
);
assertIncludes(api, "/reset-password", "Password reset client API");
assertIncludes(route, "requireStudentAccountTeacher", "Password reset teacher authorization");
assertIncludes(route, "resetStudentPassword", "Password reset route service");
assertIncludes(service, "password_hash: null", "Old permanent password invalidation");
assertIncludes(service, "must_change_password: true", "Mandatory password change");
assertIncludes(service, "auth_version: { increment: 1 }", "Active session invalidation");
assertIncludes(service, 'event_type: "teacher_student_password_reset"', "Password reset audit event");

for (const forbidden of [
  "password_hash}",
  "access_code_hash}",
  "OPENAI_API_KEY",
  "LLM_LIVE_CALLS_ENABLED"
]) {
  assert(!control.includes(forbidden), `Password reset UI must not include ${forbidden}.`);
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      row_action: true,
      teacher_only_api: true,
      one_time_credential: true,
      forced_password_change: true,
      active_sessions_invalidated: true,
      audit_event: true,
      provider_calls: 0
    },
    null,
    2
  )
);
