/**
 * Mini-test JSON files written by hand or by other tools rarely match the import format exactly.
 * This module fixes the differences that have one safe reading, and records each change in a
 * plain sentence for the instructor. It never changes wording, never guesses an answer key and
 * never shortens text; anything it cannot settle is left for the validation messages or for the
 * assistant's formatting (item-design.ts formatMiniTestJsonWithAssistant).
 */

const FORMAT_VERSION = "mini-test-import-v1";
const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

const TOP_FIELDS = new Set(["schema_version", "assessment", "design", "items"]);
const ASSESSMENT_FIELDS = new Set(["title", "diagnostic_focus", "folder_label"]);
const DESIGN_FIELDS = new Set(["schema_version", "section_topic", "section_summary", "objectives", "misconception_hypotheses",
  "exemplar_items", "generation_settings"]);
const SETTINGS_FIELDS = new Set(["target_item_count", "option_count", "difficulty_mix", "context_notes"]);
const ITEM_FIELDS = new Set(["item_label", "stem", "options", "key", "target_reasoning_note", "strong_reasoning_should_mention",
  "essential_elements", "distractor_diagnostic_notes", "distractor_rationales", "idea_labels", "objective_ids",
  "misconception_hypothesis_ids", "cognitive_demand", "source_reference", "media_assets"]);

/** Other names for item fields, by meaning. Only used when the format's own field is absent. */
const ITEM_SYNONYMS: Record<string, string[]> = {
  item_label: ["label", "item_id", "id", "number", "name"],
  stem: ["question", "prompt", "question_text", "item_stem", "text"],
  options: ["choices", "answers", "alternatives", "answer_options", "option_list"],
  key: ["answer", "correct_answer", "correct_option", "answer_key", "correct", "keyed_option"],
  target_reasoning_note: ["target_reasoning", "explanation", "rationale", "correct_answer_explanation", "answer_explanation"],
  essential_elements: ["required_explanation_evidence", "explanation_evidence", "essential_points"],
  distractor_rationales: ["option_rationales", "distractor_notes", "option_notes", "incorrect_option_rationales"],
  idea_labels: ["option_idea_labels"],
  cognitive_demand: ["cognitive_level", "bloom_level", "demand"],
  source_reference: ["source", "reference"]
};

const DEMAND: Record<string, string> = {
  remember: "remember", remembering: "remember", recall: "remember", knowledge: "remember",
  understand: "understand", understanding: "understand", comprehension: "understand",
  apply: "apply", applying: "apply", application: "apply",
  analyze: "analyze", analyse: "analyze", analyzing: "analyze", analysing: "analyze", analysis: "analyze",
  evaluate: "evaluate", evaluating: "evaluate", evaluation: "evaluate",
  create: "create", creating: "create", synthesis: "create"
};
/** Demand levels for drafts; the older remember/understand/apply levels belong to the foundational band. */
const BANDS: Record<string, string> = Object.fromEntries(Object.entries(DEMAND).map(([word, level]) => [word,
  level === "analyze" ? "analyzing" : level === "evaluate" ? "evaluating" : level === "create" ? "creating" : "foundational"]));
Object.assign(BANDS, { foundational: "foundational", foundation: "foundational", analyzing: "analyzing", analysing: "analyzing",
  reasoning: "analyzing", evaluating: "evaluating", creating: "creating" });

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : null;
const list = (values: string[]) => values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
const itemsWord = (numbers: number[]) => `${numbers.length === 1 ? "item" : "items"} ${list(numbers.map(String))}`;

/** "a", "A.", "(B)", "Option C", "c)" become a capital letter; anything else returns null. */
export function optionLetter(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(?:option|choice|answer|key)?\s*[:\-]?\s*\(?\s*([A-Fa-f])\s*[).:]?$/i);
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * Removes trailing commas and // or /* *\/ comments outside strings. These are the usual reasons
 * a hand-edited JSON file does not parse; nothing inside a string is changed.
 */
export function relaxedJsonText(source: string): { text: string; changed: boolean } {
  let out = "";
  let changed = false;
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      out += char;
      if (char === "\\") { out += source[index + 1] ?? ""; index += 1; }
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; out += char; continue; }
    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      out += "\n"; changed = true; continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 1; changed = true; continue;
    }
    if (char === ",") {
      let next = index + 1;
      while (next < source.length && /\s/.test(source[next]!)) next += 1;
      if (source[next] === "}" || source[next] === "]") { changed = true; continue; }
    }
    out += char;
  }
  return { text: out, changed };
}

