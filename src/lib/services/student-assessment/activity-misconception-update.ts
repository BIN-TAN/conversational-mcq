import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assertActivityMisconceptionEvidencePacketIsLiveEvaluatedForProductionUpdate,
  validateActivityMisconceptionEvidencePacket,
  type ActivityMisconceptionEvidencePacketV1,
  type ActivityMisconceptionEvidenceValidationIssue
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import type { ActivityMisconceptionEvidenceProviderAudit } from "@/lib/services/student-assessment/activity-misconception-evidence-live";

export const POST_ACTIVITY_DIAGNOSTIC_SNAPSHOT_VERSION =
  "post-activity-diagnostic-snapshot-v1" as const;
export const ACTIVITY_MISCONCEPTION_EVIDENCE_PERSISTENCE_GUARD_VERSION =
  "activity-misconception-evidence-persistence-guard-v1" as const;

export type ActivityMisconceptionEvidencePersistenceMode =
  | "production_diagnosis"
  | "review_artifact";

export type ActivityMisconceptionEvidencePersistenceIssue = {
  field_path: string;
  rule_code:
    | ActivityMisconceptionEvidenceValidationIssue["rule_code"]
    | "no_live_fixture_rejected_for_production"
    | "review_only_rejected_for_production"
    | "deterministic_decision_rejected_for_production"
    | "missing_evaluator_agent_call_id"
    | "missing_provider_metadata"
    | "missing_token_usage"
    | "evaluator_agent_call_not_found"
    | "evaluator_agent_call_not_validated"
    | "evaluator_agent_call_failed"
    | "production_persistence_guard_failed";
  blocked_pattern_label?: string;
};

export type ActivityMisconceptionEvidencePersistenceGuardResult = {
  passed: boolean;
  mode: ActivityMisconceptionEvidencePersistenceMode;
  guard_version: typeof ACTIVITY_MISCONCEPTION_EVIDENCE_PERSISTENCE_GUARD_VERSION;
  issues: ActivityMisconceptionEvidencePersistenceIssue[];
};

export type PostActivityDiagnosticSnapshotPayload = {
  snapshot_version: typeof POST_ACTIVITY_DIAGNOSTIC_SNAPSHOT_VERSION;
  pre_activity_diagnostic_state: string | null;
  activity_evidence_update: {
    status: ActivityMisconceptionEvidencePacketV1["misconception_evidence_update"]["status"];
    evidence_quality: ActivityMisconceptionEvidencePacketV1["misconception_evidence_update"]["evidence_quality"];
    confidence: ActivityMisconceptionEvidencePacketV1["misconception_evidence_update"]["confidence"];
    evidence_elicited_types: ActivityMisconceptionEvidencePacketV1["evidence_elicited"]["types"];
    student_response_kind: ActivityMisconceptionEvidencePacketV1["student_activity_response"]["response_kind"];
  };
  post_activity_diagnostic_state: ActivityMisconceptionEvidencePacketV1["misconception_evidence_update"]["status"];
  update_strength: "strong" | "moderate" | "limited" | "insufficient";
  evidence_quality: ActivityMisconceptionEvidencePacketV1["misconception_evidence_update"]["evidence_quality"];
  next_diagnostic_purpose: ActivityMisconceptionEvidencePacketV1["recommended_next_diagnostic_purpose"];
  student_safe_feedback: ActivityMisconceptionEvidencePacketV1["student_safe_feedback"];
  limitations: string[];
  interpretation_boundaries: string[];
};

export type PersistActivityMisconceptionEvidenceInput = {
  packet: ActivityMisconceptionEvidencePacketV1;
  evaluator_audit?: ActivityMisconceptionEvidenceProviderAudit | null;
  mode: ActivityMisconceptionEvidencePersistenceMode;
  source_activity_packet_ref?: Record<string, unknown> | null;
  pre_activity_diagnostic_state?: string | null;
};

export type ActivityMisconceptionUpdateReviewSummary = {
  status: "passed" | "completed_with_limitations" | "failed";
  session_public_id: string | null;
  records_reviewed: number;
  post_activity_snapshot_generated: boolean;
  production_persistence_guard_passed: boolean;
  diagnostic_state_before: string | null;
  activity_update_status: string | null;
  diagnostic_state_after: string | null;
  evidence_quality: string | null;
  recommended_next_diagnostic_purpose: string | null;
  student_safe_feedback_present: boolean;
  safety_check_passed: boolean;
  artifact_path: string;
  limitations: string[];
};

