import { createHash } from "node:crypto";
import { z } from "zod";
import type { StructuredAgentResult } from "@/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FormativeConversationCanonicalProfileSchema,
  type FormativeConversationCanonicalProfile
} from "./agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationV18ProfileTransitionRecommendationSchema
} from "./agent-contract-v18";
import {
  FormativeConversationV18R2AgentOutputSchema,
  type FormativeConversationV18R2AgentInput,
  type FormativeConversationV18R2AgentOutput
} from "./agent-contract-v18r2";
import {
  ConversationPlanProjectionAuditSchema,
  ConversationPostReplyReviewSchema,
  ConversationPreReplyPlanSchema,
  projectConversationContinuityWire
} from "./conversation-continuity";

export const FORMATIVE_PROFILE_UPDATE_PROPOSAL_VERSION =
  "formative-profile-update-proposal-v1" as const;
export const FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION =
  "formative-conversation-profile-proposal-output-v1" as const;

type ProfileField = (typeof FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS)[number];
type ProfileFieldChange = {
  [Field in ProfileField]: { field: Field; value: FormativeConversationCanonicalProfile[Field] }
}[ProfileField];
const ProfileFieldSchema = z.enum(FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS);

// Each nested union branch binds one field to its existing canonical value type.
// The root stays an object for strict structured output. No optional patch values,
// stringified JSON, coercion, or unconstrained field names are sent to the provider.
const changeBranches = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.map(field =>
  z.object({
    field: z.literal(field),
    value: FormativeConversationCanonicalProfileSchema.shape[field]
  }).strict()
);
export const FormativeProfileFieldChangeSchema: z.ZodType<ProfileFieldChange> = z.union(
  changeBranches as unknown as [
    z.ZodType<ProfileFieldChange>, z.ZodType<ProfileFieldChange>, ...z.ZodType<ProfileFieldChange>[]
  ]
);

export const FormativeProfileUpdateProposalSchema =
  FormativeConversationV18ProfileTransitionRecommendationSchema.innerType()
    .omit({ updated_profile: true })
    .extend({
      recommendation_version: z.literal(FORMATIVE_PROFILE_UPDATE_PROPOSAL_VERSION),
      prior_profile_version: z.string().min(1),
      changed_fields: z.array(FormativeProfileFieldChangeSchema)
        .max(FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.length)
    }).strict();

// Keep the canonical reader unchanged. The live runner may require additional
// prospective fields on this object before passing it to the provider.
export const FormativeConversationProfileProposalOutputObjectSchema =
  FormativeConversationV18R2AgentOutputSchema.innerType().extend({
    profile_transition_recommendation: FormativeProfileUpdateProposalSchema.nullable()
  }).strict();
export const FormativeConversationProfileProposalOutputSchema =
  FormativeConversationProfileProposalOutputObjectSchema;

// Provider generation order is intentional: source-bound intent decisions come
// before the visible reply, and exact receipts can cite that already-written reply.
// The canonical/historical reader above continues to accept full review objects.
export const FormativeConversationPlannedProposalOutputSchema = z.object({
  pre_reply_plan: ConversationPreReplyPlanSchema,
  ...FormativeConversationProfileProposalOutputObjectSchema.omit({ conversation_review: true }).shape,
  post_reply_review: ConversationPostReplyReviewSchema
}).strict();

export type FormativeConversationProfileProposalOutput = z.infer<
  typeof FormativeConversationProfileProposalOutputSchema
>;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const FormativeProfileUpdateProjectionAuditSchema = z.object({
  version: z.literal(FORMATIVE_PROFILE_UPDATE_PROPOSAL_VERSION),
  status: z.enum(["reconstructed", "no_profile_transition", "rejected"]),
  prior_profile_version: z.string().min(1),
  prior_profile_sha256: HashSchema.nullable(),
  original_output_sha256: HashSchema,
  reconstructed_output_sha256: HashSchema.nullable(),
  changed_fields: z.array(ProfileFieldSchema),
  retained_fields: z.array(ProfileFieldSchema),
  validation_issue_paths: z.array(z.string())
}).strict();
export type FormativeProfileUpdateProjectionAudit = z.infer<
  typeof FormativeProfileUpdateProjectionAuditSchema
>;

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
}

type ProposalReconstruction = {
  valid: true;
  output: FormativeConversationV18R2AgentOutput;
  audit: FormativeProfileUpdateProjectionAudit;
  validation_issue_paths: [];
} | {
  valid: false;
  output: null;
  audit: FormativeProfileUpdateProjectionAudit;
  validation_issue_paths: string[];
};

/**
 * Prospective wire-to-canonical reconstruction only. It never applies a profile,
 * determines an outcome, or substitutes for semantic/evidence/safety validation.
 * Every omitted value must have an explicit retained-evidence disposition.
 */