class Changes {
  private ignored = new Map<string, Set<string>>();
  private grouped = new Map<string, number[]>();
  readonly notes: string[] = [];
  add(note: string) { if (!this.notes.includes(note)) this.notes.push(note); }
  /** The same change in several items becomes one sentence: "{where}" is replaced by "items 1, 2 and 3". */
  item(template: string, number: number) {
    const numbers = this.grouped.get(template);
    if (numbers) { if (!numbers.includes(number)) numbers.push(number); return; }
    this.grouped.set(template, [number]);
    this.notes.push(template);
  }
  ignore(field: string, where: string) {
    const places = this.ignored.get(field) ?? new Set<string>();
    places.add(where);
    this.ignored.set(field, places);
  }
  sentences() {
    const ignored = [...this.ignored.entries()].map(([field, places]) => {
      const itemNumbers = [...places].filter((place) => /^\d+$/.test(place)).map(Number);
      const others = [...places].filter((place) => !/^\d+$/.test(place));
      const where = [...others, ...(itemNumbers.length ? [itemsWord(itemNumbers)] : [])];
      return `Ignored the field "${field}" (${list(where)}); the import format does not use it.`;
    });
    const notes = this.notes.map((note) => {
      const numbers = this.grouped.get(note);
      if (!numbers) return note;
      const where = itemsWord(numbers);
      return note.startsWith("{where}") ? note.replace("{where}", where[0]!.toUpperCase() + where.slice(1)) : note.replace("{where}", where);
    });
    return [...notes, ...ignored];
  }
}

function renameSynonyms(record: Json, synonyms: Record<string, string[]>, number: number, changes: Changes) {
  for (const [field, names] of Object.entries(synonyms)) {
    if (record[field] !== undefined) continue;
    const found = names.find((name) => record[name] !== undefined);
    if (!found) continue;
    record[field] = record[found];
    delete record[found];
    changes.item(`Read "${found}" as "${field}" ({where}).`, number);
  }
}

/**
 * Brings options to [{ label, text }]. Letters are normalized ("a", "(B)", "Option C"); options with
 * no labels, or numbered 1, 2, 3..., are lettered in their order. Repeated letters are left as they
 * are, because the key could then mean either option, and validation reports them.
 */
function normalizeOptions(raw: unknown, number: number, changes: Changes): { options: unknown; relabel: Map<string, string> } {
  const relabel = new Map<string, string>();
  let entries: Array<{ label: unknown; text: unknown }> | null = null;
  if (isRecord(raw)) {
    entries = Object.entries(raw).map(([label, value]) => ({ label, text: value }));
    changes.item("{where}: turned the options from letter and text pairs into the format's option list.", number);
  } else if (Array.isArray(raw)) {
    entries = raw.map((entry) => isRecord(entry)
      ? { label: entry.label ?? entry.letter ?? entry.option ?? entry.id, text: entry.text ?? entry.content ?? entry.option_text ?? entry.value }
      : { label: undefined, text: entry });
  }
  if (!entries) return { options: raw, relabel };
  const optionText = (value: unknown) => typeof value === "string" ? value : text(value) ?? value;
  const letters = entries.map((entry) => optionLetter(entry.label));
  const missing = entries.every((entry) => entry.label === undefined || entry.label === null || entry.label === "");
  const numbered = entries.every((entry, index) => text(entry.label) === String(index + 1));
  if ((missing || numbered) && entries.length <= LETTERS.length) {
    if (numbered) {
      entries.forEach((_entry, index) => relabel.set(String(index + 1), LETTERS[index]!));
      changes.item("{where}: the options were numbered, so they are lettered A, B, C... in the same order.", number);
    }
    return { options: entries.map((entry, index) => ({ label: LETTERS[index]!, text: optionText(entry.text) })), relabel };
  }
  if (letters.every((letter) => letter !== null) && entries.some((entry, index) => entry.label !== letters[index])) {
    changes.item("{where}: wrote the option letters as capital letters.", number);
  }
  entries.forEach((entry, index) => { if (letters[index]) relabel.set(String(text(entry.label)), letters[index]!); });
  return {
    options: entries.map((entry, index) => ({ label: letters[index] ?? entry.label, text: optionText(entry.text) })),
    relabel
  };
}

