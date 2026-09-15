import type { ItemMediaAsset, Prisma } from "@prisma/client";
import { stableHash } from "@/lib/operational/stable-hash";
import { teacherDiagnosticContextForProvider } from "./teacher-diagnostic-context";
import { llmMediaContextForAssets, serializeItemMediaAsset } from "./item-media";

const VERSION = "prepared-assessment-context-v1";
type ItemSource = {
  item_public_id: string; item_order: number; item_stem: string; options: unknown;
  version: number; status: string; included_in_published_set: boolean;
  administration_rules: unknown; distractor_rationales: unknown;
  expected_reasoning_patterns: unknown; possible_misconception_indicators: unknown;
  media_assets: ItemMediaAsset[];
};
type Source = {
  assessment_public_id: string; diagnostic_focus: string | null;
  concept_unit_public_id: string; title: string; learning_objective: string;
  related_concept_description: string; version: number; administration_rules: unknown;
  items: ItemSource[];
};

function hash(value: unknown): string {
  return stableHash(JSON.parse(JSON.stringify(value)));
}

export function itemMetadataFromRules(value: unknown) {
  const rules = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof rules[key] === "string" && rules[key].trim() ? rules[key].trim() : null;
  return {
    item_set_name: text("item_set_name"), domain: text("domain"), item_role: text("item_role"),
    cognitive_demand: text("cognitive_demand"), difficulty: text("difficulty"),
    knowledge_component: text("knowledge_component"), misconception_cluster: text("misconception_cluster")
  };
}

function compile(source: Source) {
  return {
    teacher_diagnostic_context: teacherDiagnosticContextForProvider({
      administration_rules: source.administration_rules,
      assessment_diagnostic_focus: source.diagnostic_focus
    }),
    included_items: source.items.map((item, index) => ({
      item_public_id: item.item_public_id, item_order: item.item_order,
      initial_item_position: index + 1, initial_item_count: source.items.length,
      item_stem: item.item_stem, options: item.options, version: item.version,
      status: item.status, included_in_published_set: item.included_in_published_set,
      media_assets: item.media_assets.map(serializeItemMediaAsset),
      llm_media_context: llmMediaContextForAssets(item.media_assets),
      ...itemMetadataFromRules(item.administration_rules),
      teacher_diagnostic_context: teacherDiagnosticContextForProvider({
        administration_rules: item.administration_rules, assessment_diagnostic_focus: source.diagnostic_focus,
        distractor_rationales: item.distractor_rationales,
        expected_reasoning_patterns: item.expected_reasoning_patterns,
        possible_misconception_indicators: item.possible_misconception_indicators
      })
    }))
  };
}

export function prepareAssessmentContext(source: Source, saved?: unknown) {
  // Only explicitly selected authoring content enters this cache, never session evidence.
  const canonicalSource: Source = {
    assessment_public_id: source.assessment_public_id, diagnostic_focus: source.diagnostic_focus,
    concept_unit_public_id: source.concept_unit_public_id, title: source.title,
    learning_objective: source.learning_objective, related_concept_description: source.related_concept_description,
    version: source.version, administration_rules: source.administration_rules,
    items: source.items.map((item) => ({
      item_public_id: item.item_public_id, item_order: item.item_order, item_stem: item.item_stem,
      options: item.options, version: item.version, status: item.status,
      included_in_published_set: item.included_in_published_set,
      administration_rules: item.administration_rules, distractor_rationales: item.distractor_rationales,
      expected_reasoning_patterns: item.expected_reasoning_patterns,
      possible_misconception_indicators: item.possible_misconception_indicators, media_assets: item.media_assets
    }))
  };
  const sourceHash = hash(canonicalSource);
  const cached = saved as { version?: string; source_hash?: string; content_hash?: string; content?: ReturnType<typeof compile> } | null;
  if (cached?.version === VERSION && cached.source_hash === sourceHash && cached.content &&
      cached.content_hash === hash(cached.content) && Array.isArray(cached.content.included_items)) {
    return { cache_hit: true, envelope: cached, content: structuredClone(cached.content) };
  }
  const content = compile(canonicalSource);
  return {
    cache_hit: false, content,
    envelope: { version: VERSION, source_hash: sourceHash, content_hash: hash(content), content }
  };
}

export async function preparePublishedAssessmentContext(tx: Prisma.TransactionClient, conceptUnitId: string) {
  const unit = await tx.conceptUnit.findUniqueOrThrow({
    where: { id: conceptUnitId },
    include: {
      assessment: { select: { assessment_public_id: true, diagnostic_focus: true } },
      items: {
        where: { status: "published", included_in_published_set: true },
        orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
        include: { media_assets: { where: { active: true }, orderBy: [{ order_index: "asc" }, { created_at: "asc" }] } }
      }
    }
  });
  const prepared = prepareAssessmentContext({ ...unit, ...unit.assessment }, unit.prepared_response_context);
  await tx.conceptUnit.update({
    where: { id: unit.id },
    data: { prepared_response_context: JSON.parse(JSON.stringify(prepared.envelope)) as Prisma.InputJsonValue }
  });
}
