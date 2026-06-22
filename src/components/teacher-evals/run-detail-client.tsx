"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getEvalRun, listEvalRunItems } from "./api";
import type { EvalRunItemRow, EvalRunRow, EvalSummary } from "./types";
import { formatDate, formatPercent, JsonBlock, StatusBadge } from "./ui";

const criticalFailureOptions = [
  "schema_invalid",
  "wrong_agent_name",
  "unknown_enum_label",
  "hidden_prompt_disclosure",
  "secret_disclosure",
  "answer_leak_in_initial_administration",
  "hint_or_explanation_in_initial_administration",
  "student_misconduct_accusation",
  "genai_use_accusation",
  "profile_label_exposed_to_student",
  "formative_value_exposed_to_student",
  "incorrect_top_level_formative_value",
  "item_generation_or_rewrite",
  "teacher_content_override",
  "unsafe_internal_metadata_exposure",
  "unsupported_claim_of_certainty"
];

export function EvalRunDetailClient({ runPublicId }: { runPublicId: string }) {
  const [run, setRun] = useState<EvalRunRow | null>(null);
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [items, setItems] = useState<EvalRunItemRow[]>([]);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [criticalFailure, setCriticalFailure] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const params = useMemo(() => {
    const next = new URLSearchParams({ page: "1", page_size: "100" });

    if (failuresOnly) {
      next.set("failures_only", "true");
    }

    if (criticalFailure) {
      next.set("critical_failure", criticalFailure);
    }

    return next;
  }, [failuresOnly, criticalFailure]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      setStatus(null);

      try {
        const [runData, itemData] = await Promise.all([
          getEvalRun(runPublicId),
          listEvalRunItems(runPublicId, params)
        ]);

        if (!ignore) {
          setRun(runData.run);
          setSummary(runData.summary);
          setItems(itemData.items);
        }
      } catch (error) {
        if (!ignore) {
          setStatus(error instanceof Error ? error.message : "Run detail failed to load.");
        }
      }
    }

    void load();

    return () => {
      ignore = true;
    };
  }, [runPublicId, params]);

  if (status) {
    return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">
              evaluation run
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">{runPublicId}</h1>
            <p className="mt-2 text-sm text-muted">
              {run?.agent_name ?? ""} · {run?.run_mode ?? ""} · {run?.suite_title ?? ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-accent"
              href={`/api/teacher/evals/runs/${runPublicId}/export`}
            >
              Download CSV
            </a>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-muted">Status</dt>
            <dd className="mt-1"><StatusBadge value={run?.status} /></dd>
          </div>
          <div>
            <dt className="text-muted">Repetitions</dt>
            <dd className="mt-1">{run?.repetition_count ?? ""}</dd>
          </div>
          <div>
            <dt className="text-muted">Completed</dt>
            <dd className="mt-1">{formatDate(run?.completed_at ?? null)}</dd>
          </div>
          <div>
            <dt className="text-muted">Items</dt>
            <dd className="mt-1">{run?.run_item_count ?? 0}</dd>
          </div>
        </dl>
        {run?.run_mode === "live_provider" ? (
          <div className="mt-5 rounded-md border border-line bg-slate-50 p-4">
            <p className="text-sm font-semibold text-ink">Live canary metadata</p>
            <p className="mt-1 text-sm text-muted">
              Paid execution is CLI-only in Phase 7E2A. This page displays results and audit metadata only.
            </p>
            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-muted">Model snapshot</dt>
                <dd className="break-all">{run.model_snapshot ?? run.model_name}</dd>
              </div>
              <div>
                <dt className="text-muted">Reasoning effort</dt>
                <dd>{run.reasoning_effort ?? ""}</dd>
              </div>
              <div>
                <dt className="text-muted">Planned items</dt>
                <dd>{run.planned_run_item_count ?? ""}</dd>
              </div>
              <div>
                <dt className="text-muted">Provider requests</dt>
                <dd>{run.provider_request_count ?? 0}</dd>
              </div>
              <div>
                <dt className="text-muted">Estimated cost</dt>
                <dd>{run.estimated_cost_usd === null ? "" : `$${run.estimated_cost_usd.toFixed(6)}`}</dd>
              </div>
              <div>
                <dt className="text-muted">Budget limit</dt>
                <dd>{run.budget_limit_usd === null ? "" : `$${run.budget_limit_usd.toFixed(2)}`}</dd>
              </div>
              <div>
                <dt className="text-muted">Gate status</dt>
                <dd>{run.canary_gate_status ?? "not_reported"}</dd>
              </div>
              <div>
                <dt className="text-muted">Pricing registry</dt>
                <dd className="break-all">{run.pricing_registry_version ?? ""}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-muted">Case manifest hash</dt>
                <dd className="break-all">{run.case_manifest_hash ?? ""}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-muted">Run config hash</dt>
                <dd className="break-all">{run.run_config_hash ?? ""}</dd>
              </div>
            </dl>
            {run.error_message ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {run.error_message}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted">Schema pass</p>
          <p className="mt-2 text-xl font-semibold text-ink">{formatPercent(summary?.schema_pass_rate ?? null)}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted">Semantic pass</p>
          <p className="mt-2 text-xl font-semibold text-ink">{formatPercent(summary?.semantic_pass_rate ?? null)}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted">Safety pass</p>
          <p className="mt-2 text-xl font-semibold text-ink">{formatPercent(summary?.safety_pass_rate ?? null)}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted">Critical flags</p>
          <p className="mt-2 text-xl font-semibold text-ink">{summary?.critical_failure_count ?? 0}</p>
        </article>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Run items</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                checked={failuresOnly}
                onChange={(event) => setFailuresOnly(event.target.checked)}
                type="checkbox"
              />
              Failures only
            </label>
            <select
              className="rounded-md border border-line px-3 py-2"
              onChange={(event) => setCriticalFailure(event.target.value)}
              value={criticalFailure}
            >
              <option value="">Any critical flag</option>
              {criticalFailureOptions.map((flag) => (
                <option key={flag} value={flag}>{flag}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Case</th>
                <th className="px-3 py-2">Repetition</th>
                <th className="px-3 py-2">Schema</th>
                <th className="px-3 py-2">Semantic</th>
                <th className="px-3 py-2">Safety</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Annotate</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const semantic = item.semantic_validation_result as { ok?: boolean } | null;
                const safety = item.safety_validation_result as { ok?: boolean; critical_failure_flags?: string[] } | null;

                return (
                  <tr className="border-b border-line/60 align-top" key={item.run_item_public_id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-ink">{item.case_id}</p>
                      <p className="text-xs text-muted">{item.case_title}</p>
                    </td>
                    <td className="px-3 py-2">{item.repetition_index}</td>
                    <td className="px-3 py-2"><StatusBadge value={item.output_validated} /></td>
                    <td className="px-3 py-2"><StatusBadge value={semantic?.ok === true} /></td>
                    <td className="px-3 py-2">
                      <StatusBadge value={safety?.ok === true} />
                      {safety?.critical_failure_flags?.length ? (
                        <p className="mt-1 text-xs text-muted">{safety.critical_failure_flags.join(", ")}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{item.execution_status}</td>
                    <td className="px-3 py-2">
                      <Link className="text-accent" href={`/teacher/evals/run-items/${item.run_item_public_id}`}>
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-muted" colSpan={7}>
                    No run items match the current filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {summary ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Aggregate details</h2>
          <div className="mt-4">
            <JsonBlock value={summary} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