type PrismaClientLike = typeof prisma;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashActivityMisconceptionEvidence(value: unknown) {
  return createHash("sha256")
    .update(stableJson(value))
    .digest("hex");
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function pushIssue(
  issues: ActivityMisconceptionEvidencePersistenceIssue[],
  field_path: string,
  rule_code: ActivityMisconceptionEvidencePersistenceIssue["rule_code"],
  blocked_pattern_label?: string
) {
  issues.push({ field_path, rule_code, ...(blocked_pattern_label ? { blocked_pattern_label } : {}) });
}

function hasProviderMetadata(audit?: ActivityMisconceptionEvidenceProviderAudit | null) {
  return Boolean(audit?.provider_request_id || audit?.provider_response_id);
}

function hasTokenUsage(audit?: ActivityMisconceptionEvidenceProviderAudit | null) {
  return Number.isFinite(audit?.input_tokens) &&
    Number.isFinite(audit?.output_tokens) &&
    Number.isFinite(audit?.total_tokens);
}

export async function validateActivityMisconceptionEvidencePersistence(input: {
  packet: ActivityMisconceptionEvidencePacketV1;
  evaluator_audit?: ActivityMisconceptionEvidenceProviderAudit | null;
  mode: ActivityMisconceptionEvidencePersistenceMode;
  client?: PrismaClientLike;
}): Promise<ActivityMisconceptionEvidencePersistenceGuardResult> {
  const issues: ActivityMisconceptionEvidencePersistenceIssue[] = [];
  const packetValidation = validateActivityMisconceptionEvidencePacket(input.packet);

  for (const issue of packetValidation.issues) {
    issues.push(issue);
  }

  if (input.mode === "production_diagnosis") {
    if (input.packet.evaluation_source === "no_live_fixture") {
      pushIssue(issues, "evaluation_source", "no_live_fixture_rejected_for_production");
    }
    if (input.packet.review_only) {
      pushIssue(issues, "review_only", "review_only_rejected_for_production");
    }
    if (input.packet.safety_check.deterministic_final_diagnostic_decision_used) {
      pushIssue(
        issues,
        "safety_check.deterministic_final_diagnostic_decision_used",
        "deterministic_decision_rejected_for_production"
      );
    }

    try {
      assertActivityMisconceptionEvidencePacketIsLiveEvaluatedForProductionUpdate(input.packet);
    } catch (error) {
      const message = error instanceof Error ? error.message : "production_persistence_guard_failed";
      if (/no_live_fixture/.test(message)) {
        pushIssue(issues, "evaluation_source", "no_live_fixture_rejected_for_production");
      } else if (/review_only/.test(message)) {
        pushIssue(issues, "review_only", "review_only_rejected_for_production");
      } else if (/deterministic/.test(message)) {
        pushIssue(issues, "safety_check.deterministic_final_diagnostic_decision_used", "deterministic_decision_rejected_for_production");
      } else {
        pushIssue(issues, "packet", "production_persistence_guard_failed", message);
      }
    }

    if (!input.evaluator_audit?.agent_call_id) {
      pushIssue(issues, "evaluator_audit.agent_call_id", "missing_evaluator_agent_call_id");
    }
    if (!hasProviderMetadata(input.evaluator_audit)) {
      pushIssue(issues, "evaluator_audit.provider_metadata", "missing_provider_metadata");
    }
    if (!hasTokenUsage(input.evaluator_audit)) {
      pushIssue(issues, "evaluator_audit.token_usage", "missing_token_usage");
    }

    if (input.evaluator_audit?.agent_call_id) {
      const client = input.client ?? prisma;
      const agentCall = await client.agentCall.findUnique({
        where: { id: input.evaluator_audit.agent_call_id },
        select: {
          id: true,
          call_status: true,
          output_validated: true,
          provider_request_id: true,
          provider_response_id: true,
          input_tokens: true,
          output_tokens: true,
          total_tokens: true
        }
      });
      if (!agentCall) {
        pushIssue(issues, "evaluator_audit.agent_call_id", "evaluator_agent_call_not_found");
      } else {
        if (agentCall.call_status !== "succeeded") {
          pushIssue(issues, "agent_call.call_status", "evaluator_agent_call_failed");
        }
        if (!agentCall.output_validated) {
          pushIssue(issues, "agent_call.output_validated", "evaluator_agent_call_not_validated");
        }
        if (!agentCall.provider_request_id && !agentCall.provider_response_id) {
          pushIssue(issues, "agent_call.provider_metadata", "missing_provider_metadata");
        }
        if (
          !Number.isFinite(agentCall.input_tokens) ||
          !Number.isFinite(agentCall.output_tokens) ||
          !Number.isFinite(agentCall.total_tokens)
        ) {
          pushIssue(issues, "agent_call.token_usage", "missing_token_usage");
        }
      }
    }
  }

  return {
    passed: packetValidation.valid && issues.length === 0,
    mode: input.mode,
    guard_version: ACTIVITY_MISCONCEPTION_EVIDENCE_PERSISTENCE_GUARD_VERSION,
    issues
  };
}

function updateStrengthFromQuality(
  evidenceQuality: ActivityMisconceptionEvidencePacketV1["misconception_evidence_update"]["evidence_quality"]
): PostActivityDiagnosticSnapshotPayload["update_strength"] {
  switch (evidenceQuality) {
    case "high":
      return "strong";
    case "medium":
      return "moderate";
    case "low":
      return "limited";
    case "insufficient":
      return "insufficient";
  }
}

function interpretationBoundaries(packet: ActivityMisconceptionEvidencePacketV1) {
  const boundaries = [
    "snapshot_is_post_activity_review_layer_not_operational_profile_replacement",
    "llm_evaluator_output_is_substantive_source_when_evaluation_source_is_live_llm",
    "deterministic_logic_maps_and_validates_only"
  ];
  const status = packet.misconception_evidence_update.status;
  if (status === "no_actionable_misconception_evidence" || status === "misconception_unsupported") {
    boundaries.push("current_hypothesis_only_not_global_absence_of_misconceptions");
  }
  if (status === "student_chose_move_on" || status === "student_requested_alternative_activity") {
    boundaries.push("student_choice_does_not_force_diagnostic_improvement");
  }
  if (packet.misconception_evidence_update.limitations.some((limitation) => /process_context/i.test(limitation))) {
    boundaries.push("process_context_is_evidence_quality_context_not_misconception_signal");
  }
  return boundaries;
}

export function buildPostActivityDiagnosticSnapshotPayload(input: {
  packet: ActivityMisconceptionEvidencePacketV1;
  pre_activity_diagnostic_state?: string | null;
}): PostActivityDiagnosticSnapshotPayload {
  const packet = input.packet;
  return {
    snapshot_version: POST_ACTIVITY_DIAGNOSTIC_SNAPSHOT_VERSION,
    pre_activity_diagnostic_state: input.pre_activity_diagnostic_state ?? null,
    activity_evidence_update: {
      status: packet.misconception_evidence_update.status,
      evidence_quality: packet.misconception_evidence_update.evidence_quality,
      confidence: packet.misconception_evidence_update.confidence,
      evidence_elicited_types: packet.evidence_elicited.types,
      student_response_kind: packet.student_activity_response.response_kind
    },
    post_activity_diagnostic_state: packet.misconception_evidence_update.status,
    update_strength: updateStrengthFromQuality(packet.misconception_evidence_update.evidence_quality),
    evidence_quality: packet.misconception_evidence_update.evidence_quality,
    next_diagnostic_purpose: packet.recommended_next_diagnostic_purpose,
    student_safe_feedback: packet.student_safe_feedback,
    limitations: packet.misconception_evidence_update.limitations,
    interpretation_boundaries: interpretationBoundaries(packet)
  };
}

export async function persistActivityMisconceptionEvidenceUpdate(
  input: PersistActivityMisconceptionEvidenceInput,
  client: PrismaClientLike = prisma
) {
  const guard = await validateActivityMisconceptionEvidencePersistence({
    packet: input.packet,
    evaluator_audit: input.evaluator_audit,
    mode: input.mode,
    client
  });

  if (!guard.passed) {
    const error = new Error("activity_misconception_evidence_persistence_guard_failed");
    Object.assign(error, { guard });
    throw error;
  }

  const snapshotPayload = buildPostActivityDiagnosticSnapshotPayload({
    packet: input.packet,
    pre_activity_diagnostic_state: input.pre_activity_diagnostic_state
  });
  const evidenceHash = hashActivityMisconceptionEvidence({
    packet: input.packet,
    evaluator_agent_call_id: input.evaluator_audit?.agent_call_id ?? null,
    mode: input.mode,
    snapshot_version: POST_ACTIVITY_DIAGNOSTIC_SNAPSHOT_VERSION
  });

  const record = await client.activityMisconceptionEvidenceRecord.upsert({
    where: {
      activity_attempt_id_evidence_hash_production_mode: {
        activity_attempt_id: input.packet.activity_attempt_id,
        evidence_hash: evidenceHash,
        production_mode: input.mode
      }
    },
    update: {},
    create: {
      session_public_id: input.packet.session_public_id,
      student_public_id: input.packet.student_public_id,
      assessment_public_id: input.packet.assessment_public_id,
      concept_unit_id: input.packet.concept_unit_id,
      activity_attempt_id: input.packet.activity_attempt_id,
      source_activity_packet_ref: input.source_activity_packet_ref ? asJson(input.source_activity_packet_ref) : undefined,
      source_evaluator_agent_call_db_id: input.evaluator_audit?.agent_call_id,
      schema_version: input.packet.schema_version,
      evaluation_source: input.packet.evaluation_source,
      review_only: input.packet.review_only,
      runtime_servable_to_student: input.packet.runtime_servable_to_student,
      production_mode: input.mode,
      diagnostic_purpose: input.packet.source_diagnostic_purpose,
      activity_family: input.packet.source_activity_family,
      student_response_kind: input.packet.student_activity_response.response_kind,
      evidence_elicited_types: asJson(input.packet.evidence_elicited.types),
      misconception_update_status: input.packet.misconception_evidence_update.status,
      evidence_quality: input.packet.misconception_evidence_update.evidence_quality,
      recommended_next_diagnostic_purpose: input.packet.recommended_next_diagnostic_purpose,
      student_safe_feedback: asJson(input.packet.student_safe_feedback),
      safety_flags: asJson(input.packet.safety_check),
      limitations: asJson(input.packet.misconception_evidence_update.limitations),
      evidence_packet: asJson(input.packet),
      evidence_hash: evidenceHash,
      diagnostic_snapshots: {
        create: {
          session_public_id: input.packet.session_public_id,
          student_public_id: input.packet.student_public_id,
          assessment_public_id: input.packet.assessment_public_id,
          concept_unit_id: input.packet.concept_unit_id,
          activity_attempt_id: input.packet.activity_attempt_id,
          pre_activity_diagnostic_state: snapshotPayload.pre_activity_diagnostic_state,
          activity_update_status: snapshotPayload.activity_evidence_update.status,
          post_activity_diagnostic_state: snapshotPayload.post_activity_diagnostic_state,
          update_strength: snapshotPayload.update_strength,
          evidence_quality: snapshotPayload.evidence_quality,
          next_diagnostic_purpose: snapshotPayload.next_diagnostic_purpose,
          student_safe_feedback: asJson(snapshotPayload.student_safe_feedback),
          limitations: asJson(snapshotPayload.limitations),
          snapshot_payload: asJson(snapshotPayload)
        }
      }
    },
    include: { diagnostic_snapshots: true }
  });

  return {
    guard,
    record,
    snapshot: record.diagnostic_snapshots[0] ?? null,
    evidence_hash: evidenceHash
  };
}

export function redactedPostActivityUpdateRecord(input: {
  record: {
    evidence_public_id: string;
    session_public_id: string;
    student_public_id: string;
    assessment_public_id: string;
    concept_unit_id: string;
    activity_attempt_id: string;
    schema_version: string;
    evaluation_source: string;
    production_mode: string;
    diagnostic_purpose: string;
    activity_family: string;
    student_response_kind: string;
    misconception_update_status: string;
    evidence_quality: string;
    recommended_next_diagnostic_purpose: string;
    student_safe_feedback: unknown;
    safety_flags: unknown;
    limitations: unknown;
    created_at: Date;
  };
  snapshot?: {
    snapshot_public_id: string;
    pre_activity_diagnostic_state: string | null;
    post_activity_diagnostic_state: string;
    update_strength: string;
    snapshot_payload: unknown;
    created_at: Date;
  } | null;
}) {
  return {
    evidence_public_id: input.record.evidence_public_id,
    session_public_id: input.record.session_public_id,
    student_public_id: input.record.student_public_id,
    assessment_public_id: input.record.assessment_public_id,
    concept_unit_id: input.record.concept_unit_id,
    activity_attempt_id: input.record.activity_attempt_id,
    schema_version: input.record.schema_version,
    evaluation_source: input.record.evaluation_source,
    production_mode: input.record.production_mode,
    diagnostic_purpose: input.record.diagnostic_purpose,
    activity_family: input.record.activity_family,
    student_response_kind: input.record.student_response_kind,
    activity_update_status: input.record.misconception_update_status,
    evidence_quality: input.record.evidence_quality,
    recommended_next_diagnostic_purpose: input.record.recommended_next_diagnostic_purpose,
    student_safe_feedback_present: Boolean(
      input.record.student_safe_feedback &&
        typeof input.record.student_safe_feedback === "object" &&
        "message" in input.record.student_safe_feedback
    ),
    safety_flags: input.record.safety_flags,
    limitations: input.record.limitations,
    snapshot: input.snapshot ? {
      snapshot_public_id: input.snapshot.snapshot_public_id,
      pre_activity_diagnostic_state: input.snapshot.pre_activity_diagnostic_state,
      post_activity_diagnostic_state: input.snapshot.post_activity_diagnostic_state,
      update_strength: input.snapshot.update_strength,
      interpretation_boundaries:
        typeof input.snapshot.snapshot_payload === "object" &&
        input.snapshot.snapshot_payload !== null &&
        "interpretation_boundaries" in input.snapshot.snapshot_payload
          ? (input.snapshot.snapshot_payload as { interpretation_boundaries?: unknown }).interpretation_boundaries
          : []
    } : null,
    created_at: input.record.created_at.toISOString()
  };
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJsonArtifact(input: {
  output_dir?: string;
  artifact_version: string;
  summary: Omit<ActivityMisconceptionUpdateReviewSummary, "artifact_path">;
  records: unknown[];
}) {
  const outputDir = input.output_dir ?? path.join(process.cwd(), ".data", "activity-misconception-update-review");
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `activity-misconception-update-review-${timestampSlug()}.json`);
  await writeFile(artifactPath, JSON.stringify({
    artifact_version: input.artifact_version,
    generated_at: new Date().toISOString(),
    no_live_provider_call_made: true,
    summary: input.summary,
    records: input.records
  }, null, 2));
  return artifactPath;
}

function summaryFromRecords(input: {
  session_public_id: string | null;
  records: Array<ReturnType<typeof redactedPostActivityUpdateRecord>>;
  artifact_path: string;
  limitations?: string[];
}): ActivityMisconceptionUpdateReviewSummary {
  const first = input.records[0];
  const snapshot = first?.snapshot;
  return {
    status: input.records.length > 0 ? "passed" : "completed_with_limitations",
    session_public_id: input.session_public_id,
    records_reviewed: input.records.length,
    post_activity_snapshot_generated: Boolean(snapshot),
    production_persistence_guard_passed: input.records.some((record) => record.production_mode === "production_diagnosis"),
    diagnostic_state_before: snapshot?.pre_activity_diagnostic_state ?? null,
    activity_update_status: first?.activity_update_status ?? null,
    diagnostic_state_after: snapshot?.post_activity_diagnostic_state ?? null,
    evidence_quality: first?.evidence_quality ?? null,
    recommended_next_diagnostic_purpose: first?.recommended_next_diagnostic_purpose ?? null,
    student_safe_feedback_present: first?.student_safe_feedback_present ?? false,
    safety_check_passed: input.records.length > 0 && input.records.every((record) =>
      record.safety_flags &&
      typeof record.safety_flags === "object" &&
      Object.values(record.safety_flags as Record<string, unknown>).every((flag) => flag === false)
    ),
    artifact_path: input.artifact_path,
    limitations: input.limitations ?? []
  };
}

export async function writePostActivityMisconceptionUpdateReview(input: {
  session_public_id?: string;
  output_dir?: string;
  fallback_packets?: ActivityMisconceptionEvidencePacketV1[];
  client?: PrismaClientLike;
}): Promise<ActivityMisconceptionUpdateReviewSummary> {
  const client = input.client ?? prisma;
  const persisted = await client.activityMisconceptionEvidenceRecord.findMany({
    where: input.session_public_id ? { session_public_id: input.session_public_id } : undefined,
    include: { diagnostic_snapshots: true },
    orderBy: { created_at: "desc" },
    take: input.session_public_id ? 100 : 20
  });

  if (persisted.length > 0) {
    const records = persisted.map((record) => redactedPostActivityUpdateRecord({
      record,
      snapshot: record.diagnostic_snapshots[0] ?? null
    }));
    const artifactPath = await writeJsonArtifact({
      output_dir: input.output_dir,
      artifact_version: "post-activity-misconception-update-review-v1",
      summary: {
        status: "passed",
        session_public_id: input.session_public_id ?? null,
        records_reviewed: records.length,
        post_activity_snapshot_generated: records.some((record) => Boolean(record.snapshot)),
        production_persistence_guard_passed: records.some((record) => record.production_mode === "production_diagnosis"),
        diagnostic_state_before: records[0]?.snapshot?.pre_activity_diagnostic_state ?? null,
        activity_update_status: records[0]?.activity_update_status ?? null,
        diagnostic_state_after: records[0]?.snapshot?.post_activity_diagnostic_state ?? null,
        evidence_quality: records[0]?.evidence_quality ?? null,
        recommended_next_diagnostic_purpose: records[0]?.recommended_next_diagnostic_purpose ?? null,
        student_safe_feedback_present: records[0]?.student_safe_feedback_present ?? false,
        safety_check_passed: records.every((record) =>
          record.safety_flags &&
          typeof record.safety_flags === "object" &&
          Object.values(record.safety_flags as Record<string, unknown>).every((flag) => flag === false)
        ),
        limitations: []
      },
      records
    });
    return summaryFromRecords({
      session_public_id: input.session_public_id ?? null,
      records,
      artifact_path: artifactPath
    });
  }

  if (input.session_public_id) {
    const artifactPath = await writeJsonArtifact({
      output_dir: input.output_dir,
      artifact_version: "post-activity-misconception-update-review-v1",
      summary: {
        status: "completed_with_limitations",
        session_public_id: input.session_public_id,
        records_reviewed: 0,
        post_activity_snapshot_generated: false,
        production_persistence_guard_passed: false,
        diagnostic_state_before: null,
        activity_update_status: null,
        diagnostic_state_after: null,
        evidence_quality: null,
        recommended_next_diagnostic_purpose: null,
        student_safe_feedback_present: false,
        safety_check_passed: false,
        limitations: ["no_persisted_post_activity_misconception_evidence_for_session"]
      },
      records: []
    });
    return {
      status: "completed_with_limitations",
      session_public_id: input.session_public_id,
      records_reviewed: 0,
      post_activity_snapshot_generated: false,
      production_persistence_guard_passed: false,
      diagnostic_state_before: null,
      activity_update_status: null,
      diagnostic_state_after: null,
      evidence_quality: null,
      recommended_next_diagnostic_purpose: null,
      student_safe_feedback_present: false,
      safety_check_passed: false,
      artifact_path: artifactPath,
      limitations: ["no_persisted_post_activity_misconception_evidence_for_session"]
    };
  }

  const fallbackPackets = input.fallback_packets ?? [];
  const records = fallbackPackets.map((packet) => {
    const snapshotPayload = buildPostActivityDiagnosticSnapshotPayload({ packet });
    return {
      evidence_public_id: `review_only_${hashActivityMisconceptionEvidence(packet).slice(0, 12)}`,
      session_public_id: packet.session_public_id,
      student_public_id: packet.student_public_id,
      assessment_public_id: packet.assessment_public_id,
      concept_unit_id: packet.concept_unit_id,
      activity_attempt_id: packet.activity_attempt_id,
      schema_version: packet.schema_version,
      evaluation_source: packet.evaluation_source,
      production_mode: "review_artifact",
      diagnostic_purpose: packet.source_diagnostic_purpose,
      activity_family: packet.source_activity_family,
      student_response_kind: packet.student_activity_response.response_kind,
      activity_update_status: packet.misconception_evidence_update.status,
      evidence_quality: packet.misconception_evidence_update.evidence_quality,
      recommended_next_diagnostic_purpose: packet.recommended_next_diagnostic_purpose,
      student_safe_feedback_present: true,
      safety_flags: packet.safety_check,
      limitations: [
        ...packet.misconception_evidence_update.limitations,
        "synthetic_review_record_not_persisted_production_diagnosis"
      ],
      snapshot: {
        snapshot_public_id: `review_snapshot_${hashActivityMisconceptionEvidence(snapshotPayload).slice(0, 12)}`,
        pre_activity_diagnostic_state: null,
        post_activity_diagnostic_state: snapshotPayload.post_activity_diagnostic_state,
        update_strength: snapshotPayload.update_strength,
        interpretation_boundaries: snapshotPayload.interpretation_boundaries
      },
      created_at: new Date().toISOString()
    };
  });
  if (records.length === 0) {
    const artifactPath = await writeJsonArtifact({
      output_dir: input.output_dir,
      artifact_version: "post-activity-misconception-update-review-v1",
      summary: {
        status: "completed_with_limitations",
        session_public_id: null,
        records_reviewed: 0,
        post_activity_snapshot_generated: false,
        production_persistence_guard_passed: false,
        diagnostic_state_before: null,
        activity_update_status: null,
        diagnostic_state_after: null,
        evidence_quality: null,
        recommended_next_diagnostic_purpose: null,
        student_safe_feedback_present: false,
        safety_check_passed: false,
        limitations: ["no_persisted_or_fallback_post_activity_misconception_evidence_records"]
      },
      records: []
    });
    return {
      status: "completed_with_limitations",
      session_public_id: null,
      records_reviewed: 0,
      post_activity_snapshot_generated: false,
      production_persistence_guard_passed: false,
      diagnostic_state_before: null,
      activity_update_status: null,
      diagnostic_state_after: null,
      evidence_quality: null,
      recommended_next_diagnostic_purpose: null,
      student_safe_feedback_present: false,
      safety_check_passed: false,
      artifact_path: artifactPath,
      limitations: ["no_persisted_or_fallback_post_activity_misconception_evidence_records"]
    };
  }
  const artifactPath = await writeJsonArtifact({
    output_dir: input.output_dir,
    artifact_version: "post-activity-misconception-update-review-v1",
    summary: {
      status: "completed_with_limitations",
      session_public_id: null,
      records_reviewed: records.length,
      post_activity_snapshot_generated: true,
      production_persistence_guard_passed: false,
      diagnostic_state_before: null,
      activity_update_status: records[0]?.activity_update_status ?? null,
      diagnostic_state_after: records[0]?.snapshot?.post_activity_diagnostic_state ?? null,
      evidence_quality: records[0]?.evidence_quality ?? null,
      recommended_next_diagnostic_purpose: records[0]?.recommended_next_diagnostic_purpose ?? null,
      student_safe_feedback_present: true,
      safety_check_passed: records.every((record) =>
        Object.values(record.safety_flags as Record<string, unknown>).every((flag) => flag === false)
      ),
      limitations: ["synthetic_review_records_not_persisted_production_diagnosis"]
    },
    records
  });
  return {
    status: "completed_with_limitations",
    session_public_id: null,
    records_reviewed: records.length,
    post_activity_snapshot_generated: true,
    production_persistence_guard_passed: false,
    diagnostic_state_before: null,
    activity_update_status: records[0]?.activity_update_status ?? null,
    diagnostic_state_after: records[0]?.snapshot?.post_activity_diagnostic_state ?? null,
    evidence_quality: records[0]?.evidence_quality ?? null,
    recommended_next_diagnostic_purpose: records[0]?.recommended_next_diagnostic_purpose ?? null,
    student_safe_feedback_present: true,
    safety_check_passed: records.every((record) =>
      Object.values(record.safety_flags as Record<string, unknown>).every((flag) => flag === false)
    ),
    artifact_path: artifactPath,
    limitations: ["synthetic_review_records_not_persisted_production_diagnosis"]
  };
}
