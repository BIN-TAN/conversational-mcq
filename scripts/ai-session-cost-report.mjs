import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Offline accounting only: never import application configuration, open a database,
// make provider calls, or emit the prompts/transcripts in the source artifacts.
export const PRICING = Object.freeze({
  model: "gpt-5.6-luna",
  currency: "USD",
  basis: "standard API text-token rates; not an invoice",
  source_checked_at: "2026-10-13",
  source_url: "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
  per_million: { input: 0.20, cached_input: 0.02, cache_write_input: 0.25, output: 1.20 },
  long_context: { input_tokens_exceeding: 272000, input_multiplier: 2, output_multiplier: 1.5 }
});

// Keep the original exported Luna table and report version for historical consumers.
// Every supported model has its own dated standard-rate table; never default an
// unrecognized model to Luna or to a discounted/batch price.
export const PRICING_BY_MODEL = Object.freeze({
  [PRICING.model]: PRICING,
  "gpt-6.1-sol": Object.freeze({
    model: "gpt-6.1-sol",
    currency: "USD",
    basis: "standard API text-token rates; not an invoice",
    source_checked_at: "2026-10-13",
    source_url: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    per_million: Object.freeze({ input: 2, cached_input: 0.10, cache_write_input: 2.50, output: 10 }),
    long_context: Object.freeze({ input_tokens_exceeding: 272000, input_multiplier: 2, output_multiplier: 1.5 })
  })
});

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const integer = value => Number.isSafeInteger(value) && value >= 0;
const round = value => Number(value.toFixed(12));
const safeModel = value => typeof value === "string" && /^gpt-[a-zA-Z0-9.-]{1,80}$/.test(value) ? value : null;
const fields = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_tokens"];

