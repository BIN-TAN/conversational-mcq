import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import type { Item } from "@prisma/client";
import { ProcessEventTypeSchema } from "../src/lib/domain/enums";

const prisma = new PrismaClient();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function expectUniqueConstraint(operation: () => Promise<unknown>, label: string) {
  try {
    await operation();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return;
    }

    throw error;
  }

  throw new Error(`Expected unique constraint violation for ${label}`);
}

async function main() {
  const prefix = `smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await prisma.user.findUnique({ where: { user_id: "teacher_demo" } });
  const student = await prisma.user.findUnique({ where: { user_id: "student_demo" } });

  assert(teacher, "Missing teacher_demo. Run npm run prisma:seed first.");
  assert(student, "Missing student_demo. Run npm run prisma:seed first.");

  const created = {
    assessmentId: "",
    conceptUnitId: "",
    itemIds: [] as string[],
    assessmentSessionId: "",
    conceptUnitSessionId: "",
    itemResponseId: "",
    conversationTurnId: "",
    processEventId: "",
    responsePackageId: ""
  };

  try {
    const assessment = await prisma.assessment.create({
      data: {
        assessment_public_id: `${prefix}_assessment`,
        title: "Smoke Test Assessment",
        description: "Temporary Phase 2A smoke-test assessment.",
        status: "draft",
        created_by_user_db_id: teacher.id
      }
    });
    created.assessmentId = assessment.id;

    const conceptUnit = await prisma.conceptUnit.create({
      data: {
        concept_unit_public_id: `${prefix}_concept_unit`,
        assessment_db_id: assessment.id,
        title: "Smoke Test Concept Unit",
        learning_objective: "Verify normalized Phase 2A database relations.",
        related_concept_description: "Temporary concept used only for database smoke testing.",
        administration_rules: { initial_administration: "no_feedback" },
        order_index: 1,
        status: "draft",
        version: 1
      }
    });
    created.conceptUnitId = conceptUnit.id;

    const items: Item[] = [];
    for (const itemOrder of [1, 2, 3]) {
      const item = await prisma.item.create({
        data: {
          item_public_id: `${prefix}_item_${itemOrder}`,
          concept_unit_db_id: conceptUnit.id,
          item_order: itemOrder,
          item_stem: `Smoke test item ${itemOrder}`,
          options: [
            { key: "A", text: "Option A" },
            { key: "B", text: "Option B" },
            { key: "C", text: "Option C" }
          ],
          correct_option: "A",
          distractor_rationales: {
            B: "Temporary distractor rationale",
            C: "Temporary distractor rationale"
          },
          expected_reasoning_patterns: ["Identifies the smoke-test answer."],
          possible_misconception_indicators: ["Chooses a distractor."],
          administration_rules: { confidence_required: true },
          status: "draft",
          version: 1
        }
      });
      items.push(item);
      created.itemIds.push(item.id);
    }

    await expectUniqueConstraint(
      () =>
        prisma.item.create({
          data: {
            item_public_id: `${prefix}_duplicate_item_order`,
            concept_unit_db_id: conceptUnit.id,
            item_order: 1,
            item_stem: "Duplicate order item",
            options: [{ key: "A", text: "Option A" }],
            correct_option: "A",
            status: "draft",
            version: 1
          }
        }),
      "duplicate item order within a concept unit"
    );

    const assessmentSession = await prisma.assessmentSession.create({
      data: {
        session_public_id: `${prefix}_session`,
        user_db_id: student.id,
        assessment_db_id: assessment.id,
        status: "active",
        current_phase: "session_started",
        current_concept_unit_db_id: conceptUnit.id,
        needs_review: false,
        started_at: new Date(),
        last_activity_at: new Date()
      }
    });
    created.assessmentSessionId = assessmentSession.id;

    const conceptUnitSession = await prisma.conceptUnitSession.create({
      data: {
        assessment_session_db_id: assessmentSession.id,
        concept_unit_db_id: conceptUnit.id,
        status: "initial_in_progress",
        initial_started_at: new Date(),
        followup_status: "not_started"
      }
    });
    created.conceptUnitSessionId = conceptUnitSession.id;

    const itemResponse = await prisma.itemResponse.create({
      data: {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[0].id,
        selected_option: "A",
        correct_option_snapshot: items[0].correct_option,
        correctness: "correct",
        reasoning_text: "Temporary reasoning for smoke testing.",
        confidence_rating: "medium",
        item_response_time_ms: 1200,
        item_started_at: new Date(),
        item_submitted_at: new Date(),
        skipped_reasoning: false,
        skipped_confidence: false,
        revision_count: 0,
        missing_evidence_repair_offered: false,
        item_version_snapshot: items[0].version,
        item_snapshot: {
          item_public_id: items[0].item_public_id,
          item_stem: items[0].item_stem,
          options: items[0].options,
          correct_option: items[0].correct_option,
          version: items[0].version
        },
        client_submission_id: `${prefix}_submission_1`
      }
    });
    created.itemResponseId = itemResponse.id;

    await expectUniqueConstraint(
      () =>
        prisma.itemResponse.create({
          data: {
            concept_unit_session_db_id: conceptUnitSession.id,
            item_db_id: items[0].id,
            correct_option_snapshot: items[0].correct_option,
            correctness: "correct",
            item_version_snapshot: items[0].version,
            item_snapshot: { item_public_id: items[0].item_public_id },
            client_submission_id: `${prefix}_submission_duplicate`
          }
        }),
      "duplicate item response within a concept-unit session"
    );

    const conversationTurn = await prisma.conversationTurn.create({
      data: {
        assessment_session_db_id: assessmentSession.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[0].id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text: "I choose A because this is a smoke test.",
        structured_payload: { selected_option: "A", confidence_rating: "medium" }
      }
    });
    created.conversationTurnId = conversationTurn.id;

    const eventType = ProcessEventTypeSchema.parse("item_submitted");
    const processEvent = await prisma.processEvent.create({
      data: {
        assessment_session_db_id: assessmentSession.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[0].id,
        event_type: eventType,
        event_category: "item",
        event_source: "backend",
        payload: { client_submission_id: `${prefix}_submission_1` },
        occurred_at: new Date()
      }
    });
    created.processEventId = processEvent.id;

    const responsePackage = await prisma.responsePackage.create({
      data: {
        concept_unit_session_db_id: conceptUnitSession.id,
        package_type: "initial_response_package",
        payload: {
          item_response_count: 1,
          includes_process_context: true,
          source: "phase2a_smoke_test"
        }
      }
    });
    created.responsePackageId = responsePackage.id;

    const loaded = await prisma.conceptUnitSession.findUnique({
      where: { id: conceptUnitSession.id },
      include: {
        assessment_session: {
          include: {
            user: true,
            assessment: true
          }
        },
        concept_unit: {
          include: { items: true }
        },
        item_responses: true,
        conversation_turns: true,
        process_events: true,
        response_packages: true
      }
    });

    assert(loaded, "Failed to load concept-unit session relations.");
    assert(loaded.assessment_session.user.user_id === "student_demo", "Student relation failed.");
    assert(loaded.assessment_session.assessment.id === assessment.id, "Assessment relation failed.");
    assert(loaded.concept_unit.items.length === 3, "Expected three related items.");
    assert(loaded.item_responses.length === 1, "Expected one related item response.");
    assert(loaded.conversation_turns.length === 1, "Expected one related conversation turn.");
    assert(loaded.process_events.length === 1, "Expected one related process event.");
    assert(loaded.response_packages.length === 1, "Expected one related response package.");

    assert(uuidPattern.test(assessment.id), "Assessment internal ID is not a UUID.");
    assert(assessment.assessment_public_id !== assessment.id, "Assessment public ID reused internal UUID.");
    assert(!uuidPattern.test(assessment.assessment_public_id), "Assessment public ID should not be a UUID.");
    assert(conceptUnit.concept_unit_public_id !== conceptUnit.id, "Concept unit public ID reused internal UUID.");
    assert(items[0].item_public_id !== items[0].id, "Item public ID reused internal UUID.");
    assert(assessmentSession.session_public_id !== assessmentSession.id, "Session public ID reused internal UUID.");

    const loadedOptions = loaded.concept_unit.items[0]?.options;
    assert(Array.isArray(loadedOptions), "Item options JSON was not read as an array.");
    assert(
      loaded.response_packages[0]?.payload &&
        typeof loaded.response_packages[0].payload === "object" &&
        "item_response_count" in loaded.response_packages[0].payload,
      "Response package JSON payload did not round-trip."
    );
    assert(
      itemResponse.item_snapshot &&
        typeof itemResponse.item_snapshot === "object" &&
        "item_public_id" in itemResponse.item_snapshot,
      "Item response snapshot JSON did not round-trip."
    );

    console.log("Phase 2A database smoke test passed.");
  } finally {
    if (created.responsePackageId) {
      await prisma.responsePackage.delete({ where: { id: created.responsePackageId } }).catch(() => undefined);
    }
    if (created.processEventId) {
      await prisma.processEvent.delete({ where: { id: created.processEventId } }).catch(() => undefined);
    }
    if (created.conversationTurnId) {
      await prisma.conversationTurn.delete({ where: { id: created.conversationTurnId } }).catch(() => undefined);
    }
    if (created.itemResponseId) {
      await prisma.itemResponse.delete({ where: { id: created.itemResponseId } }).catch(() => undefined);
    }
    if (created.conceptUnitSessionId) {
      await prisma.conceptUnitSession
        .delete({ where: { id: created.conceptUnitSessionId } })
        .catch(() => undefined);
    }
    if (created.assessmentSessionId) {
      await prisma.assessmentSession
        .delete({ where: { id: created.assessmentSessionId } })
        .catch(() => undefined);
    }
    if (created.itemIds.length > 0) {
      await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    }
    if (created.conceptUnitId) {
      await prisma.conceptUnit.delete({ where: { id: created.conceptUnitId } }).catch(() => undefined);
    }
    if (created.assessmentId) {
      await prisma.assessment.delete({ where: { id: created.assessmentId } }).catch(() => undefined);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
