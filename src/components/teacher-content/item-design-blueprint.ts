/**
 * Design-panel helpers for the mini-test item builder (item-design-client.tsx). Pure, so the
 * page and the tests share them.
 */
type BlueprintEntries = {
  objectives: Array<{ objective_id: string; statement: string; evidence_requirements: string[] }>;
  misconception_hypotheses: Array<{
    statement: string;
    linked_objective_ids: string[];
    student_language_examples: string[];
    why_plausible: string | null;
  }>;
  exemplar_items: Array<{ item_text: string; observed_difficulty_note: string | null }>;
};

const filled = (value: string | null | undefined) => Boolean(value?.trim());

/**
 * Entries added with an Add button and left empty carry no content, so they are left out
 * when the design is saved. An empty learning objective stays while a misconception example
 * links to it, and at least one objective always remains (the server then names it).
 */
export function normalizeBlueprint<T extends BlueprintEntries>(blueprint: T): T {
  const misconceptions = blueprint.misconception_hypotheses
    .filter((misconception) =>
      filled(misconception.statement) || filled(misconception.why_plausible) || misconception.student_language_examples.some(filled))
    .map((misconception) => ({
      ...misconception,
      student_language_examples: misconception.student_language_examples.map((entry) => entry.trim()).filter(Boolean)
    }));
  const linkedObjectiveIds = new Set(misconceptions.flatMap((misconception) => misconception.linked_objective_ids));
  const keptObjectives = blueprint.objectives.filter((objective) =>
    filled(objective.statement) || objective.evidence_requirements.some(filled) || linkedObjectiveIds.has(objective.objective_id));
  return {
    ...blueprint,
    objectives: (keptObjectives.length > 0 ? keptObjectives : blueprint.objectives).map((objective) => ({
      ...objective,
      evidence_requirements: objective.evidence_requirements.map((entry) => entry.trim()).filter(Boolean)
    })),
    misconception_hypotheses: misconceptions,
    exemplar_items: blueprint.exemplar_items.filter((exemplar) =>
      filled(exemplar.item_text) || filled(exemplar.observed_difficulty_note))
  };
}

/**
 * The design-panel entries named by validation paths such as
 * blueprint.objectives.1.statement, in the panel's own words (numbered from 1).
 */
export function blueprintIssueLabels(paths: string[]): string[] {
  const labels: string[] = [];
  for (const path of paths) {
    const match = /^blueprint\.(objectives|misconception_hypotheses|exemplar_items)\.(\d+)(?:\.(\w+))?/.exec(path);
    let label: string | null = null;
    if (match) {
      const number = Number(match[2]) + 1;
      const field = match[3] ?? "";
      if (match[1] === "objectives") {
        label = `Learning objective ${number} (${field === "evidence_requirements" ? "observable evidence" : "what students should know or be able to do"})`;
      } else if (match[1] === "misconception_hypotheses") {
        label = `Misconception example ${number} (${field === "linked_objective_ids" ? "linked learning objective" : "description"})`;
      } else {
        label = `Exemplar item ${number} (item text)`;
      }
    } else if (path === "blueprint.section_topic") {
      label = "Section or topic";
    } else if (path === "blueprint.section_summary") {
      label = "What this section covers";
    }
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}
