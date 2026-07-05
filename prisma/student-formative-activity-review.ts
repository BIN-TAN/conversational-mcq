import {
  buildFormativeActivityDesignPacketForSession,
  buildFormativeActivityDesignPacketFromPackets,
  validateFormativeActivityPacket,
  writeRedactedFormativeActivityReviewArtifact
} from "../src/lib/services/student-assessment/formative-activity-design";
import { prisma } from "../src/lib/db";
import { buildSyntheticActivitySourcePackets } from "./student-formative-activity-fixtures";

function getArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function buildPacket(sessionPublicId?: string) {
  const limitations: string[] = [];

  if (sessionPublicId) {
    try {
      const packet = await buildFormativeActivityDesignPacketForSession(sessionPublicId);
      return { packet, limitations };
    } catch (error) {
      limitations.push(
        "session_source_packets_unavailable_or_incomplete",
        error instanceof Error ? `session_build_error:${error.message.slice(0, 160)}` : "session_build_error:unknown"
      );
    }
  }

  const synthetic = buildSyntheticActivitySourcePackets({
    pattern: "likely_misconception",
    primary_value: "diagnostic_clarification",
    session_public_id: sessionPublicId ?? "sess_formative_activity_review_synthetic"
  });
  const packet = buildFormativeActivityDesignPacketFromPackets({
    profile_integration_packet: synthetic.profile,
    formative_value_packet: synthetic.formative
  });

  if (sessionPublicId) {
    limitations.push("synthetic_packet_used_for_review_after_session_build_failure");
  } else {
    limitations.push("synthetic_packet_used_for_default_review");
  }

  return { packet, limitations };
}

async function main() {
  const sessionPublicId = getArg("session-public-id");
  const { packet, limitations } = await buildPacket(sessionPublicId);
  const validation = validateFormativeActivityPacket(packet);
  const artifactPath = await writeRedactedFormativeActivityReviewArtifact({ packet });
  const summary = {
    status: validation.valid
      ? limitations.length > 0
        ? "completed_with_limitations"
        : "passed"
      : "failed",
    activity_packet_generated: true,
    selected_formative_value: packet.selected_formative_value,
    activity_family: packet.activity_family,
    student_safe_profile_status: packet.personalization_basis.student_safe_profile_status,
    distractor_role: packet.distractor_use.distractor_role,
    first_turn_quality_passed: validation.valid,
    safety_check_passed: validation.valid,
    redacted_activity_artifact_path: artifactPath,
    limitations: validation.valid
      ? limitations
      : [
          ...limitations,
          ...validation.issues.map((issue) =>
            `${issue.field_path}:${issue.rule_code}${issue.blocked_pattern_label ? `:${issue.blocked_pattern_label}` : ""}`
          )
        ]
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!validation.valid) {
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
