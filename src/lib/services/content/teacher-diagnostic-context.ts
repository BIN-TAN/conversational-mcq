export type TeacherDiagnosticOptionNote = {
  label: string;
  distractor_diagnostic_value?: string;
  why_tempting?: string;
  misconception_reasoning_pattern?: string;
  strengthens_hypothesis?: string;
  weakens_hypothesis?: string;
  follow_up_probe_suggestion?: string;
  student_safe_feedback_hint?: string;
};

export type TeacherCorrectOptionNote = {
  target_reasoning_note?: string;
  strong_reasoning_should_mention?: string;
  weak_unsupported_correctness_looks_like?: string;
};

export type TeacherItemMetadataInput = {
  item_label?: string;
  item_purpose?: string;
  expected_reasoning_note?: string;
  item_diagnostic_value_note?: string;
  plain_language_distractor_diagnostic_notes?: string;
  correct_option_notes?: TeacherCorrectOptionNote;
  option_notes?: TeacherDiagnosticOptionNote[];
};

export const ITEM_PURPOSE_OPTIONS = [
  { value: "initial_item", label: "Initial item", item_role: "initial" },
  { value: "diagnostic_contrast_item", label: "Diagnostic contrast item", item_role: "diagnostic_contrast" },
  { value: "transfer_item", label: "Transfer item", item_role: "transfer" },
  { value: "practice_followup_item", label: "Practice/follow-up item", item_role: "practice_followup" }
] as const;

export type ItemPurposeValue = (typeof ITEM_PURPOSE_OPTIONS)[number]["value"];

const CONTEXT_KEY = "teacher_diagnostic_context";
export const TEACHER_DIAGNOSTIC_INTERPRETATION_CAUTION =
  "Selected options are indirect evidence only and must be interpreted together with written reasoning, confidence, timing/process features, revisions, and patterns across responses.";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactRecord<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) return false;
      if (typeof entry === "string") return entry.trim().length > 0;
      if (Array.isArray(entry)) return entry.length > 0;
      if (typeof entry === "object") return Object.keys(entry as Record<string, unknown>).length > 0;
      return true;
    })
  ) as Partial<T>;
}

function purposeToItemRole(purpose?: string): string | undefined {
  return ITEM_PURPOSE_OPTIONS.find((option) => option.value === purpose)?.item_role;
}

function purposeFromItemRole(itemRole?: string): string | undefined {
  return ITEM_PURPOSE_OPTIONS.find((option) => option.item_role === itemRole)?.value;
}

export function readTeacherDiagnosticContext(value: unknown): Record<string, unknown> {
  return record(record(value)[CONTEXT_KEY]);
}

export function readTopicDiagnosticNote(value: unknown): string {
  return trimString(readTeacherDiagnosticContext(value).topic_diagnostic_note) ?? "";
}

export function mergeTopicDiagnosticNoteIntoRules(input: {
  administration_rules: Record<string, unknown>;
  topic_diagnostic_note: string;
}): Record<string, unknown> {
  const existingContext = readTeacherDiagnosticContext(input.administration_rules);
  const topicNote = input.topic_diagnostic_note.trim();
  const nextContext = compactRecord({
    ...existingContext,
    topic_diagnostic_note: topicNote || undefined
  });

  return compactRecord({
    ...input.administration_rules,
    [CONTEXT_KEY]: nextContext
  });
}

function optionNoteFromUnknown(entry: unknown): TeacherDiagnosticOptionNote | null {
  const value = record(entry);
  const label = trimString(value.label);

  if (!label) {
    return null;
  }

  return compactRecord({
    label,
    distractor_diagnostic_value: trimString(value.distractor_diagnostic_value),
    why_tempting: trimString(value.why_tempting),
    misconception_reasoning_pattern: trimString(value.misconception_reasoning_pattern),
    strengthens_hypothesis: trimString(value.strengthens_hypothesis),
    weakens_hypothesis: trimString(value.weakens_hypothesis),
    follow_up_probe_suggestion: trimString(value.follow_up_probe_suggestion),
    student_safe_feedback_hint: trimString(value.student_safe_feedback_hint)
  }) as TeacherDiagnosticOptionNote;
}

