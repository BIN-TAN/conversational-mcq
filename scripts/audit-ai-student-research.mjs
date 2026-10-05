import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

// Read-only, repeatable audit of synthetic journey exports. No database or AI calls.
const reportPath = path.resolve(process.argv[2] ?? "");
const report = JSON.parse(readFileSync(reportPath, "utf8"));
assert.equal(report.synthetic_only, true);
assert(report.finished_at, "Wait for all scenarios to finish before auditing.");
const root = path.dirname(reportPath);
const results = [];
for (const scenario of report.results) {
  if (scenario.outcome !== "mechanical_checks_passed_manual_pedagogical_review_required") {
    results.push({ case: scenario.case_id, status: "not_audited_incomplete", outcome: scenario.outcome });
    continue;
  }
  const dir = path.join(root, scenario.case_id);
  const table = file => parse(readFileSync(path.join(dir, file), "utf8"), { columns: true });
  const manifest = JSON.parse(readFileSync(path.join(dir, "research_manifest.json"), "utf8"));
  for (const entry of manifest.entries) {
    assert.equal(path.basename(entry.path), entry.path);
    const bytes = readFileSync(path.join(dir, entry.path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    if (entry.path.endsWith(".csv")) for (const row of table(entry.path)) {
      if (row.session_public_id) assert.equal(row.session_public_id, scenario.session_public_id, entry.path);
    }
  }
  const turns = table("formative_conversation_turns.csv");
  const transcriptActor = actor => actor === "agent" ? "tutor" : actor;
  assert.deepEqual(turns.map(t => [transcriptActor(t.actor_type), t.message_text]),
    scenario.transcript.map(t => [t.actor, t.message_text]));
  const bySequence = new Map(turns.map(t => [Number(t.turn_sequence_index), t]));
  const items = table("item_responses.csv");
  assert.equal(items.length, 3);
  const itemIds = new Set(items.map(i => i.item_public_id));
  for (const row of table("profile_item_evidence.csv")) assert(itemIds.has(row.item_public_id));
  let contextualReferences = 0;
  const transitions = table("formative_conversation_profile_transitions.csv");
  for (const transition of transitions) {
    assert.equal(transition.updated_confidence_alignment_scope, "carried_forward_not_reassessed");
    const snapshot = JSON.parse(transition.canonical_profile_snapshot);
    const catalog = new Map(snapshot.canonical_evidence_catalog.evidence.map(e => [e.evidence_id, e]));
    for (const id of snapshot.canonical_evidence_ids) {
      const evidence = catalog.get(id);
      assert.equal(evidence?.source_role, "student");
      assert.equal(evidence?.eligibility, "student_understanding");
      assert(evidence.source_sequence_index > snapshot.prior_profile_evidence_cutoff_sequence_index);
      assert.equal(bySequence.get(evidence.source_sequence_index)?.actor_type, "student");
    }
    for (const observation of snapshot.evidence_observations) for (const id of observation.evidence_ids) {
      const evidence = catalog.get(id);
      assert.equal(evidence?.source_role, "student");
      assert.equal(evidence?.evidence_scope_id, snapshot.canonical_evidence_catalog.evidence_scope_id);
      if (!snapshot.canonical_evidence_ids.includes(id)) contextualReferences += 1;
    }
    const sequences = transition.supporting_turn_sequence_indexes.split("|");
    const actors = transition.supporting_turn_actors.split("|");
    assert.equal(sequences.length, actors.length);
    sequences.forEach((seq, index) => assert.equal(transcriptActor(bySequence.get(Number(seq))?.actor_type), actors[index]));
  }
  results.push({ case: scenario.case_id, items: items.length, turns: turns.length,
    transitions: transitions.length, contextual_references_outside_transition: contextualReferences,
    manifest_entries: manifest.entries.length, status: "passed" });
}
console.log(JSON.stringify({ synthetic_only: true, read_only: true,
  status: results.every(result => result.status === "passed") ? "passed" : "partial", results }, null, 2));
