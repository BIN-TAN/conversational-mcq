import { PrismaClient } from "@prisma/client";
import { verifySecret } from "../src/lib/password";
import { canAccessStudentAccountManagement } from "../src/lib/services/student-accounts/api";
import {
  commitRosterImport,
  previewRosterImport
} from "../src/lib/services/student-accounts/service";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  cleanupRosterDemoFixture,
  ensureRosterDemoTeacher,
  rosterDemoUserIds
} from "./demo-roster-fixture";

const prisma = new PrismaClient();
const prefix = `roster_smoke_${Date.now()}`;
const sourceFileName = "roster-import-smoke.csv";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function csv(rows: string[]) {
  return ["user_id,display_name", ...rows].join("\n");
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { user_id: { startsWith: prefix } },
        { user_id: { in: [...rosterDemoUserIds] } }
      ]
    },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  await prisma.studentAccountEvent.deleteMany({
    where: { student_user_db_id: { in: userIds } }
  });
  await prisma.user.deleteMany({
    where: { id: { in: userIds } }
  });
  await prisma.rosterImportBatch.deleteMany({
    where: {
      source_file_name: sourceFileName
    }
  });
  await cleanupRosterDemoFixture(prisma);
}

function assertNoPlaintext(value: unknown, codes: string[]) {
  const serialized = JSON.stringify(value);

  for (const code of codes) {
    assert(!serialized.includes(code), "Plaintext access code was stored in audit data.");
  }
}

async function main() {
  await cleanup();
  const beforeAgentCalls = await prisma.agentCall.count();
  const teacher = await ensureRosterDemoTeacher(prisma);

  try {
    const alpha = `${prefix}_alpha`;
    const missing = `${prefix}_missing`;
    const preview = await previewRosterImport({
      teacher_user_db_id: teacher.id,
      data: {
        source_file_name: sourceFileName,
        csv_text: csv([
          `${alpha},Alpha Student`,
          "",
          `${missing},Missing From Later Roster`,
          ` ${prefix}_bad_space,Invalid Leading Space`,
          `${alpha.toUpperCase()},Duplicate Case Variant`,
          "teacher_demo,Teacher Account"
        ])
      }
    });

    assert(preview.total_rows === 5, "Blank rows should be ignored.");
    assert(preview.new_student_rows === 2, "Two new student rows should be valid.");
    assert(preview.invalid_rows === 1, "Invalid user_id should be rejected.");
    assert(preview.duplicate_rows === 1, "Case-only duplicate should be detected.");
    assert(preview.role_conflict_rows === 1, "Teacher-account collision should be rejected.");
    assert(
      (await prisma.user.count({ where: { user_id: { startsWith: prefix } } })) === 0,
      "Preview must not create users."
    );
    assert(!JSON.stringify(preview).includes("temporary_access_code"), "Preview must not generate codes.");

    const commit = await commitRosterImport({
      teacher_user_db_id: teacher.id,
      batch_public_id: preview.batch_public_id
    });
    const codes = commit.one_time_credentials.map((credential) => credential.temporary_access_code);

    assert(commit.committed_new_students === 2, "Commit should create only valid new students.");
    assert(codes.length === 2, "Commit should return one-time codes for new students.");
    assert(new Set(codes).size === codes.length, "Generated access codes should be unique.");

    const alphaUser = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(alpha) },
      select: {
        id: true,
        user_id: true,
        user_id_normalized: true,
        access_code_hash: true,
        account_status: true
      }
    });
    assert(alphaUser.user_id === alpha, "Canonical user_id should be preserved.");
    assert(alphaUser.account_status === "active", "New student should be active.");
    assert(alphaUser.access_code_hash !== codes[0], "Plaintext code must not be stored as the hash.");
    assert(
      commit.one_time_credentials.some((credential) =>
        verifySecret(credential.temporary_access_code, alphaUser.access_code_hash)
      ),
      "A returned plaintext code should verify against the stored hash."
    );

    const batch = await prisma.rosterImportBatch.findUniqueOrThrow({
      where: { batch_public_id: preview.batch_public_id }
    });
    const events = await prisma.studentAccountEvent.findMany({
      where: { student_user_db_id: alphaUser.id }
    });
    assertNoPlaintext(batch, codes);
    assertNoPlaintext(events, codes);

    const repeatCommit = await commitRosterImport({
      teacher_user_db_id: teacher.id,
      batch_public_id: preview.batch_public_id
    });
    assert(repeatCommit.already_committed, "Repeated commit should report already committed.");
    assert(repeatCommit.one_time_credentials.length === 0, "Repeated commit must not re-display codes.");
    assert(
      (await prisma.user.count({ where: { user_id_normalized: normalizeUserId(alpha) } })) === 1,
      "Repeated commit must not create duplicate users."
    );

    const hashBeforeReimport = alphaUser.access_code_hash;
    const existingPreview = await previewRosterImport({
      teacher_user_db_id: teacher.id,
      data: {
        source_file_name: sourceFileName,
        csv_text: csv([`${alpha},Alpha Student`])
      }
    });
    assert(existingPreview.existing_unchanged_rows === 1, "Existing student should be detected.");
    const existingCommit = await commitRosterImport({
      teacher_user_db_id: teacher.id,
      batch_public_id: existingPreview.batch_public_id
    });
    const alphaAfterReimport = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(alpha) },
      select: { access_code_hash: true }
    });
    assert(existingCommit.one_time_credentials.length === 0, "Existing re-import should not reset code.");
    assert(alphaAfterReimport.access_code_hash === hashBeforeReimport, "Existing code hash should remain unchanged.");

    const displayChangePreview = await previewRosterImport({
      teacher_user_db_id: teacher.id,
      data: {
        source_file_name: sourceFileName,
        csv_text: csv([`${alpha},Alpha Updated`])
      }
    });
    assert(displayChangePreview.display_name_change_rows === 1, "Display-name change should be detected.");
    await commitRosterImport({
      teacher_user_db_id: teacher.id,
      batch_public_id: displayChangePreview.batch_public_id
    });
    const alphaNoChange = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(alpha) },
      select: { display_name: true }
    });
    assert(alphaNoChange.display_name === "Alpha Student", "Display name should not update without approval.");

    const approvedDisplayChangePreview = await previewRosterImport({
      teacher_user_db_id: teacher.id,
      data: {
        source_file_name: sourceFileName,
        csv_text: csv([`${alpha},Alpha Updated`])
      }
    });
    await commitRosterImport({
      teacher_user_db_id: teacher.id,
      batch_public_id: approvedDisplayChangePreview.batch_public_id,
      data: { apply_display_name_updates: true }
    });
    const alphaChanged = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(alpha) },
      select: { display_name: true }
    });
    assert(alphaChanged.display_name === "Alpha Updated", "Approved display-name update should apply.");

    const missingUser = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId(missing) },
      select: { account_status: true }
    });
    assert(missingUser.account_status === "active", "Missing roster rows must not be deactivated.");

    const importHistory = await prisma.rosterImportBatch.findMany({
      where: { source_file_name: sourceFileName }
    });
    assertNoPlaintext(importHistory, codes);
    assert(canAccessStudentAccountManagement("teacher_researcher"), "Teacher should manage student accounts.");
    assert(!canAccessStudentAccountManagement("student"), "Student should not manage roster APIs.");
    assert(
      (await prisma.agentCall.count()) === beforeAgentCalls,
      "Roster import smoke must not create LLM agent calls."
    );

    console.log("Roster import smoke test passed. No LLM call was made.");
  } finally {
    await cleanup();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