function optionNoteHasDiagnosticContent(note: TeacherDiagnosticOptionNote): boolean {
  return Object.entries(note).some(
    ([key, value]) => key !== "label" && typeof value === "string" && value.trim().length > 0
  );
}

export function readTeacherItemMetadata(value: unknown): Required<TeacherItemMetadataInput> {
  const rules = record(value);
  const context = readTeacherDiagnosticContext(rules);
  const correctOptionNotes = record(context.correct_option_notes);
  const optionNotes = Array.isArray(context.option_notes)
    ? context.option_notes.map(optionNoteFromUnknown).filter((entry): entry is TeacherDiagnosticOptionNote => Boolean(entry))
    : [];
  const itemPurpose =
    trimString(context.item_purpose) ??
    purposeFromItemRole(trimString(rules.item_role)) ??
    "initial_item";

  return {
    item_label: trimString(context.item_label) ?? "",
    item_purpose: itemPurpose,
    expected_reasoning_note: trimString(context.expected_reasoning_note) ?? "",
    item_diagnostic_value_note: trimString(context.item_diagnostic_value_note) ?? "",
    plain_language_distractor_diagnostic_notes:
      trimString(context.plain_language_distractor_diagnostic_notes) ??
      trimString(context.item_distractor_diagnostic_notes_plain) ??
      optionNotesToPlainLanguage(optionNotes),
    correct_option_notes: {
      target_reasoning_note: trimString(correctOptionNotes.target_reasoning_note) ?? "",
      strong_reasoning_should_mention:
        trimString(correctOptionNotes.strong_reasoning_should_mention) ?? "",
      weak_unsupported_correctness_looks_like:
        trimString(correctOptionNotes.weak_unsupported_correctness_looks_like) ?? ""
    },
    option_notes: optionNotes
  };
}

function optionDiagnosticText(note: TeacherDiagnosticOptionNote): string {
  return [
    note.distractor_diagnostic_value,
    note.why_tempting ? `Tempting because: ${note.why_tempting}` : undefined,
    note.misconception_reasoning_pattern
      ? `Reasoning pattern: ${note.misconception_reasoning_pattern}`
      : undefined,
    note.strengthens_hypothesis
      ? `Strengthens: ${note.strengthens_hypothesis}`
      : undefined,
    note.weakens_hypothesis ? `Weakens: ${note.weakens_hypothesis}` : undefined,
    note.follow_up_probe_suggestion
      ? `Follow-up probe: ${note.follow_up_probe_suggestion}`
      : undefined
  ]
    .filter((entry): entry is string => Boolean(entry && entry.trim()))
    .join(" ");
}

