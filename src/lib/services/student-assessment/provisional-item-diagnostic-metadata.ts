import type { Prisma, PrismaClient } from "@prisma/client";

export const PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_SOURCE = "llm_proposed_v1" as const;
export const PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_REVIEW_STATUS = "unreviewed" as const;
export const PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_LIMITATION =
  "Researcher/teacher review required before stronger claims.";

export type ProvisionalItemDiagnosticMetadata = {
  concept_id: string;
  cognitive_level: string;
  subskills: string[];
  expected_solution_actions: string[];
  option_misconception_map: Record<string, string[]>;
  option_diagnostic_notes: Record<string, string>;
};

export const PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_BY_ITEM_ID: Record<
  string,
  ProvisionalItemDiagnosticMetadata
> = {
  item_mvp_irt_theta_invariance_anchor: {
    concept_id: "irt_theta_invariance_linked_forms",
    cognitive_level: "conceptual_understanding",
    subskills: [
      "distinguish_person_ability_theta_from_item_difficulty",
      "explain_common_scale_linking",
      "separate_form_difficulty_from_systematic_theta_shift"
    ],
    expected_solution_actions: [
      "Identify theta as the person's latent ability estimate on a linked scale.",
      "Explain that properly calibrated forms should not systematically change theta.",
      "Note that item difficulty affects response probabilities or precision rather than redefining ability."
    ],
    option_misconception_map: {
      A: ["harder_form_lowers_theta"],
      B: ["item_difficulty_determines_person_ability"],
      C: ["target_understanding"],
      D: ["item_difficulty_irrelevant_to_irt"]
    },
    option_diagnostic_notes: {
      A: "Treats a harder form as automatically lowering person ability.",
      B: "Confuses item difficulty with person ability level.",
      C: "Recognizes theta as comparable across properly calibrated forms.",
      D: "Overcorrects by treating item difficulty as irrelevant to IRT scoring."
    }
  },
  item_mvp_irt_theta_invariance_diagnostic_contrast: {
    concept_id: "irt_b_parameter_vs_theta",
    cognitive_level: "application_and_analysis",
    subskills: [
      "distinguish_b_parameter_from_theta",
      "evaluate_peer_reasoning_about_form_difficulty",
      "interpret_linked_form_comparability"
    ],
    expected_solution_actions: [
      "Locate the flaw as a confusion between item difficulty b and person ability theta.",
      "Explain that linked forms are intended to make theta estimates comparable.",
      "Avoid claiming item difficulty itself must be invariant across forms."
    ],
    option_misconception_map: {
      A: ["item_difficulty_should_be_invariant"],
      B: ["target_understanding"],
      C: ["misattributes_theta_flaw_to_discrimination"],
      D: ["overgeneralizes_average_difficulty_to_information"]
    },
    option_diagnostic_notes: {
      A: "Mistakes theta invariance for invariant item difficulty values.",
      B: "Identifies the b versus theta distinction.",
      C: "Shifts the flaw to discrimination rather than b/theta confusion.",
      D: "Overgeneralizes average difficulty into information for every student."
    }
  },
  item_mvp_irt_theta_invariance_parameter_extension: {
    concept_id: "irt_discrimination_precision_vs_theta",
    cognitive_level: "higher_order_application",
    subskills: [
      "distinguish_discrimination_from_difficulty",
      "connect_discrimination_to_precision",
      "preserve_common_scale_theta_interpretation"
    ],
    expected_solution_actions: [
      "Explain that discrimination affects how sharply items differentiate examinees around item difficulty.",
      "Connect higher discrimination to possible precision gains rather than higher or lower theta.",
      "Maintain that calibrated versions target the same latent ability scale."
    ],
    option_misconception_map: {
      A: ["high_discrimination_rewards_high_ability"],
      B: ["conflates_discrimination_with_difficulty"],
      C: ["target_understanding"],
      D: ["different_discrimination_prevents_common_scale"]
    },
    option_diagnostic_notes: {
      A: "Treats discrimination as systematically raising theta estimates.",
      B: "Confuses discrimination with item difficulty.",
      C: "Distinguishes same-scale theta from precision differences.",
      D: "Assumes differing discrimination prevents common-scale calibration."
    }
  },
  item_mvp_irt_theta_invariance_transfer: {
    concept_id: "irt_linked_theta_transfer",
    cognitive_level: "transfer_application",
    subskills: [
      "apply_linked_scale_comparability",
      "separate_item_mix_from_person_location",
      "recognize_precision_as_distinct_from_comparability"
    ],
    expected_solution_actions: [
      "Interpret equal theta values as comparable on the same linked scale.",
      "Avoid inferring ability directly from easy or difficult item exposure.",
      "Mention that precision may differ even when theta values are comparable."
    ],
    option_misconception_map: {
      A: ["difficult_items_imply_higher_ability"],
      B: ["easy_items_or_raw_correctness_imply_higher_ability"],
      C: ["target_understanding"],
      D: ["exact_common_items_required_for_comparison"]
    },
    option_diagnostic_notes: {
      A: "Infers ability from exposure to difficult items.",
      B: "Confuses easier item exposure or number-correct intuition with comparable theta.",
      C: "Applies linked-scale comparability while preserving precision caveat.",
      D: "Treats exact common items as necessary for comparing linked theta."
    }
  },
  item_demo_phase4b_1: {
    concept_id: "plant_phototropism_evidence",
    cognitive_level: "conceptual_explanation",
    subskills: [
      "identify_light_response",
      "connect_growth_pattern_to_light_direction",
      "reject_direct_pull_or_random_growth"
    ],
    expected_solution_actions: [
      "Explain that the plant responds to light through differential growth.",
      "Connect growth toward the window to more growth on the shaded side.",
      "Reject explanations based on light directly pulling the stem or random growth."
    ],
    option_misconception_map: {
      A: ["target_understanding"],
      B: ["light_directly_pulls_stem"],
      C: ["growth_direction_is_random"]
    },
    option_diagnostic_notes: {
      A: "Connects plant growth direction to response to light.",
      B: "Treats light as directly pulling the stem.",
      C: "Treats directional growth as random rather than responsive."
    }
  },
  item_demo_phase4b_2: {
    concept_id: "linear_equation_inverse_operations",
    cognitive_level: "procedural_explanation",
    subskills: [
      "undo_multiplication_before_subtraction",
      "preserve_equation_balance",
      "explain_inverse_operation_order"
    ],
    expected_solution_actions: [
      "Divide both sides by 3 to isolate x + 2.",
      "Subtract 2 from both sides to solve for x.",
      "Reject operation orders that do not preserve the grouped expression."
    ],
    option_misconception_map: {
      A: ["target_understanding"],
      B: ["subtracts_constant_before_undoing_group_multiplier"],
      C: ["uses_forward_operations_instead_of_inverse_operations"]
    },
    option_diagnostic_notes: {
      A: "Uses inverse operations in a valid order for 3(x + 2) = 21.",
      B: "Subtracts 2 before undoing multiplication by 3.",
      C: "Applies operations that move away from isolating x."
    }
  },
  item_demo_phase4b_3: {
    concept_id: "thermal_energy_transfer_direction",
    cognitive_level: "conceptual_explanation",
    subskills: [
      "identify_hot_to_cool_energy_transfer",
      "compare_thermal_states",
      "reject_no_transfer_or_reversed_transfer"
    ],
    expected_solution_actions: [
      "Explain that energy transfers from the hotter tea to the cooler surrounding air.",
      "Use relative temperature to determine transfer direction.",
      "Reject claims that matter status prevents energy transfer."
    ],
    option_misconception_map: {
      A: ["target_understanding"],
      B: ["reverses_hot_to_cool_transfer_direction"],
      C: ["matter_status_prevents_energy_transfer"]
    },
    option_diagnostic_notes: {
      A: "Uses relative temperature to identify transfer from tea to air.",
      B: "Reverses the direction of energy transfer.",
      C: "Claims energy transfer does not occur because both substances are matter."
    }
  }
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .map((value) => value.trim())
    )
  ];
}

