import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { analyzeAgentCall, buildSessionCostReport, estimateUsageCost, normalizeUsage, PRICING, PRICING_BY_MODEL } from "./ai-session-cost-report.mjs";

const usage = (input = 1000, output = 100, cached = 500, writes = 0) => ({
  input_tokens: input, output_tokens: output, total_tokens: input + output,
  input_tokens_details: { cached_tokens: cached, cache_write_tokens: writes },
  output_tokens_details: { reasoning_tokens: Math.min(40, output) }
});
const row = extra => ({ model_name: PRICING.model, provider: "openai", retry_count: 0,
  call_status: "succeeded", output_validated: true, token_usage: usage(), ...extra });
const fixture = extra => ({ synthetic_only: true, provider_dispatches: 2, student_model: { model_name: PRICING.model },
  results: [{ case_id: "demo", outcome: "mechanical_checks_passed_manual_pedagogical_review_required",
    generated_student_replies: [{ source: "adaptive_ai", usage: usage() }, { source: "scripted_edge_case", usage: null }] }], ...extra });

test("cached input is priced once and reasoning stays within output", () => {
  const parsed = normalizeUsage(usage());
  const cost = estimateUsageCost(PRICING.model, parsed);
  assert.equal(cost.exact_usd, 0.00023);
  assert.equal(parsed.reasoning_tokens, 40);
  assert.equal(estimateUsageCost(PRICING.model, normalizeUsage({ ...usage(), output_tokens_details: { reasoning_tokens: 0 } })).exact_usd, cost.exact_usd);
});

test("cache writes replace regular input at the 1.25 multiplier", () => {
  assert.equal(estimateUsageCost(PRICING.model, normalizeUsage(usage(1000, 100, 200, 300))).exact_usd, 0.000299);
});

test("Sol uses dated standard prices while preserving the historical Luna table and report version", () => {
  assert.deepEqual(PRICING.per_million, { input: 0.20, cached_input: 0.02, cache_write_input: 0.25, output: 1.20 });
  assert.equal(PRICING_BY_MODEL[PRICING.model], PRICING);
  const sol = PRICING_BY_MODEL["gpt-6.1-sol"];
  assert.deepEqual(sol.per_million, { input: 2, cached_input: 0.10, cache_write_input: 2.50, output: 10 });
  assert.equal(sol.source_checked_at, "2026-10-13");
  assert.equal(sol.source_url, "https://developers.openai.com/api/docs/models/gpt-6.1-sol");
  const report = buildSessionCostReport(fixture(), new Map([["demo", [row({ model_name: sol.model })]]]));
  assert.equal(report.version, "ai-session-cost-report-v1");
  assert.equal(report.pricing, PRICING);
  assert.equal(report.pricing_by_model[sol.model], sol);
  assert.equal(report.application_total.cost.exact_usd, 0.00205);
  assert.equal(report.simulator_learner_total.cost.exact_usd, 0.00023);
  assert.equal(report.combined_recorded_total.cost.exact_usd, 0.00228);
});

test("Sol partitions cache writes and reads without charging reasoning twice", () => {
  const parsed = normalizeUsage(usage(1000, 100, 200, 300));
  assert.equal(estimateUsageCost("gpt-6.1-sol", parsed).exact_usd, 0.00277);
  assert.equal(estimateUsageCost("gpt-6.1-sol", { ...parsed, reasoning_tokens: 100 }).exact_usd, 0.00277);
  const missing = estimateUsageCost("gpt-6.1-sol", normalizeUsage({ input_tokens: 1000, output_tokens: 100 }));
  assert.equal(missing.lower_usd, 0.0011);
  assert.equal(missing.upper_usd, 0.0035);
  assert.equal(missing.exact_usd, null);
  assert.deepEqual(missing.issues, ["cached_input_split_missing", "cache_write_split_missing"]);
  for (const unknown of ["gpt-6.1-sol-unverified", "toString", "__proto__"]) {
    const cost = estimateUsageCost(unknown, parsed);
    assert.equal(cost.upper_usd, null);
    assert.deepEqual(cost.issues, ["model_pricing_unavailable"]);
  }
});

test("Sol long-context rates apply to the whole request including cached reads and writes only above 272K", () => {
  const at = estimateUsageCost("gpt-6.1-sol", normalizeUsage(usage(272000, 100, 100000, 72000)));
  const above = estimateUsageCost("gpt-6.1-sol", normalizeUsage(usage(272001, 100, 100000, 72000)));
  assert.equal(at.exact_usd, 0.391);
  assert.equal(at.long_context_multiplier_applied, false);
  assert.equal(above.exact_usd, 0.781504);
  assert.equal(above.long_context_multiplier_applied, true);
});

