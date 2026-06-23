"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getEvalSummary,
  listEvalRuns,
  listEvalSuites,
  runMockEvaluation,
  seedEvalFixtures
} from "./api";
import type { EvalRunRow, EvalSuiteRow, EvalSummary } from "./types";
import { formatDate, formatPercent, StatusBadge } from "./ui";

const agentOptions = [
  "item_verification_agent",
  "response_collection_agent",
  "student_profiling_agent",
  "formative_value_and_planning_agent",
  "followup_agent"
];

export function EvalDashboardClient() {
  const [suites, setSuites] = useState<EvalSuiteRow[]>([]);
  const [runs, setRuns] = useState<EvalRunRow[]>([]);
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [agentFilter, setAgentFilter] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runParams = useMemo(() => {
    const params = new URLSearchParams({ page: "1", page_size: "25" });

    if (agentFilter) {
      params.set("agent_name", agentFilter);
    }

    return params;
  }, [agentFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(null);

    try {
      const [suiteData, runData, summaryData] = await Promise.all([
        listEvalSuites(),
        listEvalRuns(runParams),
        getEvalSummary()
      ]);

      setSuites(suiteData.suites);
      setRuns(runData.runs);
      setSummary(summaryData.summary);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Evaluation data failed to load.");
    } finally {
      setLoading(false);
    }
  }, [runParams]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSeed() {
    setStatus(null);
    setMessage(null);
    setLoading(true);

    try {
      const result = await seedEvalFixtures();
      setMessage(`Loaded ${result.case_count} synthetic cases across ${result.suite_count} suites.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Fixture loading failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRunMock() {
    setStatus(null);
    setMessage(null);
    setLoading(true);

    try {
      const result = await runMockEvaluation(agentFilter ? { agent_name: agentFilter } : {});
      setMessage(`Created ${result.run_count} mock evaluation run(s).`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mock evaluation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">
              development evaluation
            </p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Internal agent evaluation</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Mock evaluation runs use synthetic cases only. Paid live canary and pilot runs are
              terminal-only guarded workflows; this page displays their results and audit metadata.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={loading}
              onClick={handleSeed}
              type="button"
            >
              Load fixtures
            </button>
            <button
              className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
              disabled={loading || suites.length === 0}
              onClick={handleRunMock}
              type="button"
            >
              Run mock evaluation
            </button>
          </div>
        </div>
        {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
        {status ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</p> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted">Cases</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{summary?.case_count ?? 0}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted">Schema pass</p>
          <p className="mt-2 text-2xl font-semibold text-ink">
            {formatPercent(summary?.schema_pass_rate ?? null)}
          </p>
        </article>
        <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted">Safety pass</p>
          <p className="mt-2 text-2xl font-semibold text-ink">
            {formatPercent(summary?.safety_pass_rate ?? null)}
          </p>
        </article>
        <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted">Critical flags</p>
          <p className="mt-2 text-2xl font-semibold text-ink">
            {summary?.critical_failure_count ?? 0}
          </p>
        </article>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Suites</h2>
          <select
            className="rounded-md border border-line px-3 py-2 text-sm"
            onChange={(event) => setAgentFilter(event.target.value)}
            value={agentFilter}
          >
            <option value="">All agents</option>
            {agentOptions.map((agentName) => (
              <option key={agentName} value={agentName}>{agentName}</option>
            ))}
          </select>
        </div>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Suite</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Cases</th>
                <th className="px-3 py-2">Runs</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {suites
                .filter((suite) => !agentFilter || suite.agent_name === agentFilter)
                .map((suite) => (
                  <tr className="border-b border-line/60" key={suite.suite_public_id}>
                    <td className="px-3 py-2">
                      <Link className="font-medium text-accent" href={`/teacher/evals/suites#${suite.suite_public_id}`}>
                        {suite.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{suite.agent_name}</td>
                    <td className="px-3 py-2">{suite.case_count ?? 0}</td>
                    <td className="px-3 py-2">{suite.run_count ?? 0}</td>
                    <td className="px-3 py-2"><StatusBadge value={suite.status} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Recent runs</h2>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Items</th>
                <th className="px-3 py-2">Completed</th>
                <th className="px-3 py-2">Export</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr className="border-b border-line/60" key={run.run_public_id}>
                  <td className="px-3 py-2">
                    <Link className="font-medium text-accent" href={`/teacher/evals/runs/${run.run_public_id}`}>
                      {run.run_public_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{run.agent_name}</td>
                  <td className="px-3 py-2">{run.run_mode}</td>
                  <td className="px-3 py-2"><StatusBadge value={run.status} /></td>
                  <td className="px-3 py-2">{run.run_item_count ?? 0}</td>
                  <td className="px-3 py-2">{formatDate(run.completed_at)}</td>
                  <td className="px-3 py-2">
                    <a className="text-accent" href={`/api/teacher/evals/runs/${run.run_public_id}/export`}>
                      CSV
                    </a>
                  </td>
                </tr>
              ))}
              {runs.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-muted" colSpan={7}>
                    No evaluation runs yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
