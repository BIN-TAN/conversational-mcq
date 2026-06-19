import { redirect } from "next/navigation";
import { DataNav } from "@/components/teacher-data/ui";
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

  const readiness = getLlmReadiness();
  const modelEntries = Object.entries(readiness.agent_model_configured);
  const promptVersions = readiness.prompt_versions as Record<string, string>;
  const schemaVersions = readiness.schema_versions as Record<string, string>;
  const promptStatuses = readiness.prompt_statuses as Record<string, string>;

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <DataNav userId={user.user_id} />
        <header className="border-b border-line pb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            LLM infrastructure
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">LLM system status</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Phase 6A provides provider configuration, draft prompt contracts, and audit
            infrastructure only. No agent is connected to classroom workflows.
          </p>
        </header>

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

        <section className="mt-6 rounded-lg border border-line bg-white p-5 text-sm leading-6 text-muted shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Safety boundaries</h2>
          <p className="mt-3">No agent is connected to real classroom workflows.</p>
          <p>Prompts remain draft and are not validated for live classroom use.</p>
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
