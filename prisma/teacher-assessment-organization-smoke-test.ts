import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import {
  computeAssessmentOrganizationRevision,
  createAssessment,
  listAssessments,
  saveAssessmentOrganization
} from "../src/lib/services/content/assessments";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { teacherPrimaryNavItems } from "../src/components/teacher-primary-nav-items";
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

async function assertContentError(
  action: () => Promise<unknown>,
  code: string,
  message: string
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ContentServiceError, `${message}: expected ContentServiceError.`);
    assert(error.code === code, `${message}: expected ${code}, received ${error.code}.`);
    return error;
  }

  throw new Error(`${message}: expected ${code} error.`);
}

async function ensureTeacher(userId: string) {
  const passwordHash = await hashSecret(`${userId}_password`);

  return prisma.user.upsert({
    where: { user_id: userId },
    update: {
      role: "teacher_researcher",
      password_hash: passwordHash,
      access_code_hash: null,
      account_status: "active"
    },
    create: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      display_name: userId,
      role: "teacher_researcher",
      password_hash: passwordHash
    }
  });
}

async function createMiniTest(input: {
  teacherUserDbId: string;
  title: string;
  folderLabel: string | null;
  folderOrder: number;
  assessmentOrder: number;
}) {
  return createAssessment({
    teacher_user_db_id: input.teacherUserDbId,
    data: {
      title: input.title,
      diagnostic_focus: "Assessment organization smoke diagnostic focus.",
      folder_label: input.folderLabel,
      folder_order_index: input.folderOrder,
      assessment_order_index: input.assessmentOrder
    }
  });
}

async function cleanup(prefix: string) {
  await prisma.assessment.deleteMany({
    where: { title: { startsWith: prefix } }
  });
  await prisma.user.deleteMany({
    where: { user_id: { startsWith: prefix } }
  });
}

function assertManagementSurface() {
  const contentHome = readProjectFile("src/app/teacher/content/page.tsx");
  const contentLayout = readProjectFile("src/app/teacher/content/layout.tsx");
  const libraryClient = readProjectFile("src/components/teacher-content/assessment-list-client.tsx");
  const organizationRoute = readProjectFile("src/app/api/teacher/assessments/organization/route.ts");
  const legacyReorganizePage = readProjectFile("src/app/teacher/content/reorganize-assessments/page.tsx");
  const legacyLibraryReorganizePage = readProjectFile("src/app/teacher/content/assessments/reorganize/page.tsx");

  assertIncludes(contentHome, "Assessment management", "Assessment management page");
  assertIncludes(contentHome, "New mini test", "Assessment management page");
  assertIncludes(contentHome, "Assessment library", "Assessment management page");
  assertIncludes(contentHome, "JSON import", "Assessment management page");
  assertIncludes(contentHome, 'href="/teacher/content/assessments/new"', "Assessment management page");
  assertIncludes(contentHome, 'href="/teacher/content/assessments"', "Assessment management page");
  assertIncludes(contentHome, 'href="/teacher/content/import-json"', "Assessment management page");
  assertExcludes(contentHome, "Reorganize assessments", "Assessment management page");
  assertExcludes(contentHome, "PrimaryLink", "Assessment management page");
  assertExcludes(contentHome, "SecondaryLink", "Assessment management page");
  assertExcludes(contentHome, "actions=", "Assessment management page");
  const primaryCardCount = (contentHome.match(/rounded-lg border border-line bg-white p-5/g) ?? []).length;
  assert(primaryCardCount === 3, `Assessment management page should have exactly three primary cards, found ${primaryCardCount}.`);

  assertIncludes(contentLayout, "TeacherPrimaryNav", "Content layout navigation");
  const expectedNavLabels = [
    "Dashboard",
    "Assessment management",
    "Student accounts",
    "Student sessions",
    "Data and outcomes",
    "LLM status"
  ];
  assert(
    teacherPrimaryNavItems.map((item) => item.label).join("|") === expectedNavLabels.join("|"),
    "Shared teacher nav should preserve the standard label order."
  );
  assertExcludes(contentLayout, "Mini tests", "Content layout navigation");
  assertExcludes(contentLayout, 'href: "/teacher/content/assessments"', "Content layout navigation");

  assertIncludes(legacyReorganizePage, 'redirect("/teacher/content/assessments")', "Legacy reorganize route");
  assertIncludes(legacyLibraryReorganizePage, 'redirect("/teacher/content/assessments")', "Legacy library reorganize route");

  assertIncludes(libraryClient, "Reorder mini tests", "Assessment library");
  assertIncludes(libraryClient, "Save organization", "Assessment library");
  assertIncludes(libraryClient, "Cancel", "Assessment library");
  assertIncludes(libraryClient, "Move to folder/week/module", "Assessment library");
  assertIncludes(libraryClient, "Move to Unfiled", "Assessment library");
  assertIncludes(libraryClient, "Move ${assessment.title} mini test", "Assessment library");
  assertIncludes(libraryClient, "Search and alternate sorting are unavailable while reordering.", "Assessment library");
  assertIncludes(libraryClient, "Custom order", "Assessment library");
  assertIncludes(libraryClient, "activeOrganizationAssessments", "Assessment library");
  assertIncludes(libraryClient, "disabled={isReorderMode}", "Assessment library");
  assertIncludes(libraryClient, "reorderMode ? (", "Assessment library");
  assertIncludes(libraryClient, "beforeunload", "Assessment library");
  assertIncludes(libraryClient, "DndContext", "Assessment library");
  assertIncludes(libraryClient, "KeyboardSensor", "Assessment library");

  assertIncludes(organizationRoute, "requireTeacherResearcher", "Assessment organization API");
  assertIncludes(organizationRoute, "saveAssessmentOrganization", "Assessment organization API");
  assertIncludes(organizationRoute, "export async function POST", "Assessment organization API");
}

