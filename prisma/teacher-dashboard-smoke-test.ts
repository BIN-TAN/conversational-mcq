import { readFileSync } from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function readProjectFile(filePath: string) {
  return readFileSync(path.join(process.cwd(), filePath), "utf8");
}

function assertIncludes(source: string, expected: string, label: string) {
  assert(source.includes(expected), `${label} should include ${expected}.`);
}

function assertExcludes(source: string, forbidden: string, label: string) {
  assert(!source.includes(forbidden), `${label} should not include ${forbidden}.`);
}

function assertDashboardSurface() {
  const dashboard = readProjectFile("src/app/teacher/dashboard/page.tsx");

  for (const expected of [
    "Student accounts",
    "Student sessions",
    "Assessments / Mini tests",
    "Data Explorer / exports",
    "LLM status",
    "TeacherLogoutButton",
    'href="/teacher/students"',
    'href="/teacher/sessions"',
    'href="/teacher/content/assessments"',
    'href="/teacher/data/explorer"',
    'href="/teacher/system/llm"'
  ]) {
    assertIncludes(dashboard, expected, "Teacher dashboard");
  }

  for (const forbidden of [
    "JSON import",
    "Model evaluation",
    'href="/teacher/content/import-json"',
    'href="/teacher/evals"',
    "Microscope",
    "FileJson"
  ]) {
    assertExcludes(dashboard, forbidden, "Teacher dashboard");
  }

  assertIncludes(dashboard, "md:grid-cols-3", "Teacher dashboard card grid");
}

function assertStandardTeacherNav() {
  const standardNavFiles = [
    "src/app/teacher/dashboard/page.tsx",
    "src/app/teacher/content/layout.tsx",
    "src/components/teacher-data/ui.tsx",
    "src/components/teacher-review/ui.tsx"
  ];

  for (const filePath of standardNavFiles) {
    const source = readProjectFile(filePath);
    assertExcludes(source, "JSON import", filePath);
    assertExcludes(source, 'href: "/teacher/content/import-json"', filePath);
  }
}

function assertAdvancedRoutesPreservedAndProtected() {
  const contentHome = readProjectFile("src/app/teacher/content/page.tsx");
  assertIncludes(contentHome, 'href="/teacher/content/import-json"', "Content management page");
  assertIncludes(contentHome, "JSON import", "Content management page");

  const importPage = readProjectFile("src/app/teacher/content/import-json/page.tsx");
  assertIncludes(importPage, "ImportJsonClient", "JSON import page");

  const contentLayout = readProjectFile("src/app/teacher/content/layout.tsx");
  assertIncludes(contentLayout, "getCurrentUser", "Content layout");
  assertIncludes(contentLayout, 'user.role !== "teacher_researcher"', "Content layout");
  assertIncludes(contentLayout, 'redirect("/student/assessment")', "Content layout");

  const importApi = readProjectFile("src/app/api/teacher/content/import-json/route.ts");
  assertIncludes(importApi, "requireTeacherResearcher", "JSON import API");

  const evalPage = readProjectFile("src/app/teacher/evals/page.tsx");
  assertIncludes(evalPage, "getCurrentUser", "Model evaluation page");
  assertIncludes(evalPage, 'user.role !== "teacher_researcher"', "Model evaluation page");
  assertIncludes(evalPage, 'redirect("/student/assessment")', "Model evaluation page");

  const evalSummaryApi = readProjectFile("src/app/api/teacher/evals/summary/route.ts");
  assertIncludes(evalSummaryApi, "requireEvalTeacher", "Model evaluation API");
}

function main() {
  assertDashboardSurface();
  assertStandardTeacherNav();
  assertAdvancedRoutesPreservedAndProtected();

  console.log(
    JSON.stringify(
      {
        status: "passed",
        dashboard_json_import_card_absent: true,
        dashboard_model_evaluation_card_absent: true,
        standard_nav_json_import_absent: true,
        routine_cards_preserved: true,
        logout_preserved: true,
        json_import_direct_route_preserved: true,
        model_evaluation_direct_route_preserved: true,
        advanced_route_authorization_checked: true,
        openai_calls: 0
      },
      null,
      2
    )
  );
}

main();
