/**
 * Agreement statistics for the interpretation v8 evaluation (design document, section 11.1).
 * Pure functions over (reference, compared) pairs of category labels.
 */
export type LabelPair = readonly [reference: string, compared: string];

export type ConfusionMatrix = {
  categories: string[];
  /** counts[reference][compared] */
  counts: Record<string, Record<string, number>>;
  n: number;
};

export function confusionMatrix(pairs: readonly LabelPair[], categories?: readonly string[]): ConfusionMatrix {
  const labels = [...new Set([...(categories ?? []), ...pairs.flatMap(([a, b]) => [a, b])])];
  const counts: ConfusionMatrix["counts"] = Object.fromEntries(labels.map((row) => [row, Object.fromEntries(labels.map((column) => [column, 0]))]));
  for (const [reference, compared] of pairs) counts[reference][compared] += 1;
  return { categories: labels, counts, n: pairs.length };
}

export function percentAgreement(pairs: readonly LabelPair[]): number | null {
  if (!pairs.length) return null;
  return pairs.filter(([a, b]) => a === b).length / pairs.length;
}

function marginals(pairs: readonly LabelPair[], categories: readonly string[]) {
  const n = pairs.length;
  return categories.map((category) => ({
    category,
    reference: pairs.filter(([a]) => a === category).length / n,
    compared: pairs.filter(([, b]) => b === category).length / n
  }));
}

/** Cohen's kappa. Null when it is undefined (no pairs, or chance agreement of 1). */
export function cohensKappa(pairs: readonly LabelPair[], categories?: readonly string[]): number | null {
  if (!pairs.length) return null;
  const labels = confusionMatrix(pairs, categories).categories;
  const observed = percentAgreement(pairs)!;
  const expected = marginals(pairs, labels).reduce((sum, entry) => sum + entry.reference * entry.compared, 0);
  if (expected >= 1) return null;
  return (observed - expected) / (1 - expected);
}

/**
 * Gwet's AC1 for two raters. Less affected than kappa when one category dominates, which
 * is expected here ("adequate"). Q is the number of categories in the coding scheme, so pass
 * the full category list.
 */
export function gwetAC1(pairs: readonly LabelPair[], categories: readonly string[]): number | null {
  if (!pairs.length || categories.length < 2) return null;
  const observed = percentAgreement(pairs)!;
  const q = categories.length;
  const chance = marginals(pairs, categories).reduce((sum, entry) => {
    const pi = (entry.reference + entry.compared) / 2;
    return sum + pi * (1 - pi);
  }, 0) / (q - 1);
  if (chance >= 1) return null;
  return (observed - chance) / (1 - chance);
}

/** Wilson score interval for a proportion (95% by default). */
export function wilsonInterval(successes: number, total: number, z = 1.96): { low: number; high: number } | null {
  if (!total) return null;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export function precisionRecall(counts: { true_positive: number; false_positive: number; false_negative: number }) {
  const { true_positive: tp, false_positive: fp, false_negative: fn } = counts;
  return {
    ...counts,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null
  };
}

/** Share of units whose label is identical in every run (units with fewer than two runs are skipped). */
export function stability(runsByUnit: ReadonlyMap<string, readonly string[]>): { stable: number; units: number; share: number | null } {
  let stable = 0;
  let units = 0;
  for (const labels of runsByUnit.values()) {
    if (labels.length < 2) continue;
    units += 1;
    if (labels.every((label) => label === labels[0])) stable += 1;
  }
  return { stable, units, share: units ? stable / units : null };
}

export function round(value: number | null, digits = 3) {
  return value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
}
