"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { FlaggedItemReview, TutorItemFlag } from "@/lib/services/item-review/service";
import { ItemContent } from "@/components/item-content";

type ItemReviewResponse = {
  item_review: {
    assessment_public_id: string;
    assessment_title: string;
    items: FlaggedItemReview[];
    untied_tutor_flags?: TutorItemFlag[];
  };
};

async function request(assessmentPublicId: string, body?: unknown) {
  const response = await fetch(`/api/teacher/assessments/${encodeURIComponent(assessmentPublicId)}/item-review`, {
    method: body ? "POST" : "GET",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Item review could not be loaded.");
  return (payload as ItemReviewResponse).item_review;
}

function itemNumberList(numbers: number[]) {
  if (numbers.length === 1) return `Item ${numbers[0]}`;
  return `Items ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * Items the interpretation or the feedback tutor flagged as a possible item issue. A flag never changes a
 * student's rating; only the instructor's decision here removes an item from the count,
 * for every student who took it.
 */
export function ItemReviewPanel({ assessmentPublicId }: { assessmentPublicId: string }) {
  const [items, setItems] = useState<FlaggedItemReview[] | null>(null);
  const [untiedFlags, setUntiedFlags] = useState<TutorItemFlag[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    request(assessmentPublicId)
      .then((review) => {
        if (!active) return;
        setItems(review.items);
        setUntiedFlags(review.untied_tutor_flags ?? []);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Item review could not be loaded."); });
    return () => { active = false; };
  }, [assessmentPublicId]);

  async function decide(itemPublicId: string, decision: "kept" | "excluded") {
    setBusy(itemPublicId);
    setError(null);
    try {
      const review = await request(assessmentPublicId, { item_public_id: itemPublicId, decision, note: notes[itemPublicId] ?? null });
      setItems(review.items);
      setUntiedFlags(review.untied_tutor_flags ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !items) return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>;
  if (!items) {
    return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading item review</p>;
  }
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-ualberta-green-dark">Item review</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          These items were flagged as a possible item problem, either when a student&apos;s answers were interpreted (their
          reading of the item looked defensible) or by the tutor in a feedback conversation. A flag never changes a rating. Keep the item, or exclude it for every student who took it; labels are recomputed and stored profiles
          stay unchanged. You can change a decision later.
        </p>
      </div>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
      {items.length === 0 && untiedFlags.length === 0 ? <p className="rounded-md border border-dashed border-line bg-white p-4 text-sm text-muted">No items are flagged.</p> : null}
      {items.map((item) => (
        <article key={item.item_public_id} className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {item.item_number === null ? "Item not in the published set" : `Item ${item.item_number}`}
                <Link className="ml-3 normal-case tracking-normal text-accent underline-offset-2 hover:underline"
                  href={`/teacher/content/items/${encodeURIComponent(item.item_public_id)}`}>Open the item</Link>
              </p>
              <ItemContent className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink" text={item.item_stem} />
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {item.options.map((option) => (
                  <ItemContent as="li" key={option.label} prefix={`${option.label}.`} suffix={option.label === item.correct_option ? " (answer key)" : ""} text={option.text} />
                ))}
              </ul>
            </div>
            <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${item.awaiting_decision ? "bg-amber-50 text-amber-900" : item.decision === "excluded" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
              {item.awaiting_decision
                ? item.decision ? "New flag since your decision" : "Awaiting your decision"
                : item.decision === "excluded" ? "Excluded" : "Kept"}
            </span>
          </div>
          <p className="mt-3 text-sm text-muted">
            {item.flagged_by.length ? `Flagged in the interpretation of ${item.flagged_by.length} of the ${item.students_with_item} students who took it.` : ""}
            {item.tutor_flags.length ? ` Flagged by the tutor in ${item.tutor_flags.length} feedback ${item.tutor_flags.length === 1 ? "conversation" : "conversations"}.` : ""}
            {item.labels_pending_review ? ` ${item.labels_pending_review} labels are withheld until you decide.` : ""}
            {` Excluding it would change ${item.labels_that_change_if_excluded} ${item.labels_that_change_if_excluded === 1 ? "label" : "labels"}.`}
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6">
            {item.flagged_by.map((flag, index) => (
              <li key={`${flag.student_label}-${flag.attempt_number}-${index}`} className="rounded-md border border-line bg-slate-50 p-3">
                <p className="text-xs text-muted">{flag.student_label}, attempt {flag.attempt_number}, chose {flag.selected_option ?? "no option"}</p>
                {flag.student_quote ? <p className="text-ink">&ldquo;{flag.student_quote}&rdquo;</p> : null}
                {flag.model_rationale ? <p className="text-xs text-muted">Why flagged: {flag.model_rationale}</p> : null}
              </li>
            ))}
          </ul>
          {item.tutor_flags.length ? (
            <ul className="mt-3 space-y-2 text-sm leading-6" aria-label="Flags from feedback conversations">
              {item.tutor_flags.map((flag) => (
                <li key={flag.signal_public_id} className="rounded-md border border-line bg-slate-50 p-3">
                  <p className="text-xs text-muted">
                    Tutor, in {flag.student_label}&apos;s feedback conversation (attempt {flag.attempt_number})
                    {flag.student_item_numbers.length && !(flag.student_item_numbers.length === 1 && flag.student_item_numbers[0] === item.item_number)
                      ? `, about the student's ${itemNumberList(flag.student_item_numbers)}` : ""}
                    {item.decision ? (flag.after_decision ? ", after your decision" : ", before your decision") : ""}
                  </p>
                  {flag.reason ? <p className="text-ink">{flag.reason}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <label className="mt-3 block text-sm font-semibold text-ink">
            Note (optional)
            <textarea className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" rows={2}
              value={notes[item.item_public_id] ?? item.decision_note ?? ""}
              onChange={(event) => setNotes((current) => ({ ...current, [item.item_public_id]: event.target.value }))} />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => void decide(item.item_public_id, "kept")}
              className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50">Keep the item</button>
            <button type="button" disabled={busy !== null} onClick={() => void decide(item.item_public_id, "excluded")}
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">Exclude for every student</button>
            {busy === item.item_public_id ? <Loader2 className="h-4 w-4 animate-spin self-center" aria-hidden="true" /> : null}
          </div>
        </article>
      ))}
      {untiedFlags.length ? (
        <article className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
          <h3 className="text-sm font-semibold text-ink">Tutor flags that do not name an item</h3>
          <p className="mt-1 text-sm text-muted">
            The tutor flagged a possible item problem in these conversations without saying which item. Read the reason, and open the
            student&apos;s session if you need the context.
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6">
            {untiedFlags.map((flag) => (
              <li key={flag.signal_public_id} className="rounded-md border border-line bg-slate-50 p-3">
                <p className="text-xs text-muted">Tutor, in {flag.student_label}&apos;s feedback conversation (attempt {flag.attempt_number})</p>
                {flag.reason ? <p className="text-ink">{flag.reason}</p> : null}
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}
