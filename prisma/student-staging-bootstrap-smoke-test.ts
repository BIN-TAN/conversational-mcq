import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import {
  bootstrapPilotDatabase,
  parseBootstrapPilotConfig
} from "./staging-bootstrap-pilot-core";

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function smokeEnv(prefix: string) {
  return {
    BOOTSTRAP_ENABLED: "true",
    BOOTSTRAP_TEACHER_USERNAME: `${prefix}_teacher`,
    BOOTSTRAP_TEACHER_PASSWORD: `${prefix}_teacher_password_not_printed`,
    BOOTSTRAP_CLASSROOM_ID: prefix,
    BOOTSTRAP_CLASSROOM_NAME: "Staging Bootstrap Smoke",
    BOOTSTRAP_STUDENT_COUNT: "3",
    BOOTSTRAP_DEFAULT_ASSESSMENT_ID: "assessment_mvp_irt_theta_invariance"
  };
}

async function cleanup(prefix: string) {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { user_id: `${prefix}_teacher` },
        { user_id: { startsWith: `${prefix}_student_` } }
      ]
    },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  if (userIds.length > 0) {
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
}

async function assertNoForbiddenSecretsTrackedOrStaged() {
  const [tracked, staged] = await Promise.all([
    execFileAsync("git", ["ls-files", ".env", ".env.local", ".data", ".data/bootstrap", ".data/bootstrap-smoke"], {
      cwd: process.cwd()
    }),
    execFileAsync("git", ["diff", "--cached", "--name-only"], { cwd: process.cwd() })
  ]);
  const trackedForbidden = tracked.stdout.split(/\r?\n/u).filter(Boolean);
  const stagedForbidden = staged.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .filter((file) => file === ".env" || file === ".env.local" || file.startsWith(".data/"));

  assert(trackedForbidden.length === 0, "Local env or .data paths must not be tracked.");
  assert(stagedForbidden.length === 0, "Local env or generated .data paths must not be staged.");
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";

  await assertNoForbiddenSecretsTrackedOrStaged();
  await ensureDemoStudentAssessment(prisma);

  const prefix = `staging_bootstrap_smoke_${Date.now().toString(36)}`;
  const outputDir = path.join(process.cwd(), ".data", "bootstrap-smoke", prefix);
  await cleanup(prefix);

  try {
    const config = parseBootstrapPilotConfig(smokeEnv(prefix), { outputDir });
    const first = await bootstrapPilotDatabase(prisma, config);
    assert(first.teacher.created, "First bootstrap run should create the smoke teacher.");
    assert(first.students.created_count === 3, "First bootstrap run should create three students.");
    assert(first.students.existing_count === 0, "First bootstrap run should not report existing students.");
    assert(first.students.access_codes_printed === false, "Bootstrap must not print access codes.");
    assert(first.students.access_codes_output_path?.startsWith(outputDir), "Credentials should be written under ignored .data.");
    assert(first.assessment.assessment_public_id === "assessment_mvp_irt_theta_invariance", "Fixed IRT MVP assessment should be selected.");
    assert(first.assessment.status === "published", "Fixed IRT MVP assessment should be published.");
    assert(first.assessment.initial_item_count === 3, "Fixed IRT MVP initial package should include three items.");
    assert(first.assessment.transfer_item_count === 1, "Fixed IRT MVP should include one transfer item outside initial package.");

    const second = await bootstrapPilotDatabase(prisma, config);
    assert(second.teacher.existing, "Second bootstrap run should reuse the teacher.");
    assert(second.students.created_count === 0, "Second bootstrap run should not duplicate students.");
    assert(second.students.existing_count === 3, "Second bootstrap run should reuse all students.");
    assert(second.students.access_codes_output_path === null, "Second bootstrap run should not regenerate access codes.");

    const createdUsers = await prisma.user.findMany({
      where: {
        OR: [
          { user_id: `${prefix}_teacher` },
          { user_id: { startsWith: `${prefix}_student_` } }
        ]
      },
      select: { user_id: true, role: true, password_hash: true, access_code_hash: true, must_change_password: true }
    });
    assert(createdUsers.length === 4, "Smoke bootstrap should create exactly one teacher and three students.");
    assert(
      createdUsers.every((user) => user.password_hash !== `${prefix}_teacher_password_not_printed`),
      "Teacher password must not be stored in plaintext."
    );
    assert(
      createdUsers.every((user) => !user.access_code_hash?.includes("temporary_access_code")),
      "Access codes must not be stored in plaintext."
    );
    assert(
      createdUsers
        .filter((user) => user.role === "student")
        .every((user) => user.must_change_password),
      "Bootstrap-created students must be required to change temporary passwords."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          first_run_created_students: first.students.created_count,
          second_run_created_students: second.students.created_count,
          assessment_public_id: first.assessment.assessment_public_id,
          access_codes_printed: false,
          credential_file_written_under_ignored_data: true,
          forbidden_secret_paths_tracked_or_staged: false,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(prefix);
    await rm(outputDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "unknown_error",
        no_openai_call_occurred: true,
        raw_secret_values_printed: false
      },
      null,
      2
    )
  );
  process.exit(1);
});
