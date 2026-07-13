import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { createSessionToken, getUserForSessionToken, toPublicUser } from "../src/lib/auth";
import { hashAccountSecurityToken } from "../src/lib/services/account-security/tokens";
import { generatePublicId } from "../src/lib/services/ids";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  accountSecuritySmokePrefix,
  assert,
  createSmokeStudent,
  createSmokeTeacher
} from "./account-security-smoke-helpers";
import {
  bootstrapPilotDatabase,
  parseBootstrapPilotConfig
} from "./staging-bootstrap-pilot-core";

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);

async function runOperator(env: Record<string, string | undefined>) {
  return execFileAsync("npm", ["run", "operator:update-teacher-account"], {
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

async function expectBootstrapRenameConflict(prefix: string, oldUsername: string) {
  const config = parseBootstrapPilotConfig(
    {
      BOOTSTRAP_ENABLED: "true",
      BOOTSTRAP_TEACHER_USERNAME: oldUsername,
      BOOTSTRAP_TEACHER_PASSWORD: "operator_update_smoke_bootstrap_password_not_printed",
      BOOTSTRAP_CLASSROOM_ID: `${prefix}bootstrap_classroom`,
      BOOTSTRAP_CLASSROOM_NAME: "Operator Update Bootstrap Conflict",
      BOOTSTRAP_STUDENT_COUNT: "1",
      BOOTSTRAP_DEFAULT_ASSESSMENT_ID: "assessment_mvp_irt_theta_invariance"
    },
    { outputDir: `${process.cwd()}/.data/operator-update-smoke-bootstrap` }
  );
  let failed = false;
  try {
    await bootstrapPilotDatabase(prisma, config);
  } catch (error) {
    failed = true;
    assert(
      error instanceof Error && error.message.includes("Bootstrap teacher username does not match"),
      "Bootstrap rerun with the old teacher username should fail closed."
    );
  }
  assert(failed, "Bootstrap should not create a second teacher after a username rename.");
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
      title: "Operator account update smoke assessment",
      diagnostic_focus: "Synthetic operator account update fixture.",
      status: "published",
      created_by_user_db_id: input.teacherId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: `${input.prefix}concept`,
      assessment_db_id: assessment.id,
      title: "Operator smoke concept",
      learning_objective: "Verify account update preserves linked assessment data.",
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

  return { assessment, conceptUnit, item, session, conceptUnitSession };
}

async function integrityCounts(input: {
  teacherId: string;
  studentId: string;
  assessmentId: string;
  conceptUnitId: string;
  itemId: string;
}) {
  return {
    owned_assessments: await prisma.assessment.count({ where: { created_by_user_db_id: input.teacherId } }),
    managed_students: await prisma.user.count({ where: { created_by_teacher_user_id: input.teacherId } }),
    student_sessions: await prisma.assessmentSession.count({ where: { user_db_id: input.studentId } }),
    assessment_items: await prisma.item.count({ where: { concept_unit_db_id: input.conceptUnitId } }),
    response_records: await prisma.itemResponse.count({ where: { item_db_id: input.itemId } })
  };
}

async function createActiveSecurityToken(input: { teacherId: string; purpose: "teacher_password_reset" | "teacher_email_change_verification"; suffix: string }) {
  return prisma.accountSecurityToken.create({
    data: {
      token_public_id: generatePublicId("account_security_token"),
      user_db_id: input.teacherId,
      purpose: input.purpose,
      token_hash: hashAccountSecurityToken(`operator-update-smoke-${input.suffix}-${randomUUID()}`),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      pending_email_normalized: input.purpose === "teacher_email_change_verification" ? "pending-update-smoke@example.test" : null
    }
  });
}

async function main() {
  const prefix = accountSecuritySmokePrefix("operator_update_smoke");
  await cleanup(prefix);
  const oldUsername = `${prefix}teacher`;
  const newUsername = `${prefix}renamed_teacher`;
  const password = "OperatorTeacherPassword!31z";
  const rawEmail = `${prefix}teacher@example.test`;

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
  const duplicateEmail = await createSmokeTeacher({
    prisma,
    userId: `${prefix}duplicate_email`,
    password,
    email: `${prefix}duplicate@example.test`,
    verified: true
  });
  const fixture = await createIntegrityFixture({
    prefix,
    teacherId: teacher.id,
    studentId: student.id
  });
  const resetToken = await createActiveSecurityToken({
    teacherId: teacher.id,
    purpose: "teacher_password_reset",
    suffix: "reset"
  });
  const emailToken = await createActiveSecurityToken({
    teacherId: teacher.id,
    purpose: "teacher_email_change_verification",
    suffix: "email"
  });
  const before = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
  const beforeCounts = await integrityCounts({
    teacherId: teacher.id,
    studentId: student.id,
    assessmentId: fixture.assessment.id,
    conceptUnitId: fixture.conceptUnit.id,
    itemId: fixture.item.id
  });
  const sessionToken = createSessionToken(toPublicUser(before));

  try {
    await expectOperatorFailure(
      {
        TEACHER_ACCOUNT_UPDATE_ENABLED: "false",
        CURRENT_TEACHER_USERNAME: oldUsername,
        NEW_TEACHER_USERNAME: newUsername,
        CONFIRM_TEACHER_ACCOUNT_UPDATE: "UPDATE_TEACHER_ACCOUNT"
      },
      "update_not_enabled"
    );
    await expectOperatorFailure(
      {
        TEACHER_ACCOUNT_UPDATE_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: oldUsername,
        NEW_TEACHER_USERNAME: newUsername,
        CONFIRM_TEACHER_ACCOUNT_UPDATE: "WRONG"
      },
      "confirmation_required"
    );
    await expectOperatorFailure(
      {
        TEACHER_ACCOUNT_UPDATE_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: `${prefix}missing_teacher`,
        NEW_TEACHER_USERNAME: `${prefix}missing_teacher_new`,
        CONFIRM_TEACHER_ACCOUNT_UPDATE: "UPDATE_TEACHER_ACCOUNT"
      },
      "teacher_not_found"
    );
    await expectOperatorFailure(
      {
        TEACHER_ACCOUNT_UPDATE_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: student.user_id,
        NEW_TEACHER_USERNAME: `${prefix}student_target`,
        CONFIRM_TEACHER_ACCOUNT_UPDATE: "UPDATE_TEACHER_ACCOUNT"
      },
      "not_teacher_account"
    );
    await expectOperatorFailure(
      {
        TEACHER_ACCOUNT_UPDATE_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: oldUsername,
        NEW_TEACHER_USERNAME: duplicateUsername.user_id,
        CONFIRM_TEACHER_ACCOUNT_UPDATE: "UPDATE_TEACHER_ACCOUNT"
      },
      "username_unavailable"
    );
    await expectOperatorFailure(
      {
        TEACHER_ACCOUNT_UPDATE_ENABLED: "true",
        CURRENT_TEACHER_USERNAME: oldUsername,
        NEW_TEACHER_USERNAME: newUsername,
        NEW_TEACHER_EMAIL: duplicateEmail.email ?? "",
        TEACHER_EMAIL_MARK_VERIFIED: "true",
        CONFIRM_TEACHER_ACCOUNT_UPDATE: "UPDATE_TEACHER_ACCOUNT"
      },
      "email_unavailable"
    );

    const updatedResult = await runOperator({
      TEACHER_ACCOUNT_UPDATE_ENABLED: "true",
      CURRENT_TEACHER_USERNAME: oldUsername,
      NEW_TEACHER_USERNAME: newUsername,
      NEW_TEACHER_EMAIL: rawEmail,
      TEACHER_EMAIL_MARK_VERIFIED: "true",
      CONFIRM_TEACHER_ACCOUNT_UPDATE: "UPDATE_TEACHER_ACCOUNT"
    });
    assert(updatedResult.stdout.includes('"status": "updated"'), "Operator should update the existing teacher row.");
    assert(updatedResult.stdout.includes('"masked_email"'), "Operator output should include masked email.");
    assert(updatedResult.stdout.includes('"session_invalidation": "auth_version_incremented"'), "Operator output should report session invalidation.");
    assert(updatedResult.stdout.includes('"tokens_invalidated_count": 2'), "Operator output should report invalidated tokens.");
    assert(!updatedResult.stdout.includes(rawEmail), "Operator stdout must not print the raw email.");
    assert(!updatedResult.stderr.includes(rawEmail), "Operator stderr must not print the raw email.");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    assert(after.id === before.id, "Teacher database ID should be unchanged.");
    assert(after.user_id === newUsername, "Teacher username should be updated.");
    assert(after.user_id_normalized === normalizeUserId(newUsername), "Teacher normalized username should be updated.");
    assert(after.email === rawEmail, "Teacher recovery email should be persisted.");
    assert(after.email_normalized === rawEmail.toLocaleLowerCase("en-US"), "Teacher normalized email should be persisted.");
    assert(after.email_verified_at, "Teacher recovery email should be marked verified.");
    assert(after.password_hash === before.password_hash, "Teacher password hash should be unchanged.");
    assert(after.role === before.role, "Teacher role should be unchanged.");
    assert(after.auth_version === before.auth_version + 1, "Real update should increment auth_version.");
    assert(!(await prisma.user.findUnique({ where: { user_id_normalized: normalizeUserId(oldUsername) } })), "Old username should no longer identify a user.");
    assert(await getUserForSessionToken(sessionToken) === null, "Old teacher session token should be invalidated.");

    const invalidatedReset = await prisma.accountSecurityToken.findUniqueOrThrow({ where: { id: resetToken.id } });
    const invalidatedEmail = await prisma.accountSecurityToken.findUniqueOrThrow({ where: { id: emailToken.id } });
    assert(invalidatedReset.invalidated_at, "Outstanding password-reset token should be invalidated.");
    assert(invalidatedEmail.invalidated_at, "Outstanding email-change token should be invalidated.");

    const afterCounts = await integrityCounts({
      teacherId: teacher.id,
      studentId: student.id,
      assessmentId: fixture.assessment.id,
      conceptUnitId: fixture.conceptUnit.id,
      itemId: fixture.item.id
    });
    assert(JSON.stringify(afterCounts) === JSON.stringify(beforeCounts), "Owned data counts should remain unchanged.");
    assert((await prisma.user.count({ where: { user_id: { startsWith: prefix } } })) === 4, "Update should not create a second teacher account.");

    const audit = await prisma.accountSecurityEvent.findFirst({
      where: { user_db_id: teacher.id, event_type: "teacher_account_operator_updated" },
      orderBy: { created_at: "desc" }
    });
    assert(audit?.event_public_id, "Operator update should write an account-security audit event.");

    const noOp = await runOperator({
      TEACHER_ACCOUNT_UPDATE_ENABLED: "true",
      CURRENT_TEACHER_USERNAME: oldUsername,
      NEW_TEACHER_USERNAME: newUsername,
      NEW_TEACHER_EMAIL: rawEmail,
      TEACHER_EMAIL_MARK_VERIFIED: "true",
      CONFIRM_TEACHER_ACCOUNT_UPDATE: "UPDATE_TEACHER_ACCOUNT"
    });
    assert(noOp.stdout.includes('"status": "already_configured"'), "Operator rerun should be idempotent.");
    assert(!noOp.stdout.includes(rawEmail), "Idempotent output must not print raw email.");
    const afterNoOp = await prisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    assert(afterNoOp.auth_version === after.auth_version, "No-op rerun should not increment auth_version.");
    const auditCount = await prisma.accountSecurityEvent.count({
      where: { user_db_id: teacher.id, event_type: "teacher_account_operator_updated" }
    });
    assert(auditCount === 1, "No-op rerun should not create duplicate audit events.");
    await expectBootstrapRenameConflict(prefix, oldUsername);
    assert((await prisma.user.count({ where: { user_id: { startsWith: prefix } } })) === 4, "Bootstrap rename conflict should not create another user.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          enable_flag_required: true,
          exact_confirmation_required: true,
          missing_teacher_rejected: true,
          student_account_rejected: true,
          duplicate_username_rejected: true,
          duplicate_email_rejected: true,
          existing_teacher_row_updated: true,
          no_new_user_row_created: true,
          database_id_unchanged: true,
          password_hash_unchanged: true,
          role_unchanged: true,
          assessment_ownership_unchanged: true,
          student_relationships_unchanged: true,
          sessions_and_responses_unchanged: true,
          auth_version_incremented_after_real_change: true,
          old_sessions_invalidated: true,
          account_security_tokens_invalidated: true,
          email_normalized_and_verified: true,
          no_op_rerun_idempotent: true,
          bootstrap_old_username_rejected: true,
          output_masks_email: true,
          passwords_or_secrets_printed: false,
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
