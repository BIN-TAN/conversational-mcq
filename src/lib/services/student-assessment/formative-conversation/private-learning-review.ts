import { createHash } from "node:crypto";
import { z } from "zod";
import { CanonicalEvidenceIdSchema, CanonicalEvidenceKindSchema, CanonicalEvidenceEligibilitySchema } from "@/lib/domain/canonical-evidence-identity";
import type { FormativeConversationV18R2AgentInput, FormativeConversationV18R2AgentOutput } from "./agent-contract-v18r2";

export const CONVERSATION_PRIVATE_LEARNING_REVIEW_VERSION = "conversation-private-learning-review-v1" as const;
export const PRIVATE_LEARNING_REVIEW_MAX_BLOCKS = 6;
export const PRIVATE_LEARNING_REVIEW_MAX_CLAIMS = 512;
export const PRIVATE_LEARNING_REVIEW_MAX_BYTES = 96 * 1024;

// Object-key order is not evidence (in particular, JSONB can reorder keys).
// Arrays and every source string remain exact; original provider bytes stay in the execution audit.
export function privateLearningCanonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(privateLearningCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${privateLearningCanonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("private_learning_review.non_json_value");
}
export const privateLearningHash = (value: unknown) => createHash("sha256").update(privateLearningCanonicalJson(value), "utf8").digest("hex");
const textHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const ConversationPrivateLearningReviewSchema = z.object({
  version: z.literal(CONVERSATION_PRIVATE_LEARNING_REVIEW_VERSION),
  candidate_sha256: Hash.nullable(),
  claim_count: z.number().int().nonnegative().max(PRIVATE_LEARNING_REVIEW_MAX_CLAIMS),
  blocks: z.array(z.object({
    block_id: z.number().int().positive().max(PRIVATE_LEARNING_REVIEW_MAX_BLOCKS),
    claim_paths: z.array(z.string().min(1)).min(1).max(PRIVATE_LEARNING_REVIEW_MAX_CLAIMS),
    text: z.string().min(1).max(PRIVATE_LEARNING_REVIEW_MAX_BYTES), sha256: Hash
  }).strict()).max(PRIVATE_LEARNING_REVIEW_MAX_BLOCKS),
  source_bindings: z.array(z.object({
    evidence_id: CanonicalEvidenceIdSchema,
    evidence_kind: CanonicalEvidenceKindSchema,
    eligibility: CanonicalEvidenceEligibilitySchema,
    source_kind: z.enum(["visible_student_turn", "initial_student_reasoning", "outside_review_scope"]),
    sequence_index: z.number().int().positive().nullable(), item_public_id: z.string().min(1).nullable(),
    content: z.string().min(1).nullable()
  }).strict()).max(2_000)
}).strict();
export type ConversationPrivateLearningReview = z.infer<typeof ConversationPrivateLearningReviewSchema>;
type Claim = { path: string; value: unknown; evidence_ids: string[] };

// This is a lossless projection of proposed assertions, not an interpretation or
// correction of them. No existing profile value or assessment correctness enters it.
export function buildConversationPrivateLearningReview(
  context: FormativeConversationV18R2AgentInput,
  candidate: FormativeConversationV18R2AgentOutput | null
): ConversationPrivateLearningReview {
  const claims: Claim[] = [];
  const add = (path: string, value: unknown, evidenceIds: string[]) => {
    claims.push({ path, value, evidence_ids: [...evidenceIds] });
    if (claims.length > PRIVATE_LEARNING_REVIEW_MAX_CLAIMS) throw new Error("private_learning_review.claim_limit");
  };
  if (candidate !== null) {
    candidate.evidence_observations.forEach((observation, index) =>
      add(`evidence_observations[${index}]`, observation, observation.evidence_ids));
    const proposal = candidate.profile_transition_recommendation;
    if (proposal !== null) {
      add("profile_transition_recommendation", { proposed_outcome: proposal.proposed_outcome, rationale: proposal.rationale }, proposal.canonical_evidence_ids);
      const updated = proposal.updated_profile;
      const prior = context.current_profile.canonical_profile;
      if (updated) for (const field of Object.keys(updated).sort() as Array<keyof typeof updated>) {
        if (prior && privateLearningCanonicalJson(prior[field]) === privateLearningCanonicalJson(updated[field])) continue;
        const support = proposal.field_evidence.filter(entry => entry.profile_fields.some(name => name === field));
        add(`profile_transition_recommendation.updated_profile.${field}`,
          { proposed_value: updated[field], field_evidence: support }, support.flatMap(entry => entry.evidence_ids));
      }
      proposal.misconception_claim_dispositions.forEach((entry, index) => {
        if (entry.disposition === "resolved") add(`profile_transition_recommendation.misconception_claim_dispositions[${index}]`, entry, entry.evidence_ids);
      });
    }
  }
  const ids = [...new Set(claims.flatMap(claim => claim.evidence_ids))].sort();
  const source_bindings = ids.map<ConversationPrivateLearningReview["source_bindings"][number]>(id => {
    const matches = context.allowed_evidence_catalog.evidence.filter(entry => entry.evidence_id === id);
    const entry = matches[0];
    if (matches.length !== 1 || !entry || entry.evidence_scope_id !== context.allowed_evidence_catalog.evidence_scope_id ||
        entry.assessment_public_id !== context.assessment_public_id || entry.concept_unit_public_id !== context.concept_unit_public_id ||
        (entry.evidence_stage === "baseline_assessment" ? entry.conversation_public_id !== null : entry.conversation_public_id !== context.conversation_public_id)) {
      throw new Error("private_learning_review.source_identity_invalid");
    }
    const base = { evidence_id: id, evidence_kind: entry.evidence_kind, eligibility: entry.eligibility };
    if ((entry.evidence_kind === "formative_student_turn" || entry.evidence_kind === "assessment_reasoning") && entry.source_role !== "student") {
      throw new Error("private_learning_review.student_role_invalid");
    }
    if (entry.source_role === "student" && entry.evidence_kind === "formative_student_turn" && entry.evidence_stage === "formative_conversation") {
      const turns = context.visible_transcript.filter(turn => turn.sequence_index === entry.source_sequence_index);
      if (turns.length !== 1 || turns[0].actor !== "student" || turns[0].message_text !== entry.content || entry.source_sequence_index === null) {
        throw new Error("private_learning_review.student_turn_invalid");
      }
      return { ...base, source_kind: "visible_student_turn", sequence_index: entry.source_sequence_index, item_public_id: null, content: turns[0].message_text };
    }
    if (entry.source_role === "student" && entry.evidence_kind === "assessment_reasoning" && entry.evidence_stage === "baseline_assessment") {
      const responses = context.assessment_response_evidence.filter(item => item.item_public_id === entry.item_public_id);
      if (responses.length !== 1 || !context.administered_items.some(item => item.item_public_id === entry.item_public_id) ||
          responses[0].written_reasoning !== entry.content) throw new Error("private_learning_review.initial_reasoning_invalid");
      return { ...base, source_kind: "initial_student_reasoning", sequence_index: null, item_public_id: entry.item_public_id, content: responses[0].written_reasoning };
    }
    // A legitimate context citation is retained as an unavailable reference. Its
    // selected answer, confidence, private note, process data or correctness is never exposed.
    return { ...base, source_kind: "outside_review_scope", sequence_index: null, item_public_id: null, content: null };
  });
  const blocks: ConversationPrivateLearningReview["blocks"] = [];
  for (let index = 0; index < claims.length;) {
    const take = Math.ceil((claims.length - index) / (PRIVATE_LEARNING_REVIEW_MAX_BLOCKS - blocks.length));
    const group = claims.slice(index, index + take);
    const text = privateLearningCanonicalJson(group);
    blocks.push({ block_id: blocks.length + 1, claim_paths: group.map(claim => claim.path), text, sha256: textHash(text) });
    index += take;
  }
  const projection = { version: CONVERSATION_PRIVATE_LEARNING_REVIEW_VERSION,
    candidate_sha256: candidate === null ? null : privateLearningHash(candidate), claim_count: claims.length, blocks, source_bindings };
  if (Buffer.byteLength(privateLearningCanonicalJson(projection), "utf8") > PRIVATE_LEARNING_REVIEW_MAX_BYTES) {
    throw new Error("private_learning_review.byte_limit");
  }
  return ConversationPrivateLearningReviewSchema.parse(projection);
}