function letterRecord(raw: unknown, field: string, number: number, relabel: Map<string, string>, changes: Changes): unknown {
  const letterOf = (value: unknown) => relabel.get(String(text(value))) ?? optionLetter(value);
  if (Array.isArray(raw)) {
    const record: Json = {};
    for (const entry of raw) {
      if (!isRecord(entry)) return raw;
      const label = letterOf(entry.label ?? entry.option ?? entry.letter);
      const value = field === "idea_labels" ? entry.idea_label ?? entry.label_text ?? entry.text : entry.rationale ?? entry.note ?? entry.text;
      if (!label || typeof value !== "string") return raw;
      record[label] = value;
      if (field === "distractor_rationales" && typeof entry.idea_label === "string") {
        // A rationale entry that carries its idea label is split into the two records.
        (record as Json)[`__idea_${label}`] = entry.idea_label;
      }
    }
    changes.item(`{where}: turned ${field} from a list into the format's letter-keyed record.`, number);
    return record;
  }
  if (!isRecord(raw)) return raw;
  const record: Json = {};
  let relettered = false;
  for (const [label, value] of Object.entries(raw)) {
    const letter = letterOf(label);
    if (letter && letter !== label) relettered = true;
    record[letter ?? label] = value;
  }
  if (relettered) changes.item(`{where}: wrote the option letters in ${field} as capital letters.`, number);
  return record;
}

