"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, RefreshCcw } from "lucide-react";
import type { AttemptComparison, AttemptPair } from "@/lib/services/teacher-dashboard/attempt-comparison";

const headings = ["Attempt 1", "Attempt 2", "Attempt 3", "Latest submitted"];
const pairs: Array<[AttemptPair, string]> = [["1-2", "Attempt 1 to 2"], ["2-3", "Attempt 2 to 3"],
  ["1-3", "Attempt 1 to 3"], ["first-latest", "First to latest"]];
const percentage = (value: number | null) => value === null ? "Not recorded" : `${value}%`;
const inputClass = "mt-1 block w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal";

function Distribution({ counts, total, labels }: { counts: Record<string, number>; total: number; labels: string[] }) {
  return <div className="space-y-1.5">{labels.map(label => {
    const count = counts[label] ?? 0;
    return <div key={label}><div className="flex justify-between gap-2 text-xs">
      <span className="capitalize">{label}</span><span>{count}{total ? ` (${Math.round(count / total * 100)}%)` : ""}</span>
    </div><div className="mt-1 h-1.5 bg-gray-100" aria-hidden="true">
      <div className={label === "high" ? "h-full bg-amber-500" : "h-full bg-accent"} style={{ width: `${total ? count / total * 100 : 0}%` }} />
    </div></div>;
  })}</div>;
}