async function assertOrganizationPersistence() {
  const prefix = `org_smoke_${randomUUID()}`;
  await cleanup(prefix);

  try {
    const teacher = await ensureTeacher(`${prefix}_teacher`);
    const otherTeacher = await ensureTeacher(`${prefix}_other_teacher`);
    const alpha = await createMiniTest({
      teacherUserDbId: teacher.id,
      title: `${prefix} alpha`,
      folderLabel: "Week 1",
      folderOrder: 0,
      assessmentOrder: 0
    });
    const beta = await createMiniTest({
      teacherUserDbId: teacher.id,
      title: `${prefix} beta`,
      folderLabel: "Week 1",
      folderOrder: 0,
      assessmentOrder: 1
    });
    const gamma = await createMiniTest({
      teacherUserDbId: teacher.id,
      title: `${prefix} gamma`,
      folderLabel: "Week 2",
      folderOrder: 1,
      assessmentOrder: 0
    });
    const unfiled = await createMiniTest({
      teacherUserDbId: teacher.id,
      title: `${prefix} unfiled`,
      folderLabel: null,
      folderOrder: 2,
      assessmentOrder: 0
    });
    const archived = await createMiniTest({
      teacherUserDbId: teacher.id,
      title: `${prefix} archived`,
      folderLabel: "Archive",
      folderOrder: 3,
      assessmentOrder: 0
    });
    const unauthorized = await createMiniTest({
      teacherUserDbId: otherTeacher.id,
      title: `${prefix} unauthorized`,
      folderLabel: "Other",
      folderOrder: 0,
      assessmentOrder: 0
    });

    await prisma.assessment.update({
      where: { assessment_public_id: gamma.assessment_public_id },
      data: { status: "published" }
    });
    await prisma.assessment.update({
      where: { assessment_public_id: archived.assessment_public_id },
      data: { status: "archived" }
    });

    const beforeCounts = {
      sessions: await prisma.assessmentSession.count(),
      responses: await prisma.itemResponse.count(),
      turns: await prisma.conversationTurn.count(),
      packages: await prisma.responsePackage.count()
    };
    const initial = await listAssessments({ teacher_user_db_id: teacher.id });
    const initialRevision = computeAssessmentOrganizationRevision(initial);

    const saved = await saveAssessmentOrganization({
      teacher_user_db_id: teacher.id,
      data: {
        expected_revision: initialRevision,
        groups: [
          {
            folder_label: "Week 1",
            assessment_public_ids: [beta.assessment_public_id]
          },
          {
            folder_label: "Week 2",
            assessment_public_ids: [alpha.assessment_public_id, gamma.assessment_public_id]
          },
          {
            folder_label: null,
            assessment_public_ids: [unfiled.assessment_public_id]
          }
        ]
      }
    });

    const byId = new Map(saved.assessments.map((assessment) => [assessment.assessment_public_id, assessment]));
    assert(byId.get(beta.assessment_public_id)?.assessment_order_index === 0, "Move within folder did not normalize source order.");
    assert(byId.get(alpha.assessment_public_id)?.folder_label === "Week 2", "Move between folders did not update folder label.");
    assert(byId.get(alpha.assessment_public_id)?.assessment_order_index === 0, "Destination order was not normalized.");
    assert(byId.get(gamma.assessment_public_id)?.assessment_order_index === 1, "Destination order did not preserve peer order.");
    assert(byId.get(unfiled.assessment_public_id)?.folder_label === null, "Moving to Unfiled should persist null folder label.");
    assert(byId.get(gamma.assessment_public_id)?.status === "published", "Published status changed during organization save.");
    assert(byId.get(archived.assessment_public_id)?.status === "archived", "Archived status changed during organization save.");
    assert(byId.get(archived.assessment_public_id)?.folder_label === "Archive", "Archived organization metadata changed when omitted from active reorder.");
    assert(
      saved.organization_revision !== initialRevision,
      "Successful organization save should return a new revision."
    );

    const afterCounts = {
      sessions: await prisma.assessmentSession.count(),
      responses: await prisma.itemResponse.count(),
      turns: await prisma.conversationTurn.count(),
      packages: await prisma.responsePackage.count()
    };
    assert(JSON.stringify(beforeCounts) === JSON.stringify(afterCounts), "Organization save mutated operational student data.");

    await assertContentError(
      () =>
        saveAssessmentOrganization({
          teacher_user_db_id: teacher.id,
          data: {
            expected_revision: saved.organization_revision,
            groups: [
              {
                folder_label: "Week 1",
                assessment_public_ids: [alpha.assessment_public_id, alpha.assessment_public_id]
              }
            ]
          }
        }),
      "validation_failed",
      "Duplicate assessment IDs should be rejected."
    );

    await assertContentError(
      () =>
        saveAssessmentOrganization({
          teacher_user_db_id: teacher.id,
          data: {
            expected_revision: saved.organization_revision,
            groups: [
              {
                folder_label: "Week 1",
                assessment_public_ids: [
                  alpha.assessment_public_id,
                  beta.assessment_public_id,
                  gamma.assessment_public_id,
                  unfiled.assessment_public_id,
                  "assessment_unknown_for_organization_smoke"
                ]
              }
            ]
          }
        }),
      "validation_failed",
      "Unknown assessment IDs should be rejected."
    );

    await assertContentError(
      () =>
        saveAssessmentOrganization({
          teacher_user_db_id: teacher.id,
          data: {
            expected_revision: saved.organization_revision,
            groups: [
              {
                folder_label: "Week 1",
                assessment_public_ids: [
                  alpha.assessment_public_id,
                  beta.assessment_public_id,
                  gamma.assessment_public_id,
                  unfiled.assessment_public_id,
                  unauthorized.assessment_public_id
                ]
              }
            ]
          }
        }),
      "forbidden",
      "Unauthorized assessment IDs should be rejected."
    );

    await assertContentError(
      () =>
        saveAssessmentOrganization({
          teacher_user_db_id: teacher.id,
          data: {
            expected_revision: saved.organization_revision,
            groups: [
              {
                folder_label: "Week 1",
                assessment_public_ids: [alpha.assessment_public_id]
              }
            ]
          }
        }),
      "validation_failed",
      "Omitted assessment IDs should be rejected."
    );

    await prisma.assessment.update({
      where: { assessment_public_id: beta.assessment_public_id },
      data: { assessment_order_index: 9 }
    });

    await assertContentError(
      () =>
        saveAssessmentOrganization({
          teacher_user_db_id: teacher.id,
          data: {
            expected_revision: saved.organization_revision,
            groups: [
              {
                folder_label: "Week 1",
                assessment_public_ids: [beta.assessment_public_id]
              },
              {
                folder_label: "Week 2",
                assessment_public_ids: [alpha.assessment_public_id, gamma.assessment_public_id]
              },
              {
                folder_label: null,
                assessment_public_ids: [unfiled.assessment_public_id]
              }
            ]
          }
        }),
      "conflict",
      "Concurrent organization changes should return a safe conflict."
    );
  } finally {
    await cleanup(prefix);
  }
}

async function main() {
  assertManagementSurface();
  await assertOrganizationPersistence();
  console.log("Teacher assessment organization smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
