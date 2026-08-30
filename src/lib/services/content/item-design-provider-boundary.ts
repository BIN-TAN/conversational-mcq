function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Projects concept authoring rules into the educational evidence student-facing
 * agents may use. The teacher's authoring conversation and source exemplars stay
 * in the teacher/audit record and never enter student-facing provider payloads.
 */
export function projectConceptAdministrationRulesForStudentAgents(
  value: unknown
): Record<string, unknown> {
  const rules = asRecord(value);
  const studentSafeRules = Object.fromEntries(
    Object.entries(rules).filter(
      ([key]) =>
        key !== "item_design_assistant_thread" &&
        key !== "item_design_assistant_state" &&
        key !== "item_design_source_materials"
    )
  );
  const blueprint = asRecord(studentSafeRules.item_design_blueprint);

  if (Object.keys(blueprint).length === 0) {
    return studentSafeRules;
  }

  const generationSettings = asRecord(blueprint.generation_settings);

  return {
    ...studentSafeRules,
    item_design_blueprint: {
      schema_version: blueprint.schema_version,
      section_topic: blueprint.section_topic,
      section_summary: blueprint.section_summary,
      objectives: Array.isArray(blueprint.objectives) ? blueprint.objectives : [],
      misconception_hypotheses: Array.isArray(blueprint.misconception_hypotheses)
        ? blueprint.misconception_hypotheses
        : [],
      generation_settings: {
        target_item_count: generationSettings.target_item_count,
        option_count: generationSettings.option_count,
        difficulty_mix: generationSettings.difficulty_mix
      }
    }
  };
}
