import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import {
  commitRosterImport,
  previewRosterImport,
  setStudentAccountStatus
} from "../src/lib/services/student-accounts/service";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

export const rosterDemoUserIds = [
  "roster_demo_alpha",
  "roster_demo_beta",
  "roster_demo_inactive"
] as const;

export const rosterDemoSourceFileName = "roster-demo-students.csv";

export async function ensureRosterDemoTeacher(prisma: PrismaClient) {
  const passwordHash = await hashSecret("teacher_demo_password");

  return prisma.user.upsert({
    where: { user_id: "teacher_demo" },
    update: {
      role: "teacher_researcher",
      user_id_normalized: normalizeUserId("teacher_demo"),
      account_status: "active",
      auth_version: 1,
      password_hash: passwordHash,
      access_code_hash: null
    },
    create: {
      user_id: "teacher_demo",
      user_id_normalized: normalizeUserId("teacher_demo"),
      role: "teacher_researcher",
      account_status: "active",
      auth_version: 1,
      password_hash: passwordHash
    }
  });
}

export function rosterDemoCsv() {
  return [
    "user_id,display_name",
    "roster_demo_alpha,Roster Demo Alpha",
    "roster_demo_beta,Roster Demo Beta",
    "roster_demo_inactive,Roster Demo Inactive"
  ].join("\n");
}

export async function ensureRosterDemoFixture(prisma: PrismaClient) {
  const teacher = await ensureRosterDemoTeacher(prisma);
  const preview = await previewRosterImport({
    teacher_user_db_id: teacher.id,
    data: {
      source_file_name: rosterDemoSourceFileName,
      csv_text: rosterDemoCsv()
    }
  });
  const commit = await commitRosterImport({
    teacher_user_db_id: teacher.id,
    batch_public_id: preview.batch_public_id,
    data: { apply_display_name_updates: true }
  });

  await setStudentAccountStatus({
    teacher_user_db_id: teacher.id,
    user_id: "roster_demo_inactive",
    account_status: "inactive"
  }).catch(() => null);

  return { teacher, preview, commit };
}

export async function cleanupRosterDemoFixture(prisma: PrismaClient) {
  const users = await prisma.user.findMany({
    where: {
      user_id: { in: [...rosterDemoUserIds] }
    },
    select: {
      id: true,
      user_id: true,
      _count: {
        select: {
          assessment_sessions: true,
          summative_outcomes: true
        }
      }
    }
  });

  const deleted: string[] = [];
  const retainedAndDeactivated: string[] = [];

  for (const user of users) {
    if (user._count.assessment_sessions > 0 || user._count.summative_outcomes > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          account_status: "inactive",
          deactivated_at: new Date(),
          auth_version: { increment: 1 }
        }
      });
      retainedAndDeactivated.push(user.user_id);
      continue;
    }

    await prisma.studentAccountEvent.deleteMany({
      where: { student_user_db_id: user.id }
    });
    await prisma.user.delete({
      where: { id: user.id }
    });
    deleted.push(user.user_id);
  }

  await prisma.rosterImportBatch.deleteMany({
    where: {
      source_file_name: {
        in: [rosterDemoSourceFileName, "roster-import-smoke.csv", "student-account-ui-smoke.csv"]
      }
    }
  });

  return { deleted, retainedAndDeactivated };
}
