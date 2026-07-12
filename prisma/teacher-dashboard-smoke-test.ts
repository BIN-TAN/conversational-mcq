import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  downloadTeacherAssessmentDashboardCsv,
  getTeacherAssessmentDashboard
} from "../src/lib/services/teacher-dashboard/assessment-dashboard";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

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
  const client = readProjectFile("src/components/teacher-dashboard/assessment-dashboard-client.tsx");
  const service = readProjectFile("src/lib/services/teacher-dashboard/assessment-dashboard.ts");
  const route = readProjectFile("src/app/api/teacher/dashboard/route.ts");
  const exportRoute = readProjectFile("src/app/api/teacher/dashboard/export/route.ts");

  for (const expected of [
    "Assessment dashboard",
    "AssessmentDashboardClient",
    "Student accounts",
    "Student sessions",
    "Data and outcomes",
    "LLM status",
    "TeacherLogoutButton",
    'href: "/teacher/students"',
    'href: "/teacher/sessions"',
    'href: "/teacher/data"',
    'href: "/teacher/system/llm"'
  ]) {
    assertIncludes(dashboard, expected, "Teacher dashboard");
  }

  for (const expected of [
    "Assessment-level diagnostic overview",
    "Total students",
    "Not started",
    "In progress",
    "Completed",
    "Flagged for review",
    "Average time spent",
    "Status distribution",
    "Completion progress",
    "Assessment-specific understanding",
    "Engagement signals",
    "Item-level diagnostic view",
    "Candidate misconception patterns",
    "Export and readable data",
    "diagnostic signals",
    "response patterns",
    "does not claim stable learner traits"
  ]) {
    assertIncludes(client, expected, "Teacher assessment dashboard client");
  }

  for (const expected of [
    "CANDIDATE_PATTERN_THRESHOLD = 3",
    "deterministic exact normalized reasoning-prefix grouping",
    "anonymizedReasoningSnippet",
    "downloadTeacherAssessmentDashboardCsv",
    "assessment_specific_understanding",
    "engagement_signals",
    "candidate_misconception_pattern",
    "text/csv; charset=utf-8"
  ]) {
    assertIncludes(service, expected, "Teacher assessment dashboard service");
  }

  assertIncludes(route, "getTeacherAssessmentDashboard", "Teacher dashboard API");
  assertIncludes(route, "requireTeacherResearcher", "Teacher dashboard API");
  assertIncludes(exportRoute, "downloadTeacherAssessmentDashboardCsv", "Teacher dashboard export API");
  assertIncludes(exportRoute, "requireTeacherResearcher", "Teacher dashboard export API");
  assertIncludes(exportRoute, "Content-Type", "Teacher dashboard export API");

  for (const forbidden of [
    "JSON import",
    "Model evaluation",
    'href="/teacher/content/import-json"',
    'href="/teacher/evals"',
    "Microscope",
    "FileJson",
    "students needing attention now",
    "ability level",
    "ability levels",
    "live classroom-monitoring"
  ]) {
    assertExcludes(dashboard, forbidden, "Teacher dashboard");
    assertExcludes(client, forbidden, "Teacher assessment dashboard client");
    assertExcludes(service, forbidden, "Teacher assessment dashboard service");
  }
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

