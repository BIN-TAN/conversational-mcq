/**
 * Item builder and API-helper resilience (20 Oct 2026), without a database or provider calls:
 * - empty design-panel rows are left out when the design is saved, and incomplete ones are
 *   named in the panel's words;
 * - a web page in place of data (the hosting platform answering during a restart) becomes a
 *   plain message in the teacher and student pages;
 * - an item-builder call cut off by a restart no longer blocks the same request;
 * - a request that never reaches the server (the browser's "Failed to fetch") shows a plain
 *   message on teacher pages and sign-in (release CMCQ-20261020-05).
 * Run with: npx tsx prisma/teacher-tools-resilience-unit-test.ts
 */
import assert from "node:assert/strict";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

const htmlPage = "<!DOCTYPE html><html><body>Bad gateway</body></html>";
function stubFetch(body: string, init: ResponseInit) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, init)) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

async function main() {
  const { normalizeBlueprint, blueprintIssueLabels } = await import("../src/components/teacher-content/item-design-blueprint");
  const { apiRequest, ClientApiError } = await import("../src/components/teacher-content/api");
  const { fetchSessionState } = await import("../src/components/student-assessment/api");
  const { abandonedStartedCalls, ITEM_DESIGN_ASSISTANT_STALE_CALL_MS, ITEM_GENERATION_STALE_CALL_MS } =
    await import("../src/lib/services/content/agent-call-staleness");
  const { requestErrorMessage, SERVER_UNREACHABLE_MESSAGE } = await import("../src/components/server-unavailable-message");

  const blueprint = {
    section_topic: "Measurement logic and IRT assumptions",
    objectives: [
      { objective_id: "obj_1", statement: "Interpret ability estimates", evidence_requirements: ["Explains theta ", " "] },
      { objective_id: "obj_new", statement: "", evidence_requirements: [""] },
      { objective_id: "obj_linked", statement: " ", evidence_requirements: [] }
    ],
    misconception_hypotheses: [
      { statement: "Theta is a percent correct", linked_objective_ids: ["obj_1"], student_language_examples: [" ", "It is the score"], why_plausible: null },
      { statement: "", linked_objective_ids: ["obj_1"], student_language_examples: [], why_plausible: null },
      { statement: "", linked_objective_ids: ["obj_linked"], student_language_examples: [], why_plausible: "Partly written" }
    ],
    exemplar_items: [
      { item_text: "", observed_difficulty_note: null },
      { item_text: "Which statement about local independence is true?", observed_difficulty_note: null }
    ]
  };

  await check("Saving leaves out empty rows and keeps anything with content", () => {
    const saved = normalizeBlueprint(blueprint);
    assert.deepEqual(saved.objectives.map((objective) => objective.objective_id), ["obj_1", "obj_linked"],
      "The empty new objective is left out; an empty objective that a misconception links to stays for the server to name");
    assert.deepEqual(saved.objectives[0].evidence_requirements, ["Explains theta"]);
    assert.equal(saved.misconception_hypotheses.length, 2, "Only the completely empty misconception example is left out");
    assert.deepEqual(saved.misconception_hypotheses[0].student_language_examples, ["It is the score"]);
    assert.equal(saved.exemplar_items.length, 1);
    assert.equal(saved.section_topic, blueprint.section_topic, "Other fields are unchanged");
  });

  await check("At least one objective always remains", () => {
    const empty = { ...blueprint, objectives: [{ objective_id: "only", statement: "", evidence_requirements: [""] }],
      misconception_hypotheses: [], exemplar_items: [] };
    assert.equal(normalizeBlueprint(empty).objectives.length, 1);
  });

  await check("Incomplete entries are named in the panel's words", () => {
    assert.deepEqual(blueprintIssueLabels([
      "blueprint.objectives.1.statement",
      "blueprint.objectives.1.evidence_requirements",
      "blueprint.objectives.1.statement",
      "blueprint.misconception_hypotheses.0.linked_objective_ids",
      "blueprint.exemplar_items.2.item_text",
      "blueprint.section_summary",
      "expected_concept_unit_version"
    ]), [
      "Learning objective 2 (what students should know or be able to do)",
      "Learning objective 2 (observable evidence)",
      "Misconception example 1 (linked learning objective)",
      "Exemplar item 3 (item text)",
      "What this section covers"
    ]);
  });

  await check("Teacher pages: a web page in place of data becomes a plain message", async () => {
    for (const status of [502, 200]) {
      const restore = stubFetch(htmlPage, { status, headers: { "Content-Type": "text/html" } });
      try {
        await assert.rejects(apiRequest("/api/teacher/anything"), (error: unknown) => {
          assert(error instanceof ClientApiError);
          assert.equal(error.code, "unexpected_response");
          assert.equal(error.status, status);
          assert.doesNotMatch(error.message, /Unexpected token|DOCTYPE|JSON/);
          assert.match(error.message, /restarting/);
          return true;
        });
      } finally {
        restore();
      }
    }
    const restore = stubFetch(JSON.stringify({ error: { code: "conflict", message: "Changed." } }), { status: 409 });
    try {
      await assert.rejects(apiRequest("/api/teacher/anything"), (error: unknown) =>
        error instanceof ClientApiError && error.code === "conflict" && error.message === "Changed.");
    } finally {
      restore();
    }
  });

  await check("Student pages: a web page in place of data is a connection failure with a status", async () => {
    for (const [status, expected] of [[502, 502], [200, 503]] as const) {
      const restore = stubFetch(htmlPage, { status, headers: { "Content-Type": "text/html" } });
      try {
        await assert.rejects(fetchSessionState("session_x"), (error: unknown) => {
          const value = error as { code: string; message: string; status: number };
          assert.equal(value.code, "service_unavailable");
          assert.equal(value.status, expected, "The attempt page retries non-401/403 failures");
          assert.doesNotMatch(value.message, /Unexpected token|DOCTYPE|JSON/);
          return true;
        });
      } finally {
        restore();
      }
    }
  });

  await check("Item builder: a call cut off by a restart is closed after the stale window", () => {
    const now = new Date("2026-10-21T00:30:00Z");
    const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    const calls = [
      { id: "fresh", call_status: "started", started_at: minutesAgo(9), created_at: minutesAgo(9) },
      { id: "stale", call_status: "started", started_at: minutesAgo(16), created_at: minutesAgo(16) },
      { id: "done", call_status: "succeeded", started_at: minutesAgo(30), created_at: minutesAgo(30) },
      { id: "no_start", call_status: "started", started_at: null, created_at: minutesAgo(17) }
    ];
    assert.deepEqual(abandonedStartedCalls(calls, ITEM_DESIGN_ASSISTANT_STALE_CALL_MS, now).map((call) => call.id), ["stale", "no_start"]);
    assert.deepEqual(abandonedStartedCalls(calls, ITEM_GENERATION_STALE_CALL_MS, now).map((call) => call.id), []);
    assert(ITEM_DESIGN_ASSISTANT_STALE_CALL_MS > 2 * 360_000, "Longer than two assistant provider calls of 360 seconds");
  });

  await check("A request that never reaches the server reads as a plain message", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    try {
      await assert.rejects(apiRequest("/api/teacher/anything"), (error: unknown) => {
        assert(error instanceof ClientApiError);
        assert.equal(error.code, "network_error");
        assert.equal(error.status, 0);
        assert.equal(error.message, SERVER_UNREACHABLE_MESSAGE);
        return true;
      });
      const abort = new DOMException("The operation was aborted.", "AbortError");
      globalThis.fetch = (async () => { throw abort; }) as typeof fetch;
      await assert.rejects(apiRequest("/api/teacher/anything"), (error: unknown) => error === abort, "An abort stays an abort");
    } finally {
      globalThis.fetch = original;
    }
    for (const browserMessage of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      assert.equal(requestErrorMessage(new TypeError(browserMessage), "fallback"), SERVER_UNREACHABLE_MESSAGE);
    }
    assert.equal(requestErrorMessage(new Error("The report is not ready yet."), "fallback"), "The report is not ready yet.");
    assert.equal(requestErrorMessage("odd", "The report could not be loaded."), "The report could not be loaded.");
    const fs = await import("node:fs");
    for (const file of ["src/components/login-form.tsx", "src/components/teacher-dashboard/instructor-report-panel.tsx",
      "src/components/teacher-dashboard/attempt-comparison-panel.tsx", "src/components/teacher-review/restore-attempt-chance.tsx"]) {
      assert(fs.readFileSync(file, "utf8").includes("requestErrorMessage("), file);
    }
  });

  console.log(`\n${passed} teacher tools resilience checks passed; no database or provider calls.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
