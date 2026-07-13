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

function assertExcludes(sourceText: string, forbidden: string | RegExp, label: string) {
  const matched = typeof forbidden === "string" ? sourceText.includes(forbidden) : forbidden.test(sourceText);
  assert(!matched, `${label} should not include ${String(forbidden)}.`);
}

const normalTeacherUiFiles = [
  "src/app/teacher/dashboard/page.tsx",
  "src/components/teacher-dashboard/assessment-dashboard-client.tsx",
  "src/app/teacher/content/page.tsx",
  "src/components/teacher-content/assessment-list-client.tsx",
  "src/components/teacher-content/assessment-form-client.tsx",
  "src/components/teacher-content/assessment-detail-client.tsx",
  "src/components/teacher-content/item-editor-client.tsx",
  "src/components/teacher-content/concept-unit-form-client.tsx",
  "src/components/teacher-content/concept-unit-detail-client.tsx",
  "src/components/teacher-content/mcq-import-client.tsx",
  "src/components/teacher-content/import-json-client.tsx",
  "src/app/teacher/students/page.tsx",
  "src/app/teacher/students/new/page.tsx",
  "src/app/teacher/students/import/page.tsx",
  "src/app/teacher/students/[userId]/page.tsx",
  "src/app/teacher/sessions/page.tsx",
  "src/app/teacher/sessions/[sessionPublicId]/page.tsx",
  "src/app/teacher/data/page.tsx",
  "src/app/teacher/data/explorer/page.tsx",
  "src/app/teacher/data/export/page.tsx",
  "src/app/teacher/data/summative-outcomes/page.tsx",
  "src/app/teacher/system/llm/page.tsx",
  "src/app/teacher/account/page.tsx"
];

const legacyUiPhrases: Array<string | RegExp> = [
  /teacher_researcher\s+student accounts/i,
  /teacher_researcher\s+session review/i,
  /teacher_researcher\s+assessment tools/i,
  /teacher_researcher\s+data management/i,
  /teacher_researcher\s+roster import/i,
  /teacher_researcher\s+student record/i,
  "Search and manage pilot student accounts",
  "Review existing assessment sessions",
  "Create, organize, and open diagnostic MCQ mini tests",
  "Import supervised summative outcome records",
  "LLM infrastructure",
  "LLM system status",
  "Assessment-level diagnostic overview",
  "local workflow testing",
  "classroom validity",
  "provisional engineering readiness",
  "Phase 8A",
  "plaintext passwords",
  "credential hashes",
  "research records",
  "backend API",
  /\bprototype\b/i,
  /\bscaffold\b/i
];

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

  for (const forbidden of [
    "JSON import",
    "Model evaluation",
    "Assessment library",
    "New mini test",
    "Import roster",
    "Create student"
  ]) {
    assert(
      teacherPrimaryNavItems.every((item) => item.label !== forbidden),
      `Teacher primary navigation should not include ${forbidden}.`
    );
  }
}

function assertNormalTeacherCopyIsConcise() {
  for (const filePath of normalTeacherUiFiles) {
    const file = source(filePath);
    for (const forbidden of legacyUiPhrases) {
      assertExcludes(file, forbidden, filePath);
    }
  }
}

