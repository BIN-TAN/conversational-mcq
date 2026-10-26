import { readFileSync } from "node:fs";
import path from "node:path";
import { teacherPrimaryNavItems } from "../src/components/teacher-primary-nav-items";
import { teacherHomeSections } from "../src/components/teacher-home-sections";
import { orderLikeAssessmentLibrary } from "../src/lib/assessment-library-order";

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

function assertExcludes(sourceText: string, forbidden: string, label: string) {
  assert(!sourceText.includes(forbidden), `${label} should not include ${forbidden}.`);
}

function assertPrimaryNavContract() {
  const expected = [
    { label: "Home", href: "/teacher" },
    { label: "Dashboard", href: "/teacher/dashboard" },
    { label: "Assessment management", href: "/teacher/content" },
    { label: "Student accounts", href: "/teacher/students" },
    { label: "Student sessions", href: "/teacher/sessions" },
    { label: "Data and outcomes", href: "/teacher/data" },
    { label: "LLM status", href: "/teacher/system/llm" }
  ];

  assert(
    teacherPrimaryNavItems.length === expected.length,
    `Teacher primary navigation should have exactly ${expected.length} entries.`
  );

  for (const [index, expectedItem] of expected.entries()) {
    const actual = teacherPrimaryNavItems[index];
    assert(actual.label === expectedItem.label, `Nav entry ${index + 1} label drifted.`);
    assert(actual.href === expectedItem.href, `Nav entry ${index + 1} href drifted.`);
  }

  const forbiddenLabels = [
    "Roster import",
    "Create student",
    "Mini tests",
    "JSON import",
    "Import JSON",
    "New mini test",
    "Assessment library",
    "Reorganize assessments",
    "Model evaluation"
  ];

  for (const forbidden of forbiddenLabels) {
    assert(
      teacherPrimaryNavItems.every((item) => item.label !== forbidden),
      `Teacher primary navigation should not include ${forbidden}.`
    );
  }
}

function assertPrimaryNavComponent() {
  const nav = source("src/components/teacher-primary-nav.tsx");

  assertIncludes(nav, "usePathname", "Teacher primary nav component");
  assertIncludes(nav, 'aria-label="Teacher primary navigation"', "Teacher primary nav component");
  assertIncludes(nav, 'aria-current={active ? "page" : undefined}', "Teacher primary nav component");
  assertIncludes(nav, "focus-visible:outline", "Teacher primary nav component");
  assertIncludes(nav, "flex flex-wrap", "Teacher primary nav component");
  assertIncludes(nav, "variant === \"dark\"", "Teacher primary nav component");
}

function assertNormalTeacherPagesUseSharedNav() {
  const layout = source("src/app/teacher/layout.tsx");
  const header = source("src/components/teacher-workspace-header.tsx");
  const formerNavSurfaces = [
    "src/app/teacher/dashboard/page.tsx",
    "src/app/teacher/content/layout.tsx",
    "src/components/teacher-students/ui.tsx",
    "src/components/teacher-review/ui.tsx",
    "src/components/teacher-data/ui.tsx"
  ];
  const forbiddenPrimaryLabels = [
    "Roster import",
    "Mini tests",
    "Import JSON",
    "Reorganize assessments",
    "Model evaluation"
  ];

  assertIncludes(layout, "TeacherWorkspaceHeader", "Teacher workspace layout");
  assertIncludes(layout, "getCurrentUser", "Teacher workspace layout");
  assertIncludes(layout, 'user.role !== "teacher_researcher"', "Teacher workspace layout");

  for (const expected of [
    "TeacherPrimaryNav",
    "TeacherAccountUtilityLink",
    "TeacherLogoutButton",
    "UAlbertaLogo",
    "EDPY 507: Measurement Theory",
    "Assessment dashboard",
    "Assessment management",
    "Student accounts",
    "Student sessions",
    "Data and outcomes",
    "LLM status"
  ]) {
    assertIncludes(header, expected, "Teacher workspace header");
  }
  assertIncludes(header, '<TeacherPrimaryNav variant="dark" />', "Teacher workspace header");
  assertIncludes(
    header,
    '<TeacherAccountUtilityLink variant="dark" />',
    "Teacher workspace header"
  );

  for (const filePath of formerNavSurfaces) {
    const file = source(filePath);
    assertExcludes(file, "TeacherPrimaryNav", filePath);
    assertExcludes(file, "TeacherAccountUtilityLink", filePath);
    assertExcludes(file, 'href: "/teacher/content/import-json"', filePath);
    assertExcludes(file, 'href="/teacher/evals"', filePath);
    for (const label of forbiddenPrimaryLabels) {
      assertExcludes(file, label, filePath);
    }
  }

  const utility = source("src/components/teacher-account-utility-link.tsx");
  assertIncludes(utility, 'href="/teacher/account"', "Teacher account utility link");
  assertIncludes(utility, "Account settings", "Teacher account utility link");

  const loginForm = source("src/components/login-form.tsx");
  assertIncludes(loginForm, "Sign in", "Login form");
  assertExcludes(loginForm, "Forgot your teacher password?", "Login form");
  assertExcludes(loginForm, "/auth/forgot-password", "Login form");

  const accountSettings = source("src/components/teacher-account/account-settings-client.tsx");
  assertIncludes(accountSettings, "Change password", "Teacher account settings");
  assertExcludes(accountSettings, "Recovery email", "Teacher account settings");
  assertExcludes(accountSettings, "Change recovery email", "Teacher account settings");
  assertExcludes(accountSettings, "email-change", "Teacher account settings");
}

