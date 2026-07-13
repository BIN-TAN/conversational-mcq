import { readFileSync } from "node:fs";
import path from "node:path";
import { teacherPrimaryNavItems } from "../src/components/teacher-primary-nav-items";

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
  const pages = [
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

  for (const filePath of pages) {
    const file = source(filePath);
    assertIncludes(file, "TeacherPrimaryNav", filePath);
    assertExcludes(file, 'href: "/teacher/content/import-json"', filePath);
    assertExcludes(file, 'href="/teacher/evals"', filePath);
    for (const label of forbiddenPrimaryLabels) {
      assertExcludes(file, label, filePath);
    }
  }

  const dashboard = source("src/app/teacher/dashboard/page.tsx");
  assertIncludes(dashboard, "TeacherLogoutButton", "Teacher dashboard");
  assertIncludes(dashboard, '<TeacherPrimaryNav variant="dark" />', "Teacher dashboard");
}

function assertStudentAccountActionsRemainInPageContent() {
  const studentList = source("src/components/teacher-students/student-list-client.tsx");

  assertIncludes(studentList, 'href="/teacher/students/import"', "Student accounts page actions");
  assertIncludes(studentList, "Import roster", "Student accounts page actions");
  assertIncludes(studentList, 'href="/teacher/students/new"', "Student accounts page actions");
  assertIncludes(studentList, "Create student", "Student accounts page actions");
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

function main() {
  assertPrimaryNavContract();
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