function optionNotesToPlainLanguage(notes: TeacherDiagnosticOptionNote[]): string {
  return notes
    .map((note) => {
      const text = optionDiagnosticText(note);
      return text ? `Option ${note.label}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function buildItemAdministrationRulesFromTeacherMetadata(input: {
  administration_rules: Record<string, unknown>;
  metadata: TeacherItemMetadataInput;
}): Record<string, unknown> {
  const existingContext = readTeacherDiagnosticContext(input.administration_rules);
  const cleanOptionNotes = (input.metadata.option_notes ?? [])
    .map(optionNoteFromUnknown)
    .filter((entry): entry is TeacherDiagnosticOptionNote => {
      return entry !== null && optionNoteHasDiagnosticContent(entry);
    });
  const correctOptionNotes = compactRecord({
    target_reasoning_note: trimString(input.metadata.correct_option_notes?.target_reasoning_note),
    strong_reasoning_should_mention:
      trimString(input.metadata.correct_option_notes?.strong_reasoning_should_mention),
    weak_unsupported_correctness_looks_like:
      trimString(input.metadata.correct_option_notes?.weak_unsupported_correctness_looks_like)
  });
  const itemPurpose = trimString(input.metadata.item_purpose) ?? "initial_item";
  const plainLanguageDistractorNotes = trimString(
    input.metadata.plain_language_distractor_diagnostic_notes
  );
  const expectedSolutionActions = [
    trimString(input.metadata.expected_reasoning_note),
    trimString(input.metadata.correct_option_notes?.target_reasoning_note),
    trimString(input.metadata.correct_option_notes?.strong_reasoning_should_mention)
  ].filter((entry): entry is string => Boolean(entry));
  const optionDiagnosticNotes = Object.fromEntries(
    cleanOptionNotes
      .map((note) => [note.label, optionDiagnosticText(note)] as const)
      .filter(([, value]) => value.length > 0)
  );
  const optionMisconceptionMap = Object.fromEntries(
    cleanOptionNotes
      .map((note) => [
        note.label,
        [
          note.misconception_reasoning_pattern,
          note.strengthens_hypothesis,
          note.weakens_hypothesis
        ].filter((entry): entry is string => Boolean(entry && entry.trim()))
      ] as const)
      .filter(([, value]) => value.length > 0)
  );

  const nextContext = compactRecord({
    ...existingContext,
    item_label: trimString(input.metadata.item_label),
    item_purpose: itemPurpose,
    expected_reasoning_note: trimString(input.metadata.expected_reasoning_note),
    item_diagnostic_value_note: trimString(input.metadata.item_diagnostic_value_note),
    plain_language_distractor_diagnostic_notes: plainLanguageDistractorNotes,
    interpretation_caution: TEACHER_DIAGNOSTIC_INTERPRETATION_CAUTION,
    correct_option_notes: correctOptionNotes,
    option_notes: cleanOptionNotes
  });

  return compactRecord({
    ...input.administration_rules,
    item_role: purposeToItemRole(itemPurpose) ?? input.administration_rules.item_role,
    option_diagnostic_notes: optionDiagnosticNotes,
    option_misconception_map: optionMisconceptionMap,
    expected_solution_actions: expectedSolutionActions,
    [CONTEXT_KEY]: nextContext
  });
}

export function buildDistractorRationalesFromTeacherNotes(input: {
  option_labels: string[];
  correct_option: string;
  existing_rationales: Record<string, string>;
  option_notes: TeacherDiagnosticOptionNote[];
  plain_language_distractor_diagnostic_notes?: string;
}): Record<string, string> {
  const notesByLabel = new Map(input.option_notes.map((note) => [note.label, note]));
  const plainLanguageNote = trimString(input.plain_language_distractor_diagnostic_notes);

  return Object.fromEntries(
    input.option_labels
      .filter((label) => label !== input.correct_option)
      .map((label) => {
        const existing = trimString(input.existing_rationales[label]);
        const diagnostic = notesByLabel.get(label) ? optionDiagnosticText(notesByLabel.get(label)!) : "";
        return [label, existing ?? (diagnostic || plainLanguageNote)];
      })
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
  );
}

export function teacherDiagnosticContextForProvider(input: {
  administration_rules: unknown;
  assessment_diagnostic_focus?: unknown;
  distractor_rationales?: unknown;
  expected_reasoning_patterns?: unknown;
  possible_misconception_indicators?: unknown;
}) {
  const rules = record(input.administration_rules);
  const context = readTeacherDiagnosticContext(rules);

  return compactRecord({
    teacher_diagnostic_context: compactRecord({
      ...context,
      assessment_diagnostic_focus: trimString(input.assessment_diagnostic_focus),
      interpretation_caution:
        trimString(context.interpretation_caution) ??
        TEACHER_DIAGNOSTIC_INTERPRETATION_CAUTION
    }),
    option_diagnostic_notes: record(rules.option_diagnostic_notes),
    option_misconception_map: record(rules.option_misconception_map),
    expected_solution_actions: Array.isArray(rules.expected_solution_actions)
      ? rules.expected_solution_actions
      : undefined,
    distractor_rationales: record(input.distractor_rationales),
    expected_reasoning_patterns: Array.isArray(input.expected_reasoning_patterns)
      ? input.expected_reasoning_patterns
      : undefined,
    possible_misconception_indicators: Array.isArray(input.possible_misconception_indicators)
      ? input.possible_misconception_indicators
      : undefined
  });
}
