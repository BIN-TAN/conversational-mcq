import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { asArray, asRecord } from "@/lib/services/teacher-review/serializers";

export const ATTEMPT_COMPARISON_VERSION = "attempt-comparison-v1";
export const ATTEMPT_VIEWS = ["1", "2", "3", "latest"] as const;
export type AttemptView = typeof ATTEMPT_VIEWS[number];
export type AttemptPair = "1-2" | "2-3" | "1-3" | "first-latest";

type Package = { package_type: string; payload: unknown; created_at: Date };
export type AttemptSource = {
  session_public_id: string; attempt_number: number; status: string; started_at: Date | null; created_at: Date;
  user: { user_id: string };
  assessment: { assessment_public_id: string; title: string; revision_family_public_id: string | null;
    concept_units: Array<{ id: string }> };
  concept_unit_sessions: Array<{ concept_unit_db_id: string; response_packages: Package[] }>;
};
export type SubmittedItem = {
  item_key: string; item_public_id: string; item_version: number | null; item_order: number;
  stem: string; options: Array<{ label: string; text: string }>;
  objective: string; selected_option: string | null; confidence: string | null;
  correctness: string | null; reasoning: string | null;
  first_option: string | null; first_confidence: string | null; first_reasoning: string | null;
  scoring_key: string | null;
  submitted_at: string; evidence_source: "sealed_initial_package";
};
export type AttemptObservation = {
  student_key: string; session_public_id: string; assessment_public_id: string; assessment_title: string;
  assessment_family_public_id: string; attempt_number: number; status: string; started_at: string;
  submitted_at: string | null; items: SubmittedItem[]; limitation: string | null;
  chance_policy: string | null; chance_waived_at: string | null;
};
const text = (value: unknown) => typeof value === "string" ? value : null;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function packageItems(pkg: Package, sessionId: string): SubmittedItem[] {
  const payload = asRecord(pkg.payload);
  const included = asArray(payload.included_items).map(asRecord);
  const includedIds = new Set(included.map(item => text(item.item_public_id)).filter(Boolean));
  const concept = asRecord(payload.concept_unit);
  return asArray(payload.item_responses).map(asRecord).filter(item =>
    includedIds.size ? includedIds.has(text(item.item_public_id)) : item.item_role !== "transfer"
  ).flatMap(item => {
    const id = text(item.item_public_id);
    if (!id) return [];
    const snapshot = asRecord(item.item_snapshot);
    const content = Object.keys(asRecord(snapshot.item)).length ? asRecord(snapshot.item) : snapshot;
    const definition = included.find(entry => entry.item_public_id === id) ?? {};
    const stem = text(content.item_stem) ?? text(definition.item_stem) ?? "Item wording unavailable";
    const rawOptions = content.options ?? definition.options;
    const options = Array.isArray(rawOptions) ? rawOptions.map(asRecord).map(option => ({
      label: text(option.label) ?? "", text: text(option.text) ?? ""
    })) : Object.entries(asRecord(rawOptions)).map(([label, value]) => ({ label, text: String(value) }));
    const version = typeof item.item_version_snapshot === "number" ? item.item_version_snapshot : null;
    // Unknown snapshots never match across attempts. Stable content, not session IDs, defines comparability.
    const signature = hash({ stem, options, media: content.media_assets ?? [] });
    const comparable = version !== null && options.length > 0 && stem !== "Item wording unavailable";
    return [{ item_key: `${id}:v${version}:${comparable ? signature : `unknown:${hash(sessionId)}`}`,
      item_public_id: id, item_version: version, item_order: Number(item.initial_item_position ?? item.item_order ?? 0),
      stem, options, objective: text(item.knowledge_component) ?? text(concept.learning_objective) ?? text(concept.title) ?? "Unspecified objective",
      selected_option: text(item.selected_answer_final) ?? text(item.selected_option),
      confidence: text(item.confidence_final) ?? text(item.confidence_rating),
      correctness: ["correct", "incorrect"].includes(String(item.correctness)) ? String(item.correctness) : null,
      reasoning: text(item.reasoning_text_final) ?? text(item.reasoning_text),
      first_option: text(item.selected_answer_initial), first_confidence: text(item.confidence_initial),
      first_reasoning: text(item.reasoning_text_initial), submitted_at: pkg.created_at.toISOString(),
      scoring_key: text(item.correct_option_snapshot),
      evidence_source: "sealed_initial_package" as const }];
  });
}

