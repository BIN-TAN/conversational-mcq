import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createResponseCollectionFixture } from "./response-collection-smoke-fixture";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { buildInitialStudentProfilingInput } from "../src/lib/agents/student-profiling/input-builder";
import { prisma } from "../src/lib/db";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert(url.pathname.startsWith("/conversational_mcq_classroom_audit_ux"));
  assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
  const db = new PrismaClient();
  try {
    const fixture = await createResponseCollectionFixture({ prisma: db, prefix: `stage_boundary_${Date.now()}`, responseCollectionMode: "deterministic" });
    const marker = "synthetic_high_frequency_stage_marker";
    await db.processEvent.create({ data: {
      assessment_session_db_id: fixture.session.id, concept_unit_session_db_id: fixture.conceptUnitSession.id,
      item_db_id: fixture.items[0].id, event_type: "response_stage_observation", event_source: "frontend", event_category: "response_observation",
      payload: { research_only: marker }, occurred_at: new Date()
    } });
    const responsePackage = await createResponsePackage({ concept_unit_session_db_id: fixture.conceptUnitSession.id });
    const providerInput = await buildInitialStudentProfilingInput(fixture.conceptUnitSession.id, responsePackage.id);
    assert(!JSON.stringify(responsePackage.payload).includes(marker));
    assert(!JSON.stringify(providerInput).includes(marker));
    assert.equal(await db.processEvent.count({ where: { assessment_session_db_id: fixture.session.id, event_type: "response_stage_observation" } }), 1);
    assert.equal(await db.agentCall.count({ where: { assessment_session_db_id: fixture.session.id } }), 0);
    console.log("PASS detailed stage evidence remains in research storage without duplicated provider workload; provider calls: 0");
  } finally { await db.$disconnect(); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
