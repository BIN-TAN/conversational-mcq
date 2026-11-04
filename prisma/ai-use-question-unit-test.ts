/**
 * Release 40: one question after each mini-test, "Did you use another AI tool while answering the questions?".
 * - Asked once per attempt, after the answers of the last topic are submitted, while the attempt is open.
 * - The answer is stored with the attempt and appears only in the research dataset (sessions.csv).
 * - Instructor pages, interpretation, feedback and the attempt summary never read it.
 * No database or provider calls. Run with: npx tsx prisma/ai-use-question-unit-test.ts
 * The database checks are in prisma/initial-preparation-smoke-test.ts.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  AI_USE_QUESTION_NOTE,
  AI_USE_QUESTION_TEXT,
  AI_USE_QUESTION_VERSION,
  aiUseQuestionNeeded
} from "../src/lib/services/student-assessment/ai-use-report";
import { SESSIONS_COLUMNS, buildAnalysisReadyDictionaryEntries } from "../src/lib/services/teacher-research-data/dictionary";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${passed}. ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
function filesUnder(dir: string): string[] {
  return readdirSync(path.join(process.cwd(), dir)).flatMap((entry) => {
    const relative = path.join(dir, entry);
    return statSync(path.join(process.cwd(), relative)).isDirectory() ? filesUnder(relative) : [relative];
  });
}

check("the question is asked once, after the last topic is submitted, in an open attempt", () => {
  const base = { answered: false, terminal: false, current_topic_submitted: true, current_topic_is_last: true };
  assert.equal(aiUseQuestionNeeded(base), true);
  assert.equal(aiUseQuestionNeeded({ ...base, answered: true }), false, "Answered attempts are not asked again");
  assert.equal(aiUseQuestionNeeded({ ...base, terminal: true }), false, "Ended or finished attempts are not asked");
  assert.equal(aiUseQuestionNeeded({ ...base, current_topic_submitted: false }), false, "Not before submission");
  assert.equal(aiUseQuestionNeeded({ ...base, current_topic_is_last: false }), false, "Not before the last topic");
  assert.equal(AI_USE_QUESTION_TEXT, "Did you use another AI tool while answering the questions?");
  assert.equal(AI_USE_QUESTION_VERSION, "ai-use-question-v1");
  assert.match(AI_USE_QUESTION_NOTE, /your instructor will not see it/);
});

check("the answer is stored with the attempt by a new migration that changes nothing existing", () => {
  const schema = source("prisma/schema.prisma");
  assert.match(schema, /other_ai_tool_use\s+Boolean\?/);
  assert.match(schema, /other_ai_tool_use_reported_at\s+DateTime\?\s+@db\.Timestamptz\(6\)/);
  const migration = source("prisma/migrations/20261104120000_other_ai_tool_use/migration.sql");
  assert.match(migration, /ADD COLUMN "other_ai_tool_use" BOOLEAN,/);
  assert.match(migration, /ADD COLUMN "other_ai_tool_use_reported_at" TIMESTAMPTZ\(6\);/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|DROP/i);
  const service = source("src/lib/services/student-assessment/ai-use-report.ts");
  assert.match(service, /where: \{ id: session\.id, other_ai_tool_use: null \}/, "The first answer stands");
  const route = source("src/app/api/student/sessions/[sessionPublicId]/ai-use/route.ts");
  assert.match(route, /requireStudent\(\)/);
  assert.match(route, /z\.object\(\{ used: z\.boolean\(\) \}\)/);
});

check("the student sees one dialog with Yes and No that never holds them", () => {
  const client = source("src/components/student-assessment/assessment-session-client.tsx");
  assert.match(client, /!readOnlyReview && state\.ai_use_question\?\.needed && !aiUseClosed \? \(/);
  assert.match(client, /data-testid="ai-use-answer-yes"/);
  assert.match(client, /data-testid="ai-use-answer-no"/);
  assert.match(client, /if \(failures >= 2\) setAiUseClosed\(true\);/, "Two failed saves close the dialog");
  const state = source("src/lib/services/student-assessment/service.ts");
  assert.match(state, /ai_use_question: \{\n\s+needed: aiUseQuestionNeeded\(\{/);
});

check("the answer is in sessions.csv of the research dataset, with a definition", () => {
  const columns = SESSIONS_COLUMNS as readonly string[];
  assert.ok(columns.includes("other_ai_tool_use"));
  assert.ok(columns.includes("other_ai_tool_use_reported_at"));
  const exportSource = source("src/lib/services/teacher-research-data/analysis-ready-export.ts");
  assert.match(exportSource, /other_ai_tool_use: session\.other_ai_tool_use === null \? null : session\.other_ai_tool_use \? "yes" : "no",/);
  const entry = buildAnalysisReadyDictionaryEntries().find((row) =>
    row.table_name === "sessions" && row.variable_name === "other_ai_tool_use");
  assert.ok(entry, "sessions.other_ai_tool_use has a dictionary entry");
  assert.match(JSON.stringify(entry), /Did you use another AI tool while answering the questions\?/);
});

check("instructor pages, interpretation and feedback never read the answer", () => {
  const allowed = new Set([
    "src/lib/services/student-assessment/ai-use-report.ts",
    "src/lib/services/student-assessment/service.ts",
    "src/lib/services/teacher-research-data/analysis-ready-export.ts",
    "src/lib/services/teacher-research-data/dictionary.ts"
  ]);
  const readers = filesUnder("src").filter((file) => /\.(ts|tsx)$/.test(file) &&
    source(file).includes("other_ai_tool_use")).map((file) => file.split(path.sep).join("/"));
  assert.deepEqual(readers.filter((file) => !allowed.has(file)), []);
  for (const file of filesUnder("src/components/teacher-review").concat(filesUnder("src/components/teacher-dashboard"))) {
    assert.doesNotMatch(source(file), /another AI tool/i, file);
  }
});

console.log(`\n${passed} AI-use question checks passed; no database or provider calls.`);