export function AttemptComparisonPanel({ assessmentPublicId }: { assessmentPublicId: string }) {
  const [mode, setMode] = useState("all");
  const [pair, setPair] = useState<AttemptPair>("1-2");
  const [allThree, setAllThree] = useState(false);
  const [objective, setObjective] = useState("");
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<AttemptComparison | null>(null);
  const [objectives, setObjectives] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    const query = new URLSearchParams({ assessment_public_id: assessmentPublicId, mode, pair, all_three: String(allThree) });
    if (objective) query.set("objective", objective);
    void fetch(`/api/teacher/dashboard/attempts?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Attempt comparison could not be loaded.");
        if (!controller.signal.aborted) {
          setData(body.comparison);
          setObjectives(body.comparison.objectives);
        }
      }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [assessmentPublicId, mode, pair, allThree, objective, reload]);
  return <section aria-label="Compare attempts" className="space-y-5">
    <div className="flex flex-wrap items-end gap-4 border-b border-line pb-4">
      <label className="text-sm font-semibold">Students<select value={mode} onChange={e => setMode(e.target.value)} className={inputClass}>
        <option value="all">All participants</option><option value="matched">Same students</option>
      </select></label>
      <label className="text-sm font-semibold">Compare<select value={pair} onChange={e => setPair(e.target.value as AttemptPair)} className={inputClass}>
        {pairs.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
      </select></label>
      <label className="min-w-0 max-w-full text-sm font-semibold">Learning objective<select value={objective} onChange={e => setObjective(e.target.value)} className={`${inputClass} max-w-sm`}>
        <option value="">Whole mini-test</option>{objectives.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button aria-label="Refresh comparison" title="Refresh comparison" type="button" onClick={() => setReload(value => value + 1)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-white" disabled={loading}>
        <RefreshCcw className="h-4 w-4" aria-hidden="true" />
      </button>
      <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={allThree} onChange={e => setAllThree(e.target.checked)} />Submitted all three</label>
    </div>
    {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading comparison...</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error} <button type="button" className="underline" onClick={() => setReload(value => value + 1)}>Retry</button></p>}
    {data && <>
      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted">
        <span>{data.cohort_student_count} {data.cohort_student_count === 1 ? "student" : "students"} in comparison; {data.incomplete_attempt_count} incomplete {data.incomplete_attempt_count === 1 ? "attempt" : "attempts"}</span>
        <time dateTime={data.snapshot_at}>As of {new Date(data.snapshot_at).toLocaleString()}</time>
      </div>
      <div className="overflow-x-auto border-y border-line bg-white" tabIndex={0} role="region" aria-label="Class results by attempt">
        <table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-gray-50"><tr>
          <th className="p-3">Class results</th>{headings.map(title => <th className="p-3" key={title}>{title}</th>)}
        </tr></thead><tbody>
          <tr className="border-t border-line"><th className="p-3 font-medium">Students submitted</th>{data.columns.map(column => <td className="p-3" key={column.view}>{column.student_count}</td>)}</tr>
          <tr className="border-t border-line"><th className="p-3 font-medium">No submission for this view</th>{data.columns.map(column => <td className="p-3" key={column.view}>{column.missing_student_count}</td>)}</tr>
          <tr className="border-t border-line"><th className="p-3 font-medium">Correct responses</th>{data.columns.map(column => <td className="p-3" key={column.view}>{percentage(column.correct_percentage)}<span className="block text-xs text-muted">{column.correct_count} / {column.scored_response_count} scored</span></td>)}</tr>
          <tr className="border-t border-line"><th className="p-3 font-medium">Incorrect with high confidence</th>{data.columns.map(column => <td className="p-3" key={column.view}>{column.confidence_scored_count ? `${column.high_confidence_incorrect_count} / ${column.confidence_scored_count}` : "Not recorded"}</td>)}</tr>
          <tr className="border-t border-line"><th className="p-3 align-top font-medium">Confidence</th>{data.columns.map(column => <td className="p-3 align-top" key={column.view}><Distribution counts={column.confidence_counts} total={column.response_count} labels={["low", "medium", "high", "Not recorded"]} /></td>)}</tr>
        </tbody></table>
      </div>
      <section className="space-y-3 border-b border-line pb-5">
        <h3 className="font-semibold">Changes in the same students: {pairs.find(entry => entry[0] === pair)?.[1]}</h3>
        <p className="text-sm text-muted">{data.matched_student_count} students submitted both; {data.comparable_student_count} have matching item versions. {data.comparable_item_pairs} comparable response pairs.</p>
        {data.comparable_item_pairs ? <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[["incorrect_to_correct", "Incorrect to correct"], ["correct_to_incorrect", "Correct to incorrect"],
            ["correct_to_correct", "Stayed correct"], ["incorrect_to_incorrect", "Stayed incorrect"]].map(([key, title]) =>
            <div key={key}><dt className="text-sm text-muted">{title}</dt><dd className="mt-1 text-xl font-semibold">{data.transition_summary[key] ?? 0}</dd></div>)}
        </dl> : <p className="text-sm">No comparable submitted attempts yet.</p>}
        {data.unmatched_item_pairs > 0 && <p className="text-sm text-amber-900">{data.unmatched_item_pairs} item pairs excluded because the item version or evidence differs.</p>}
        {(data.transition_summary.unscored ?? 0) > 0 && <p className="text-sm text-muted">{data.transition_summary.unscored} comparable pairs have no recorded correctness comparison.</p>}
      </section>
      <section className="space-y-0">
        <h3 className="mb-3 font-semibold">Item comparisons</h3>
        {data.items.length === 0 && <p className="text-sm text-muted">No submitted item evidence for this selection.</p>}
        {data.items.map((item, index) => <details key={item.item_key} className="border-b border-line py-3">
          <summary className="flex cursor-pointer list-none items-start gap-3 text-sm font-semibold"><ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{index + 1}. {item.stem}</span></summary>
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted">{item.objective} | Version {item.item_version ?? "unknown"}</p>
            <ul className="space-y-1 text-sm">{item.options.map(option => <li key={option.label}><strong>{option.label}.</strong> {option.text}</li>)}</ul>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{item.columns.map((column, columnIndex) => <div key={column.view} className="min-w-0">
              <h4 className="text-sm font-semibold">{headings[columnIndex]}</h4>
              <p className="mb-3 mt-1 text-xs text-muted">{column.response_count} responses; {percentage(column.correct_percentage)} correct</p>
              <Distribution counts={column.option_counts} total={column.response_count} labels={[...new Set([...item.options.map(option => option.label), ...Object.keys(column.option_counts)])]} />
              <div className="mt-4"><Distribution counts={column.confidence_counts} total={column.response_count} labels={["low", "medium", "high", "Not recorded"]} /></div>
            </div>)}</div>
            <div className="grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
              <div><h4 className="mb-2 text-sm font-semibold">Same-student answer changes</h4>
                {item.paired_response_count ? <Distribution counts={item.option_transitions} total={item.paired_response_count} labels={Object.keys(item.option_transitions).sort()} /> : <p className="text-sm text-muted">No matched responses.</p>}
              </div>
              <div><h4 className="mb-2 text-sm font-semibold">Same-student confidence changes</h4>
                <Distribution counts={item.confidence_transitions} total={item.paired_response_count} labels={Object.keys(item.confidence_transitions).sort()} />
              </div>
            </div>
          </div>
        </details>)}
      </section>
      <details className="text-sm text-muted"><summary className="cursor-pointer font-medium">Data notes</summary>
        <p className="mt-2">Counts use original submitted responses before feedback in each attempt. Latest submitted may be attempt 1, 2, 3, or a later historical attempt. Missing evidence is not scored as incorrect. Technical restorations are excluded from comparisons but retained in research data. Different participant groups and repeat exposure can affect results; changes do not establish a tutor effect.</p>
      </details>
    </>}
  </section>;
}
