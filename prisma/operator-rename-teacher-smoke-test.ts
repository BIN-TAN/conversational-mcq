import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { createSessionToken, getUserForSessionToken, toPublicUser } from "../src/lib/auth";
import { verifySecret } from "../src/lib/password";
import { hashAccountSecurityToken } from "../src/lib/services/account-security/tokens";
import { generatePublicId } from "../src/lib/services/ids";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  accountSecuritySmokePrefix,
  assert,
  createSmokeStudent,
  createSmokeTeacher
} from "./account-security-smoke-helpers";

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);

async function runOperator(env: Record<string, string | undefined>) {
  return execFileAsync("npm", ["run", "operator:rename-teacher"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false"
    },
    maxBuffer: 1024 * 1024
  });
}

async function expectOperatorFailure(env: Record<string, string | undefined>, expected: string) {
  let failed = false;
  try {
    await runOperator(env);
  } catch (error) {
    failed = true;
    const output = `${(error as { stdout?: string }).stdout ?? ""}\n${(error as { stderr?: string }).stderr ?? ""}`;
    assert(output.includes(expected), `Expected operator failure output to include ${expected}.`);
  }
  assert(failed, "Operator command should have failed.");
}

async function cleanup(prefix: string) {
  const assessments = await prisma.assessment.findMany({
    where: { assessment_public_id: { startsWith: prefix } },
    include: { concept_units: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const conceptUnitIds = assessments.flatMap((assessment) => assessment.concept_units.map((conceptUnit) => conceptUnit.id));
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

  await prisma.processEvent.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.conversationTurn.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.itemResponse.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.conceptUnitSession.deleteMany({ where: { id: { in: conceptUnitSessionIds } } });
  await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: conceptUnitIds } } });
  await prisma.conceptUnit.deleteMany({ where: { id: { in: conceptUnitIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });

  const users = await prisma.user.findMany({
    where: { user_id: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  await prisma.accountSecurityToken.deleteMany({ where: { user_db_id: { in: userIds } } });
  await prisma.accountSecurityEvent.deleteMany({
    where: {
      OR: [
        { user_db_id: { in: userIds } },
        { performed_by_user_db_id: { in: userIds } }
      ]
    }
  });
  await prisma.studentAccountEvent.deleteMany({
    where: {
      OR: [
        { student_user_db_id: { in: userIds } },
        { performed_by_user_db_id: { in: userIds } }
      ]
    }
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function createIntegrityFixture(input: { prefix: string; teacherId: string; studentId: string }) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: `${input.prefix}assessment`,
      title: "Operator rename smoke assessment",
      diagnostic_focus: "Synthetic operator rename fixture.",
      status: "published",
      created_by_user_db_id: input.teacherId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: `${input.prefix}concept`,
      assessment_db_id: assessment.id,
      title: "Operator rename concept",
      learning_objective: "Verify rename preserves linked assessment data.",
      related_concept_description: "Synthetic fixture.",
      order_index: 1,
      status: "published"
    }
  });
  const item = await prisma.item.create({
    data: {
      item_public_id: `${input.prefix}item`,
      concept_unit_db_id: conceptUnit.id,
      item_order: 1,
      item_stem: "Synthetic item stem",
      options: [
        { label: "A", text: "Option A" },
        { label: "B", text: "Option B" }
      ],
      correct_option: "A",
      status: "published"
    }
  });
  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: `${input.prefix}session`,
      user_db_id: input.studentId,
      assessment_db_id: assessment.id,
      status: "active",
      current_phase: "initial_item_administration",
      current_concept_unit_db_id: conceptUnit.id
    }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: "initial_completed"
    }
  });
  await prisma.itemResponse.create({
    data: {
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      selected_option: "B",
      correct_option_snapshot: "A",
      correctness: "incorrect",
      reasoning_text: "Synthetic reasoning.",
      confidence_rating: "medium",
      item_version_snapshot: item.version,
      item_snapshot: {
        item_public_id: item.item_public_id,
        item_stem: item.item_stem,
        options: item.options
      }
    }
  });
  await prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      phase: "initial_item_administration",
      actor_type: "student",
      message_text: "Synthetic student turn"
    }
  });
  await prisma.processEvent.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      event_type: "operator_rename_smoke_event",
      event_category: "smoke",
      event_source: "backend",
      occurred_at: new Date()
    }
  });

  return { assessment, conceptUnit, item, session };
}

