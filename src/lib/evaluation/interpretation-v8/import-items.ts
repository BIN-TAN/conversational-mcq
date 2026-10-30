import { parseMiniTestJson, type MiniTestJson } from "@/lib/services/content/mini-test-json-contract";
import type { EvaluationCaseFile, ItemBank } from "./case-model";

/**
 * Brings real items (for example the EDPY 507 mini-tests) into the evaluation. Input is a
 * mini-test-import-v1 file, the format used to import items into the application. The
 * output is one item-bank topic, plus a case template whose responses are to be written by
 * a person: one simulated response per situation, with the expected categories pre-filled
 * from the situation and left for the author to confirm.
 */
export type ImportedTopic = { topic: ItemBank["topics"][number]; problems: string[]; warnings: string[] };

const OPTION_NOTE = /(?:^|[\n;])\s*(?:option\s+)?([A-F])\s*[.):\-–]\s*/gi;

/** Split an older single note ("A: ...; B: ...") into per-option text. */
export function splitOptionNote(note: string | null | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!note?.trim()) return result;
  const matches = [...note.matchAll(OPTION_NOTE)];
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? note.length : note.length;
    const text = note.slice(start, end).trim().replace(/[;\s]+$/, "");
    if (text) result.set(match[1].toUpperCase(), text);
  });
  return result;
}

function topicIdFrom(title: string) {
  const letters = title.split(/\s+/).map((word) => word[0]?.toUpperCase() ?? "").join("").replace(/[^A-Z]/g, "");
  return (letters || "T").slice(0, 4);
}

export function topicFromMiniTest(document: MiniTestJson, options: { topic_id?: string } = {}): ImportedTopic {
  const problems: string[] = [];
  const warnings: string[] = [];
  const topicId = options.topic_id ?? topicIdFrom(document.assessment.title);
  const objective = document.design?.objectives.map((entry) => entry.statement).join(" ")
    || document.assessment.diagnostic_focus
    || document.assessment.title;
  const description = document.design?.section_summary || document.assessment.diagnostic_focus || document.assessment.title;
  if (!document.design) warnings.push("No design block: the learning objective and description fall back to the diagnostic focus or the title.");

  const items: ItemBank["topics"][number]["items"] = [];
  document.items.forEach((item, index) => {
    const itemId = `${topicId}${index + 1}`;
    const where = `${itemId}${item.item_label ? ` (${item.item_label})` : ""}`;
    if (!item.key) { problems.push(`${where}: no key; the item is left out.`); return; }
    const target = item.target_reasoning_note?.trim();
    if (!target) problems.push(`${where}: no target reasoning (target_reasoning_note).`);
    const elements = item.essential_elements?.length
      ? item.essential_elements.join("\n")
      : item.strong_reasoning_should_mention?.trim() ?? "";
    if (!elements) problems.push(`${where}: no essential elements (essential_elements or strong_reasoning_should_mention).`);
    const fromNote = splitOptionNote(item.distractor_diagnostic_notes);
    const rationales: Record<string, { rationale: string; idea_label: string | null }> = {};
    for (const option of item.options) {
      if (option.label === item.key) continue;
      const rationale = item.distractor_rationales?.[option.label]?.trim()
        || fromNote.get(option.label)
        || (fromNote.size === 0 ? item.distractor_diagnostic_notes?.trim() : undefined);
      if (!rationale) {
        problems.push(`${where}: option ${option.label} has no rationale.`);
        continue;
      }
      if (!item.distractor_rationales?.[option.label] && fromNote.size === 0) {
        warnings.push(`${where}: option ${option.label} uses the item's single distractor note as its rationale.`);
      }
      rationales[option.label] = { rationale, idea_label: item.idea_labels?.[option.label]?.trim() || null };
    }
    let stem = item.stem;
    const media = item.media_assets.filter((asset) => asset.active !== false);
    if (media.length) {
      stem += media.map((asset) => `\n[${asset.media_type}: ${asset.teacher_llm_media_description ?? asset.alt_text_or_description}]`).join("");
      warnings.push(`${where}: media replaced by its description in the stem.`);
    }
    items.push({
      item_id: itemId,
      stem,
      options: item.options.map((option) => ({ label: option.label, text: option.text })),
      key: item.key,
      target_reasoning: target || "(missing)",
      essential_elements: elements || "(missing)",
      rationales,
      known_ambiguity: null
    });
  });
  return {
    topic: { topic_id: topicId, title: document.assessment.title, learning_objective: objective, description, items },
    problems,
    warnings
  };
}