test("mixed-model transport prices both rejected and repaired Sol calls once while retaining Luna overhead", () => {
  const ledger = { version: "ai-session-transport-usage-v1", requests: [
    { request_index: 1, case_id: "demo", category: "application", model_name: PRICING.model, status: "completed", usage: usage() },
    { request_index: 2, case_id: "demo", category: "application", model_name: "gpt-6.1-sol", status: "failed", usage: usage(1000, 100, 200, 300) },
    { request_index: 3, case_id: "demo", category: "application", model_name: "gpt-6.1-sol", status: "completed", usage: usage(1000, 100, 200, 300) },
    { request_index: 4, case_id: "demo", category: "simulator_learner", model_name: PRICING.model, status: "completed", usage: usage() }
  ] };
  const records = new Map([["demo", [row({ model_name: "gpt-6.1-sol", retry_count: 1 })]]]);
  const report = buildSessionCostReport(fixture({ provider_dispatches: 4 }), records, "test", ledger);
  assert.equal(report.provider_dispatch_reconciliation.status, "matched");
  assert.equal(report.sessions[0].agent_call_recorded_usage.cost.upper_usd, null);
  assert.deepEqual(report.sessions[0].application.models, [PRICING.model, "gpt-6.1-sol"]);
  assert.equal(report.application_total.recorded_usage_units, 3);
  assert.equal(report.application_total.cost.exact_usd, 0.00577);
  assert.equal(report.simulator_learner_total.cost.exact_usd, 0.00023);
  assert.equal(report.combined_recorded_total.cost.exact_usd, 0.006);
  ledger.requests[1].usage = null;
  const missing = buildSessionCostReport(fixture({ provider_dispatches: 4 }), records, "test", ledger);
  assert.equal(missing.application_total.cost.upper_usd, null);
  assert.equal(missing.application_total.tokens.input_tokens.records_missing, 1);
  assert.equal(missing.combined_recorded_total.cost.upper_usd, null);
});

test("missing cache/read/write splits form ranges instead of fabricated zero", () => {
  const cost = estimateUsageCost(PRICING.model, normalizeUsage({ input_tokens: 1000, output_tokens: 100 }));
  assert.equal(cost.lower_usd, 0.00014);
  assert.equal(cost.upper_usd, 0.00037);
  assert.equal(cost.exact_usd, null);
  assert.deepEqual(cost.issues, ["cached_input_split_missing", "cache_write_split_missing"]);
  const knownReads = estimateUsageCost(PRICING.model, normalizeUsage({ input_tokens: 1000, output_tokens: 100, cached_input_tokens: 500 }));
  assert.equal(knownReads.lower_usd, 0.00023);
  assert.equal(knownReads.upper_usd, 0.000255);
});

test("long context threshold is per full request, strictly above 272K", () => {
  const at = estimateUsageCost(PRICING.model, normalizeUsage(usage(272000, 100, 0, 0)));
  const above = estimateUsageCost(PRICING.model, normalizeUsage(usage(272001, 100, 0, 0)));
  assert.equal(at.exact_usd, 0.05452);
  assert.equal(at.long_context_multiplier_applied, false);
  assert.equal(above.exact_usd, 0.1089804);
  assert.equal(above.long_context_multiplier_applied, true);
});

test("invalid totals, cache overlaps and reasoning subsets are not priced", () => {
  for (const invalid of [
    { ...usage(), total_tokens: 1 }, usage(10, 10, 9, 2),
    { ...usage(), output_tokens_details: { reasoning_tokens: 101 } },
    { ...usage(), input_tokens: -1 }, { input_tokens: "1000", output_tokens: 100 }
  ]) assert.equal(estimateUsageCost(PRICING.model, normalizeUsage(invalid)).upper_usd, null);
  assert.equal(estimateUsageCost(PRICING.model, normalizeUsage(null)).upper_usd, null);
  assert.equal(estimateUsageCost("gpt-unknown", normalizeUsage(usage())).upper_usd, null);
});

test("both failed semantic draft and accepted regeneration count without aggregate duplication", () => {
  const attempt = (sequence, accepted) => ({ sequence, accepted, input_tokens: 200000, output_tokens: 100,
    total_tokens: 200100, http_request_count: 1, transport_retry_count: 0 });
  const analyzed = analyzeAgentCall(row({ token_usage: { input_tokens: 400000, output_tokens: 200, total_tokens: 400200 },
    raw_output: { provider_execution_audit: { attempts: [attempt(1, false), attempt(2, true)] } } }));
  assert.equal(analyzed.units.length, 2);
  assert.equal(analyzed.units.reduce((sum, unit) => sum + unit.usage.input_tokens, 0), 400000);
  assert(analyzed.units.every(unit => !unit.cost.long_context_multiplier_applied));
  assert.equal(analyzed.missing_attempts, 0);
});

