import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  buildProfileIntegrationInterpretationPacketForSession,
  validateProfileIntegrationOutput,
  writeProfileIntegrationReviewArtifact
} from "../src/lib/services/student-assessment/profile-integration";
import { applyProvisionalItemDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { logProcessEvent } from "../src/lib/services/process-events";
import {
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

function configureNoLiveReviewRuntime() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
}

function getArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? null;

  return null;
}

async function addSyntheticProcessContext(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });
  const responses = await prisma.itemResponse.findMany({
    where: { concept_unit_session_db_id: conceptUnitSession.id },
    orderBy: [{ item: { item_order: "asc" } }],
    select: { item_db_id: true }
  });

  for (const [index, response] of responses.entries()) {
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: response.item_db_id,
      event_type: index === 1 ? "paste_detected" : "typing_activity_summary",
      event_category: "student_process",
      event_source: "frontend",
      payload:
        index === 1
          ? {
              target_kind: "textarea",
              pasted_text_length_band: "21_100",
              clipboard_type_count: 1,
              includes_plain_text: true
            }
          : {
              key_count: 40 + index,
              backspace_count: index,
              enter_key_count: 1,
              duration_ms: 30_000
            }
    });
  }
}

async function createSampleSession() {
  configureNoLiveReviewRuntime();
  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const prefix = `profile_integration_review_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];
  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: demoAssessmentPublicId
  });
  sessionPublicIds.push(started.session.session_public_id);

  let state = await startConceptUnitInitialAdministration({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
  });

  for (const itemIndex of [1, 2, 3]) {
    state = await completeInitialItem({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex,
      withTemptingReason: itemIndex === 2
    });
  }

  assert(state.assessment_state === "PACKAGE_REVIEW", "Sample session did not reach package review.");
  await addSyntheticProcessContext(started.session.session_public_id);

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: started.session.session_public_id },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });

  await createResponsePackage({ concept_unit_session_db_id: conceptUnitSession.id });

  return {
    session_public_id: started.session.session_public_id,
    cleanup: () =>
      cleanupSmokeStudentSessions({
        prisma,
        userDbId: student.id,
        sessionPublicIds
      })
  };
}

async function main() {
  configureNoLiveReviewRuntime();
  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const requestedSessionPublicId = getArg("session-public-id");
  const sample = requestedSessionPublicId ? null : await createSampleSession();
  const sessionPublicId = requestedSessionPublicId ?? sample?.session_public_id;

  assert(sessionPublicId, "A session public ID could not be determined.");

  try {
    const packet = await buildProfileIntegrationInterpretationPacketForSession(sessionPublicId);
    const validation = validateProfileIntegrationOutput(packet);

    if (!validation.valid) {
      throw new Error(
        `Profile integration validation failed: ${validation.issues
          .map((issue) => `${issue.field_path}:${issue.rule_code}`)
          .join(", ")}`
      );
    }

    const artifactPath = await writeProfileIntegrationReviewArtifact({ packet });
    const summary = {
      status: packet.output_status === "ok" ? "passed" : "completed_with_limitations",
      session_public_id: packet.session_public_id,
      internal_integrated_status: packet.internal_integrated_status,
      student_facing_status: packet.student_facing_status,
      integration_pattern: packet.integration_pattern,
      status_confidence: packet.status_confidence,
      engagement_category: packet.engagement_context.engagement_category,
      ai_assistance_signal: packet.engagement_context.ai_assistance_signal,
      engagement_effect_on_interpretation:
        packet.engagement_context.engagement_effect_on_interpretation,
      ai_assistance_effect_on_interpretation:
        packet.engagement_context.ai_assistance_effect_on_interpretation,
      redacted_profile_integration_artifact_path: artifactPath,
      safety_check_passed: validation.valid,
      limitations: packet.uncertainty_and_limitations
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (sample) {
      await sample.cleanup();
    }
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