export function importMiniTestFiles(files: Array<{ name: string; text: string; topic_id?: string }>, source: string): { bank: ItemBank; problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const topics: ItemBank["topics"] = [];
  for (const file of files) {
    try {
      const imported = topicFromMiniTest(parseMiniTestJson(file.text), { topic_id: file.topic_id });
      if (topics.some((topic) => topic.topic_id === imported.topic.topic_id)) {
        problems.push(`${file.name}: topic id ${imported.topic.topic_id} is already used; pass a different id.`);
        continue;
      }
      topics.push(imported.topic);
      problems.push(...imported.problems.map((problem) => `${file.name}: ${problem}`));
      warnings.push(...imported.warnings.map((warning) => `${file.name}: ${warning}`));
    } catch (error) {
      problems.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { bank: { bank_version: "imported-mini-tests-1", source, topics }, problems, warnings };
}

type Template = {
  answer: "key" | "distractor" | "labelled_distractor" | "none";
  quality: string[];
  beyond: boolean | "either" | null;
  error_source: string[] | null;
  no_usable_reason?: string[];
  side_remark?: boolean;
  tempting?: boolean;
  process?: Record<string, unknown>;
  claim?: { kind: "possible_misconception" | "considered_idea"; endorsement: "endorsed" | "tentative" | null };
  forbidden?: boolean;
  confidence: "low" | "medium" | "high";
};

/** Pre-filled expectations for each situation of the evaluation (fixtures/cases.json). */
export const SITUATION_TEMPLATES: Record<string, Template> = {
  S01: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, confidence: "high" },
  S02: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, confidence: "medium" },
  S03: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, confidence: "medium" },
  S04: { answer: "key", quality: ["adequate"], beyond: false, error_source: null, confidence: "medium" },
  S05: { answer: "key", quality: ["limited"], beyond: false, error_source: null, confidence: "medium" },
  S06: { answer: "key", quality: ["limited"], beyond: true, error_source: null, confidence: "medium" },
  S07: { answer: "key", quality: ["incorrect"], beyond: true, error_source: ["conceptual"], claim: { kind: "possible_misconception", endorsement: "endorsed" }, confidence: "medium" },
  S08: { answer: "labelled_distractor", quality: ["incorrect"], beyond: "either", error_source: ["conceptual"], claim: { kind: "possible_misconception", endorsement: "endorsed" }, confidence: "high" },
  S09: { answer: "labelled_distractor", quality: ["incorrect"], beyond: true, error_source: ["conceptual"], claim: { kind: "possible_misconception", endorsement: "endorsed" }, confidence: "high" },
  S10: { answer: "labelled_distractor", quality: ["incorrect"], beyond: true, error_source: ["conceptual"], claim: { kind: "possible_misconception", endorsement: "tentative" }, confidence: "low" },
  S11: { answer: "labelled_distractor", quality: ["incorrect"], beyond: true, error_source: ["conceptual"], claim: { kind: "possible_misconception", endorsement: "endorsed" }, confidence: "low" },
  S12: { answer: "distractor", quality: ["adequate"], beyond: true, error_source: ["execution_slip", "unclear"], forbidden: true, confidence: "medium" },
  S13: { answer: "key", quality: ["limited", "incorrect"], beyond: true, error_source: ["unclear"], confidence: "medium" },
  S14: { answer: "key", quality: ["no_usable_explanation"], beyond: null, error_source: null, no_usable_reason: ["not_provided", "stated_guess"], confidence: "low" },
  S15: { answer: "distractor", quality: ["no_usable_explanation"], beyond: null, error_source: ["unclear", "conceptual"], no_usable_reason: ["not_provided"], forbidden: true, confidence: "medium" },
  S16: { answer: "distractor", quality: ["no_usable_explanation"], beyond: null, error_source: ["unclear", "conceptual"], no_usable_reason: ["not_provided"], forbidden: true, process: { first_selection_ms: 3000 }, confidence: "low" },
  S17: { answer: "distractor", quality: ["no_usable_explanation"], beyond: null, error_source: ["unclear"], no_usable_reason: ["stated_guess"], forbidden: true, confidence: "low" },
  S18: { answer: "key", quality: ["limited", "adequate"], beyond: true, error_source: null, confidence: "low" },
  S19: { answer: "distractor", quality: ["no_usable_explanation"], beyond: null, error_source: ["unclear"], no_usable_reason: ["off_task"], forbidden: true, confidence: "medium" },
  S20: { answer: "distractor", quality: ["no_usable_explanation"], beyond: null, error_source: ["unclear"], no_usable_reason: ["off_task"], forbidden: true, confidence: "high" },
  S21: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, confidence: "medium" },
  S22: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, side_remark: true, claim: { kind: "possible_misconception", endorsement: "endorsed" }, confidence: "high" },
  S23: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, tempting: true, claim: { kind: "considered_idea", endorsement: null }, confidence: "high" },
  S24: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, tempting: true, claim: { kind: "possible_misconception", endorsement: "endorsed" }, confidence: "high" },
  S25: { answer: "distractor", quality: ["no_usable_explanation", "limited"], beyond: null, error_source: ["unclear", "conceptual"], no_usable_reason: ["not_provided", "off_task"], forbidden: true, confidence: "low" },
  S26: { answer: "distractor", quality: ["adequate"], beyond: true, error_source: ["possible_item_issue"], forbidden: true, confidence: "medium" },
  S27: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, forbidden: true, process: { first_option: "DISTRACTOR", first_explanation: "WRITE: the first, incorrect explanation", first_confidence: "high" }, confidence: "medium" },
  S28: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, forbidden: true, process: { unfocused_seconds: 300 }, confidence: "medium" },
  S29: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, forbidden: true, process: { blocked_paste_attempts: 2 }, confidence: "medium" },
  S30: { answer: "distractor", quality: ["adequate"], beyond: true, error_source: ["execution_slip", "unclear"], forbidden: true, confidence: "medium" },
  S31: { answer: "labelled_distractor", quality: ["no_usable_explanation"], beyond: null, error_source: ["unclear", "conceptual"], no_usable_reason: ["not_provided"], forbidden: true, confidence: "medium" },
  S32: { answer: "key", quality: ["adequate"], beyond: true, error_source: null, forbidden: true, confidence: "medium" }
};

