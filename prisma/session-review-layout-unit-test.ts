/**
 * Releases 35–36 (1 Nov 2026): the instructor's session review shows what an instructor needs and
 * does not repeat it across tabs. Checked from the component source, without a database:
 * - Overview: the attempt summary first; no facts already in the header or other tabs; background
 *   processing folded away unless something needs attention; the topic table only for several topics.
 * - Formative conversation: for interpretation v8 the mini-test interpretation and the conversation,
 *   without the earlier profile-update trajectory (starting evidence, validated change, profile
 *   evolution), which stays only for earlier sessions.
 * - Technical records (formerly Advanced records): earlier-design planning and follow-up sections
 *   only when they apply; the operational audit behind a disclosure.
 * Run with: npx tsx prisma/session-review-layout-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/teacher-review/session-detail-client.tsx", "utf8");
const between = (from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${name}`);
}

check("Overview starts with the attempt summary and drops repeated facts", () => {
  const overview = between("export function Overview(", "function ItemResponsesSection(");
  assert.match(overview, /data-testid="teacher-overview-attempt-summary"/);
  assert.match(overview, /attemptSummary\(stored as unknown as StoredInterpretationV8\)/);
  assert.ok(overview.indexOf("teacher-overview-attempt-summary") < overview.indexOf('labelText="Assessment reference"'));
  for (const removed of ['labelText="Student user ID"', 'labelText="Assessment"', 'labelText="Current topic"',
    'labelText="Topics with questions submitted"', 'labelText="Response collection"', 'labelText="Content lock"',
    'labelText="Response packages"', "No instructor actions recorded."]) {
    assert.ok(!overview.includes(removed), `Overview still shows ${removed}`);
  }
  assert.match(overview, /<details className="group rounded-lg border border-line bg-white p-5" open=\{automationNeedsAttention\}>/);
  assert.match(overview, /\["completed", "cancelled"\]\.includes\(job\.status\)/);
  assert.match(overview, /detail\.concept_unit_sessions\.length > 1 \? \(/);
});

check("Formative conversation shows the v8 interpretation with the conversation, not the old trajectory", () => {
  const section = between("export function FormativeConversationEvidenceSection(", "export function formativeConversationPhaseLabel(");
  assert.match(section, /const v8Units = conceptUnitSessions\.filter\(isV8Unit\)/);
  assert.match(section, /data-testid="teacher-mini-test-interpretation"/);
  assert.match(section, /<InterpretationRecord unit=\{unit\} \/>/);
  const v8Part = section.slice(section.indexOf("{v8Units.map("), section.indexOf("{legacyConversations.map("));
  for (const legacy of ["Starting evidence", "Validated change", "Profile evolution", "formative decision", "Remaining concern"]) {
    assert.ok(!v8Part.includes(legacy), `The v8 view still shows ${legacy}`);
  }
  assert.match(source, /conceptUnitSessions=\{detail\.concept_unit_sessions\}/);
});

check("No explanatory statements on the instructor's tabs (release 36)", () => {
  for (const removed of ["For the instructor only. The item-by-item interpretation", "Close a stuck or test attempt without deleting records",
    "Conversation and recorded student actions. Technical details remain", "Elapsed intervals start when a prompt was recorded",
    "Background processing records are retained for audit", "Computed from this attempt&apos;s item ratings",
    "Technical records for audit and research", "The conversation supports the student; it does not change",
    "The mini-test interpretation and the conversation that followed"]) {
    assert.ok(!source.includes(removed), `Still shows: ${removed}`);
  }
  const overview = between("export function Overview(", "function ItemResponsesSection(");
  for (const removed of ['labelText="Completed"', 'labelText="Needs review"']) assert.ok(!overview.includes(removed), removed);
});

check("Technical records hide earlier-design sections that do not apply", () => {
  assert.match(source, /if \(tab === "future_agent_data"\) return "Technical records";/);
  const technical = between("function FutureAgentSection(", "\n}\n");
  assert.match(technical, /const profilingUnits = detail\.concept_unit_sessions\.filter\(\(unit\) => !isV8Unit\(unit\) \|\| unit\.can_run_profiling\)/);
  assert.match(technical, /\{showPlanning \? \(/);
  assert.match(technical, /\{showFollowup \? \(/);
  assert.match(technical, /<summary className="cursor-pointer text-base font-semibold text-ink">Operational agent audit<\/summary>/);
  assert.ok(!technical.includes("Agent call rows"));
});

check("Readable transcript shows items as the student saw them, tables and formulas included (release 39)", () => {
  const readable = between("function ReadableTranscriptSection(", "function TranscriptSection(");
  assert.match(readable, /turn\.speaker === "agent" && turn\.phase_label === "Initial item administration" \? \(/);
  assert.match(readable, /<ItemContent className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink" text=\{turn\.message_text\} \/>/);
  assert.match(readable, /<SafeTutorMessageMarkdown/, "Feedback and conversation turns keep the tutor message renderer");
});

console.log(`\n${passed} session review layout checks passed; no database or provider calls.`);