function assertRoutineActionsRemainAvailable() {
  const dashboard = source("src/app/teacher/dashboard/page.tsx");
  const contentHome = source("src/app/teacher/content/page.tsx");
  const studentList = source("src/components/teacher-students/student-list-client.tsx");
  const sessionList = source("src/components/teacher-review/session-list-client.tsx");
  const dataHome = source("src/app/teacher/data/page.tsx");
  const llmPage = source("src/app/teacher/system/llm/page.tsx");
  const assessmentDetail = source("src/components/teacher-content/assessment-detail-client.tsx");

  assertIncludes(dashboard, "Assessment dashboard", "Teacher dashboard");
  assertIncludes(dashboard, "TeacherLogoutButton", "Teacher dashboard");
  assertIncludes(contentHome, "Assessment management", "Assessment management page");
  assertIncludes(contentHome, "New mini test", "Assessment management page");
  assertIncludes(contentHome, "Assessment library", "Assessment management page");
  assertIncludes(contentHome, "JSON import", "Assessment management page");
  assertIncludes(studentList, "Create student", "Student accounts page");
  assertIncludes(studentList, "Import roster", "Student accounts page");
  assertIncludes(sessionList, "Review", "Student sessions page");
  assertIncludes(dataHome, "Summative outcomes", "Data and outcomes page");
  assertIncludes(dataHome, "Master CSV export", "Data and outcomes page");
  assertIncludes(dataHome, "Download all research data", "Data and outcomes page");
  assertIncludes(dataHome, "Data Explorer", "Data and outcomes page");
  assertIncludes(llmPage, "Provider", "LLM status page");
  assertIncludes(llmPage, "Live calls", "LLM status page");
  assertIncludes(llmPage, "API key configured", "LLM status page");
  assertIncludes(llmPage, "Agent configuration", "LLM status page");
  assertIncludes(llmPage, "This page never displays an API key", "LLM status page");
  assertIncludes(assessmentDetail, "Danger zone", "Assessment detail");
  assertIncludes(assessmentDetail, "Permanent deletion", "Assessment detail");
  assertIncludes(assessmentDetail, "cannot be undone", "Assessment detail");
}

function assertAdvancedRoutesRemainHiddenButProtected() {
  const dashboard = source("src/app/teacher/dashboard/page.tsx");
  const navFiles = [
    "src/app/teacher/dashboard/page.tsx",
    "src/app/teacher/content/layout.tsx",
    "src/components/teacher-data/ui.tsx",
    "src/components/teacher-review/ui.tsx",
    "src/components/teacher-students/ui.tsx"
  ];

  assertExcludes(dashboard, 'href="/teacher/content/import-json"', "Teacher dashboard");
  assertExcludes(dashboard, 'href="/teacher/evals"', "Teacher dashboard");
  assertExcludes(dashboard, "Model evaluation", "Teacher dashboard");

  for (const filePath of navFiles) {
    const file = source(filePath);
    assertIncludes(file, "TeacherPrimaryNav", filePath);
    assertExcludes(file, "JSON import", filePath);
    assertExcludes(file, "Model evaluation", filePath);
  }

  const importPage = source("src/app/teacher/content/import-json/page.tsx");
  const importApi = source("src/app/api/teacher/content/import-json/route.ts");
  const evalPage = source("src/app/teacher/evals/page.tsx");
  const evalApi = source("src/app/api/teacher/evals/summary/route.ts");

  assertIncludes(importPage, "ImportJsonClient", "JSON import page");
  assertIncludes(importApi, "requireTeacherResearcher", "JSON import API");
  assertIncludes(evalPage, "getCurrentUser", "Model evaluation page");
  assertIncludes(evalPage, 'user.role !== "teacher_researcher"', "Model evaluation page");
  assertIncludes(evalApi, "requireEvalTeacher", "Model evaluation API");
}

function assertDataDefinitionsRemainAvailable() {
  const dataExplorer = source("src/app/teacher/data/explorer/page.tsx");
  const masterExport = source("src/components/teacher-data/master-export-client.tsx");
  const simpleExplorer = source("src/components/teacher-data/simple-csv-explorer-client.tsx");

  assertIncludes(dataExplorer, "Data Explorer", "Data explorer page");
  assertIncludes(masterExport, "Generate master assessment CSV", "Master export component");
  assertIncludes(masterExport, "normalized database", "Master export component");
  assertIncludes(simpleExplorer, "Data dictionary", "Simple CSV explorer");
}

function main() {
  assertPrimaryNavContract();
  assertNormalTeacherCopyIsConcise();
  assertRoutineActionsRemainAvailable();
  assertAdvancedRoutesRemainHiddenButProtected();
  assertDataDefinitionsRemainAvailable();

  console.log(
    JSON.stringify(
      {
        status: "passed",
        normal_teacher_ui_files_checked: normalTeacherUiFiles.length,
        primary_nav_entries: teacherPrimaryNavItems.length,
        advanced_routes_preserved: true,
        routine_actions_preserved: true,
        openai_calls: 0
      },
      null,
      2
    )
  );
}

main();