export function mergeProvisionalDiagnosticMetadata(input: {
  item_public_id: string;
  administration_rules: unknown;
}): Prisma.InputJsonObject {
  const metadata = PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_BY_ITEM_ID[input.item_public_id];
  const rules = record(input.administration_rules);

  if (!metadata) {
    return rules as Prisma.InputJsonObject;
  }

  return {
    ...rules,
    concept_id: metadata.concept_id,
    cognitive_level: metadata.cognitive_level,
    subskills: metadata.subskills,
    expected_solution_actions: metadata.expected_solution_actions,
    option_misconception_map: metadata.option_misconception_map,
    option_diagnostic_notes: metadata.option_diagnostic_notes,
    metadata_source: PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_SOURCE,
    metadata_review_status: PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_REVIEW_STATUS,
    metadata_provisional: true,
    metadata_limitations: uniqueStrings([
      ...(Array.isArray(rules.metadata_limitations) ? rules.metadata_limitations : []),
      PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_LIMITATION
    ])
  } as Prisma.InputJsonObject;
}

export async function applyProvisionalItemDiagnosticMetadata(prismaClient: PrismaClient) {
  const itemPublicIds = Object.keys(PROVISIONAL_ITEM_DIAGNOSTIC_METADATA_BY_ITEM_ID);
  const items = await prismaClient.item.findMany({
    where: { item_public_id: { in: itemPublicIds } },
    select: {
      id: true,
      item_public_id: true,
      administration_rules: true
    }
  });
  let updated = 0;

  for (const item of items) {
    const nextRules = mergeProvisionalDiagnosticMetadata({
      item_public_id: item.item_public_id,
      administration_rules: item.administration_rules
    });

    await prismaClient.item.update({
      where: { id: item.id },
      data: { administration_rules: nextRules }
    });
    updated += 1;
  }

  return {
    expected_item_count: itemPublicIds.length,
    found_item_count: items.length,
    updated_item_count: updated,
    missing_item_public_ids: itemPublicIds.filter(
      (itemPublicId) => !items.some((item) => item.item_public_id === itemPublicId)
    )
  };
}
