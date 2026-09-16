"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, Info } from "lucide-react";
import type { ProcessDataSummary } from "@/lib/services/teacher-review/process-data-summary";
import { processDataTimelineCsv } from "@/lib/services/teacher-review/process-data-csv";
import { EmptyState, formatDate, formatDuration } from "./ui";

const number = (value: number | null) => value === null ? "Not recorded" : value.toLocaleString();
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-panel disabled:opacity-50";

export function ProcessDataSection({ data, sessionPublicId }: { data?: ProcessDataSummary; sessionPublicId: string }) {
  const [category, setCategory] = useState("key_activity");
  const [page, setPage] = useState(1);
  if (!data) return <EmptyState title="Process data is not available for this session." />;
  const events = data.timeline.filter((event) => category === "key_activity"
    ? !["Typing", "Window focus"].includes(event.category) : !category || event.category === category);
  const pages = Math.max(1, Math.ceil(events.length / 50));
  const currentPage = Math.min(page, pages);
  const metrics = [
    { title: "Elapsed time", value: formatDuration(data.timing.elapsed_ms), detail: "Start to completion or last recorded activity; includes waiting and pauses." },
    { title: "Page hidden / returns", value: `${number(data.core.page_hidden_count)} / ${number(data.core.matched_return_count)}`, detail: "Returns are paired with a recorded page-hidden event. Window focus changes are not counted as page exits." },
    { title: "Idle intervals", value: number(data.core.idle_interval_count), detail: `${number(data.core.extended_idle_interval_count)} extended idle observations. The thresholds overlap; do not add these counts. Reading and waiting can produce idle intervals.` },
    { title: "Response revisions", value: number(data.core.recorded_response_revision_count), detail: "Recorded response updates, not keystrokes. One update can change several response fields." },
    { title: "Assessment pauses / resumes", value: `${data.core.assessment_pause_count} / ${data.core.assessment_resume_count}`, detail: "Explicit assessment lifecycle actions, separate from inferred idle time and conversation-only pauses." },
    { title: "Page reloads", value: number(data.core.page_reload_count), detail: "Observed browser reloads, not item navigation." }
  ];
  function download(format: "json" | "csv") {
    if (!data) return;
    const content = format === "csv" ? processDataTimelineCsv(data, sessionPublicId) : JSON.stringify({ session_public_id: sessionPublicId, ...data }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sessionPublicId}-${format === "csv" ? "activity-timeline.csv" : "process-data.json"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="min-w-0 space-y-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold text-ink">Process data</h2>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} onClick={() => download("csv")} type="button"><Download size={18} aria-hidden="true" />Download timeline CSV</button>
        <button className={buttonClass} onClick={() => download("json")} type="button"><Download size={18} aria-hidden="true" />Download process data</button>
      </div>
    </header>
    {!data.browser_observations_available ? <p className="border-l-2 border-amber-500 pl-3 text-sm text-ink" role="status">No browser activity was recorded. Missing observations are not zero activity.</p> : null}
    <dl className="grid gap-x-6 gap-y-5 border-y border-line py-5 sm:grid-cols-2 xl:grid-cols-3">
      {metrics.map((metric) => <div className="min-w-0" key={metric.title}>
        <dt className="flex items-center gap-2 text-sm text-muted">{metric.title}<span tabIndex={0} title={metric.detail} aria-label={metric.detail}><Info size={14} /></span></dt>
        <dd className="mt-2 break-words text-xl font-semibold text-ink">{metric.value}</dd>
      </div>)}
    </dl>
    <section>
      <h3 className="mb-3 text-lg font-semibold">Item activity</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line text-muted"><tr>{["Topic / item", "Elapsed response time", "First action", "Explanation time", "Confidence time", "System waiting", "Revisions"].map((heading) => <th className="px-3 py-3 font-semibold" key={heading}>{heading}</th>)}</tr></thead>
          <tbody>{data.items.map((item) => <tr className="border-b border-line" key={item.item_public_id}>
            <th className="px-3 py-3 font-medium">{item.topic_title}<span className="block text-muted">Item {item.item_order}</span></th>
            <td className="px-3 py-3">{formatDuration(item.elapsed_ms)}</td><td className="px-3 py-3">{formatDuration(item.time_to_first_action_ms)}</td>
            <td className="px-3 py-3">{formatDuration(item.explanation_elapsed_ms)}</td>
            <td className="px-3 py-3">{formatDuration(item.stage_summary?.confidence_time_ms ?? null)}</td>
            <td className="px-3 py-3">{formatDuration(item.stage_summary?.system_wait_ms ?? null)}</td><td className="px-3 py-3">{item.revision_count}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!data.items.length ? <p className="mt-3 text-sm text-muted">No item responses recorded.</p> : null}
      <details className="mt-4 border-b border-line pb-4 text-sm">
        <summary className="cursor-pointer font-semibold">Response stages and interruptions</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[880px] text-left">
          <thead className="border-b border-line text-muted"><tr>{["Item / stage", "Context", "Before typing", "To first submission", "Submissions / accepted", "Clarification required", "Time hidden", "Capture"].map(label => <th className="px-3 py-3" key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.items.flatMap(item => (item.stage_visits ?? []).map(visit => <tr className="border-b border-line" key={visit.stage_visit_id}>
            <th className="px-3 py-3 font-medium">Item {item.item_order} / {visit.response_stage.replaceAll("_", " ")}</th>
            <td className="px-3 py-3">{visit.response_phase}</td><td className="px-3 py-3">{formatDuration(visit.input_start_latency_ms)}</td>
            <td className="px-3 py-3">{formatDuration(visit.response_elapsed_ms)}</td><td className="px-3 py-3">{visit.submission_count} / {visit.accepted_submission_count}</td>
            <td className="px-3 py-3">{visit.validation_rejection_count}</td><td className="px-3 py-3">{formatDuration(visit.hidden_duration_ms)}</td>
            <td className="px-3 py-3" title={visit.timing_limitations}>{visit.timing_quality_status === "valid" ? "Complete" : "Partial"}</td>
          </tr>))}</tbody>
        </table></div>
        {!data.items.some(item => item.stage_visits?.length) ? <p className="mt-3 text-muted">Stage observations were not recorded for this attempt.</p> : null}
      </details>
    </section>
    {data.conversations.length ? <section>
      <h3 className="mb-3 text-lg font-semibold">Learning conversation activity</h3>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="border-b border-line text-muted"><tr>{["Topic", "Student messages", "Input coverage", "Input edits", "Backspaces", "Paste actions", "Pauses / resumes"].map((heading) => <th className="px-3 py-3 font-semibold" key={heading}>{heading}</th>)}</tr></thead>
        <tbody>{data.conversations.map((conversation, index) => <tr className="border-b border-line" key={index}>
          <th className="px-3 py-3 font-medium">{conversation.topic_title}</th>
          <td className="px-3 py-3">{conversation.student_turn_count}</td><td className="px-3 py-3">{conversation.messages_with_input_telemetry} / {conversation.student_turn_count}</td>
          <td className="px-3 py-3">{conversation.messages_with_input_telemetry ? conversation.edits : "Not recorded"}</td>
          <td className="px-3 py-3">{conversation.messages_with_input_telemetry ? conversation.backspaces : "Not recorded"}</td>
          <td className="px-3 py-3">{conversation.messages_with_input_telemetry ? conversation.paste_actions : "Not recorded"}</td>
          <td className="px-3 py-3">{conversation.pause_count} / {conversation.resume_count}</td>
        </tr>)}</tbody>
      </table></div>
    </section> : null}
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Activity timeline</h3>
        <label className="flex items-center gap-2 text-sm">Activity
          <select className="h-10 max-w-full rounded-md border border-line bg-white px-3" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
            <option value="key_activity">Key activity</option><option value="">All activity</option>{["Assessment activity", "Browser activity", "Revisions", "Learning conversation", "Typing", "Window focus"].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <ol className="divide-y divide-line border-y border-line">
        {events.slice((currentPage - 1) * 50, currentPage * 50).map((event, index) => <li className="grid gap-1 py-3 text-sm sm:grid-cols-[12rem_1fr]" key={`${currentPage}-${index}`}>
          <time className="text-muted" dateTime={event.at ?? undefined}>{formatDate(event.at, true)}</time>
          <div className="min-w-0"><p className="font-medium text-ink">{event.action}{event.duration_ms !== null ? ` (${formatDuration(event.duration_ms)})` : ""}</p><p className="break-words text-muted">{event.context}</p></div>
        </li>)}
      </ol>
      {!events.length ? <p className="py-4 text-sm text-muted">No recorded activity matches this filter.</p> : null}
      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted"><span>{events.length} events · Page {currentPage} of {pages}</span><div className="flex gap-2">
        <button className={buttonClass} type="button" title="Previous page" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button>
        <button className={buttonClass} type="button" title="Next page" aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button>
      </div></div>
    </section>
    <details className="border-t border-line pt-4 text-sm">
      <summary className="cursor-pointer font-semibold">Capture coverage and interpretation</summary>
      <dl className="my-4 grid gap-3 sm:grid-cols-2">
        <div><dt className="text-muted">Observed time hidden</dt><dd>{formatDuration(data.timing.observed_hidden_ms)}</dd></div>
        <div><dt className="text-muted">Observed idle time (overlap removed)</dt><dd>{formatDuration(data.timing.observed_idle_ms)}</dd></div>
        <div><dt className="text-muted">Whole-page typing summaries / keys / backspaces</dt><dd>{data.typing.summary_count} / {number(data.typing.key_count)} / {number(data.typing.backspace_count)}</dd></div>
        <div><dt className="text-muted">Whole-page paste actions</dt><dd>{number(data.core.paste_action_count)}</dd></div>
        <div><dt className="text-muted">Changed fields: answers / explanations / confidence / alternatives</dt><dd>{Object.values(data.core.revision_fields).join(" / ")}</dd></div>
        <div><dt className="text-muted">Assessment view openings</dt><dd>{data.core.assessment_view_open_count}</dd></div>
      </dl>
      <p className="mb-3 text-muted">Whole-page observations include the learning conversation; do not add them to conversation input counts.</p>
      <ul className="list-disc space-y-2 pl-5 text-muted">{data.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    </details>
  </section>;
}