function assertStudentAccountActionsRemainInPageContent() {
  const studentList = source("src/components/teacher-students/student-list-client.tsx");
  const batchDeletion = source(
    "src/components/teacher-students/student-batch-deletion-control.tsx"
  );
  const batchPreviewRoute = source(
    "src/app/api/teacher/students/batch-deletion/preview/route.ts"
  );
  const batchDeletionRoute = source(
    "src/app/api/teacher/students/batch-deletion/route.ts"
  );

  assertIncludes(studentList, 'href="/teacher/students/import"', "Student accounts page actions");
  assertIncludes(studentList, "Import roster", "Student accounts page actions");
  assertIncludes(studentList, 'href="/teacher/students/new"', "Student accounts page actions");
  assertIncludes(studentList, "Create student", "Student accounts page actions");
  assertIncludes(studentList, 'data-testid="select-all-students"', "Student batch selection");
  assertIncludes(studentList, "toggleStudentSelection", "Student batch selection");
  assertIncludes(studentList, "StudentBatchDeletionControl", "Student batch deletion action");
  assertIncludes(batchDeletion, "Delete selected", "Student batch deletion action");
  assertIncludes(
    batchDeletion,
    'testId="batch-delete-students-dialog"',
    "Student batch deletion confirmation"
  );
  assertIncludes(
    batchDeletion,
    "required_delete_confirmation",
    "Student batch deletion confirmation"
  );
  assertIncludes(
    batchPreviewRoute,
    "requireStudentAccountTeacher",
    "Student batch deletion preview API"
  );
  assertIncludes(
    batchDeletionRoute,
    "requireStudentAccountTeacher",
    "Student batch deletion API"
  );
}

function assertAdvancedRoutesRemainProtected() {
  const importPage = source("src/app/teacher/content/import-json/page.tsx");
  const importApi = source("src/app/api/teacher/content/import-json/route.ts");
  const evalPage = source("src/app/teacher/evals/page.tsx");
  const evalApi = source("src/app/api/teacher/evals/summary/route.ts");

  assertIncludes(importPage, "ImportJsonClient", "JSON import page");
  assertIncludes(importApi, "requireTeacherResearcher", "JSON import API");
  assertIncludes(evalPage, "getCurrentUser", "Model evaluation page");
  assertIncludes(evalPage, 'user.role !== "teacher_researcher"', "Model evaluation page");
  assertIncludes(evalPage, 'redirect("/student/assessment")', "Model evaluation page");
  assertIncludes(evalApi, "requireEvalTeacher", "Model evaluation API");
}

/** The instructor home page comes first after sign-in, with one card for every other section. */
function assertInstructorHome() {
  const page = source("src/app/teacher/page.tsx");
  assertIncludes(page, "teacherHomeSections", "Instructor home page");
  assert(
    teacherHomeSections.length === teacherPrimaryNavItems.length - 1 &&
      !teacherHomeSections.some((section) => String(section.href) === "/teacher"),
    "The home page shows a card for every other section of the navigation."
  );
  assertIncludes(source("src/components/login-form.tsx"), '? "/teacher"\n', "Instructor sign-in goes to the home page");
  assertIncludes(source("src/app/instructor-login/page.tsx"), 'redirect("/teacher");', "Signed-in instructors go to the home page");
  assertIncludes(source("src/components/teacher-workspace-header.tsx"), '"Instructor home"', "Home page title");
}

/** The dashboard lists mini tests in the assessment library's order, grouped by category. */
function assertDashboardUsesLibraryOrder() {
  const row = (title: string, folder: string | null, folderIndex: number, index: number) =>
    ({ title, folder_label: folder, folder_order_index: folderIndex, assessment_order_index: index });
  const ordered = orderLikeAssessmentLibrary([
    row("Test 10", "Lecture 5", 1, 0),
    row("Loose", null, 0, 0),
    row("Test 9", "Lecture 4", 0, 1),
    row("Test 8", "Lecture 4", 0, 0),
    row("Test 11", "Lecture 5", 1, 1)
  ]).map((entry) => entry.title);
  assert(JSON.stringify(ordered) === JSON.stringify(["Test 8", "Test 9", "Test 10", "Test 11", "Loose"]),
    `Library order: categories by their order, mini tests by theirs, uncategorized last (got ${ordered.join(", ")}).`);
  const service = source("src/lib/services/teacher-dashboard/assessment-dashboard.ts");
  assertIncludes(service, "orderLikeAssessmentLibrary(assessments)", "Dashboard mini-test options");
  assertExcludes(service, '{ status: "desc" },\n      { folder_order_index: "asc" }', "Dashboard mini-test options");
  assertIncludes(source("src/components/teacher-dashboard/assessment-dashboard-client.tsx"), "<optgroup", "Dashboard selector groups by category");
  assertIncludes(source("src/lib/services/teacher-review/sessions.ts"), "orderLikeAssessmentLibrary(await prisma.assessment.findMany", "Student sessions mini-test filter");
  assertIncludes(source("src/lib/services/teacher-simple-csv-export/service.ts"), "orderLikeAssessmentLibrary(await prisma.assessment.findMany", "Data explorer mini-test list");
}

function main() {
  assertPrimaryNavContract();
  assertInstructorHome();
  assertDashboardUsesLibraryOrder();
  assertPrimaryNavComponent();
  assertNormalTeacherPagesUseSharedNav();
  assertStudentAccountActionsRemainInPageContent();
  assertAdvancedRoutesRemainProtected();

  console.log(
    JSON.stringify(
      {
        status: "passed",
        nav_entries: teacherPrimaryNavItems.length,
        page_actions_preserved: true,
        shared_component_checked: true,
        advanced_routes_preserved: true,
        openai_calls: 0
      },
      null,
      2
    )
  );
}

main();