function normalizeItem(raw: unknown, index: number, design: { objectives: Set<string>; misconceptions: Set<string> } | null, changes: Changes): unknown {
  const number = index + 1;
  if (!isRecord(raw)) return raw;
  const item: Json = { ...raw };
  renameSynonyms(item, ITEM_SYNONYMS, number, changes);
  if (typeof item.item_label === "number") item.item_label = String(item.item_label);
  let relabel = new Map<string, string>();
  if (item.options !== undefined) {
    const normalized = normalizeOptions(item.options, number, changes);
    item.options = normalized.options;
    relabel = normalized.relabel;
  }
  const options = Array.isArray(item.options) ? item.options as Array<{ label: string; text: unknown }> : [];
  const labels = new Set(options.map((option) => option.label));

  if (item.key !== undefined && item.key !== null) {
    const letter = relabel.get(String(text(item.key))) ?? optionLetter(item.key);
    const byText = !letter && typeof item.key === "string"
      ? options.find((option) => typeof option.text === "string" && option.text.trim() === (item.key as string).trim())?.label ?? null
      : null;
    const key = letter ?? byText;
    if (key && labels.has(key)) {
      if (key !== item.key) changes.add(`Item ${number}: read the key "${String(item.key)}" as ${key}.`);
      item.key = key;
    } else {
      changes.add(`Item ${number}: the key "${String(item.key)}" does not match an option, so it is left blank for you to confirm in review.`);
      item.key = null;
    }
  }

  if (typeof item.essential_elements === "string") {
    const parts = item.essential_elements.split(/\r?\n|;\s*/).map((part) => part.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
    item.essential_elements = parts;
    changes.item("{where}: split the essential elements into a list.", number);
  }
  if (Array.isArray(item.essential_elements) && item.essential_elements.length === 0) delete item.essential_elements;
  if (item.essential_elements !== undefined && item.strong_reasoning_should_mention) {
    delete item.strong_reasoning_should_mention;
    changes.item("{where}: kept essential_elements and ignored strong_reasoning_should_mention, which says the same thing in the older format.", number);
  }

  for (const field of ["distractor_rationales", "idea_labels"] as const) {
    if (item[field] === undefined || item[field] === null) { delete item[field]; continue; }
    const record = letterRecord(item[field], field, number, relabel, changes);
    if (!isRecord(record)) { item[field] = record; continue; }
    for (const key of Object.keys(record)) {
      const idea = key.match(/^__idea_([A-F])$/);
      if (idea) {
        const ideas = isRecord(item.idea_labels) ? item.idea_labels : {};
        if (ideas[idea[1]!] === undefined) item.idea_labels = { ...ideas, [idea[1]!]: record[key] };
        delete record[key];
        continue;
      }
      if (!labels.has(key)) {
        delete record[key];
        changes.add(`Item ${number}: ignored the ${field === "idea_labels" ? "idea label" : "note"} for option ${key}, which the item does not have.`);
      } else if (field === "distractor_rationales" && item.key === key) {
        if (!item.target_reasoning_note) {
          item.target_reasoning_note = record[key];
          changes.add(`Item ${number}: the note for the key (${key}) became the target reasoning note.`);
        } else {
          changes.add(`Item ${number}: ignored the note for the key (${key}); the target reasoning note covers the correct option.`);
        }
        delete record[key];
      } else if (typeof record[key] === "string" && !(record[key] as string).trim()) {
        delete record[key];
      }
    }
    item[field] = record;
  }

  for (const [field, known, name] of [["objective_ids", design?.objectives, "objective"], ["misconception_hypothesis_ids", design?.misconceptions, "misconception"]] as const) {
    if (item[field] === undefined || item[field] === null) { delete item[field]; continue; }
    if (typeof item[field] === "string") item[field] = [item[field]];
    if (!Array.isArray(item[field])) continue;
    const ids = (item[field] as unknown[]).map((id) => text(id)).filter((id): id is string => Boolean(id));
    const kept = ids.filter((id) => known?.has(id));
    const dropped = ids.filter((id) => !known?.has(id));
    if (dropped.length) {
      changes.item(`{where}: removed the link to ${list(dropped.map((id) => `"${id}"`))}, which ${dropped.length === 1 ? "is" : "are"} not ${name === "objective" ? "an objective" : "a misconception"} in the file's design.`, number);
    }
    item[field] = kept;
  }

  if (typeof item.cognitive_demand === "string") {
    const mapped = DEMAND[item.cognitive_demand.trim().toLowerCase()];
    if (mapped && mapped !== item.cognitive_demand) changes.item(`{where}: read the cognitive demand "${item.cognitive_demand}" as "${mapped}".`, number);
    if (!mapped) changes.item(`{where}: the cognitive demand "${item.cognitive_demand}" is not one of remember, understand, apply, analyze, evaluate or create, so it is left blank.`, number);
    item.cognitive_demand = mapped ?? null;
  }
  for (const field of ["target_reasoning_note", "strong_reasoning_should_mention", "distractor_diagnostic_notes", "source_reference", "item_label"]) {
    if (typeof item[field] === "string" && !(item[field] as string).trim()) item[field] = null;
  }
  for (const field of Object.keys(item)) {
    if (!ITEM_FIELDS.has(field)) { delete item[field]; changes.ignore(field, String(number)); }
  }
  return item;
}

function normalizeDesign(raw: unknown, changes: Changes): unknown {
  if (!isRecord(raw)) return raw;
  const design: Json = { ...raw };
  if (design.schema_version === undefined) design.schema_version = "evidence-centered-item-design-v1";
  for (const field of Object.keys(design)) {
    if (!DESIGN_FIELDS.has(field)) { delete design[field]; changes.ignore(field, "design"); }
  }
  for (const field of ["misconception_hypotheses", "exemplar_items"]) if (design[field] === undefined || design[field] === null) design[field] = [];
  if (Array.isArray(design.objectives)) {
    design.objectives = design.objectives.map((objective) => isRecord(objective) && typeof objective.evidence_requirements === "string"
      ? { ...objective, evidence_requirements: [objective.evidence_requirements] } : objective);
  }
  if (Array.isArray(design.misconception_hypotheses)) {
    design.misconception_hypotheses = design.misconception_hypotheses.map((entry) => {
      if (!isRecord(entry)) return entry;
      const next: Json = { ...entry };
      if (typeof next.linked_objective_ids === "string") next.linked_objective_ids = [next.linked_objective_ids];
      if (next.student_language_examples === undefined || next.student_language_examples === null) next.student_language_examples = [];
      if (next.why_plausible === undefined) next.why_plausible = null;
      return next;
    });
  }
  if (isRecord(design.generation_settings)) {
    const settings: Json = { ...design.generation_settings };
    for (const field of Object.keys(settings)) {
      if (!SETTINGS_FIELDS.has(field)) { delete settings[field]; changes.ignore(field, "design.generation_settings"); }
    }
    for (const [field, min, max, name] of [["target_item_count", 3, 12, "number of items"], ["option_count", 3, 5, "number of options"]] as const) {
      const value = typeof settings[field] === "string" ? Number(settings[field]) : settings[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        const clamped = Math.min(max, Math.max(min, Math.round(value)));
        if (clamped !== value) changes.add(`Design: the ${name} for drafts (${value}) is outside ${min} to ${max}, so it is set to ${clamped}.`);
        settings[field] = clamped;
      }
    }
    if (typeof settings.difficulty_mix === "string") settings.difficulty_mix = [settings.difficulty_mix];
    if (Array.isArray(settings.difficulty_mix)) {
      const mapped = settings.difficulty_mix.map((band) => typeof band === "string" ? BANDS[band.trim().toLowerCase()] ?? null : null);
      const unknown = settings.difficulty_mix.filter((_band, index) => !mapped[index]);
      if (unknown.length) changes.add(`Design: ignored the demand level${unknown.length === 1 ? "" : "s"} ${list(unknown.map((band) => `"${String(band)}"`))}; the levels are foundational, analyzing, evaluating and creating.`);
      const kept = [...new Set(mapped.filter((band): band is string => Boolean(band)))];
      settings.difficulty_mix = kept.length ? kept : ["foundational", "analyzing"];
    }
    if (typeof settings.context_notes === "string" && !settings.context_notes.trim()) settings.context_notes = null;
    design.generation_settings = settings;
  }
  return design;
}

/** Brings a parsed mini-test file to the import format where there is one safe reading. */
export function normalizeMiniTestJson(input: unknown): { value: unknown; changes: string[] } {
  const changes = new Changes();
  let value: unknown = input;
  if (Array.isArray(value)) {
    value = { items: value };
    changes.add("The file is a list of items, so it was read as the items of one mini test.");
  }
  if (!isRecord(value)) return { value, changes: [] };
  const document: Json = { ...value };
  if (document.items === undefined) {
    const found = ["questions", "mcqs", "item_list"].find((name) => Array.isArray(document[name]));
    if (found) { document.items = document[found]; delete document[found]; changes.add(`Read "${found}" as "items".`); }
  }
  if (document.schema_version !== FORMAT_VERSION) {
    if (document.schema_version !== undefined) changes.add(`Set schema_version to "${FORMAT_VERSION}" (the file had "${String(document.schema_version)}").`);
    document.schema_version = FORMAT_VERSION;
  }
  const assessment: Json = isRecord(document.assessment) ? { ...document.assessment } : {};
  for (const field of ["title", "diagnostic_focus", "folder_label"]) {
    if (assessment[field] === undefined && typeof document[field] === "string") {
      assessment[field] = document[field];
      delete document[field];
      changes.add(`Moved "${field}" into assessment.`);
    }
  }
  for (const field of Object.keys(assessment)) {
    if (!ASSESSMENT_FIELDS.has(field)) { delete assessment[field]; changes.ignore(field, "assessment"); }
  }
  document.design = normalizeDesign(document.design, changes);
  if (!text(assessment.title)) {
    const topic = isRecord(document.design) ? text(document.design.section_topic) : null;
    assessment.title = topic || "Imported mini test";
    changes.add(topic
      ? `The file has no mini-test title, so the design topic "${topic}" is used. You can rename the mini test later.`
      : "The file has no mini-test title, so it is called \"Imported mini test\". You can rename it later.");
  }
  document.assessment = assessment;
  const design = isRecord(document.design) ? {
    objectives: new Set((Array.isArray(document.design.objectives) ? document.design.objectives : [])
      .map((objective) => isRecord(objective) ? text(objective.objective_id) : null).filter((id): id is string => Boolean(id))),
    misconceptions: new Set((Array.isArray(document.design.misconception_hypotheses) ? document.design.misconception_hypotheses : [])
      .map((entry) => isRecord(entry) ? text(entry.misconception_id) : null).filter((id): id is string => Boolean(id)))
  } : null;
  if (Array.isArray(document.items)) {
    document.items = document.items.map((item, index) => normalizeItem(item, index, design, changes));
  }
  for (const field of Object.keys(document)) {
    if (!TOP_FIELDS.has(field)) { delete document[field]; changes.ignore(field, "top level"); }
  }
  return { value: document, changes: changes.sentences() };
}