test("accepted raw response cache details only match their own response ID", () => {
  const record = row({ token_usage: { input_tokens: 2000, output_tokens: 200 }, raw_output: {
    accepted_output: { id: "resp_final", usage: usage() }, provider_execution_audit: { attempts: [
      { provider_response_id: "resp_rejected", input_tokens: 1000, output_tokens: 100, http_request_count: 1 },
      { provider_response_id: "resp_final", input_tokens: 1000, output_tokens: 100, http_request_count: 1 }
    ] }
  } });
  const analyzed = analyzeAgentCall(record);
  assert.equal(analyzed.units[0].usage.cached_input_tokens, null);
  assert.equal(analyzed.units[1].usage.cached_input_tokens, 500);
});

test("transport retries with unretained usage keep an unknown upper bound", () => {
  const report = buildSessionCostReport(fixture({ provider_dispatches: 3 }), new Map([["demo", [row({ retry_count: 1 })]]]));
  assert.equal(report.application_total.usage_units_missing, 1);
  assert.equal(report.application_total.cost.upper_usd, null);
  assert.equal(report.application_total.cost.lower_usd, 0.00023);
  assert.equal(report.provider_dispatch_reconciliation.status, "matched");
});

test("application failure usage and learner overhead remain separate", () => {
  const report = buildSessionCostReport(fixture(), new Map([["demo", [row({ call_status: "failed", output_validated: false })]]]));
  assert.equal(report.sessions[0].application.failed_or_rejected_records, 1);
  assert.equal(report.application_total.cost.exact_usd, 0.00023);
  assert.equal(report.simulator_learner_total.cost.exact_usd, 0.00023);
  assert.equal(report.combined_recorded_total.cost.exact_usd, 0.00046);
  assert.equal(report.sessions[0].scripted_student_replies, 1);
});

test("missing artifacts, retry metadata and failed learner dispatches remain unknown", () => {
  const absent = buildSessionCostReport(fixture(), new Map());
  assert.equal(absent.application_total.cost.upper_usd, null);
  assert.equal(absent.sessions[0].application.agent_call_records, null);
  const noRetries = row(); delete noRetries.retry_count;
  assert.equal(buildSessionCostReport(fixture(), new Map([["demo", [noRetries]]])).application_total.cost.upper_usd, null);
  const extra = buildSessionCostReport(fixture({ provider_dispatches: 3 }), new Map([["demo", [row()]]]));
  assert.equal(extra.provider_dispatch_reconciliation.unallocated_dispatches, 1);
  assert.equal(extra.unallocated_cost.upper_usd, null);
  assert.equal(extra.application_total.cost.upper_usd, null);
  assert.equal(extra.simulator_learner_total.cost.upper_usd, null);
  assert.equal(extra.combined_recorded_total.cost.upper_usd, null);
});

test("explicitly undispatched attempts and mock calls do not manufacture charges", () => {
  const analyzed = analyzeAgentCall(row({ token_usage: null, raw_output: { provider_execution_audit: { attempts: [
    { http_request_count: 0, input_tokens: null, output_tokens: null }
  ] } } }));
  assert.equal(analyzed.request_count, 0);
  assert.equal(analyzed.units[0].cost.status, "not_dispatched");
  assert.equal(analyzeAgentCall(row({ provider: "mock" })).units.length, 0);
});

test("transport sidecar replaces aggregates and captures every repair or failed learner call", () => {
  const ledger = { records: [
    { dispatch: 1, case_id: "demo", category: "application", model: PRICING.model, usage: usage() },
    { dispatch: 2, case_id: "demo", category: "application", model: PRICING.model, usage: usage(), response_status: "failed" },
    { dispatch: 3, case_id: "demo", category: "synthetic_learner", model: PRICING.model, usage: usage() },
    { dispatch: 4, case_id: "other_case", category: "application", model: PRICING.model, usage: usage(20000) }
  ] };
  const report = buildSessionCostReport(fixture({ provider_dispatches: 3 }), new Map([["demo", [row({ retry_count: 1 })]]]), "test", ledger);
  assert.equal(report.application_total.recorded_usage_units, 2);
  assert.equal(report.application_total.cost.exact_usd, 0.00046);
  assert.equal(report.simulator_learner_total.cost.exact_usd, 0.00023);
  assert.equal(report.combined_recorded_total.cost.exact_usd, 0.00069);
  assert.equal(report.provider_dispatch_reconciliation.status, "matched");
  assert.equal(report.sessions[0].agent_call_recorded_usage.cost.upper_usd, null);
  assert.equal(report.transport_ledger_total.recorded_usage_units, 4);
});