export function observeAttempts(sessions: AttemptSource[], chances: Array<{
  session_public_id: string; policy_version: string; waived_at: Date | null;
}> = []): AttemptObservation[] {
  const chanceBySession = new Map(chances.map(chance => [chance.session_public_id, chance]));
  return sessions.map(session => {
    const packages = session.concept_unit_sessions.flatMap(concept => {
      const first = concept.response_packages.filter(pkg => pkg.package_type === "initial_concept_unit_response_package")
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
      return first ? [{ concept: concept.concept_unit_db_id, pkg: first }] : [];
    });
    const expected = session.assessment.concept_units;
    const complete = expected.length > 0 && expected.every(concept => packages.some(entry => {
      if (entry.concept !== concept.id) return false;
      const payload = asRecord(entry.pkg.payload);
      const expectedItems = Number(payload.initial_item_count ?? asArray(payload.included_items).length);
      if (typeof payload.completed_initial_item_count === "number" && payload.completed_initial_item_count !== expectedItems) return false;
      const actualItems = packageItems(entry.pkg, session.session_public_id);
      return expectedItems > 0 && actualItems.length === expectedItems && new Set(actualItems.map(item => item.item_public_id)).size === expectedItems;
    }));
    const items = packages.flatMap(entry => packageItems(entry.pkg, session.session_public_id));
    const chance = chanceBySession.get(session.session_public_id);
    const valid = complete && items.length > 0;
    return { student_key: session.user.user_id, session_public_id: session.session_public_id,
      assessment_public_id: session.assessment.assessment_public_id, assessment_title: session.assessment.title,
      assessment_family_public_id: session.assessment.revision_family_public_id ?? session.assessment.assessment_public_id,
      attempt_number: session.attempt_number, status: session.status,
      started_at: (session.started_at ?? session.created_at).toISOString(),
      submitted_at: valid ? new Date(Math.max(...packages.map(entry => entry.pkg.created_at.getTime()))).toISOString() : null,
      items, limitation: valid ? null : "incomplete_or_missing_sealed_initial_package",
      chance_policy: chance?.policy_version ?? null, chance_waived_at: chance?.waived_at?.toISOString() ?? null };
  });
}

export async function loadAttemptObservations(db: Prisma.TransactionClient, where: Prisma.AssessmentSessionWhereInput) {
  const sessions = await db.assessmentSession.findMany({ where, select: {
    session_public_id: true, attempt_number: true, status: true, started_at: true, created_at: true,
    user: { select: { user_id: true } },
    assessment: { select: { assessment_public_id: true, title: true, revision_family_public_id: true,
      concept_units: { where: { items: { some: { included_in_published_set: true } } }, select: { id: true } } } },
    concept_unit_sessions: { select: { concept_unit_db_id: true,
      response_packages: { where: { package_type: "initial_concept_unit_response_package" },
        orderBy: { created_at: "asc" }, take: 1, select: { package_type: true, payload: true, created_at: true } } } }
  } });
  const chances = await db.assessmentAttemptChance.findMany({
    where: { session_public_id: { in: sessions.map(session => session.session_public_id) } },
    select: { session_public_id: true, policy_version: true, waived_at: true }
  });
  return observeAttempts(sessions, chances);
}

function byStudent(attempts: AttemptObservation[]) {
  const result = new Map<string, AttemptObservation[]>();
  for (const attempt of attempts) {
    const key = `${attempt.assessment_public_id}:${attempt.student_key}`;
    result.set(key, [...(result.get(key) ?? []), attempt]);
  }
  for (const group of result.values()) group.sort((a, b) => a.attempt_number - b.attempt_number || a.started_at.localeCompare(b.started_at));
  return result;
}

export function selectSubmittedAttempts(attempts: AttemptObservation[], view: AttemptView) {
  return [...byStudent(attempts).values()].flatMap(group => {
    const submitted = group.filter(attempt => attempt.submitted_at && !attempt.chance_waived_at);
    const selected = view === "latest" ? submitted.at(-1) : submitted.find(attempt => attempt.attempt_number === Number(view));
    return selected ? [selected] : [];
  });
}

export function matchAttempts(attempts: AttemptObservation[], pair: AttemptPair) {
  return [...byStudent(attempts).values()].flatMap(group => {
    const valid = group.filter(attempt => attempt.submitted_at && !attempt.chance_waived_at);
    const firstNumber = pair === "2-3" ? 2 : 1;
    const from = valid.find(attempt => attempt.attempt_number === firstNumber);
    const to = pair === "first-latest" ? valid.at(-1) : valid.find(attempt => attempt.attempt_number === Number(pair.slice(-1)));
    return from && to && from.session_public_id !== to.session_public_id ? [{ from, to }] : [];
  });
}

