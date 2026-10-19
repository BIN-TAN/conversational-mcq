/**
 * D13 (docs/DESIGN_ALIGNMENT_2026-10-17.md): no transfer labels in the profile produced
 * from the mini-test.
 *
 * The mini-test has no transfer task, so the profile produced from it cannot support a
 * claim that the student is ready to transfer the idea to new situations. The profiling
 * instructions and output format belong to the approved live AI configuration and still
 * list the transfer labels, so this rule is applied when that profile is saved:
 *  - ability_profile robust_transfer_ready_understanding is saved as
 *    mostly_correct_understanding (the dashboard category, Mostly understood, is the same);
 *  - the transfer_ready ability pattern flag is removed (no_clear_pattern when no flag remains).
 * The model's original output stays unchanged in its AgentCall record (output_payload), so
 * each replacement can be counted (initialProfileTransferRule).
 *
 * The integrated label robust_understanding_ready_for_transfer has no counterpart without a
 * transfer claim in the fixed list, and the formative conversation reads it as "sound
 * understanding" at the start. Its stored code is kept; readers see
 * INITIAL_PROFILE_ROBUST_READABLE_LABEL instead.
 *
 * Profiles recommended during the formative conversation are not changed: there a transfer
 * label requires independent_transfer_application evidence from the conversation itself.
 */
export const INITIAL_PROFILE_TRANSFER_RULE_VERSION = "initial-profile-transfer-labels-blocked-v1" as const;

export const TRANSFER_ABILITY_PROFILE = "robust_transfer_ready_understanding" as const;
export const NON_TRANSFER_ABILITY_PROFILE = "mostly_correct_understanding" as const;
export const TRANSFER_ABILITY_PATTERN_FLAG = "transfer_ready" as const;
export const TRANSFER_INTEGRATED_PROFILE = "robust_understanding_ready_for_transfer" as const;
export const INITIAL_PROFILE_ROBUST_READABLE_LABEL = "Robust understanding (transfer not assessed)";

type TransferLabelFields = {
  ability_profile: string;
  ability_pattern_flags: readonly string[];
};

function flagList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((flag): flag is string => typeof flag === "string") : [];
}

export function hasInitialProfileTransferLabel(profile: { ability_profile: string; ability_pattern_flags: unknown }) {
  return profile.ability_profile === TRANSFER_ABILITY_PROFILE ||
    flagList(profile.ability_pattern_flags).includes(TRANSFER_ABILITY_PATTERN_FLAG);
}

/** Returns the output unchanged when it carries no transfer label. */
export function blockInitialProfileTransferLabels<T extends TransferLabelFields>(output: T): T {
  if (!hasInitialProfileTransferLabel(output)) return output;
  const flags = output.ability_pattern_flags.filter((flag) => flag !== TRANSFER_ABILITY_PATTERN_FLAG);
  return {
    ...output,
    ability_profile: output.ability_profile === TRANSFER_ABILITY_PROFILE
      ? NON_TRANSFER_ABILITY_PROFILE
      : output.ability_profile,
    ability_pattern_flags: flags.length > 0 ? flags : ["no_clear_pattern"]
  } as T;
}

export type InitialProfileTransferRuleStatus =
  | "transfer_label_replaced"
  | "no_transfer_label"
  | "saved_before_rule";

/**
 * Research-export status for a profile saved from student_profiling_agent output; null for
 * other profiles (conversation updates, intermediate planning profiles, fallbacks without a call).
 * saved_before_rule marks a stored transfer label from before this rule.
 */
export function initialProfileTransferRule(profile: {
  ability_profile: string;
  ability_pattern_flags: unknown;
  based_on_agent_call?: { agent_name?: string | null; output_payload?: unknown } | null;
}): InitialProfileTransferRuleStatus | null {
  if (profile.based_on_agent_call?.agent_name !== "student_profiling_agent") return null;
  if (hasInitialProfileTransferLabel(profile)) return "saved_before_rule";
  const payload = profile.based_on_agent_call.output_payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const output = payload as Record<string, unknown>;
    if (typeof output.ability_profile === "string" &&
      hasInitialProfileTransferLabel({ ability_profile: output.ability_profile, ability_pattern_flags: output.ability_pattern_flags })) {
      return "transfer_label_replaced";
    }
  }
  return "no_transfer_label";
}

/**
 * Teacher-page label for a stored profile code. In profiles produced from the mini-test
 * (profile_type initial) the transfer codes are shown without the transfer claim.
 */
export function profileCodeReadableLabel(code: string, profileType: string | null | undefined) {
  if (profileType === "initial" && (code === TRANSFER_INTEGRATED_PROFILE || code === TRANSFER_ABILITY_PROFILE)) {
    return INITIAL_PROFILE_ROBUST_READABLE_LABEL;
  }
  return code.replace(/_/g, " ");
}
