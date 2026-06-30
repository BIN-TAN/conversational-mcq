import { PrismaClient } from "@prisma/client";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  itemRole
} from "./student-mvp-smoke-helpers";
import {
  demoAssessmentPublicId,
  demoItemPublicIds,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  listAvailableAssessments,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
import { resetStudentDemoFixedMvpAttempt } from "./demo-reset-student-mvp-helper";

const prisma = new PrismaClient();

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "false";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);

  const student = await prisma.user.findUniqueOrThrow({
    where: { user_id: "student_demo" },
    select: { id: true, user_id: true, role: true, account_status: true }
  });
  assert(student.role === "student", "student_demo must be a student account.");
  assert(student.account_status === "active", "student_demo must be active.");

  await resetStudentDemoFixedMvpAttempt(prisma);

  process.env.ITEM_ADMIN_TUTOR_MODE = "auto";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "false";
  const priorLifecycleEvent = process.env.npm_lifecycle_event;
  process.env.npm_lifecycle_event = "";
  const unavailable = await listAvailableAssessments({ student_user_db_id: student.id });
  const unavailableFixedRow = unavailable.assessments.find(
    (assessment) => assessment.assessment_public_id === demoAssessmentPublicId
  );
  assert(unavailableFixedRow, "Fixed IRT MVP row should remain visible when tutor runtime is blocked.");
  assert(unavailableFixedRow.can_start === false, "Fixed IRT MVP start should be blocked without tutor runtime readiness.");
  assert(
    unavailableFixedRow.student_safe_availability_message ===
      "This assessment is temporarily unavailable. Please try again later.",
    "Blocked tutor runtime should show only the neutral temporary-unavailable message."
  );
  if (priorLifecycleEvent === undefined) {
    delete process.env.npm_lifecycle_event;
  } else {
    process.env.npm_lifecycle_event = priorLifecycleEvent;
  }
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";

  const fixedAssessment = await prisma.assessment.findUniqueOrThrow({
    where: { assessment_public_id: demoAssessmentPublicId },
    include: {
      concept_units: {
        include: {
          items: { orderBy: [{ item_order: "asc" }, { created_at: "asc" }] }
        }
      }
    }
  });
  assert(fixedAssessment.workflow_mode === "automatic", "Fixed MVP assessment should use automatic workflow.");
  assert(fixedAssessment.status === "published", "Fixed MVP assessment should be published.");

  const conceptUnit = fixedAssessment.concept_units[0];
  assert(conceptUnit?.status === "published", "Fixed MVP concept unit should be published.");
  const initialItems = conceptUnit.items.filter((item) => item.included_in_published_set);
  const transferItems = conceptUnit.items.filter(
    (item) => itemRole(item.administration_rules) === "transfer"
  );
  assert(initialItems.length === 3, "Fixed MVP initial package should include exactly three items.");
  assert(transferItems.length === 1, "Fixed MVP should keep exactly one transfer item.");
  assert(
    transferItems[0]?.item_public_id === demoItemPublicIds[3] &&
      transferItems[0].included_in_published_set === false,
    "Transfer item should remain excluded from the initial package."
  );

  const available = await listAvailableAssessments({ student_user_db_id: student.id });
  assertStudentPayloadIsSafe(available);
  assertStudentVisibleTextIsSafe(available);

  const fixedRow = available.assessments.find(
    (assessment) => assessment.assessment_public_id === demoAssessmentPublicId
  );
  assert(fixedRow, "student_demo should see the fixed IRT MVP assessment on the dashboard.");
  assert(fixedRow.can_start === true, "Fixed IRT MVP start button should be enabled for student_demo.");
  assert(fixedRow.can_resume === false, "Fixed IRT MVP should not require resume before the smoke start.");
  assert(
    fixedRow.student_safe_availability_message === "This assessment is available.",
    `Unexpected fixed MVP availability message: ${fixedRow.student_safe_availability_message}`
  );

  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: demoAssessmentPublicId
  });
  assertStudentPayloadIsSafe(started);
  assertStudentVisibleTextIsSafe(started);
  assert(started.session.session_public_id, "Starting fixed MVP should create a public session ID.");
  assert(started.state.next_step === "concept_unit_intro", "Started fixed MVP should enter concept intro.");
  assert(
    started.state.current_concept_unit?.concept_unit_public_id === conceptUnit.concept_unit_public_id,
    "Started fixed MVP should open the published IRT concept unit."
  );

  const storedSession = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: started.session.session_public_id },
    select: { workflow_mode_snapshot: true, response_collection_mode_snapshot: true }
  });
  assert(
    storedSession.workflow_mode_snapshot === "automatic",
    "Started fixed MVP session should snapshot automatic workflow."
  );

  const initialState = await startConceptUnitInitialAdministration({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: conceptUnit.concept_unit_public_id
  });
  assertStudentPayloadIsSafe(initialState);
  assertStudentVisibleTextIsSafe(initialState);
  assert(initialState.next_step === "present_item", "Initial administration should present the first item.");
  const presentedItemPublicId = initialState.current_item?.item_public_id;
  assert(
    presentedItemPublicId === demoItemPublicIds[0],
    "Initial administration should start with the first fixed MVP included item."
  );
  assert(
    !transferItems.some((item) => item.item_public_id === presentedItemPublicId),
    "Transfer item must not be shown during the initial package."
  );

  await resetStudentDemoFixedMvpAttempt(prisma);

  console.log(
    "Student dashboard availability smoke test passed. student_demo can start the fixed IRT MVP assessment, and no OpenAI calls were made."
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
