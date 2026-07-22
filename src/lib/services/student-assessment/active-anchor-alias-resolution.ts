import { z } from "zod";

export const ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION =
  "active-anchor-alias-resolution-v1" as const;

export const ActiveAnchorAliasContractSchema = z.object({
  resolver_version: z.literal(ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION),
  active_anchor_id: z.string().min(1).max(240),
  option_label: z.string().min(1).max(24),
  option_text: z.string().min(1).max(1400),
  accepted_identifiers: z.array(z.string().min(1).max(240)).min(1).max(24),
  accepted_aliases: z.array(z.string().min(1).max(240)).max(24),
  accepted_paraphrases: z.array(z.string().min(1).max(500)).max(24),
  negative_or_contrast_forms: z.array(z.string().min(1).max(500)).max(24),
  pronoun_resolution_context: z.object({
    active_anchor_is_current_topic: z.boolean(),
    accepted_pronouns: z.array(z.string().min(1).max(80)).max(12),
    require_active_anchor_antecedent: z.boolean()
  }).strict()
}).strict();
export type ActiveAnchorAliasContract = z.infer<
  typeof ActiveAnchorAliasContractSchema
>;

const AnchorStanceSchema = z.enum([
  "endorses_distractor",
  "rejects_distractor",
  "ambiguous",
  "not_expressed"
]);

export const ActiveAnchorAliasResolutionSchema = z.object({
  resolver_version: z.literal(ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION),
  active_anchor_id: z.string().min(1),
  observed_anchor_reference: z.enum(["explicit", "absent"]),
  observed_anchor_identifier: z.string().min(1).nullable(),
  observed_anchor_text: z.string().min(1).nullable(),
  observed_anchor_conclusion: AnchorStanceSchema,
  observed_anchor_stance: AnchorStanceSchema,
  anchor_aliases_detected: z.array(z.string().min(1)).max(24),
  exact_anchor_evidence_spans: z.array(z.object({
    label: z.literal("anchor_reference"),
    span: z.string().min(1).max(900),
    start_index: z.number().int().nonnegative()
  }).strict()).max(24),
  exact_stance_evidence_spans: z.array(z.object({
    label: z.literal("anchor_stance"),
    span: z.string().min(1).max(900),
    start_index: z.number().int().nonnegative()
  }).strict()).max(24),
  ambiguous_due_to_multiple_stances: z.boolean(),
  direct_reference_mapped_absent: z.boolean()
}).strict();
export type ActiveAnchorAliasResolution = z.infer<
  typeof ActiveAnchorAliasResolutionSchema
>;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function aliasPattern(alias: string) {
  const escaped = escapeRegex(alias.trim()).replace(/\s+/gu, "\\s+");
  return alias.trim().length === 1
    ? `\\b${escaped}\\b`
    : `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`;
}

function allMatches(message: string, pattern: RegExp) {
  return [...message.matchAll(pattern)].map((match) => ({
    index: match.index ?? 0,
    span: match[0].trim()
  }));
}

function clauseAt(message: string, index: number) {
  const left = Math.max(
    message.lastIndexOf(".", index - 1),
    message.lastIndexOf("!", index - 1),
    message.lastIndexOf("?", index - 1),
    message.lastIndexOf(";", index - 1),
    message.lastIndexOf("\n", index - 1)
  ) + 1;
  const ends = [".", "!", "?", ";", "\n"]
    .map((separator) => message.indexOf(separator, index))
    .filter((candidate) => candidate >= 0);
  const right = ends.length > 0 ? Math.min(...ends) + 1 : message.length;
  return { start: left, text: message.slice(left, right).trim() };
}

