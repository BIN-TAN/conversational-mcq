import { PrismaClient } from "@prisma/client";
import {
  buildFormativeValueDeterminationPacketForSession,
  persistFormativeValueDeterminationSnapshot,
  presentFormativeValueChoice,
  recordStudentFormativeValueChoice,
  validateFormativeValueDeterminationOutput,
  writeFormativeValueReviewArtifact
} from "../src/lib/services/student-assessment/formative-value-determination";
import { applyProvisionalItemDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import { ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import {
  configureNoLiveFormativeValueRuntime,
  createFormativeValueSampleSession,
  getArg
} from "./student-formative-value-helpers";
import { assert } from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

async function main() {
  const liveRequested =
    process.argv.includes("--live") || process.env.RUN_LIVE_FORMATIVE_VALUE_SMOKE === "1";

  if (!liveRequested) {
    configureNoLiveFormativeValueRuntime();
  }

  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const requestedSessionPublicId = getArg("session-public-id");
  assert(
    !liveRequested || requestedSessionPublicId,
    "Live formative value review requires --session-public-id so setup remains explicit."
  );
  const sample = requestedSessionPublicId ? null : await createFormativeValueSampleSession(prisma);
  const sessionPublicId = requestedSessionPublicId ?? sample?.session_public_id;

  assert(sessionPublicId, "A session public ID could not be determined.");

  try {
    const packet = await buildFormativeValueDeterminationPacketForSession(sessionPublicId, {
      execution_mode: liveRequested ? "live_provider" : "deterministic_mock"
    });
    const validation = validateFormativeValueDeterminationOutput(packet);

    if (!validation.valid) {
      throw new Error(
        `Formative value validation failed: ${validation.issues
          .map((issue) => `${issue.field_path}:${issue.rule_code}`)
          .join(", ")}`
      );
    }

    const persistence = await persistFormativeValueDeterminationSnapshot({ packet });
    const presentation = await presentFormativeValueChoice(packet);
    const artifactPath = await writeFormativeValueReviewArtifact({ packet });
    const acceptedChoice = sample
      ? await recordStudentFormativeValueChoice({
          packet,
          choice: "accepted_recommendation"
        })
      : null;

    const summary = {
      status: "passed",
      session_public_id: packet.session_public_id,
      source_profile_integration_schema: packet.source_profile_integration_schema,
      source_profile_integration_snapshot_id: packet.source_profile_integration_snapshot_id,
      primary_value: packet.primary_value,
      primary_value_label: packet.primary_value_label,
      primary_value_confidence: packet.primary_value_confidence,
      alternative_values: packet.alternative_values.map((value) => value.value),
      student_choice_policy: packet.student_choice_policy,
      student_choice_state: acceptedChoice?.student_choice_state ?? packet.student_choice_state,
      persistence_status: persistence.status,
      presentation_status: presentation.status,
      review_artifact_path: artifactPath,
      safety_check_passed: validation.valid,
      limitations: packet.rationale.limitations
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
