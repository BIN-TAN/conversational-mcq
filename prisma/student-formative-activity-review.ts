import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type FormativeActivityPacketV1,
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

const REVIEW_SESSION_FALLBACK = "sess_20260701_v2n-8a0";

function hashJson(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function syntheticCases() {
  return [
    {
      artifact_section: "sample_01_basic_concept_grounding",
      profile_condition: "diagnostic_clarification + likely_knowledge_gap",
      input: {
        pattern: "likely_knowledge_gap" as const,
        primary_value: "diagnostic_clarification" as const,
        student_message: "Your answers suggest the basic boundary is still forming.",
        ability_summary: "The explanation names theta and item information but does not yet separate their roles.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      artifact_section: "sample_02_distractor_contrast",
      profile_condition: "diagnostic_clarification + likely_misconception",
      input: {
        pattern: "likely_misconception" as const,
        primary_value: "diagnostic_clarification" as const,
        student_message: "Your answer pattern suggests a tempting alternative is pulling two ideas together.",
        ability_summary: "The explanation mixes a person's estimated ability with the information provided by the item.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      artifact_section: "sample_03_reasoning_chain_repair",
      profile_condition: "reasoning_refinement + developing_understanding",
      input: {
        pattern: "developing_understanding" as const,
        primary_value: "reasoning_refinement" as const,
        student_message: "Your reasoning has a useful start but needs one clearer connection.",
        ability_summary: "The explanation points toward theta but skips the link to item information.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      artifact_section: "sample_04_independent_reconstruction",
      profile_condition: "independent_understanding_verification + mixed_or_conflicting_evidence",
      input: {
        pattern: "mixed_or_conflicting_evidence" as const,
        primary_value: "independent_understanding_verification" as const,
        reliability_limited: true,
        student_message: "Your answers leave the explanation unclear enough that an own-words rebuild is useful.",
        ability_summary: "The responses vary between option recognition and a partial concept explanation.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      artifact_section: "sample_05_confidence_evidence_audit",
      profile_condition: "confidence_calibration + stable_understanding + underconfidence",
      input: {
        pattern: "stable_understanding" as const,
        primary_value: "confidence_calibration" as const,
        status: "Mostly understood" as const,
        status_confidence: "high" as const,
        student_message: "Your explanation has enough substance to check confidence against evidence.",
        ability_summary: "The explanation separates the person-side estimate from the item-side information.",
        confidence_summary: "You were cautious even though the explanation gives usable evidence.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      artifact_section: "sample_06_transfer_and_distractor_generation",
      profile_condition: "consolidation_and_transfer + stable_understanding",
      input: {
        pattern: "stable_understanding" as const,
        primary_value: "consolidation_and_transfer" as const,
        status: "Mostly understood" as const,
        status_confidence: "high" as const,
        student_message: "Your answers give a stable base for extending the concept.",
        ability_summary: "The explanation keeps the person-side estimate separate from item information.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    }
  ];
}

function qualityChecklist(packet: FormativeActivityPacketV1) {
  const validation = validateFormativeActivityPacket(packet);
  return {
    passed: validation.valid,
    issue_count: validation.issues.length,
    issue_codes: validation.issues.map((issue) => issue.rule_code),
    includes_concrete_concept_explanation:
      /\b(theta|ability scale|estimated ability|person ability)\b/i.test(packet.first_turn.message) &&
      /\b(item|difficulty|information|item parameter)\b/i.test(packet.first_turn.message),
    connects_to_prior_response: /\bYour earlier (work|responses|explanation|thinking)\b/i.test(packet.first_turn.message),
    prompt_count: (packet.first_turn.message.match(/\?/g) ?? []).length,
    ends_with_prompt: packet.first_turn.message.trim().endsWith("?"),
    has_family_specific_content: validation.valid,
    no_template_splice_artifact: !validation.issues.some((issue) =>
      ["template_splice_artifact", "template_colon_splice", "label_sentence_duplication"].includes(issue.rule_code)
    ),
    no_internal_evidence_label: !validation.issues.some((issue) => issue.rule_code === "internal_evidence_label_exposed")
  };
}

function safetyChecklist(packet: FormativeActivityPacketV1) {
  const validation = validateFormativeActivityPacket(packet);
  return {
    validator_passed: validation.valid,
    option_solution_value_exposed: packet.safety_check.correct_option_value_exposed,
    correctness_label_exposed: packet.safety_check.correctness_label_exposed,
    raw_option_diagnostic_metadata_exposed: packet.safety_check.raw_distractor_metadata_exposed,
    raw_diagnostic_identifier_exposed: packet.safety_check.raw_misconception_id_exposed,
    engagement_or_ai_label_exposed: packet.safety_check.engagement_or_ai_label_exposed,
    raw_process_context_exposed: packet.safety_check.raw_process_payload_exposed,
    raw_provider_text_exposed: packet.safety_check.raw_llm_output_exposed,
    secret_or_header_exposed: packet.safety_check.secret_or_header_exposed,
    activity_generates_new_item: packet.safety_check.activity_generates_new_item
  };
}

function forbiddenHitCount(samples: Array<{ first_turn: { message: string }; expected_student_action: { prompt: string }; distractor_student_safe_description: string }>) {
  const forbidden = [
    /\banswer key\b/i,
    /\bcorrect option\b/i,
    /\b(correct|incorrect)\s+(answer|choice|option)\b/i,
    /\bmisconception[_ -]?id\b/i,
    /\braw process\b/i,
    /\braw llm\b|\braw model\b|\bprovider output\b/i,
    /\b(api key|authorization header|bearer token|session secret|database url)\b/i,
    /\b(engagement category|ai assistance|external assistance signal|process data)\b/i,
    /\b(ability evidence|ability[- ]packet|profile integration|formative value packet)\b/i,
    /\b(cheating|misconduct|integrity|authenticity|suspicious)\b/i,
    /\b(low engagement|disengaged|low participation)\b/i
  ];
  return samples.reduce((count, sample) => {
    const text = [
      sample.first_turn.message,
      sample.expected_student_action.prompt,
      sample.distractor_student_safe_description
    ].join("\n");
    return count + forbidden.filter((pattern) => pattern.test(text)).length;
  }, 0);
}

async function buildHumanReadableSamplesArtifact(sessionPublicId?: string) {
  const samples = syntheticCases().map((entry) => {
    const synthetic = buildSyntheticActivitySourcePackets(entry.input);
    const packet = buildFormativeActivityDesignPacketFromPackets({
      profile_integration_packet: synthetic.profile,
      formative_value_packet: synthetic.formative
    });
    return { packet, artifact_section: entry.artifact_section, profile_condition: entry.profile_condition, limitations: ["synthetic_no_live_review_sample"] };
  });

  const realSessionPublicId = sessionPublicId ?? REVIEW_SESSION_FALLBACK;
  try {
    const packet = await buildFormativeActivityDesignPacketForSession(realSessionPublicId);
    samples.push({
      packet,
      artifact_section: `sample_${String(samples.length + 1).padStart(2, "0")}_real_session_${realSessionPublicId}`,
      profile_condition: "real_session_review",
      limitations: []
    });
  } catch (error) {
    samples.push({
      packet: samples[0]!.packet,
      artifact_section: `sample_${String(samples.length + 1).padStart(2, "0")}_real_session_unavailable`,
      profile_condition: "real_session_review_unavailable",
      limitations: [
        "real_session_sample_unavailable",
        error instanceof Error ? `real_session_error:${error.message.slice(0, 160)}` : "real_session_error:unknown"
      ]
    });
  }

  const reviewSamples = samples.map(({ packet, artifact_section, profile_condition, limitations }) => {
    const validation = validateFormativeActivityPacket(packet);
    return {
      sample_id: `review_${hashJson({ artifact_section, packet }).slice(0, 16)}`,
      artifact_section,
      activity_family: packet.activity_family,
      selected_formative_value: packet.selected_formative_value,
      profile_condition,
      student_safe_profile_status: packet.personalization_basis.student_safe_profile_status,
      distractor_role: packet.distractor_use.distractor_role,
      distractor_student_safe_description: packet.distractor_use.student_safe_description,
      first_turn: validation.valid
        ? packet.first_turn
        : { message: "[REDACTED_UNSAFE_FIRST_TURN]", message_structure: packet.first_turn.message_structure },
      expected_student_action: packet.expected_student_action,
      quality_check: qualityChecklist(packet),
      safety_check: safetyChecklist(packet),
      limitations
    };
  });

  const families = new Set(reviewSamples.map((sample) => sample.activity_family));
  const qualityScan = {
    forbidden_hit_count: forbiddenHitCount(reviewSamples),
    sample_count: reviewSamples.length,
    each_family_included: families.size === 6,
    student_safe_profile_status_non_null: reviewSamples.every((sample) =>
      ["Mostly understood", "Still developing", "Needs more work"].includes(sample.student_safe_profile_status)
    ),
    distractor_role_non_null: reviewSamples.every((sample) => typeof sample.distractor_role === "string" && sample.distractor_role.length > 0),
    distractor_families_have_concrete_descriptions: reviewSamples
      .filter((sample) => sample.distractor_role !== "none")
      .every((sample) => sample.distractor_student_safe_description.length >= 80),
    no_colon_splice_patterns: reviewSamples.every((sample) => !/:\s+(Your|The|This|It)\b/.test(sample.first_turn.message)),
    no_internal_labels: forbiddenHitCount(reviewSamples) === 0,
    no_fake_distractor_contrast: reviewSamples
      .filter((sample) => sample.activity_family === "distractor_contrast")
      .every((sample) => /hidden assumption/i.test(sample.first_turn.message) && /interchangeable|separate/i.test(sample.first_turn.message))
  };

  const outputDir = path.join(process.cwd(), ".data", "formative-activity-review");
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `human-readable-first-turn-samples-${timestampSlug()}.json`);
  await writeFile(
    artifactPath,
    `${JSON.stringify({
      artifact_version: "formative-activity-human-readable-first-turn-samples-v3",
      generated_at: new Date().toISOString(),
      no_live_provider_call_made: true,
      sample_count: reviewSamples.length,
      quality_scan: qualityScan,
      samples: reviewSamples
    }, null, 2)}\n`,
    "utf8"
  );

  return { artifactPath, qualityScan, samples: reviewSamples };
}

async function main() {
  const sessionPublicId = getArg("session-public-id");
  const { packet, limitations } = await buildPacket(sessionPublicId);
  const validation = validateFormativeActivityPacket(packet);
  const artifactPath = await writeRedactedFormativeActivityReviewArtifact({ packet });
  const humanReadable = await buildHumanReadableSamplesArtifact(sessionPublicId);
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
    human_readable_first_turn_samples_artifact_path: humanReadable.artifactPath,
    human_readable_quality_scan: humanReadable.qualityScan,
    limitations: validation.valid
      ? limitations
      : [
          ...limitations,
          ...validation.issues.map((issue) =>
            `${issue.field_path}:${issue.rule_code}${issue.blocked_pattern_label ? `:${issue.blocked_pattern_label}` : ""}`
          )
        ]
  };

  console.log("| Activity family | Formative value | Profile condition | Distractor role | First-turn quality | Safety | Artifact section |");
  console.log("|---|---|---|---|---|---|---|");
  for (const sample of humanReadable.samples) {
    console.log(`| ${sample.activity_family} | ${sample.selected_formative_value} | ${sample.profile_condition} | ${sample.distractor_role} | ${sample.quality_check.passed ? "passed" : "failed"} | ${sample.safety_check.validator_passed ? "passed" : "failed"} | ${sample.artifact_section} |`);
  }
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