export function responseMetrics(items: SubmittedItem[]) {
  const scored = items.filter(item => item.correctness !== null);
  const correct = scored.filter(item => item.correctness === "correct").length;
  const confidenceObserved = scored.filter(item => ["low", "medium", "high"].includes(item.confidence ?? ""));
  const highIncorrect = confidenceObserved.filter(item => item.correctness === "incorrect" && item.confidence === "high").length;
  return { response_count: items.length, scored_response_count: scored.length, correct_count: correct,
    correct_percentage: scored.length ? Math.round(correct / scored.length * 1000) / 10 : null,
    high_confidence_incorrect_count: highIncorrect, confidence_scored_count: confidenceObserved.length,
    high_confidence_incorrect_percentage: confidenceObserved.length ? Math.round(highIncorrect / confidenceObserved.length * 1000) / 10 : null,
    option_counts: counts(items.map(item => item.selected_option ?? "Not recorded")),
    confidence_counts: counts(items.map(item => item.confidence ?? "Not recorded")) };
}
function counts(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function buildAttemptComparison(attempts: AttemptObservation[], options: {
  pair?: AttemptPair; mode?: "all" | "matched"; all_three?: boolean; objective?: string;
  eligible_student_count?: number; snapshot_at: string;
}) {
  const pair = options.pair ?? "1-2";
  let scoped = attempts;
  if (options.all_three) {
    const eligible = new Set([...byStudent(attempts).entries()].filter(([, group]) =>
      ["1", "2", "3"].every(view => selectSubmittedAttempts(group, view as AttemptView).length)).map(([key]) => key));
    scoped = attempts.filter(attempt => eligible.has(`${attempt.assessment_public_id}:${attempt.student_key}`));
  }
  const pairs = matchAttempts(scoped, pair);
  const participants = options.mode === "matched" ? new Set(pairs.map(entry => entry.from.student_key)) : null;
  if (participants) scoped = scoped.filter(attempt => participants.has(attempt.student_key));
  const cohortSize = participants?.size ?? (options.all_three ? byStudent(scoped).size : options.eligible_student_count) ?? byStudent(scoped).size;
  const itemFilter = (item: SubmittedItem) => !options.objective || item.objective === options.objective;
  const columns = ATTEMPT_VIEWS.map(view => {
    const selected = selectSubmittedAttempts(scoped, view);
    return { view, student_count: selected.length,
      missing_student_count: Math.max(0, cohortSize - selected.length),
      ...responseMetrics(selected.flatMap(attempt => attempt.items.filter(itemFilter))) };
  });
  const itemDefinitions = new Map(scoped.flatMap(attempt => attempt.items.filter(itemFilter)).map(item => [item.item_key, item]));
  const items = [...itemDefinitions.values()].sort((a, b) => a.item_order - b.item_order || a.item_key.localeCompare(b.item_key)).map(item => ({
    item_key: item.item_key, item_public_id: item.item_public_id, item_version: item.item_version,
    stem: item.stem, options: item.options, objective: item.objective,
    columns: ATTEMPT_VIEWS.map(view => ({ view, ...responseMetrics(selectSubmittedAttempts(scoped, view)
      .flatMap(attempt => attempt.items.filter(entry => entry.item_key === item.item_key))) }))
  }));
  const transitions = pairs.flatMap(({ from, to }) => from.items.filter(itemFilter).flatMap(before => {
    const after = to.items.find(item => item.item_key === before.item_key && item.scoring_key === before.scoring_key);
    if (!after) return [];
    return [{ student_key: from.student_key, from_session: from.session_public_id, to_session: to.session_public_id,
      from_attempt: from.attempt_number, to_attempt: to.attempt_number, item_key: before.item_key,
      correctness_change: before.correctness && after.correctness ? `${before.correctness}_to_${after.correctness}` : "unscored",
      option_change: `${before.selected_option ?? "Not recorded"} -> ${after.selected_option ?? "Not recorded"}`,
      confidence_change: `${before.confidence ?? "Not recorded"} -> ${after.confidence ?? "Not recorded"}`,
      before, after, elapsed_between_submissions_ms: Date.parse(to.submitted_at!) - Date.parse(from.submitted_at!) }];
  }));
  return { version: ATTEMPT_COMPARISON_VERSION, snapshot_at: options.snapshot_at, pair, mode: options.mode ?? "all",
    eligible_student_count: options.eligible_student_count ?? byStudent(attempts).size,
    cohort_student_count: cohortSize,
    participating_students: byStudent(scoped).size, matched_student_count: pairs.length,
    comparable_student_count: new Set(transitions.map(row => row.student_key)).size,
    incomplete_attempt_count: scoped.filter(attempt => !attempt.submitted_at).length,
    waived_attempt_count: attempts.filter(attempt => attempt.chance_waived_at).length,
    objectives: [...new Set(attempts.flatMap(attempt => attempt.items.map(item => item.objective)))].sort(),
    columns, items: items.map(item => {
      const matched = transitions.filter(row => row.item_key === item.item_key);
      return { ...item, paired_response_count: matched.length,
        option_transitions: counts(matched.map(row => row.option_change)),
        confidence_transitions: counts(matched.map(row => row.confidence_change)) };
    }), transition_summary: counts(transitions.map(row => row.correctness_change)),
    comparable_item_pairs: transitions.length,
    unmatched_item_pairs: pairs.reduce((sum, entry) => sum + entry.from.items.filter(itemFilter).length, 0) - transitions.length,
    transitions };
}

export type AttemptComparison = Omit<ReturnType<typeof buildAttemptComparison>, "transitions">;