function firstField(sources, paths) {
  for (const source of sources) for (const keys of paths) {
    let value = source;
    for (const key of keys.split(".")) value = object(value)[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

export function normalizeUsage(...sources) {
  const roots = sources.flatMap(source => {
    const value = object(source);
    return [value, object(value.raw)];
  });
  const paths = {
    input_tokens: ["input_tokens", "inputTokens", "prompt_tokens"],
    output_tokens: ["output_tokens", "outputTokens", "completion_tokens"],
    total_tokens: ["total_tokens", "totalTokens"],
    cached_input_tokens: ["input_tokens_details.cached_tokens", "input_token_details.cached_tokens", "cached_input_tokens", "cachedInputTokens", "prompt_tokens_details.cached_tokens"],
    cache_write_input_tokens: ["input_tokens_details.cache_write_tokens", "input_tokens_details.cache_creation_tokens", "cache_write_input_tokens", "cache_creation_input_tokens"],
    reasoning_tokens: ["output_tokens_details.reasoning_tokens", "output_token_details.reasoning_tokens", "reasoning_tokens", "reasoningTokens", "completion_tokens_details.reasoning_tokens"]
  };
  const usage = Object.fromEntries(Object.entries(paths).map(([key, alternatives]) => [key, firstField(roots, alternatives)]));
  const issues = Object.entries(usage).filter(([, value]) => value !== null && !integer(value)).map(([key]) => `invalid_${key}`);
  for (const key of Object.keys(usage)) if (usage[key] !== null && !integer(usage[key])) usage[key] = null;
  if (usage.input_tokens !== null && usage.output_tokens !== null && usage.total_tokens !== null
    && usage.total_tokens !== usage.input_tokens + usage.output_tokens) issues.push("inconsistent_total_tokens");
  if (usage.input_tokens !== null && (usage.cached_input_tokens ?? 0) + (usage.cache_write_input_tokens ?? 0) > usage.input_tokens) issues.push("cache_subsets_exceed_input");
  if (usage.output_tokens !== null && usage.reasoning_tokens !== null && usage.reasoning_tokens > usage.output_tokens) issues.push("reasoning_subset_exceeds_output");
  return { ...usage, issues };
}

export function estimateUsageCost(model, usage) {
  const issues = [...usage.issues];
  const pricing = Object.hasOwn(PRICING_BY_MODEL, model) ? PRICING_BY_MODEL[model] : null;
  if (!pricing) issues.push("model_pricing_unavailable");
  if (usage.input_tokens === null || usage.output_tokens === null) issues.push("input_or_output_usage_missing");
  if (issues.length) return { status: "unknown", lower_usd: 0, upper_usd: null, exact_usd: null, issues };
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const reads = usage.cached_input_tokens;
  const writes = usage.cache_write_input_tokens;
  const longContext = input > pricing.long_context.input_tokens_exceeding;
  const inputMultiplier = longContext ? pricing.long_context.input_multiplier : 1;
  const outputMultiplier = longContext ? pricing.long_context.output_multiplier : 1;
  const price = (readCount, writeCount) => round((
    ((input - readCount - writeCount) * pricing.per_million.input
      + readCount * pricing.per_million.cached_input
      + writeCount * pricing.per_million.cache_write_input) * inputMultiplier
    + output * pricing.per_million.output * outputMultiplier
  ) / 1_000_000);
  // Missing cache details are unknown, not zero. Reads and writes are disjoint
  // subsets of total input; reasoning is already a subset of total output.
  const lower = price(reads ?? input - (writes ?? 0), writes ?? 0);
  const upper = price(reads ?? 0, writes ?? input - (reads ?? 0));
  if (reads === null) issues.push("cached_input_split_missing");
  if (writes === null) issues.push("cache_write_split_missing");
  return {
    status: lower === upper ? "exact_for_recorded_usage" : "bounded_for_recorded_usage",
    lower_usd: lower, upper_usd: upper, exact_usd: lower === upper ? lower : null,
    long_context_multiplier_applied: longContext, issues
  };
}

function executionAudit(record) {
  return object(object(record.raw_output).provider_execution_audit ?? object(record.usage_guard_snapshot).provider_execution_audit);
}

function providerUsage(record) {
  const raw = object(record.raw_output);
  return object(raw.usage ?? object(raw.provider_raw_output).usage);
}

function unit(model, usage, metadata = {}) {
  return { model: safeModel(model), usage, cost: estimateUsageCost(model, usage), ...metadata };
}

export function analyzeAgentCall(record) {
  const audit = executionAudit(record);
  const attempts = Array.isArray(audit.attempts) ? audit.attempts : [];
  const model = safeModel(record.model_name);
  const warnings = [];
  let missingAttempts = 0;
  let requestCount = 0;
  let retryCoverageUnknown = false;
  let units;
  if (attempts.length) {
    // Price each dispatched tutor and review request at its own recorded model.
    // These units replace the aggregate AgentCall, which includes both kinds.
    const auditUnits = (attempt, attemptModel, usage, kind, rawResponse = {}) => {
      const requests = integer(attempt.http_request_count) ? attempt.http_request_count : null;
      const retries = integer(attempt.transport_retry_count) ? attempt.transport_retry_count : null;
      if (attempt.dispatch_accounting_complete === false || attempt.usage_accounting_complete === false) {
        warnings.push(`${kind}_accounting_incomplete`);
        retryCoverageUnknown = true;
      }
      if (Object.hasOwn(attempt, "physical_usage")) {
        const physical = object(attempt.physical_usage);
        const rows = Array.isArray(physical.attempts) ? physical.attempts : [];
        const responseIds = rows.map(entry => entry?.provider_response_id).filter(id => id !== null);
        const shapeValid = physical.version === "provider-physical-usage-v1" && Array.isArray(physical.attempts)
          && rows.length <= 3 && rows.every((entry, index) => entry && typeof entry === "object"
            && entry.adapter_attempt_index === index + 1 && typeof entry.client_request_id === "string"
            && entry.client_request_id.length > 0 && [true, false, null].includes(entry.fetch_invoked)
            && (entry.provider_response_id === null || (typeof entry.provider_response_id === "string"
              && entry.provider_response_id.length > 0)))
          && new Set(rows.map(entry => entry.client_request_id)).size === rows.length
          && new Set(responseIds).size === responseIds.length;
        if (shapeValid) {
          const dispatched = rows.filter(entry => entry.fetch_invoked !== false);
          const counted = requests ?? dispatched.length;
          requestCount += counted;
          missingAttempts += Math.max(0, counted - dispatched.length);
          const inconsistent = requests === null || requests !== rows.filter(entry => entry.fetch_invoked === true).length
            || !integer(attempt.provider_attempt_count) || attempt.provider_attempt_count !== rows.length
            || physical.usage_accounting_complete !== true || rows.some(entry => entry.fetch_invoked === null
              || (entry.fetch_invoked === true && entry.provider_response_id === null));
          if (inconsistent) {
            warnings.push(`${kind}_physical_accounting_incomplete`);
            retryCoverageUnknown = true;
          }
          return rows.map(entry => {
            // Supplement cache details only from this exact physical response.
            // Never borrow the final response's usage for an earlier request.
            const ownRaw = entry.provider_response_id && rawResponse.id === entry.provider_response_id
              ? object(rawResponse.usage) : {};
            const recorded = normalizeUsage(entry, ownRaw);
            const rawTokens = normalizeUsage(ownRaw);
            const tokenConflict = ["input_tokens", "output_tokens", "total_tokens"].some(field =>
              rawTokens[field] !== null && recorded[field] !== null && rawTokens[field] !== recorded[field]);
            if (tokenConflict) recorded.issues.push("physical_response_usage_mismatch");
            if (entry.fetch_invoked === false && [recorded.input_tokens, recorded.output_tokens, recorded.total_tokens]
              .every(value => value === null || value === 0)) {
              return { model: safeModel(attemptModel), usage: recorded,
                cost: { status: "not_dispatched", lower_usd: 0, upper_usd: 0, exact_usd: 0, issues: [] },
                dispatched: false, kind };
            }
            if (entry.fetch_invoked === false) recorded.issues.push("physical_usage_without_dispatch");
            if (recorded.input_tokens === null || recorded.output_tokens === null || recorded.total_tokens === null
              || recorded.issues.length) {
              retryCoverageUnknown = true;
              warnings.push(`${kind}_physical_usage_incomplete`);
            }
            return unit(attemptModel, recorded, { dispatched: true, kind });
          });
        }
        warnings.push(`${kind}_physical_audit_invalid`);
        retryCoverageUnknown = true;
      }
      if (requests === 0 && (usage.input_tokens ?? 0) === 0 && (usage.output_tokens ?? 0) === 0) {
        return [{ model: safeModel(attemptModel), usage,
          cost: { status: "not_dispatched", lower_usd: 0, upper_usd: 0, exact_usd: 0, issues: [] }, dispatched: false, kind }];
      }
      const counted = requests ?? (retries === null ? 1 : retries + 1);
      requestCount += counted;
      missingAttempts += Math.max(0, counted - 1);
      if (requests === null && retries === null) retryCoverageUnknown = true;
      if (requests === 0) {
        warnings.push(`${kind}_usage_without_dispatch`);
        retryCoverageUnknown = true;
      }
      return [unit(attemptModel, usage, { dispatched: true, kind })];
    };
    let reviewLogicalCalls = 0;
    units = attempts.flatMap(attempt => {
      const raw = object(object(record.raw_output).accepted_output);
      const acceptedRaw = object(raw.provider_raw_output ?? raw);
      const matchingRaw = attempt.provider_response_id && acceptedRaw.id === attempt.provider_response_id
        ? object(acceptedRaw.usage) : {};
      const parent = auditUnits(attempt, model,
        normalizeUsage(attempt.token_usage, attempt.usage, matchingRaw, attempt), "tutor", acceptedRaw);
      if (!Object.hasOwn(attempt, "pre_delivery_review")) return parent;
      const review = object(attempt.pre_delivery_review);
      if (review.logical_call_entered === true) reviewLogicalCalls++;
      const reviewRaw = object(review.raw_output);
      const usage = normalizeUsage(review.token_usage, review.usage, review,
        object(reviewRaw.usage), object(object(reviewRaw.provider_raw_output).usage));
      const childRaw = object(reviewRaw.provider_raw_output ?? reviewRaw);
      return [...parent, ...auditUnits(review, safeModel(review.model_name), usage, "delivery_review", childRaw)];
    });
    if (audit.dispatch_accounting_complete === false || audit.usage_accounting_complete === false) {
      warnings.push("execution_audit_accounting_incomplete");
      retryCoverageUnknown = true;
    }
    if (integer(audit.review_logical_calls_entered) && audit.review_logical_calls_entered !== reviewLogicalCalls) {
      warnings.push("delivery_review_receipt_count_mismatch");
      retryCoverageUnknown = true;
    }
    if (integer(audit.http_requests_dispatched) && audit.http_requests_dispatched !== requestCount) {
      warnings.push("aggregate_dispatches_do_not_match_attempts");
      retryCoverageUnknown = true;
    }
    const recorded = normalizeUsage(record.token_usage, record);
    const dispatched = units.filter(entry => entry.dispatched !== false);
    for (const field of ["input_tokens", "output_tokens"]) {
      if (recorded[field] !== null && dispatched.every(entry => entry.usage[field] !== null)
        && recorded[field] !== dispatched.reduce((sum, entry) => sum + entry.usage[field], 0)) {
        warnings.push(`aggregate_${field}_does_not_match_attempts`);
        retryCoverageUnknown = true;
      }
    }
  } else {
    units = [unit(model, normalizeUsage(record.token_usage, providerUsage(record), record), { dispatched: true })];
    const retries = integer(record.retry_count) ? record.retry_count : null;
    requestCount = 1 + (retries ?? 0);
    missingAttempts = retries ?? 0;
    retryCoverageUnknown = retries === null;
  }
  if (record.provider === "mock") {
    return { units: [], request_count: 0, missing_attempts: 0, retry_coverage_unknown: false, failed_or_rejected: false, warnings: ["mock_record_excluded_from_paid_usage"] };
  }
  if (missingAttempts) warnings.push("earlier_transport_attempt_usage_not_retained");
  if (retryCoverageUnknown) warnings.push("retry_coverage_not_established");
  return { units, request_count: requestCount, missing_attempts: missingAttempts,
    retry_coverage_unknown: retryCoverageUnknown,
    failed_or_rejected: record.call_status !== "succeeded" || record.output_validated !== true, warnings };
}

function summary(units, missing = 0, coverageUnknown = false) {
  const paid = units.filter(entry => entry.dispatched !== false);
  const lower = round(units.reduce((sum, entry) => sum + entry.cost.lower_usd, 0));
  const bounded = !missing && !coverageUnknown && units.every(entry => entry.cost.upper_usd !== null);
  const upper = bounded ? round(units.reduce((sum, entry) => sum + entry.cost.upper_usd, 0)) : null;
  return {
    recorded_usage_units: paid.length,
    usage_units_missing: missing,
    coverage_unknown: coverageUnknown,
    tokens: Object.fromEntries(fields.map(field => [field, {
      known: paid.reduce((sum, entry) => sum + (entry.usage[field] ?? 0), 0),
      records_missing: missing + paid.filter(entry => entry.usage[field] === null).length
    }])),
    cost: { status: upper === null ? "incomplete_unknown_upper_bound" : lower === upper ? "exact_for_recorded_usage" : "bounded_for_recorded_usage",
      lower_usd: lower, upper_usd: upper, exact_usd: upper === lower ? lower : null },
    issues: [...new Set(units.flatMap(entry => entry.cost.issues))]
  };
}

export function buildSessionCostReport(report, recordsByCase, generatedAt = new Date().toISOString(), transportLedger = null) {
  if (report.synthetic_only !== true || !Array.isArray(report.results)) throw new Error("A synthetic journey report is required.");
  const allApplication = [];
  const allLearner = [];
  const sessions = [];
  let accountedRequests = 0;
  let missingApplication = 0;
  let applicationCoverageUnknown = false;
  for (const result of report.results) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(result.case_id ?? "")) throw new Error("Invalid case identifier.");
    const records = recordsByCase.get(result.case_id);
    if (records !== undefined && !Array.isArray(records)) throw new Error("Agent-call artifact must be an array.");
    const analyzed = (records ?? []).map(analyzeAgentCall);
    const application = analyzed.flatMap(entry => entry.units);
    const missing = analyzed.reduce((sum, entry) => sum + entry.missing_attempts, 0);
    const coverageUnknown = records === undefined || analyzed.some(entry => entry.retry_coverage_unknown);
    const learner = (result.generated_student_replies ?? []).filter(reply => reply.source !== "scripted_edge_case").map(reply =>
      unit(report.student_model?.model_name, normalizeUsage(reply.usage), { dispatched: true }));
    accountedRequests += analyzed.reduce((sum, entry) => sum + entry.request_count, 0) + learner.length;
    missingApplication += missing;
    applicationCoverageUnknown ||= coverageUnknown;
    allApplication.push(...application);
    allLearner.push(...learner);
    sessions.push({ case_id: result.case_id,
      completed: result.outcome === "mechanical_checks_passed_manual_pedagogical_review_required",
      application: { ...summary(application, missing, coverageUnknown), agent_call_records: records?.length ?? null,
        failed_or_rejected_records: analyzed.filter(entry => entry.failed_or_rejected).length,
        warnings: [...new Set(analyzed.flatMap(entry => entry.warnings))],
        models: [...new Set(application.map(entry => entry.model))] },
      simulator_learner: summary(learner),
      scripted_student_replies: (result.generated_student_replies ?? []).filter(reply => reply.source === "scripted_edge_case").length });
  }
  const dispatches = integer(report.provider_dispatches) ? report.provider_dispatches : null;
  const reconciled = dispatches !== null && dispatches === accountedRequests;
  const extra = dispatches === null ? null : Math.max(0, dispatches - accountedRequests);
  // The boundary observer counts all harness traffic, including failed learner
  // generation that never reached generated_student_replies. Never price it at zero.
  const unallocated = !reconciled;
  const output = {
    version: "ai-session-cost-report-v1", generated_at: generatedAt, synthetic_only: true,
    pricing: PRICING,
    pricing_by_model: PRICING_BY_MODEL,
    interpretation: [
      "pricing preserves the original Luna table for compatibility; pricing_by_model records the dated standard-rate table used for each supported model.",
      "Application cost is per synthetic three-item assessment session, including preparation and the recorded dialogue; it excludes the learner simulator.",
      "Failed/rejected records and semantic-regeneration attempts are included. Missing earlier transport usage produces an unknown upper bound.",
      "Cached reads and cache writes partition input; reasoning is part of output and is never added again.",
      "Cache/write detail absence produces a range. Missing usage or unsupported model prices remain unknown, not zero.",
      "Dispatch counts are execution evidence, not proof of billing. Ranges apply to standard text-token prices only; taxes, discounts, tools and nonstandard service tiers are excluded.",
      "Delivery-review calls are application requests priced at their own recorded model in both retained child receipts and transport-based accounting. Manual pedagogical review is unpriced; these simulations are not classroom learning evidence."
    ],
    provider_dispatch_reconciliation: { reported_dispatches: dispatches, accounted_request_count: accountedRequests,
      unallocated_dispatches: extra, status: reconciled ? "matched" : "unreconciled" },
    sessions,
    application_total: summary(allApplication, missingApplication, applicationCoverageUnknown || unallocated),
    simulator_learner_total: summary(allLearner, 0, unallocated),
    combined_recorded_total: summary([...allApplication, ...allLearner], missingApplication,
      applicationCoverageUnknown || unallocated),
    unallocated_cost: { status: unallocated ? "unknown" : "none_identified", lower_usd: 0, upper_usd: unallocated ? null : 0 }
  };
  return transportLedger === null ? output : applyTransportLedger(output, transportLedger);
}

function applyTransportLedger(output, ledger) {
  const records = ledger.version === "ai-session-transport-usage-v1" && Array.isArray(ledger.requests)
    ? ledger.requests.map(request => ({ dispatch: request.request_index, case_id: request.case_id,
      category: request.category === "simulator_learner" ? "synthetic_learner" : request.category,
      model: request.model_name, usage: request.usage }))
    : ledger.records;
  if (!Array.isArray(records)) throw new Error("Transport ledger requires request records.");
  const cases = new Set(output.sessions.map(session => session.case_id));
  const rows = records.filter(record => record.case_id == null || cases.has(record.case_id));
  const seen = new Set();
  for (const row of records) {
    if (!integer(row.dispatch) || row.dispatch < 1 || seen.has(row.dispatch)) throw new Error("Transport dispatch IDs must be distinct positive integers.");
    seen.add(row.dispatch);
  }
  const entries = rows.map(row => ({
    case_id: row.case_id ?? null,
    category: row.category === "application" ? "application" : row.category === "synthetic_learner" ? "simulator_learner" : "unknown",
    unit: unit(row.model, normalizeUsage(row.usage), { dispatched: true })
  }));
  const unassigned = entries.filter(entry => entry.case_id === null || entry.category === "unknown");
  const application = entries.filter(entry => entry.case_id !== null && entry.category === "application").map(entry => entry.unit);
  const learner = entries.filter(entry => entry.case_id !== null && entry.category === "simulator_learner").map(entry => entry.unit);
  const dispatches = output.provider_dispatch_reconciliation.reported_dispatches;
  const matched = dispatches !== null && dispatches === rows.length;
  output.accounting_source = "passive_fetch_transport_usage_replaces_agent_call_aggregates";
  output.provider_dispatch_reconciliation = {
    reported_dispatches: dispatches, accounted_request_count: rows.length,
    unallocated_dispatches: unassigned.length + (dispatches === null ? 0 : Math.max(0, dispatches - rows.length)),
    status: matched && !unassigned.length ? "matched" : "unreconciled"
  };
  for (const session of output.sessions) {
    const sessionRows = entries.filter(entry => entry.case_id === session.case_id);
    const unknown = !matched || unassigned.some(entry => entry.case_id === null || entry.case_id === session.case_id);
    session.agent_call_recorded_usage = session.application;
    session.application = {
      ...summary(sessionRows.filter(entry => entry.category === "application").map(entry => entry.unit), 0, unknown),
      agent_call_records: session.agent_call_recorded_usage.agent_call_records,
      failed_or_rejected_records: session.agent_call_recorded_usage.failed_or_rejected_records,
      models: [...new Set(sessionRows.filter(entry => entry.category === "application").map(entry => entry.unit.model))]
    };
    session.simulator_learner = summary(sessionRows.filter(entry => entry.category === "simulator_learner").map(entry => entry.unit), 0, unknown);
  }
  output.application_total = summary(application, 0, !matched || unassigned.length > 0);
  output.simulator_learner_total = summary(learner, 0, !matched || unassigned.length > 0);
  output.combined_recorded_total = summary(entries.map(entry => entry.unit), 0, !matched);
  output.unallocated_cost = summary(unassigned.map(entry => entry.unit), 0, !matched).cost;
  const priced = rowsToPrice => rowsToPrice.map(row => unit(row.model, normalizeUsage(row.usage), { dispatched: true }));
  output.connectivity_probe_overhead = summary(priced(records.filter(row => row.case_id === "connectivity_probe")));
  output.transport_ledger_total = { ...summary(priced(records)),
    scope: "All requests in the supplied shared sidecar, including connectivity and other sessions outside this report. Do not sum this shared total across per-case reports." };
  output.interpretation.push("When supplied, the passive fetch ledger replaces aggregate usage for costs and retains every dispatch, including failed learner generation and repairs. Original AgentCall totals remain a comparison, never an extra charge.");
  return output;
}

function readJson(file) {
  const bytes = readFileSync(file);
  if (bytes.length > 64 * 1024 * 1024) throw new Error("Artifact exceeds the offline report size limit.");
  return { value: JSON.parse(bytes.toString("utf8")), sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function runCli(args) {
  if (!args.length) throw new Error("A report path is required.");
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    if (!["--output", "--transport-usage"].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error("Invalid offline report options.");
    options[args[index]] = args[index + 1];
  }
  const reportPath = path.resolve(args[0]);
  const source = readJson(reportPath);
  const records = new Map();
  const artifactHashes = {};
  for (const result of source.value.results ?? []) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(result.case_id ?? "")) throw new Error("Invalid case identifier.");
    try {
      const artifact = readJson(path.join(path.dirname(reportPath), `${result.case_id}-agent-calls.json`));
      records.set(result.case_id, artifact.value);
      artifactHashes[result.case_id] = artifact.sha256;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const transport = options["--transport-usage"] ? readJson(path.resolve(options["--transport-usage"])) : null;
  const output = { ...buildSessionCostReport(source.value, records, new Date().toISOString(), transport?.value ?? null),
    source_report_sha256: source.sha256, source_agent_call_sha256: artifactHashes,
    ...(transport ? { source_transport_usage_sha256: transport.sha256 } : {}) };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (options["--output"]) writeFileSync(path.resolve(options["--output"]), json, { flag: "wx" });
  else process.stdout.write(json);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runCli(process.argv.slice(2)); }
  catch { console.error("Cost report failed: check synthetic report/artifact format, case identifiers, paths and that the output file is new."); process.exitCode = 1; }
}