async function integrityCounts(input: { teacherId: string; studentId: string; itemId: string; sessionId: string }) {
  return {
    owned_assessments: await prisma.assessment.count({ where: { created_by_user_db_id: input.teacherId } }),
    managed_students: await prisma.user.count({ where: { created_by_teacher_user_id: input.teacherId } }),
    student_sessions: await prisma.assessmentSession.count({ where: { user_db_id: input.studentId } }),
    response_records: await prisma.itemResponse.count({ where: { item_db_id: input.itemId } }),
    process_events: await prisma.processEvent.count({ where: { assessment_session_db_id: input.sessionId } }),
    conversation_turns: await prisma.conversationTurn.count({ where: { assessment_session_db_id: input.sessionId } })
  };
}

async function createActiveSecurityToken(input: { teacherId: string; suffix: string }) {
  return prisma.accountSecurityToken.create({
    data: {
      token_public_id: generatePublicId("account_security_token"),
      user_db_id: input.teacherId,
      purpose: "teacher_password_reset",
      token_hash: hashAccountSecurityToken(`operator-rename-smoke-${input.suffix}-${randomUUID()}`),
      expires_at: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
}

async function assertUsernameAuthenticates(userId: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { user_id_normalized: normalizeUserId(userId) },
    select: { password_hash: true, role: true, account_status: true, must_change_password: true }
  });
  assert(user, `Expected ${userId} to exist.`);
  assert(user.role === "teacher_researcher", "Renamed user should remain teacher/researcher.");
  assert(user.account_status === "active", "Renamed teacher account should remain active.");
  assert(!user.must_change_password, "Teacher rename must not trigger first-login password change.");
  assert(await verifySecret(password, user.password_hash), "Original teacher password should still authenticate.");
}

async function main() {
  const prefix = accountSecuritySmokePrefix("operator_rename_smoke");
  await cleanup(prefix);
  const oldUsername = `${prefix}teacher`;
  const newUsername = `${prefix}edpy507_instructor`;
  const password = "OperatorTeacherPassword!31z";

  const teacher = await createSmokeTeacher({ prisma, userId: oldUsername, password });
  const student = await createSmokeStudent({
    prisma,
    userId: `${prefix}student`,
    password: "OperatorStudentPassword!31z",
    teacher
  });
  const duplicateUsername = await createSmokeTeacher({
    prisma,
    userId: `${prefix}duplicate_username`,
    password
  });
  const fixture = await createIntegrityFixture({
    prefix,
    teacherId: teacher.id,
    studentId: student.id
  });
  const resetToken = await createActiveSecurityToken({ teacherId: teacher.id, suffix: "reset" });
  const before = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
  const beforePasswordHash = before.password_hash;
  assert(beforePasswordHash, "Smoke teacher should have a password hash.");
  const beforeCounts = await integrityCounts({
    teacherId: teacher.id,
    studentId: student.id,
    itemId: fixture.item.id,
    sessionId: fixture.session.id
  });
  const sessionToken = createSessionToken(toPublicUser(before));

  try {
    await expectOperatorFailure(
      {
        TEACHER_USERNAME_RENAME_ENABLED: "false",
        CURRENT_TEACHER_USERNAME: oldUsername,
        NEW_TEACHER_USERNAME: newUsername,
        CONFIRM_TEACHER_USERNAME_RENAME: "RENAME_TEACHER"
      },
      "rename_not_enabled"
    );
    await expectOperatorFailure(
      {
        TEACHER_USERNAME_RENAME_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: oldUsername,
        NEW_TEACHER_USERNAME: newUsername,
        CONFIRM_TEACHER_USERNAME_RENAME: "WRONG"
      },
      "confirmation_required"
    );
    await expectOperatorFailure(
      {
        TEACHER_USERNAME_RENAME_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: `${prefix}missing_teacher`,
        NEW_TEACHER_USERNAME: `${prefix}missing_teacher_new`,
        CONFIRM_TEACHER_USERNAME_RENAME: "RENAME_TEACHER"
      },
      "teacher_not_found"
    );
    await expectOperatorFailure(
      {
        TEACHER_USERNAME_RENAME_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: student.user_id,
        NEW_TEACHER_USERNAME: `${prefix}student_target`,
        CONFIRM_TEACHER_USERNAME_RENAME: "RENAME_TEACHER"
      },
      "not_teacher_account"
    );
    await expectOperatorFailure(
      {
        TEACHER_USERNAME_RENAME_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: oldUsername,
        NEW_TEACHER_USERNAME: "bad username with spaces",
        CONFIRM_TEACHER_USERNAME_RENAME: "RENAME_TEACHER"
      },
      "invalid_username"
    );
    await expectOperatorFailure(
      {
        TEACHER_USERNAME_RENAME_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: oldUsername,
        NEW_TEACHER_USERNAME: duplicateUsername.user_id,
        CONFIRM_TEACHER_USERNAME_RENAME: "RENAME_TEACHER"
      },
      "username_unavailable"
    );

    const renamedResult = await runOperator({
      TEACHER_USERNAME_RENAME_ENABLED: "true",
      CURRENT_TEACHER_USERNAME: oldUsername,
      NEW_TEACHER_USERNAME: newUsername,
      CONFIRM_TEACHER_USERNAME_RENAME: "RENAME_TEACHER"
    });
    assert(renamedResult.stdout.includes('"status": "updated"'), "Operator should rename the existing teacher row.");
    assert(renamedResult.stdout.includes('"session_invalidation": "auth_version_incremented"'), "Operator should report session invalidation.");
    assert(renamedResult.stdout.includes('"account_security_tokens_invalidated_count": 1'), "Operator should report token invalidation.");
    assert(!renamedResult.stdout.includes(beforePasswordHash), "Operator stdout must not print password hash.");
    assert(!renamedResult.stderr.includes(beforePasswordHash), "Operator stderr must not print password hash.");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    assert(after.id === before.id, "Teacher database ID should be unchanged.");
    assert(after.user_id === newUsername, "Teacher username should be updated.");
    assert(after.user_id_normalized === normalizeUserId(newUsername), "Teacher normalized username should be updated.");
    assert(after.password_hash === beforePasswordHash, "Teacher password hash should be unchanged.");
    assert(after.role === before.role, "Teacher role should be unchanged.");
    assert(after.account_status === before.account_status, "Teacher account status should be unchanged.");
    assert(after.auth_version === before.auth_version + 1, "Real rename should increment auth_version once.");
    assert(!(await prisma.user.findUnique({ where: { user_id_normalized: normalizeUserId(oldUsername) } })), "Old username should no longer identify a user.");
    assert(await getUserForSessionToken(sessionToken) === null, "Old teacher session token should be invalidated.");
    assert((await prisma.accountSecurityToken.findUniqueOrThrow({ where: { id: resetToken.id } })).invalidated_at, "Outstanding token should be invalidated.");
    await assertUsernameAuthenticates(newUsername, password);

    const afterCounts = await integrityCounts({
      teacherId: teacher.id,
      studentId: student.id,
      itemId: fixture.item.id,
      sessionId: fixture.session.id
    });
    assert(JSON.stringify(afterCounts) === JSON.stringify(beforeCounts), "Owned data counts should remain unchanged.");
    assert((await prisma.user.count({ where: { user_id: { startsWith: prefix } } })) === 3, "Rename should not create a second teacher account.");

    const auditCount = await prisma.accountSecurityEvent.count({
      where: { user_db_id: teacher.id, event_type: "teacher_username_operator_renamed" }
    });
    assert(auditCount === 1, "Rename should write one account-security audit event.");

    const noOp = await runOperator({
      TEACHER_USERNAME_RENAME_ENABLED: "true",
      CURRENT_TEACHER_USERNAME: oldUsername,
      NEW_TEACHER_USERNAME: newUsername,
      CONFIRM_TEACHER_USERNAME_RENAME: "RENAME_TEACHER"
    });
    assert(noOp.stdout.includes('"status": "already_configured"'), "Operator rerun should be idempotent.");
    const afterNoOp = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    assert(afterNoOp.auth_version === after.auth_version, "No-op rerun should not increment auth_version.");
    assert(
      (await prisma.accountSecurityEvent.count({
        where: { user_db_id: teacher.id, event_type: "teacher_username_operator_renamed" }
      })) === 1,
      "No-op rerun should not create duplicate audit events."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          enable_flag_required: true,
          exact_confirmation_required: true,
          missing_teacher_rejected: true,
          student_account_rejected: true,
          invalid_username_rejected: true,
          duplicate_username_rejected: true,
          existing_teacher_row_renamed: true,
          no_new_user_row_created: true,
          database_id_unchanged: true,
          password_hash_unchanged: true,
          role_unchanged: true,
          account_status_unchanged: true,
          assessment_ownership_unchanged: true,
          student_relationships_unchanged: true,
          sessions_responses_and_process_data_unchanged: true,
          auth_version_incremented_once: true,
          old_sessions_invalidated: true,
          account_security_tokens_invalidated: true,
          old_username_removed: true,
          new_username_authenticates_with_original_password: true,
          no_op_rerun_idempotent: true,
          passwords_or_hashes_printed: false,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(prefix);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "unknown_error",
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
  process.exit(1);
});