async function cleanupDashboardFixture(prefix: string) {
  const assessments = await prisma.assessment.findMany({
    where: { assessment_public_id: { startsWith: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const sessions = await prisma.assessmentSession.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);
  const conceptUnits = await prisma.conceptUnit.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true }
  });
  const conceptUnitIds = conceptUnits.map((conceptUnit) => conceptUnit.id);

  await prisma.itemResponse.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.conceptUnitSession.deleteMany({ where: { id: { in: conceptUnitSessionIds } } });
  await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: conceptUnitIds } } });
  await prisma.conceptUnit.deleteMany({ where: { id: { in: conceptUnitIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
  await prisma.user.deleteMany({ where: { user_id: { startsWith: prefix } } });
}

async function assertDashboardAggregationService() {
  const prefix = `teacher_dashboard_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  await cleanupDashboardFixture(prefix);

  try {
    const teacher = await prisma.user.create({
      data: {
        user_id: `${prefix}_teacher`,
        user_id_normalized: normalizeUserId(`${prefix}_teacher`),
        role: "teacher_researcher"
      }
    });
    const students = await Promise.all(
      [1, 2, 3, 4, 5].map((index) =>
        prisma.user.create({
          data: {
            user_id: `${prefix}_student_${index}`,
            user_id_normalized: normalizeUserId(`${prefix}_student_${index}`),
            role: "student",
            created_by_teacher_user_id: teacher.id
          }
        })
      )
    );
    const assessment = await prisma.assessment.create({
      data: {
        assessment_public_id: `${prefix}_assessment`,
        title: "Synthetic assessment dashboard smoke",
        diagnostic_focus: "Teacher reviews diagnostic MCQ response patterns.",
        status: "published",
        created_by_user_db_id: teacher.id
      }
    });
    const conceptUnit = await prisma.conceptUnit.create({
      data: {
        concept_unit_public_id: `${prefix}_concept`,
        assessment_db_id: assessment.id,
        title: "Synthetic dashboard concept",
        learning_objective: "Exercise assessment-level dashboard summaries.",
        related_concept_description: "Synthetic dashboard smoke fixture.",
        order_index: 1,
        status: "published",
        administration_rules: {
          metadata: {
            item_diagnostic_value_note: "Checks whether students distinguish the target concept from a common distractor.",
            plain_language_distractor_diagnostic_notes:
              "Option B can suggest a specific incorrect response pattern for teacher review."
          }
        }
      }
    });
    const item = await prisma.item.create({
      data: {
        item_public_id: `${prefix}_item`,
        concept_unit_db_id: conceptUnit.id,
        item_order: 1,
        item_stem: "Which option best represents the target concept?",
        options: [
          { label: "A", text: "Target concept" },
          { label: "B", text: "Common distractor" },
          { label: "C", text: "Unrelated feature" },
          { label: "D", text: "Surface cue" }
        ],
        correct_option: "A",
        status: "published",
        included_in_published_set: true,
        version: 1
      }
    });

    const base = new Date("2026-07-12T14:00:00.000Z");
    for (const [index, student] of students.slice(0, 4).entries()) {
      const session = await prisma.assessmentSession.create({
        data: {
          session_public_id: `${prefix}_session_${index + 1}`,
          user_db_id: student.id,
          assessment_db_id: assessment.id,
          status: "completed",
          current_phase: "session_completed",
          started_at: new Date(base.getTime() + index * 60_000),
          last_activity_at: new Date(base.getTime() + index * 60_000 + 12 * 60_000),
          completed_at: new Date(base.getTime() + index * 60_000 + 12 * 60_000)
        }
      });
      const conceptUnitSession = await prisma.conceptUnitSession.create({
        data: {
          assessment_session_db_id: session.id,
          concept_unit_db_id: conceptUnit.id,
          status: "completed",
          initial_completed_at: session.completed_at
        }
      });
      const wrong = index < 3;
      await prisma.itemResponse.create({
        data: {
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: item.id,
          selected_option: wrong ? "B" : "A",
          correct_option_snapshot: "A",
          correctness: wrong ? "incorrect" : "correct",
          reasoning_text: wrong
            ? "I chose B because I treated the distractor as the target concept."
            : "I chose A because it matches the target concept.",
          confidence_rating: wrong ? "high" : "medium",
          item_response_time_ms: 40_000,
          item_started_at: session.started_at,
          item_submitted_at: session.completed_at,
          item_version_snapshot: 1,
          item_snapshot: { item_public_id: item.item_public_id }
        }
      });
    }

    const dashboard = await getTeacherAssessmentDashboard({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });

    assert(dashboard.summary_cards.total_students === 5, "Dashboard should count teacher-created active students.");
    assert(dashboard.summary_cards.not_started === 1, "Dashboard should count the synthetic not-started student.");
    assert(dashboard.summary_cards.completed === 4, "Dashboard should count completed sessions.");
    assert(dashboard.summary_cards.average_time_spent_minutes === 12, "Dashboard should calculate average time spent.");
    assert(
      dashboard.understanding_distribution.some((entry) => entry.label === "Still developing" && entry.count > 0),
      "Dashboard should expose assessment-specific understanding categories."
    );
    assert(
      dashboard.engagement_distribution.some((entry) => entry.label === "Low engagement" && entry.count > 0),
      "Dashboard should expose engagement signals."
    );
    assert(dashboard.item_diagnostics.length === 1, "Dashboard should expose item-level diagnostics.");
    assert(
      dashboard.item_diagnostics[0].option_distribution.some((entry) => entry.label === "B" && entry.count === 3),
      "Item diagnostics should count option selections."
    );
    assert(
      dashboard.candidate_misconception_patterns.length === 1,
      "Repeated wrong-option evidence should create one candidate pattern."
    );
    assert(
      dashboard.candidate_misconception_patterns[0].review_note.includes("not a confirmed misconception"),
      "Candidate pattern should use cautious review wording."
    );
    const csv = await downloadTeacherAssessmentDashboardCsv({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(csv.content.includes("candidate_misconception_pattern"), "Dashboard CSV should include candidate patterns.");
    assert(csv.content.includes("item_option_distribution"), "Dashboard CSV should include item option distributions.");
  } finally {
    await cleanupDashboardFixture(prefix);
  }
}

async function main() {
  assertDashboardSurface();
  assertStandardTeacherNav();
  assertAdvancedRoutesPreservedAndProtected();
  await assertDashboardAggregationService();

  console.log(
    JSON.stringify(
      {
        status: "passed",
        dashboard_json_import_card_absent: true,
        dashboard_model_evaluation_card_absent: true,
        assessment_level_dashboard_present: true,
        assessment_summary_cards_present: true,
        diagnostic_charts_present: true,
        candidate_misconception_patterns_deterministic: true,
        dashboard_csv_export_present: true,
        dashboard_aggregation_service_checked: true,
        standard_nav_json_import_absent: true,
        routine_nav_links_preserved: true,
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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
