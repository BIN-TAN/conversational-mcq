import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PrismaClient,
  type EngagementProfile,
  type EvidenceSufficiency,
  type IntegratedDiagnosticProfile
} from "@prisma/client";
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
  const contentHome = readProjectFile("src/app/teacher/content/page.tsx");

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
    "Eligible students",
    "Not started",
    "In progress",
    "Completed",
    "Flagged for review",
    "Average time spent",
    "Status distribution",
    "Completion progress",
    "Assessment-specific understanding",
    "Engagement review signals",
    "Engagement review reasons",
    "Item-level diagnostic view",
    "Candidate misconception patterns",
    "diagnostic signals",
    "response patterns",
    "does not claim stable learner traits",
    "No student data are available for this assessment.",
    "Sample size",
    "Legend:",
    "Chart data table",
    "Overlapping review indicator",
    "< 1 min"
  ]) {
    assertIncludes(client, expected, "Teacher assessment dashboard client");
  }

  for (const expected of [
    "CANDIDATE_PATTERN_THRESHOLD = 3",
    "ATTEMPT_POLICY_LATEST_PER_STUDENT",
    "all_active_students_created_by_teacher_no_assessment_assignment_model",
    "active_interaction_ms",
    "latest_attempt_per_student",
    "deterministic exact normalized reasoning after removing common opening phrases",
    "anonymizedReasoningSnippet",
    "itemSnapshotPublicId",
    "downloadTeacherAssessmentDashboardCsv",
    "assessment_specific_understanding",
    "engagement_review_signals",
    "engagement_review_reason",
    "No engagement concern flagged",
    "Flagged for engagement review",
    "Insufficient engagement evidence",
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
  assertIncludes(contentHome, "Mini tests", "Content management page");
  assertIncludes(contentHome, "JSON import", "Content management page");
  assertExcludes(contentHome, "Research integrity", "Content management page");

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
    "live classroom-monitoring",
    "Low engagement signals",
    "Moderate engagement signals",
    "High engagement signals",
    "Export and readable data",
    "Dashboard summary CSV",
    "Assessment CSV",
    "Detailed process bundle"
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
  await prisma.studentProfile.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
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
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) =>
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
    const emptyAssessment = await prisma.assessment.create({
      data: {
        assessment_public_id: `${prefix}_empty_assessment`,
        title: "Synthetic empty assessment dashboard smoke",
        diagnostic_focus: "Exercise no-data dashboard state.",
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
    await prisma.conceptUnit.create({
      data: {
        concept_unit_public_id: `${prefix}_empty_concept`,
        assessment_db_id: emptyAssessment.id,
        title: "Synthetic empty concept",
        learning_objective: "Exercise no-data dashboard state.",
        related_concept_description: "Synthetic no-data dashboard smoke fixture.",
        order_index: 1,
        status: "published"
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
    const itemSnapshot = {
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      item_stem: item.item_stem,
      options: item.options,
      correct_option: "A",
      version: 1
    };
    async function createProfile(
      conceptUnitSessionId: string,
      input: {
        integrated_diagnostic_profile: IntegratedDiagnosticProfile;
        engagement_profile: EngagementProfile;
        evidence_sufficiency?: EvidenceSufficiency;
      }
    ) {
      return prisma.studentProfile.create({
        data: {
          concept_unit_session_db_id: conceptUnitSessionId,
          profile_type: "initial",
          ability_profile: "partial_understanding",
          ability_pattern_flags: {},
          engagement_profile: input.engagement_profile,
          engagement_pattern_flags: {},
          integrated_diagnostic_profile: input.integrated_diagnostic_profile,
          integrated_profile_confidence: "medium",
          integrated_profile_rationale: "Synthetic dashboard smoke profile.",
          evidence_sufficiency: input.evidence_sufficiency ?? "adequate",
          confidence_alignment: "mixed",
          independence_interpretability: "independent_understanding_uncertain",
          misconception_indicators: {},
          item_level_evidence: {},
          reasoning_quality_summary: "Synthetic persisted profile evidence.",
          engagement_summary: "Synthetic persisted engagement evidence.",
          process_interpretation_cautions: {},
          profile_confidence: "medium",
          rationale: "Synthetic dashboard smoke profile.",
          recommended_next_evidence: {}
        }
      });
    }
    async function createSession(input: {
      studentIndex: number;
      attemptNumber: number;
      status: "active" | "paused" | "completed" | "student_exited";
      selectedOption?: string;
      correctness?: "correct" | "incorrect";
      reasoning?: string;
      confidence?: "low" | "medium" | "high";
      itemTimeMs?: number;
      needsReview?: boolean;
      profile?: {
        integrated_diagnostic_profile: IntegratedDiagnosticProfile;
        engagement_profile: EngagementProfile;
        evidence_sufficiency?: EvidenceSufficiency;
      };
    }) {
      const student = students[input.studentIndex - 1];
      const offsetMs = (input.studentIndex * 10 + input.attemptNumber) * 60_000;
      const startedAt = new Date(base.getTime() + offsetMs);
      const completedAt = input.status === "completed" || input.status === "student_exited"
        ? new Date(startedAt.getTime() + 12 * 60_000)
        : null;
      const session = await prisma.assessmentSession.create({
        data: {
          session_public_id: `${prefix}_session_${input.studentIndex}_${input.attemptNumber}`,
          user_db_id: student.id,
          assessment_db_id: assessment.id,
          attempt_number: input.attemptNumber,
          status: input.status,
          current_phase:
            input.status === "completed"
              ? "session_completed"
              : input.status === "student_exited"
                ? "student_exited"
                : "initial_item_administration",
          needs_review: input.needsReview ?? false,
          needs_review_reason: input.needsReview ? "Synthetic review flag." : null,
          started_at: startedAt,
          last_activity_at: completedAt ?? new Date(startedAt.getTime() + 5 * 60_000),
          completed_at: completedAt
        }
      });
      const conceptUnitSession = await prisma.conceptUnitSession.create({
        data: {
          assessment_session_db_id: session.id,
          concept_unit_db_id: conceptUnit.id,
          status: input.status === "completed" ? "completed" : "initial_in_progress",
          initial_completed_at: session.completed_at
        }
      });
      if (input.selectedOption) {
        await prisma.itemResponse.create({
          data: {
            concept_unit_session_db_id: conceptUnitSession.id,
            item_db_id: item.id,
            selected_option: input.selectedOption,
            correct_option_snapshot: "A",
            correctness: input.correctness ?? "incorrect",
            reasoning_text: input.reasoning ?? null,
            confidence_rating: input.confidence ?? "high",
            item_response_time_ms: input.itemTimeMs ?? 40_000,
            item_started_at: session.started_at,
            item_submitted_at: session.completed_at ?? new Date(startedAt.getTime() + 4 * 60_000),
            item_version_snapshot: 1,
            item_snapshot: itemSnapshot
          }
        });
      }
      if (input.profile) {
        await createProfile(conceptUnitSession.id, input.profile);
      }
      return { session, conceptUnitSession };
    }

    await createSession({
      studentIndex: 1,
      attemptNumber: 1,
      status: "completed",
      selectedOption: "B",
      reasoning: "I treated the distractor as the target concept because the wording sounded similar.",
      confidence: "high",
      itemTimeMs: 40_000,
      profile: {
        integrated_diagnostic_profile: "misconception_with_sufficient_engagement",
        engagement_profile: "low_engagement"
      }
    });
    await createSession({
      studentIndex: 2,
      attemptNumber: 1,
      status: "completed",
      selectedOption: "B",
      reasoning: "I treated the distractor as the target concept because the wording sounded similar.",
      confidence: "high",
      itemTimeMs: 40_000
    });
    await createSession({
      studentIndex: 2,
      attemptNumber: 2,
      status: "active",
      selectedOption: "C",
      reasoning: "I think this is one different explanation.",
      confidence: "high",
      itemTimeMs: 30_000
    });
    await createSession({
      studentIndex: 3,
      attemptNumber: 1,
      status: "paused",
      selectedOption: "C",
      reasoning: "I think this is another different explanation.",
      confidence: "high",
      itemTimeMs: 30_000,
      needsReview: true
    });
    await createSession({
      studentIndex: 4,
      attemptNumber: 1,
      status: "student_exited",
      selectedOption: "C",
      reasoning: "I think this is a third different explanation.",
      confidence: "high",
      itemTimeMs: 30_000
    });
    await createSession({
      studentIndex: 5,
      attemptNumber: 1,
      status: "completed",
      selectedOption: "B",
      reasoning: "I treated the distractor as the target concept because the wording sounded similar.",
      confidence: "high",
      itemTimeMs: 40_000
    });
    await createSession({
      studentIndex: 5,
      attemptNumber: 2,
      status: "completed",
      selectedOption: "B",
      reasoning: "I treated the distractor as the target concept because the wording sounded similar.",
      confidence: "high",
      itemTimeMs: 50_000,
      profile: {
        integrated_diagnostic_profile: "robust_understanding_ready_for_transfer",
        engagement_profile: "adequate_engagement"
      }
    });
    await createSession({
      studentIndex: 6,
      attemptNumber: 1,
      status: "completed",
      selectedOption: "B",
      reasoning: "I treated the distractor as the target concept because the wording sounded similar. learner@example.com 555-123-4567.",
      confidence: "medium",
      itemTimeMs: 60_000,
      profile: {
        integrated_diagnostic_profile: "developing_understanding_with_productive_engagement",
        engagement_profile: "productive_engagement"
      }
    });
    await createSession({
      studentIndex: 7,
      attemptNumber: 1,
      status: "completed",
      selectedOption: "B",
      reasoning: "I treated the distractor as the target concept because the wording sounded similar.",
      confidence: "high",
      itemTimeMs: 40_000
    });
    await createSession({
      studentIndex: 7,
      attemptNumber: 2,
      status: "active"
    });

    await prisma.item.update({
      where: { id: item.id },
      data: {
        item_stem: "Edited current item stem that should not rewrite administered snapshot.",
        options: [
          { label: "A", text: "Edited option A" },
          { label: "B", text: "Edited option B" },
          { label: "E", text: "Edited option E" }
        ],
        correct_option: "B",
        version: 2
      }
    });

    const dashboard = await getTeacherAssessmentDashboard({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });

    assert(dashboard.eligible_student_count === 9, "Dashboard should expose an explicit eligible-student denominator.");
    assert(
      dashboard.eligibility_basis === "all_active_students_created_by_teacher_no_assessment_assignment_model",
      "Dashboard should document the denominator basis."
    );
    assert(dashboard.attempt_policy.policy === "latest_attempt_per_student", "Dashboard should expose latest-attempt policy.");
    assert(dashboard.summary_cards.not_started === 2, "Dashboard should count students with no attempts as not started.");
    assert(dashboard.summary_cards.in_progress === 3, "Dashboard should use latest attempts for in-progress status.");
    assert(dashboard.summary_cards.completed === 3, "Dashboard should count one latest completed attempt per student.");
    assert(
      dashboard.summary_cards.exited_terminal_incomplete === 1,
      "Dashboard should count exited latest attempts separately."
    );
    assert(dashboard.summary_cards.unavailable === 0, "Dashboard should expose unavailable status count.");
    assert(dashboard.summary_cards.flagged_for_review === 1, "Flagged review should be an overlapping indicator.");
    assert(
      dashboard.status_distribution.reduce((total, row) => total + row.count, 0) === dashboard.eligible_student_count,
      "Status categories should be mutually exclusive and sum to the eligible denominator."
    );
    assert(
      dashboard.time_indicator.time_metric_type === "active_interaction_ms",
      "Dashboard should use active interaction timing when available."
    );
    assert(dashboard.time_indicator.average_time_ms === 50_000, "Dashboard should average latest completed active time.");
    assert(dashboard.time_indicator.sample_size === 3, "Time metric should use latest completed attempts only.");
    assert(dashboard.time_indicator.unavailable_count === 0, "Time metric should report unavailable count.");
    assert(
      dashboard.understanding_distribution.some((entry) => entry.label === "Unavailable / insufficient evidence" && entry.count === 6),
      "Missing understanding profiles should remain unavailable."
    );
    assert(
      dashboard.engagement_distribution.some((entry) => entry.label === "Insufficient engagement evidence" && entry.count === 6),
      "Missing engagement profiles should remain insufficient engagement evidence."
    );
    assert(
      dashboard.engagement_distribution.some((entry) => entry.label === "Flagged for engagement review" && entry.count === 1),
      "Low persisted engagement profile should be flagged for engagement review."
    );
    assert(
      dashboard.engagement_distribution.some((entry) => entry.label === "No engagement concern flagged" && entry.count === 2),
      "Persisted non-low engagement profiles should be counted as no engagement concern flagged."
    );
    assert(
      dashboard.engagement_review_reasons.some((entry) => entry.label.includes("Persisted low-engagement") && entry.count === 1),
      "Dashboard should expose safe teacher-only engagement review reasons."
    );
    assert(dashboard.item_diagnostics.length >= 1, "Dashboard should expose item-level diagnostics.");
    const administeredSnapshot = dashboard.item_diagnostics.find((entry) => entry.item_snapshot_public_id.endsWith(":v1"));
    assert(administeredSnapshot, "Dashboard should preserve administered item snapshot diagnostics.");
    assert(
      administeredSnapshot.item_stem_preview.includes("Which option best represents"),
      "Dashboard should use administered item stem snapshot, not the edited current item."
    );
    assert(
      administeredSnapshot.option_distribution.some((entry) => entry.label === "B" && entry.count === 3),
      "Item diagnostics should use latest attempts and administered option snapshots."
    );
    assert(
      dashboard.candidate_misconception_patterns.length === 1,
      "Only the repeated exact reasoning pattern should meet the unique-student threshold."
    );
    const candidate = dashboard.candidate_misconception_patterns[0];
    assert(candidate.unique_student_count === 3, "Candidate threshold should count unique students.");
    assert(candidate.response_count === 3, "Repeated attempts from one student should not inflate response count.");
    assert(candidate.threshold_unique_student_count === 3, "Candidate should report the configured threshold.");
    assert(candidate.item_snapshot_public_id.endsWith(":v1"), "Candidate should bind to administered item snapshot.");
    assert(
      candidate.review_note.includes("not a confirmed misconception"),
      "Candidate pattern should use cautious review wording."
    );
    assert(
      candidate.reasoning_grouping_method.includes("exact normalized reasoning"),
      "Candidate should use conservative exact reasoning grouping."
    );
    assert(
      candidate.representative_reasoning_snippets.every(
        (snippet) => !snippet.includes("@") && !/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(snippet)
      ),
      "Candidate reasoning snippets should redact obvious contact information."
    );
    const csv = await downloadTeacherAssessmentDashboardCsv({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(csv.content.includes("dashboard_metadata"), "Dashboard CSV should include metadata rows.");
    assert(csv.content.includes("latest_attempt_per_student"), "Dashboard CSV should include attempt policy.");
    assert(csv.content.includes("active_interaction_ms"), "Dashboard CSV should include time metric type.");
    assert(csv.content.includes("engagement_review_signals"), "Dashboard CSV should include engagement review categories.");
    assert(csv.content.includes("engagement_review_reason"), "Dashboard CSV should include engagement review reasons.");
    assert(csv.content.includes("candidate_misconception_pattern"), "Dashboard CSV should include candidate patterns.");
    assert(csv.content.includes(candidate.item_snapshot_public_id), "Dashboard CSV should match UI snapshot binding.");
    assert(csv.content.includes("item_option_distribution"), "Dashboard CSV should include item option distributions.");

    const emptyDashboard = await getTeacherAssessmentDashboard({
      teacher_user_db_id: teacher.id,
      assessment_public_id: emptyAssessment.assessment_public_id
    });
    assert(emptyDashboard.has_student_data === false, "Empty assessment should report no student data.");
    assert(emptyDashboard.status_distribution.length === 0, "Empty assessment should not render zero status charts.");
    assert(emptyDashboard.progress_chart.length === 0, "Empty assessment should not render zero progress charts.");
    assert(
      emptyDashboard.notes.includes("No student data are available for this assessment."),
      "Empty assessment should include no-data note."
    );
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
        dashboard_csv_export_api_preserved: true,
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
