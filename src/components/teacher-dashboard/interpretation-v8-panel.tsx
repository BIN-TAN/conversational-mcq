"use client";

import type { TeacherAssessmentDashboard } from "@/lib/services/teacher-dashboard/assessment-dashboard";
import type { V8AttemptGroupSummary } from "@/lib/services/teacher-dashboard/interpretation-v8-summary";

type V8Dashboard = NonNullable<TeacherAssessmentDashboard["interpretation_v8"]>;

function referenceLabel(referenceId: string) {
  const parts = referenceId.split(":");
  if (parts[0] === "topic") return parts[1] === "objective" ? "Learning objective" : "Topic description";
  if (parts[1] === "option") return `Rationale for option ${parts[2]}`;
  if (parts[1] === "target") return "Target reasoning";
  if (parts[1] === "elements") return "Essential elements";
  return referenceId;
}

function percent(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0;
}

function GroupSummary({ title, description, group }: { title: string; description: string; group: V8AttemptGroupSummary }) {
  return (
    <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <h3 className="text-lg font-semibold text-ualberta-green-dark">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      {group.students === 0 ? (
        <p className="mt-4 text-sm text-muted">No attempts in this group yet.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">
            {group.students} students; {group.interpreted_students} interpreted
            {group.fallback_students ? `, ${group.fallback_students} without an interpretation (no claims made)` : ""}.
            {group.based_on_median.administered_items !== null
              ? ` Labels are typically based on ${group.based_on_median.interpretable_items} of ${group.based_on_median.administered_items} items.`
              : ""}
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {group.summary_distribution.map((entry) => (
              <li key={entry.label}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium text-ink">{entry.label}</span>
                  <span className="text-muted">{entry.count} ({percent(entry.count, group.students)}%)</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
                  <div className="h-2 rounded-full bg-ualberta-green" style={{ width: `${Math.max(percent(entry.count, group.students), entry.count ? 3 : 0)}%` }} />
                </div>
              </li>
            ))}
          </ul>

          <h4 className="mt-5 text-sm font-semibold text-ink">Possible misconceptions</h4>
          {group.possible_misconceptions.length ? (
            <ul className="mt-2 space-y-2 text-sm leading-6">
              {group.possible_misconceptions.map((claim) => (
                <li key={claim.reference_id} className="rounded-md border border-line bg-slate-50 p-3">
                  <p className="text-ink">{claim.example_idea}</p>
                  <p className="text-xs text-muted">
                    {claim.students} students ({claim.endorsed} stated firmly, {claim.tentative} tentatively); questions {claim.item_numbers.join(", ") || "not recorded"}; contradicts: {referenceLabel(claim.reference_id)}.
                  </p>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted">None stated and endorsed in students&apos; own words.</p>}

          {group.considered_ideas.length ? (
            <>
              <h4 className="mt-5 text-sm font-semibold text-ink">Ideas considered but not endorsed</h4>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-muted">
                {group.considered_ideas.map((idea) => (
                  <li key={idea.reference_id}>{idea.example_idea} ({idea.students} students{idea.item_number ? `, question ${idea.item_number}` : ""})</li>
                ))}
              </ul>
            </>
          ) : null}

          {group.answer_patterns.length ? (
            <>
              <h4 className="mt-5 text-sm font-semibold text-ink">Answer patterns (choices only, unconfirmed)</h4>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-muted">
                {group.answer_patterns.map((pattern) => (
                  <li key={pattern.shared_idea}>Choices consistent with &quot;{pattern.shared_idea}&quot;: {pattern.students} students</li>
                ))}
              </ul>
            </>
          ) : null}

          <h4 className="mt-5 text-sm font-semibold text-ink">Item status</h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 pr-2">Question</th>
                  <th className="py-1 pr-2">Supported</th>
                  <th className="py-1 pr-2">Partly</th>
                  <th className="py-1 pr-2">Not supported</th>
                  <th className="py-1 pr-2">Not interpretable</th>
                  <th className="py-1 pr-2">Only option wording</th>
                  <th className="py-1">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {group.item_status.map((item) => (
                  <tr key={item.item_id} className="border-t border-line">
                    <td className="py-1 pr-2 font-medium text-ink">{item.item_number}</td>
                    <td className="py-1 pr-2">{item.supported}</td>
                    <td className="py-1 pr-2">{item.partly_supported}</td>
                    <td className="py-1 pr-2">{item.not_supported}</td>
                    <td className="py-1 pr-2">{item.not_interpretable}</td>
                    <td className="py-1 pr-2">{item.beyond_option_text_no}</td>
                    <td className="py-1">{item.flagged_for_review}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function InterpretationV8Panel({ data, onOpenItemReview }: { data: V8Dashboard; onOpenItemReview: () => void }) {
  const conversations = data.conversations;
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-ualberta-green-dark">Interpretation of submitted responses</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Item ratings come from each student&apos;s own words; labels are computed from them by fixed rules. Possible
            misconceptions are listed separately and never folded into a label.
          </p>
        </div>
        {data.items_awaiting_review > 0 ? (
          <button type="button" onClick={onOpenItemReview}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            {data.items_awaiting_review} {data.items_awaiting_review === 1 ? "item awaits" : "items await"} your review
          </button>
        ) : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <GroupSummary title="Initial difficulties (first attempts)" description="Each student's first submitted attempt, before any feedback." group={data.first_attempts} />
        <GroupSummary title="Change after feedback (later attempts)" description="Each student's latest attempt submitted after seeing feedback on an earlier one." group={data.later_attempts} />
      </div>
      <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
        <h3 className="text-lg font-semibold text-ualberta-green-dark">Formative conversations</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted">Conversations held</dt><dd className="text-lg font-semibold text-ink">{conversations.conversations_held}</dd></div>
          <div><dt className="text-muted">Student replies</dt><dd className="text-lg font-semibold text-ink">{conversations.student_turns}</dd></div>
          <div><dt className="text-muted">Corrected reasoning expressed with support</dt><dd className="text-lg font-semibold text-ink">{conversations.foci_with_corrected_reasoning}</dd></div>
          <div><dt className="text-muted">Difficulty still evident</dt><dd className="text-lg font-semibold text-ink">{conversations.foci_with_difficulty_still_evident}</dd></div>
        </dl>
        {conversations.instructor_review_flags.length ? (
          <p className="mt-3 text-sm text-muted">
            Flags for you: {conversations.instructor_review_flags.map((flag) => `${flag.flag.replaceAll("_", " ")} (${flag.count})`).join("; ")}.
          </p>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-muted">
          Corrected reasoning expressed with support describes what students wrote during the conversation; it is not
          evidence of independent mastery and never changes the labels above.
        </p>
      </section>
    </section>
  );
}
