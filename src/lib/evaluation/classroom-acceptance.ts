import { z } from "zod";

export const CLASSROOM_ACCEPTANCE_VERSION = "classroom-acceptance-v2";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1);
export const AcceptanceIdentitySchema = z.object({
  source_sha256: digest,
  assessment_sha256: digest,
  effective_model_config_sha256: digest,
  intended_use: text,
  target_population: text,
  decision_policy_sha256: digest
}).strict();

export const ACCEPTANCE_REQUIREMENTS = [
  { id: "runtime_integrity", kind: "deterministic" },
  { id: "browser_recovery", kind: "browser" },
  { id: "research_data_reconciliation", kind: "browser" },
  { id: "classroom_load_and_recovery", kind: "load" },
  { id: "content_and_answer_keys", kind: "expert_review" },
  { id: "diagnostic_accuracy_and_repeatability", kind: "live_ai_review" },
  { id: "pedagogical_quality_and_coverage", kind: "live_ai_review" },
  { id: "fairness_and_accessibility", kind: "student_pilot" },
  { id: "response_process_and_stance_interpretation", kind: "student_pilot" },
  { id: "student_experience_and_instructional_safety", kind: "student_pilot" },
  { id: "teacher_review_and_intervention", kind: "expert_review" }
] as const;

const requirementId = z.enum(ACCEPTANCE_REQUIREMENTS.map(entry => entry.id) as [string, ...string[]]);
export const ClassroomAcceptancePacketSchema = z.object({
  version: z.literal(CLASSROOM_ACCEPTANCE_VERSION),
  permitted_use: z.literal("teacher_supervised_formative_classroom"),
  identity: AcceptanceIdentitySchema,
  criteria_frozen_at: z.string().datetime({ offset: true }),
  criteria_artifact_path: text,
  criteria_sha256: digest,
  evidence: z.array(z.object({
    requirement: requirementId,
    kind: z.enum(["deterministic", "browser", "load", "expert_review", "live_ai_review", "student_pilot"]),
    status: z.enum(["pass", "fail", "not_run", "review_required"]),
    identity: AcceptanceIdentitySchema,
    collected_at: z.string().datetime({ offset: true }),
    criteria_sha256: digest,
    artifact_path: text,
    artifact_sha256: digest,
    limitations: z.array(text),
    reviewer_ids: z.array(text),
    independent_review: z.boolean()
  }).strict()),
  unresolved_critical_findings: z.array(text)
}).strict();
export type ClassroomAcceptancePacket = z.infer<typeof ClassroomAcceptancePacketSchema>;

// This is an evidence checklist, not a scientific certificate or application
// access control. Review provenance and sign-off must be verified by a human.
export function evaluateClassroomAcceptance(input: {
  packet: unknown;
  currentIdentity: z.infer<typeof AcceptanceIdentitySchema>;
  artifactHash: (path: string) => string | null;
  now?: Date;
}) {
  const parsed = ClassroomAcceptancePacketSchema.safeParse(input.packet);
  const blockers: string[] = [];
  if (!parsed.success) return { status: "blocked" as const, high_stakes_authorized: false as const,
    blockers: ["acceptance_packet_missing_or_invalid"] };
  const packet = parsed.data;
  const sameIdentity = (value: typeof packet.identity) =>
    (Object.keys(packet.identity) as Array<keyof typeof value>).every(key => value[key] === input.currentIdentity[key]);
  if (!sameIdentity(packet.identity)) blockers.push("candidate_identity_changed");
  if (input.artifactHash(packet.criteria_artifact_path) !== packet.criteria_sha256) {
    blockers.push("criteria_artifact_missing_or_changed");
  }
  const frozen = Date.parse(packet.criteria_frozen_at);
  const now = (input.now ?? new Date()).getTime();
  if (frozen > now) blockers.push("criteria_freeze_in_future");
  for (const requirement of ACCEPTANCE_REQUIREMENTS) {
    const records = packet.evidence.filter(entry => entry.requirement === requirement.id);
    if (records.length !== 1) { blockers.push(`${requirement.id}:missing_or_duplicate_evidence`); continue; }
    const evidence = records[0];
    if (evidence.status !== "pass") blockers.push(`${requirement.id}:${evidence.status}`);
    if (evidence.kind !== requirement.kind) blockers.push(`${requirement.id}:wrong_evidence_kind`);
    if (!sameIdentity(evidence.identity)) blockers.push(`${requirement.id}:stale_identity`);
    if (evidence.criteria_sha256 !== packet.criteria_sha256) blockers.push(`${requirement.id}:criteria_mismatch`);
    const collected = Date.parse(evidence.collected_at);
    if (collected < frozen || collected > now) blockers.push(`${requirement.id}:invalid_evidence_date`);
    if (input.artifactHash(evidence.artifact_path) !== evidence.artifact_sha256) blockers.push(`${requirement.id}:artifact_missing_or_changed`);
    if (["expert_review", "live_ai_review", "student_pilot"].includes(requirement.kind) &&
        (!evidence.independent_review || new Set(evidence.reviewer_ids).size < 2)) {
      blockers.push(`${requirement.id}:independent_review_missing`);
    }
  }
  blockers.push(...packet.unresolved_critical_findings.map(finding => `unresolved:${finding}`));
  return { status: blockers.length ? "blocked" as const : "ready_for_human_decision" as const,
    high_stakes_authorized: false as const, blockers };
}
