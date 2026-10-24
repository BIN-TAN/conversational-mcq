/**
 * Release CMCQ-20261023-08, performance: less repeated work on the student request path.
 * - The attempt page fetches the response review only once the attempt reaches it, not after every
 *   answer step (each review fetch rebuilds the whole session state on the server).
 * - The state build reads the tempting-option evidence once, and keeps the agent-readiness answer
 *   for 60 seconds on the production server without pinging the database it has just queried.
 * - The mini-test list reads the student's sessions in one query and the rest in small groups.
 * - Starting an attempt retries serialization conflicts up to five times with a short random wait.
 * - The JSON import page parses while typing pauses.
 * - Feedback preparation runs six jobs at a time (render.yaml; set on Render).
 * No database or provider calls. Run with: npx tsx prisma/performance-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const service = source("src/lib/services/student-assessment/service.ts");
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  assert(from >= 0, start);
  return text.slice(from, text.indexOf(end, from + start.length));
};

check("The attempt page skips the review fetch while the student answers", () => {
  const client = source("src/components/student-assessment/assessment-session-client.tsx");
  const answering = between(client, "const ANSWERING_STATES = new Set([", "]);");
  for (const state of ["ITEM_PRESENTED", "AWAIT_ANSWER", "AWAIT_REASON", "AWAIT_CONFIDENCE", "AWAIT_TEMPTING_OPTION", "AWAIT_TEMPTING_REASON", "TRANSFER_ITEM"]) {
    assert(answering.includes(`"${state}"`), state);
  }
  for (const state of ["PACKAGE_REVIEW", "PACKAGE_ANALYSIS", "SESSION_COMPLETE", "FORMATIVE_ACTIVITY"]) {
    assert(!answering.includes(`"${state}"`), `${state} still shows the review`);
  }
  assert(client.includes("reviewNeeded ? fetchStudentReview(sessionPublicId)"));
  assert(!/refreshSecondaryData\([^,)]+\)/.test(client), "Every refresh passes the next state");
});

check("The state build reads tempting evidence once and caches readiness only in production", () => {
  const build = between(service, "export async function getStudentSessionState", "\nexport async function ");
  assert.equal(build.split("getLatestTemptingOptionEvidence(").length - 1, 1, "One tempting-evidence read per state build");
  assert(build.includes("await cachedAutomaticAgentIntegrationReady()"));
  assert(!build.includes("checkDatabase: true"));
  const cache = between(service, "async function cachedAutomaticAgentIntegrationReady", "\n}\n");
  assert(cache.includes('process.env.NODE_ENV === "production"') && cache.includes("checkDatabase: false"));
  assert(service.includes("const AGENT_READINESS_TTL_MS = 60_000;"));
});

check("The mini-test list batches its reads", () => {
  const list = between(service, "export async function listAvailableAssessments", "\nexport async function ");
  assert(list.includes("assessment_db_id: { in: assessments.map((assessment) => assessment.id) }"));
  assert(!list.includes("prisma.$transaction"), "No transaction around a single read");
  assert(list.includes("await inGroups(assessments, 4") && list.includes("await inGroups(families, 4"));
});

check("Starting an attempt retries conflicts with a short random wait", () => {
  assert(service.includes("const START_ATTEMPT_TRIES = 5;"));
  assert(service.includes("for (let attempt = 0; attempt < START_ATTEMPT_TRIES; attempt += 1) {"));
  assert(service.includes("40 * attempt + Math.floor(Math.random() * 120)"));
});

check("The JSON page parses deferred text, and continuing waits for the current text", () => {
  const client = source("src/components/teacher-content/import-json-client.tsx");
  assert(client.includes("const deferredText = useDeferredValue(jsonText);"));
  assert(client.includes("disabled={!document || busy || deferredText !== jsonText}"));
});

check("Feedback preparation runs six jobs at a time", () => {
  assert.match(source("render.yaml"), /- key: INITIAL_PREPARATION_CONCURRENCY\r?\n\s+value: "6"/);
});

console.log(`\n${passed} performance checks passed; no database or provider calls.`);
