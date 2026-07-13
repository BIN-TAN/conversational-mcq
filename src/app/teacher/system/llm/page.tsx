import { redirect } from "next/navigation";
import { DataNav } from "@/components/teacher-data/ui";
import { TeacherPageHeader } from "@/components/teacher-page-header";
import { getCurrentUser } from "@/lib/auth";
import { getLlmReadiness } from "@/lib/llm/readiness";

export default async function TeacherLlmSystemPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const readiness = await getLlmReadiness();
  const modelEntries = Object.entries(readiness.agent_model_configured);
  const promptVersions = readiness.prompt_versions as Record<string, string>;
  const schemaVersions = readiness.schema_versions as Record<string, string>;
  const promptStatuses = readiness.prompt_statuses as Record<string, string>;
  const usage = readiness.usage;
  const operationalIntegration = readiness.guarded_operational_agent_integration;

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <DataNav userId={user.user_id} />
        <TeacherPageHeader title="LLM status" />

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <StatusCard label="Provider" value={String(readiness.provider)} />
          <StatusCard
            label="Live calls"
            value={readiness.live_calls_enabled ? "enabled" : "disabled"}
          />
          <StatusCard
            label="API key configured"
            value={readiness.openai_key_configured ? "yes" : "no"}
          />
          <StatusCard
            label="Mock provider"
            value={readiness.mock_provider_available ? "available" : "unavailable"}
          />
          <StatusCard
            label="Operational integration"
            value={operationalIntegration?.allowed ? "enabled" : "blocked"}
          />
          <StatusCard
            label="Integration block reason"
            value={operationalIntegration?.allowed ? "none" : operationalIntegration?.block_reason ?? "unknown"}
          />
          <StatusCard
            label="Approved eval run"
            value={operationalIntegration?.config.approved_targeted_run_public_id ?? "not configured"}
          />
          <StatusCard
            label="Class calls today"
            value={String(usage?.current_usage.class_daily.call_count ?? 0)}
          />
          <StatusCard
            label="Class tokens today"
            value={String(usage?.current_usage.class_daily.total_tokens ?? 0)}
          />
        </section>

        {readiness.configuration_error ? (
          <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">{readiness.configuration_error.message}</p>
            <p className="mt-1 text-xs uppercase tracking-wide">
              {readiness.configuration_error.code}
            </p>
          </section>
        ) : null}

        <section className="mt-6 rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Agent configuration</h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2">Model configured</th>
                  <th className="px-3 py-2">Prompt version</th>
                  <th className="px-3 py-2">Schema version</th>
                  <th className="px-3 py-2">Prompt status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {modelEntries.map(([agentName, value]) => (
                  <tr key={agentName}>
                    <td className="px-3 py-2 font-mono text-xs">{agentName}</td>
                    <td className="px-3 py-2">{value.model_configured ? "yes" : "no"}</td>
                    <td className="px-3 py-2">
                      {promptVersions[agentName] ?? "not registered"}
                    </td>
                    <td className="px-3 py-2">
                      {schemaVersions[agentName] ?? "not registered"}
                    </td>
                    <td className="px-3 py-2">
                      {promptStatuses[agentName] ?? "not registered"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {usage ? (
          <section className="mt-6 rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Usage safeguards</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <MetricValue
                label="Daily class calls"
                value={`${usage.current_usage.class_daily.call_count} / ${usage.limits.daily_class_call_limit}`}
              />
              <MetricValue
                label="Daily class tokens"
                value={`${usage.current_usage.class_daily.total_tokens} / ${usage.limits.daily_class_token_limit}`}
              />
              <MetricValue
                label="Student daily calls"
                value={String(usage.limits.daily_student_call_limit)}
              />
              <MetricValue
                label="Student daily tokens"
                value={String(usage.limits.daily_student_token_limit)}
              />
              <MetricValue
                label="Session calls"
                value={String(usage.limits.session_call_limit)}
              />
              <MetricValue
                label="Agent session calls"
                value={String(usage.limits.agent_call_limit_per_session)}
              />
            </div>
            <p className="mt-3 text-sm text-muted">
              Usage day: {usage.current_usage.window_start} to{" "}
              {usage.current_usage.window_end} ({usage.limits.usage_timezone})
            </p>
            <p className="mt-1 text-sm text-muted">
              Cost limits are {usage.limits.cost_limits_enforced ? "enforced" : "not enforced"} in
              this phase because no versioned pricing registry is configured.
            </p>
          </section>
        ) : null}

        {usage ? (
          <section className="mt-6 rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Daily agent usage</h2>
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Calls</th>
                    <th className="px-3 py-2">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {Object.entries(usage.current_usage.per_agent_daily).map(([agentName, counts]) => (
                    <tr key={agentName}>
                      <td className="px-3 py-2 font-mono text-xs">{agentName}</td>
                      <td className="px-3 py-2">{counts.call_count}</td>
                      <td className="px-3 py-2">{counts.total_tokens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {usage ? (
          <section className="mt-6 rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Recent agent-call audit rows</h2>
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Provider</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Blocked reason</th>
                    <th className="px-3 py-2">Retries</th>
                    <th className="px-3 py-2">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {usage.recent_agent_calls.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-muted" colSpan={7}>
                        No agent-call audit rows have been recorded.
                      </td>
                    </tr>
                  ) : (
                    usage.recent_agent_calls.map((call, index) => (
                      <tr key={`${call.created_at}-${index}`}>
                        <td className="px-3 py-2">{new Date(call.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2 font-mono text-xs">{call.agent_name}</td>
                        <td className="px-3 py-2">{call.provider}</td>
                        <td className="px-3 py-2">{call.call_status}</td>
                        <td className="px-3 py-2">{call.blocked_reason ?? "none"}</td>
                        <td className="px-3 py-2">{call.retry_count}</td>
                        <td className="px-3 py-2">{call.total_tokens ?? 0}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="mt-6 rounded-lg border border-line bg-white p-5 text-sm leading-6 text-muted shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Configuration boundaries</h2>
          <p className="mt-3">Provider: {String(readiness.provider)}.</p>
          <p>Live calls: {readiness.live_calls_enabled ? "enabled" : "disabled"}.</p>
          <p>Connectivity testing uses only fixed synthetic data.</p>
          <p>This page never displays an API key and does not provide a browser form for secrets.</p>
        </section>
      </div>
    </main>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-soft">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-lg font-semibold text-ink">{value}</p>
    </article>
  );
}

function MetricValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l-2 border-line pl-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-base font-semibold text-ink">{value}</p>
    </div>
  );
}