/**
 * A case template for imported items: simulated students whose responses rotate through the
 * situations, so each topic covers every situation. Explanations start as WRITE: prompts and
 * the fixture checks fail until they are written, so nothing half-finished can be scored.
 */
export function caseTemplateForBank(bank: ItemBank, situations: Record<string, string>, studentsPerTopic?: number): EvaluationCaseFile {
  const codes = Object.keys(SITUATION_TEMPLATES).filter((code) => situations[code]);
  const cases: EvaluationCaseFile["cases"] = [];
  for (const topic of bank.topics) {
    const perStudent = topic.items.length;
    const students = studentsPerTopic ?? Math.ceil(codes.length / Math.max(1, perStudent));
    let cursor = 0;
    for (let student = 0; student < students; student += 1) {
      const responses: EvaluationCaseFile["cases"][number]["responses"] = [];
      const claims: EvaluationCaseFile["cases"][number]["claims"] = [];
      const forbidden: string[] = [];
      for (const item of topic.items) {
        const code = codes[cursor % codes.length];
        cursor += 1;
        const template = SITUATION_TEMPLATES[code];
        const incorrect = item.options.filter((option) => option.label !== item.key);
        const labelled = incorrect.find((option) => item.rationales[option.label]?.idea_label) ?? incorrect[0];
        const selected = template.answer === "key" ? item.key
          : template.answer === "none" ? null
          : template.answer === "labelled_distractor" ? labelled?.label ?? null : incorrect[0]?.label ?? null;
        const process = { ...(template.process ?? {}) };
        if (process.first_option === "DISTRACTOR") process.first_option = incorrect[0]?.label ?? null;
        const writes = !(code === "S14" || code === "S15" || code === "S16" || code === "S31");
        responses.push({
          item_id: item.item_id,
          situation: code,
          selected_option: selected,
          confidence: template.confidence,
          explanation: writes ? `WRITE: ${situations[code]}` : null,
          tempting_option: template.tempting ? labelled?.label ?? null : null,
          tempting_option_reason: template.tempting ? `WRITE: ${code === "S23" ? "names and rejects" : "names and endorses"} the idea behind option ${labelled?.label}` : null,
          process: process as EvaluationCaseFile["cases"][number]["responses"][number]["process"],
          expected: {
            quality: template.quality as Array<"adequate" | "limited" | "incorrect" | "no_usable_explanation">,
            beyond_option_text: template.beyond,
            error_source: template.error_source as Array<"conceptual" | "execution_slip" | "possible_item_issue" | "unclear"> | null,
            no_usable_reason: (template.no_usable_reason ?? null) as Array<"not_provided" | "off_task" | "stated_guess"> | null,
            side_remark: template.side_remark ?? false
          }
        });
        if (template.claim) {
          claims.push({
            item_id: item.item_id,
            kind: template.claim.kind,
            endorsement: template.claim.endorsement,
            distractor: template.answer === "key" && !template.tempting ? null : labelled?.label ?? null,
            note: ""
          });
        }
        if (template.forbidden) forbidden.push(item.item_id);
      }
      cases.push({
        case_id: `${topic.topic_id}-${String(student + 1).padStart(2, "0")}`,
        topic_id: topic.topic_id,
        profile: "WRITE: a one-line description of this simulated student",
        responses,
        claims,
        forbidden_claim_items: forbidden,
        optional_claim_items: []
      });
    }
  }
  return { cases_version: "interpretation-v8-eval-cases-template-1", situations, cases };
}

/** True while a case file still holds WRITE: placeholders. */
export function unwrittenPlaceholders(cases: EvaluationCaseFile) {
  return cases.cases.flatMap((evaluationCase) => [
    ...(evaluationCase.profile.startsWith("WRITE:") ? [`${evaluationCase.case_id}: profile`] : []),
    ...evaluationCase.responses.flatMap((response) => [
      ...(response.explanation?.startsWith("WRITE:") ? [`${evaluationCase.case_id}/${response.item_id}: explanation`] : []),
      ...(response.tempting_option_reason?.startsWith("WRITE:") ? [`${evaluationCase.case_id}/${response.item_id}: tempting-option reason`] : []),
      ...(typeof response.process?.first_explanation === "string" && response.process.first_explanation.startsWith("WRITE:") ? [`${evaluationCase.case_id}/${response.item_id}: first explanation`] : [])
    ])
  ]);
}