test("sidecar unknown usage or attribution never silently becomes a free call", () => {
  const ledger = { records: [
    { dispatch: 1, case_id: "demo", category: "application", model: PRICING.model, usage: usage() },
    { dispatch: 2, case_id: "demo", category: "synthetic_learner", model: PRICING.model, usage: null }
  ] };
  let report = buildSessionCostReport(fixture(), new Map([["demo", [row()]]]), "test", ledger);
  assert.equal(report.simulator_learner_total.cost.upper_usd, null);
  assert.equal(report.simulator_learner_total.tokens.input_tokens.records_missing, 1);
  assert.equal(report.combined_recorded_total.cost.upper_usd, null);
  ledger.records[1] = { ...ledger.records[1], category: "unknown", usage: usage() };
  report = buildSessionCostReport(fixture(), new Map([["demo", [row()]]]), "test", ledger);
  assert.equal(report.application_total.cost.upper_usd, null);
  assert.equal(report.unallocated_cost.exact_usd, 0.00023);
  assert.equal(report.combined_recorded_total.cost.exact_usd, 0.00046);
  ledger.records[1].dispatch = 1;
  assert.throws(() => buildSessionCostReport(fixture(), new Map(), "test", ledger));
});

test("versioned transport usage format preserves application and simulator attribution", () => {
  const ledger = { version: "ai-session-transport-usage-v1", requests: [
    { request_index: 1, case_id: "demo", category: "application", model_name: PRICING.model, status: "completed", usage: usage() },
    { request_index: 2, case_id: "demo", category: "simulator_learner", model_name: PRICING.model, status: "failed", usage: usage() },
    { request_index: 3, case_id: "connectivity_probe", category: "unknown", model_name: PRICING.model, status: "completed", usage: usage(37, 14, 0, 0) }
  ] };
  const report = buildSessionCostReport(fixture(), new Map([["demo", [row()]]]), "test", ledger);
  assert.equal(report.application_total.cost.exact_usd, 0.00023);
  assert.equal(report.simulator_learner_total.cost.exact_usd, 0.00023);
  assert.equal(report.provider_dispatch_reconciliation.status, "matched");
  assert.equal(report.connectivity_probe_overhead.cost.exact_usd, 0.0000242);
  assert.equal(report.transport_ledger_total.cost.exact_usd, 0.0004842);
});

test("offline CLI creates a safe new report without changing sources or printing transcripts", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cmcq-cost-test-"));
  try {
    const source = path.join(directory, "report.json");
    const calls = path.join(directory, "demo-agent-calls.json");
    const destination = path.join(directory, "cost.json");
    writeFileSync(source, JSON.stringify(fixture({ private_secret: "MUST_NOT_LEAK", transcript: "PRIVATE_TRANSCRIPT" })));
    writeFileSync(calls, JSON.stringify([row({ input_payload: "PRIVATE_PROMPT", raw_output: { secret: "PRIVATE_OUTPUT" } })]));
    const original = readFileSync(source, "utf8");
    const command = [path.resolve("scripts/ai-session-cost-report.mjs"), source, "--output", destination];
    const run = spawnSync(process.execPath, command, { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const output = readFileSync(destination, "utf8");
    assert.doesNotMatch(output + run.stdout + run.stderr, /MUST_NOT_LEAK|PRIVATE_TRANSCRIPT|PRIVATE_PROMPT|PRIVATE_OUTPUT/);
    assert.equal(JSON.parse(output).source_report_sha256.length, 64);
    assert.equal(readFileSync(source, "utf8"), original);
    assert.notEqual(spawnSync(process.execPath, command, { encoding: "utf8" }).status, 0);
    assert.equal(readFileSync(destination, "utf8"), output);
    const sidecar = path.join(directory, "transport-usage.json");
    const withTransport = path.join(directory, "cost-with-transport.json");
    writeFileSync(sidecar, JSON.stringify({ version: "ai-session-transport-usage-v1", requests: [
      { request_index: 1, case_id: "demo", category: "application", model_name: PRICING.model, usage: usage() },
      { request_index: 2, case_id: "demo", category: "simulator_learner", model_name: PRICING.model, usage: usage() }
    ] }));
    const sidecarRun = spawnSync(process.execPath, [command[0], source, "--transport-usage", sidecar, "--output", withTransport], { encoding: "utf8" });
    assert.equal(sidecarRun.status, 0, sidecarRun.stderr);
    const sidecarReport = JSON.parse(readFileSync(withTransport, "utf8"));
    assert.equal(sidecarReport.combined_recorded_total.cost.exact_usd, 0.00046);
    assert.equal(sidecarReport.source_transport_usage_sha256.length, 64);
    assert.throws(() => buildSessionCostReport({ ...fixture(), synthetic_only: false }, new Map()));
    assert.throws(() => buildSessionCostReport(fixture({ results: [{ case_id: "../secret" }] }), new Map()));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert(path.basename(directory).startsWith("cmcq-cost-test-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