function quotedRanges(message: string) {
  return [...message.matchAll(/["“][^"”]{1,900}["”]/gu)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
}

function stanceForClause(clause: string, aliasExpression: string) {
  const endorsement = [
    new RegExp(`\\b(?:choose|chose|select|selected|pick|picked|prefer|preferred|accept|accepted|endorse|endorsed)\\s+(?:the\\s+)?${aliasExpression}`, "iu"),
    new RegExp(`\\b(?:i(?:'d| would)?\\s+)?(?:still\\s+)?think\\s+${aliasExpression}(?:\\b|\\s)`, "iu"),
    new RegExp(`${aliasExpression}\\s+(?:still\\s+)?(?:is|was|seems|looks|sounds|remains)\\s+(?:accurate|correct|right|valid|reasonable|appropriate|best|true)\\b`, "iu"),
    new RegExp(`${aliasExpression}\\s+(?:still\\s+)?(?:makes|made)\\s+sense\\b`, "iu")
  ].some((pattern) => pattern.test(clause));
  const rejection = [
    new RegExp(`\\b(?:reject|rejected|rejecting|discard|discarded)\\s+(?:the\\s+)?${aliasExpression}`, "iu"),
    new RegExp(`\\b(?:do not|don't|would not|wouldn't|should not|shouldn't)\\s+(?:choose|select|pick|accept)\\s+(?:the\\s+)?${aliasExpression}`, "iu"),
    new RegExp(`${aliasExpression}\\s+(?:still\\s+)?(?:is|was|seems|looks|sounds|remains)\\s+(?:wrong|incorrect|inaccurate|invalid|unsupported|false)\\b`, "iu"),
    new RegExp(`${aliasExpression}\\s+(?:is|was)\\s+not\\s+(?:accurate|correct|right|valid|appropriate|true)\\b`, "iu"),
    new RegExp(`${aliasExpression}[\\s\\S]{0,80}\\b(?:revise|rewrite|correct|change)\\s+(?:it|that|the\\s+(?:option|choice|answer|claim))\\b`, "iu")
  ].some((pattern) => pattern.test(clause));
  if (endorsement && rejection) return "ambiguous" as const;
  if (endorsement) return "endorses_distractor" as const;
  if (rejection) return "rejects_distractor" as const;
  return "ambiguous" as const;
}

export function buildActiveAnchorAliasContract(input: {
  active_anchor_id: string;
  option_label: string;
  option_text: string;
  accepted_paraphrases?: string[];
}): ActiveAnchorAliasContract {
  const label = input.option_label.trim();
  return ActiveAnchorAliasContractSchema.parse({
    resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    active_anchor_id: input.active_anchor_id,
    option_label: label,
    option_text: input.option_text.trim(),
    accepted_identifiers: unique([
      label,
      `option ${label}`,
      `choice ${label}`,
      `answer ${label}`
    ]),
    accepted_aliases: [],
    accepted_paraphrases: unique(input.accepted_paraphrases ?? []),
    negative_or_contrast_forms: [
      `not option ${label}`,
      `reject option ${label}`,
      `option ${label} is wrong`
    ],
    pronoun_resolution_context: {
      active_anchor_is_current_topic: true,
      accepted_pronouns: [
        "that option",
        "that choice",
        "that answer",
        "that claim"
      ],
      require_active_anchor_antecedent: true
    }
  });
}

export function resolveActiveAnchorAlias(input: {
  message: string;
  contract: ActiveAnchorAliasContract;
  prior_visible_message?: string | null;
}): ActiveAnchorAliasResolution {
  const contract = ActiveAnchorAliasContractSchema.parse(input.contract);
  const message = input.message.trim();
  const acceptedPronouns = new Set(
    contract.pronoun_resolution_context.accepted_pronouns.map((value) =>
      value.toLocaleLowerCase("en-CA")
    )
  );
  const directAliases = unique([
    ...contract.accepted_identifiers,
    contract.option_text,
    ...contract.accepted_paraphrases
  ]).filter((value) => !acceptedPronouns.has(
    value.toLocaleLowerCase("en-CA")
  )).sort((left, right) => right.length - left.length);
  const pronouns = contract.pronoun_resolution_context.active_anchor_is_current_topic &&
      (!contract.pronoun_resolution_context.require_active_anchor_antecedent ||
        Boolean(input.prior_visible_message?.trim()))
    ? contract.pronoun_resolution_context.accepted_pronouns
    : [];
  const aliases = unique([
    ...directAliases,
    ...contract.accepted_aliases,
    ...pronouns
  ]).sort((left, right) => right.length - left.length);
  const matches = aliases.flatMap((alias) => {
    const expression = aliasPattern(alias);
    return allMatches(message, new RegExp(expression, "giu")).map((match) => ({
      ...match,
      alias,
      expression
    }));
  }).sort((left, right) => left.index - right.index ||
    right.span.length - left.span.length);
  const deduplicated = matches.filter((match, index) => !matches.some(
    (other, otherIndex) => otherIndex < index && other.index === match.index &&
      other.span.length >= match.span.length
  ));
  const quoted = quotedRanges(message);
  const stanceRows = deduplicated.map((match) => {
    const clause = clauseAt(message, match.index);
    return {
      stance: quoted.some((range) =>
        match.index >= range.start && match.index < range.end
      ) ? "ambiguous" as const : stanceForClause(clause.text, match.expression),
      span: clause.text.slice(0, 900),
      start: clause.start
    };
  });
  const decisive = stanceRows.filter((row) =>
    row.stance === "endorses_distractor" || row.stance === "rejects_distractor"
  );
  const decisiveStances = new Set(decisive.map((row) => row.stance));
  const selfCorrection = /\b(?:actually|rather|i mean|correction|on second thought)\b/iu
    .test(message);
  let stance: z.infer<typeof AnchorStanceSchema> = "not_expressed";
  if (deduplicated.length > 0) stance = "ambiguous";
  if (decisiveStances.size === 1) stance = decisive.at(-1)!.stance;
  if (decisiveStances.size > 1) {
    stance = selfCorrection ? decisive.at(-1)!.stance : "ambiguous";
  }
  const first = deduplicated[0] ?? null;
  return ActiveAnchorAliasResolutionSchema.parse({
    resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    active_anchor_id: contract.active_anchor_id,
    observed_anchor_reference: first ? "explicit" : "absent",
    observed_anchor_identifier: first?.alias ?? null,
    observed_anchor_text: first?.span ?? null,
    observed_anchor_conclusion: stance,
    observed_anchor_stance: stance,
    anchor_aliases_detected: unique(deduplicated.map((entry) => entry.alias)),
    exact_anchor_evidence_spans: deduplicated.map((entry) => ({
      label: "anchor_reference",
      span: entry.span.slice(0, 900),
      start_index: entry.index
    })),
    exact_stance_evidence_spans: decisive.map((entry) => ({
      label: "anchor_stance",
      span: entry.span,
      start_index: entry.start
    })),
    ambiguous_due_to_multiple_stances: decisiveStances.size > 1 &&
      !selfCorrection,
    direct_reference_mapped_absent: false
  });
}
