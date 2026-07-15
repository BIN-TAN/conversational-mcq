import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { generatePublicId } from "../src/lib/services/ids";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  endStudentAssessmentAttempt,
  exitStudentAssessmentSession,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  markLifecycleOperationPostCommitWarning,
  type LifecycleCommandResult
} from "../src/lib/services/student-assessment/lifecycle-operations";
import {
  LifecycleCommandResultSchema,
  StartSessionCommandResponseSchema
} from "../src/lib/student-assessment-ui/types";
import { assert, cleanupFollowupSmoke } from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const suiteName = process.argv[2] ?? "all";
const prefix = `p31al5_lifecycle_${suiteName}_${Date.now()}_${randomBytes(3).toString("hex")}`;

function setNoLiveRuntimeEnv() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
}

async function cleanup() {
  await cleanupFollowupSmoke(prisma, prefix);
}

async function createUser(role: "student" | "teacher_researcher", suffix: string) {
  const userId = `${prefix}_${suffix}`;
  return prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      role,
      account_status: "active"
    }
  });
}

async function createAssessment(teacherId: string) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: `${prefix} assessment`,
      description: "Lifecycle command-result smoke fixture.",
      status: "published",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      created_by_user_db_id: teacherId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: `${prefix} concept`,
      learning_objective: "Verify lifecycle command result delivery.",
      related_concept_description: "Synthetic concept.",
      administration_rules: {},
      order_index: 1,
      status: "published",
      version: 1
    }
  });

  for (const itemOrder of [1, 2, 3]) {
    await prisma.item.create({
      data: {
        item_public_id: generatePublicId("item"),
        concept_unit_db_id: conceptUnit.id,
        item_order: itemOrder,
        item_stem: `${prefix} item ${itemOrder}`,
        options: [
          { label: "A", text: "First option" },
          { label: "B", text: "Second option" },
          { label: "C", text: "Third option" },
          { label: "D", text: "Fourth option" }
        ],
        correct_option: "A",
        distractor_rationales: {
          B: "Synthetic distractor.",
          C: "Synthetic distractor.",
          D: "Synthetic distractor."
        },
        expected_reasoning_patterns: ["Explains the selected option."],
        possible_misconception_indicators: ["Uses unsupported evidence."],
        administration_rules: {},
        included_in_published_set: true,
        status: "published",
        version: 1
      }
    });
  }

  return assessment;
}

function requireCommandResult(value: { command_result?: LifecycleCommandResult | null }) {
  assert(value.command_result, "Expected lifecycle command_result.");
  return LifecycleCommandResultSchema.parse(value.command_result);
}

async function commandOperations(sessionPublicId: string) {
  return prisma.assessmentLifecycleOperation.findMany({
    where: {
      OR: [
        { target_session_public_id: sessionPublicId },
        { resulting_session_public_id: sessionPublicId }
      ]
    },
    orderBy: { requested_at: "asc" }
  });
}

function assertContractVariants() {
  const base = {
    result_version: "assessment-lifecycle-operation-result-v1",
    operation_public_id: "attempt_op_contract",
    command_succeeded: true,
    mutation_committed: true,
    already_satisfied: false,
    recovered: false,
    session_public_id: "sess_contract",
    attempt_number: 1,
    canonical_status: "active",
    canonical_destination: "session",
    presenter_ready: true,
    recovery_required: false,
    safe_warning: null
  };
  for (const [commandType, code] of [
    ["start_attempt", "created"],
    ["start_attempt", "already_started"],
    ["resume_attempt", "already_active"],
    ["pause_attempt", "already_paused"],
    ["end_attempt", "already_ended"],
    ["start_attempt", "committed_presenter_recovery_required"],
    ["start_attempt", "existing_resumable_attempt"],
    ["start_attempt", "policy_blocked"],
    ["resume_attempt", "incompatible_state"]
  ]) {
    LifecycleCommandResultSchema.parse({
      ...base,
      command_type: commandType,
      safe_response_code: code
    });
  }
  StartSessionCommandResponseSchema.parse({
    session: {
      session_public_id: "sess_contract",
      session_status: "active",
      current_phase: "concept_unit_intro",
      attempt_number: 1
    },
    state: null,
    command_result: {
      ...base,
      command_type: "start_attempt",
      presenter_ready: false,
      recovery_required: true,
      safe_warning: "session_presenter_construction",
      safe_response_code: "committed_presenter_recovery_required"
    }
  });
}

