import type { EvalRunItemRow, EvalRunRow, EvalSuiteRow, EvalSummary, Paginated } from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function listEvalSuites() {
  return requestJson<{ suites: EvalSuiteRow[] }>("/api/teacher/evals/suites");
}

export function seedEvalFixtures() {
  return requestJson<{ suite_count: number; case_count: number; suite_public_ids: string[] }>(
    "/api/teacher/evals/fixtures/seed",
    { method: "POST" }
  );
}

export function runMockEvaluation(body: { suite_public_id?: string; agent_name?: string } = {}) {
  return requestJson<{ runs: EvalRunRow[]; run_count: number }>(
    "/api/teacher/evals/runs/mock",
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}

export function listEvalRuns(params: URLSearchParams) {
  return requestJson<Paginated<{ runs: EvalRunRow[] }>>(
    `/api/teacher/evals/runs?${params.toString()}`
  );
}

export function getEvalRun(runPublicId: string) {
  return requestJson<{ run: EvalRunRow; summary: EvalSummary }>(
    `/api/teacher/evals/runs/${runPublicId}`
  );
}

export function listEvalRunItems(runPublicId: string, params: URLSearchParams) {
  return requestJson<Paginated<{ items: EvalRunItemRow[] }>>(
    `/api/teacher/evals/runs/${runPublicId}/items?${params.toString()}`
  );
}

export function getEvalRunItem(runItemPublicId: string, showProvider = false) {
  const params = new URLSearchParams();

  if (showProvider) {
    params.set("show_provider", "true");
  }

  return requestJson<{ item: EvalRunItemRow }>(
    `/api/teacher/evals/run-items/${runItemPublicId}?${params.toString()}`
  );
}

export function saveEvalAnnotation(
  runItemPublicId: string,
  body: {
    blind_review: boolean;
    overall_rating: number | null;
    pass_fail: string | null;
    rubric_scores: Record<string, number>;
    safety_flags: string[];
    notes: string;
  }
) {
  return requestJson(`/api/teacher/evals/run-items/${runItemPublicId}/annotations`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function confirmEvalAnnotation(runItemPublicId: string) {
  return requestJson(`/api/teacher/evals/run-items/${runItemPublicId}/annotations/confirm`, {
    method: "POST"
  });
}

export function confirmAllEvalAnnotations(runPublicId: string, attestation: string) {
  return requestJson(`/api/teacher/evals/runs/${runPublicId}/annotations/confirm-all`, {
    method: "POST",
    body: JSON.stringify({ attestation })
  });
}

export function getEvalSummary() {
  return requestJson<{ summary: EvalSummary }>("/api/teacher/evals/summary");
}