export function reconstructFormativeProfileProposal(input: {
  candidate: unknown;
  context: FormativeConversationV18R2AgentInput;
}): ProposalReconstruction {
  const prior = input.context.current_profile.canonical_profile;
  const audit: FormativeProfileUpdateProjectionAudit = {
    version: FORMATIVE_PROFILE_UPDATE_PROPOSAL_VERSION,
    status: "rejected",
    prior_profile_version: input.context.current_profile.profile_version,
    prior_profile_sha256: prior === null ? null : sha256(prior),
    original_output_sha256: sha256(input.candidate),
    reconstructed_output_sha256: null,
    changed_fields: [], retained_fields: [], validation_issue_paths: []
  };
  const reject = (paths: string[]): ProposalReconstruction => {
    const issues = [...new Set(paths)].sort();
    return { valid: false, output: null,
      audit: { ...audit, validation_issue_paths: issues }, validation_issue_paths: issues };
  };
  const parsed = FormativeConversationProfileProposalOutputSchema.safeParse(input.candidate);
  if (!parsed.success) return reject(parsed.error.issues.map(issue =>
    `profile_update_proposal.${issue.path.join(".")}:${issue.code}`));
  const output = parsed.data;
  if (output.contract_version !== input.context.contract_version)
    return reject(["profile_update_proposal.contract_version:context_mismatch"]);
  const recommendation = output.profile_transition_recommendation;
  let canonicalCandidate: unknown = output;
  if (recommendation !== null) {
    const prefix = "profile_transition_recommendation";
    if (recommendation.prior_profile_version !== input.context.current_profile.profile_version)
      return reject([`${prefix}.prior_profile_version:stale_profile_version`]);
    const priorParsed = FormativeConversationCanonicalProfileSchema.safeParse(prior);
    if (!priorParsed.success) return reject([`${prefix}.changed_fields:canonical_prior_required`]);
    const issues: string[] = [];
    const changes = new Map<ProfileField, ProfileFieldChange>();
    for (const change of recommendation.changed_fields) {
      if (changes.has(change.field)) issues.push(`${prefix}.changed_fields.${change.field}:duplicate_field`);
      changes.set(change.field, change);
    }
    const evidence = new Map<ProfileField, typeof recommendation.field_evidence[number]>();
    for (const entry of recommendation.field_evidence) {
      for (const field of entry.profile_fields) {
        if (evidence.has(field)) issues.push(`${prefix}.field_evidence.${field}:duplicate_field`);
        evidence.set(field, entry);
      }
    }
    for (const field of FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS) {
      const entry = evidence.get(field);
      const change = changes.get(field);
      if (!entry) issues.push(`${prefix}.field_evidence.${field}:explicit_disposition_required`);
      else if (entry.disposition === "retained_evidence_remains_valid") {
        if (change) issues.push(`${prefix}.changed_fields.${field}:retained_field_value_forbidden`);
        audit.retained_fields.push(field);
      } else {
        audit.changed_fields.push(field);
        if (!change) issues.push(`${prefix}.changed_fields.${field}:updated_field_value_required`);
        else if (JSON.stringify(change.value) === JSON.stringify(priorParsed.data[field]))
          issues.push(`${prefix}.changed_fields.${field}:updated_field_unchanged`);
      }
    }
    if (issues.length) return reject(issues);
    // Copy authoritative retained values, then apply ONLY explicitly proposed
    // replacements. Inputs and provider output are never mutated.
    const updated = { ...priorParsed.data, ...Object.fromEntries(
      recommendation.changed_fields.map(change => [change.field, change.value])
    ) };
    canonicalCandidate = { ...output, profile_transition_recommendation: {
      recommendation_version: FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
      recommended: recommendation.recommended,
      proposed_outcome: recommendation.proposed_outcome,
      rationale: recommendation.rationale,
      canonical_evidence_ids: recommendation.canonical_evidence_ids,
      field_evidence: recommendation.field_evidence,
      misconception_claim_dispositions: recommendation.misconception_claim_dispositions,
      updated_profile: updated
    } };
  }
  const canonical = FormativeConversationV18R2AgentOutputSchema.safeParse(canonicalCandidate);
  if (!canonical.success) return reject(canonical.error.issues.map(issue =>
    `profile_update_proposal.${issue.path.join(".")}:${issue.code}`));
  return {
    valid: true, output: canonical.data, validation_issue_paths: [],
    audit: { ...audit,
      status: recommendation === null ? "no_profile_transition" : "reconstructed",
      reconstructed_output_sha256: sha256(canonical.data) }
  };
}

export function readFormativeProfileProposalAudit(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const envelope = raw as Record<string, unknown>;
  const parsed = FormativeProfileUpdateProjectionAuditSchema.safeParse(envelope.profile_update_projection);
  return parsed.success ? { envelope, audit: parsed.data } : null;
}

export function readConversationPlanProjectionAudit(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const envelope = raw as Record<string, unknown>;
  const parsed = ConversationPlanProjectionAuditSchema.safeParse(envelope.conversation_plan_projection);
  return parsed.success ? { envelope, audit: parsed.data } : null;
}

export function prepareConversationPlanResult(
  result: StructuredAgentResult<unknown>, context: FormativeConversationV18R2AgentInput
): StructuredAgentResult<unknown> {
  if (result.status !== "completed") return result;
  const projection = projectConversationContinuityWire(result.parsed_output, context);
  return {
    ...result,
    parsed_output: projection.output ?? result.parsed_output,
    raw_output: {
      provider_raw_output: result.raw_output ?? null,
      original_parsed_output: result.parsed_output,
      conversation_plan_projection: projection.audit
    }
  };
}

export function prepareFormativeProfileProposalResult(
  result: StructuredAgentResult<unknown>, context: FormativeConversationV18R2AgentInput
): StructuredAgentResult<unknown> {
  if (result.status !== "completed") return result;
  // A rejected plan remains the original model wire candidate for the existing
  // bounded semantic repair. Do not stack a misleading profile-shape rejection.
  if (readConversationPlanProjectionAudit(result.raw_output)?.audit.status === "rejected") return result;
  const reconstruction = reconstructFormativeProfileProposal({ candidate: result.parsed_output, context });
  return {
    ...result,
    // A rejection retains the unmodified proposal for the bounded semantic-repair
    // path; it must never be presented as a validated canonical profile.
    parsed_output: reconstruction.valid ? reconstruction.output : result.parsed_output,
    raw_output: {
      provider_raw_output: result.raw_output ?? null,
      original_parsed_output: result.parsed_output,
      profile_update_projection: reconstruction.audit
    }
  };
}
