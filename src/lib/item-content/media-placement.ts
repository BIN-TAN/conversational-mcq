/**
 * Where an item media asset is shown (stored in item_media_assets.placement):
 * - item_stem: with the question text, during answering and everywhere the question is shown;
 * - option: with one answer option (option_label names it);
 * - explanation: with the item's explanation, shown to students only in the answer review
 *   after their answers are sealed (it may reveal the key), and to instructors in previews.
 * item_stem and option are the original values; explanation was added in release
 * CMCQ-20261024-11. Stored records with the original values read exactly as before.
 */

export const ITEM_MEDIA_PLACEMENTS = ["item_stem", "option", "explanation"] as const;
export type ItemMediaPlacementValue = (typeof ITEM_MEDIA_PLACEMENTS)[number];

/** Placements students may see while they answer (never explanation media). */
export const ANSWERING_MEDIA_PLACEMENTS = ["item_stem", "option"] as const;

export const ITEM_MEDIA_PLACEMENT_LABELS: Record<ItemMediaPlacementValue, string> = {
  item_stem: "Question text",
  option: "An answer option",
  explanation: "Explanation (answer review)"
};

export function isItemMediaPlacement(value: unknown): value is ItemMediaPlacementValue {
  return typeof value === "string" && (ITEM_MEDIA_PLACEMENTS as readonly string[]).includes(value);
}

export function isAnsweringMediaPlacement(value: unknown): value is (typeof ANSWERING_MEDIA_PLACEMENTS)[number] {
  return value === "item_stem" || value === "option";
}

/** A placement value from any source; null when it is not one of the stored values. */
export function parseItemMediaPlacement(value: unknown): ItemMediaPlacementValue | null {
  return isItemMediaPlacement(value) ? value : null;
}