async function main() {
  setNoLiveRuntimeEnv();
  await cleanup();
  const openAiCallsBefore = await prisma.agentCall.count({ where: { provider: "openai" } });
  const teacher = await createUser("teacher_researcher", "teacher");
  const student = await createUser("student", "student");
  const assessment = await createAssessment(teacher.id);

  assertContractVariants();

  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id
  });
  const startResult = requireCommandResult(started);
  assert(startResult.safe_response_code === "created", "Start should return created command result.");
  assert(started.state, "Normal start should still include presenter state.");

  const duplicateStart = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id,
    new_attempt: true
  });
  const duplicateStartResult = requireCommandResult(duplicateStart);
  assert(
    duplicateStart.session.session_public_id === started.session.session_public_id,
    "Duplicate start should return existing session."
  );
  assert(
    duplicateStartResult.safe_response_code === "existing_resumable_attempt",
    "Duplicate start should be a committed existing-resumable result."
  );

  const paused = await exitStudentAssessmentSession({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id
  });
  assert(paused.command_result?.safe_response_code === "paused", "Pause should return command result.");
  const pausedAgain = await exitStudentAssessmentSession({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id
  });
  assert(
    pausedAgain.command_result?.safe_response_code === "already_paused",
    "Repeated pause should return already_paused."
  );

  const resumed = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id
  });
  assert(
    resumed.command_result?.safe_response_code === "resumed",
    "Resume from paused should return resumed result."
  );
  const activeResume = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id
  });
  assert(
    activeResume.command_result?.safe_response_code === "already_active",
    "Resume on active should return already_active."
  );

  const ended = await endStudentAssessmentAttempt({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id
  });
  assert(
    ended.command_result?.safe_response_code === "ended_by_student",
    "End should return ended_by_student command result."
  );
  const endedAgain = await endStudentAssessmentAttempt({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id
  });
  assert(
    endedAgain.command_result?.safe_response_code === "already_ended",
    "Repeated end should return already_ended."
  );

  const operations = await commandOperations(started.session.session_public_id);
  assert(operations.length >= 7, "Lifecycle operation ledger should contain command outcomes.");
  assert(
    operations.every((operation) => operation.safe_response_code !== "failed"),
    "Committed lifecycle operations must not be recorded as failed."
  );
  for (const commandType of ["start_attempt", "resume_attempt", "pause_attempt", "end_attempt"]) {
    const committedOperation = operations.find(
      (operation) => operation.command_type === commandType && operation.mutation_committed
    );
    assert(committedOperation, `Expected committed ${commandType} operation.`);
    const warned = await markLifecycleOperationPostCommitWarning({
      prisma,
      operation_public_id: committedOperation.operation_public_id,
      result: LifecycleCommandResultSchema.parse(committedOperation.response_payload),
      safe_failure_stage: "session_presenter_construction",
      safe_failure_code: `simulated_${commandType}_presenter_failure`
    });
    assert(
      warned.safe_response_code === "committed_presenter_recovery_required",
      `${commandType} post-commit warning should not become a conflict.`
    );
    const warnedRecord = await prisma.assessmentLifecycleOperation.findUniqueOrThrow({
      where: { operation_public_id: committedOperation.operation_public_id }
    });
    assert(
      warnedRecord.mutation_committed === true &&
        warnedRecord.safe_response_code === "committed_presenter_recovery_required",
      `Ledger should preserve committed ${commandType} mutation while recording post-commit warning.`
    );
  }

  const openAiCallsAfter = await prisma.agentCall.count({ where: { provider: "openai" } });
  assert(openAiCallsAfter === openAiCallsBefore, "Lifecycle command-result smoke must not call OpenAI.");

  console.log(JSON.stringify({
    status: "passed",
    suite: suiteName,
    session_public_id: started.session.session_public_id,
    operation_count: operations.length,
    no_openai_call_made: true
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
