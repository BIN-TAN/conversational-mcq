import {
  buildNoLiveActivityMisconceptionEvidenceFixture,
  validateActivityMisconceptionEvidencePacket,
  writeRedactedActivityMisconceptionEvidenceReviewArtifact
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import { prisma } from "../src/lib/db";
import { activityMisconceptionEvidenceFixtureCases } from "./student-activity-misconception-evidence-fixtures";

function getArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function buildSessionReview(sessionPublicId?: string) {
  if (!sessionPublicId) return null;

  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: {
      session_public_id: true,
      status: true,
      current_phase: true,
      completed_at: true,
      conversation_turns: {
        select: {
          id: true,
          phase: true,
          actor_type: true,
          structured_payload: true,
          created_at: true
        },
        orderBy: { created_at: "asc" },
        take: 80
      }
    }
  });

  if (!session) {
    return {
      session_public_id: sessionPublicId,
      status: "session_not_found",
      activity_response_evidence_available: false,
      limitations: ["session_not_found"]
    };
  }

  const candidateActivityTurns = session.conversation_turns.filter((turn) =>
    JSON.stringify(turn.structured_payload ?? {}).includes("formative_activity")
  );
  const hasStudentActivityResponse = candidateActivityTurns.some((turn) => turn.actor_type === "student");

  return {
    session_public_id: session.session_public_id,
    status: session.status,
    current_phase: session.current_phase,
    completed_at: session.completed_at?.toISOString() ?? null,
    activity_response_evidence_available: hasStudentActivityResponse,
    safe_activity_turn_count: candidateActivityTurns.length,
    limitations: hasStudentActivityResponse
      ? [
          "runtime_activity_response_schema_not_implemented_in_phase_30b",
          "review_command_does_not_evaluate_real_student_activity_response_yet"
        ]
      : [
          "no_post_activity_response_evidence_found",
          "phase_30b_does_not_execute_runtime_activity_dialogue"
        ]
  };
}

async function main() {
  const sessionPublicId = getArg("session-public-id");
  const cases = activityMisconceptionEvidenceFixtureCases();
  const packets = cases.map((fixture) => buildNoLiveActivityMisconceptionEvidenceFixture(fixture));
  const sessionReview = await buildSessionReview(sessionPublicId);
  const artifactPath = await writeRedactedActivityMisconceptionEvidenceReviewArtifact({
    packets,
    session_review: sessionReview
  });
  const rows = packets.map((packet) => {
    const validation = validateActivityMisconceptionEvidencePacket(packet);
    return {
      activity_family: packet.source_activity_family,
      diagnostic_purpose: packet.source_diagnostic_purpose,
      response_kind: packet.student_activity_response.response_kind,
      evidence_quality: packet.misconception_evidence_update.evidence_quality,
      update_status: packet.misconception_evidence_update.status,
      validation: validation.valid ? "passed" : "failed",
      artifact_section: packet.activity_attempt_id
    };
  });

  console.log("| Activity family | Diagnostic purpose | Response kind | Evidence quality | Update status | Safety/schema | Artifact section |");
  console.log("|---|---|---|---|---|---|---|");
  for (const row of rows) {
    console.log(`| ${row.activity_family} | ${row.diagnostic_purpose} | ${row.response_kind} | ${row.evidence_quality} | ${row.update_status} | ${row.validation} | ${row.artifact_section} |`);
  }

  const summary = {
    status: rows.every((row) => row.validation === "passed") ? "passed" : "failed",
    no_live_provider_call_made: true,
    artifact_path: artifactPath,
    packet_count: packets.length,
    statuses_covered: Array.from(new Set(packets.map((packet) => packet.misconception_evidence_update.status))).sort(),
    session_review: sessionReview
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== "passed") {
    process.exitCode = 1;
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
