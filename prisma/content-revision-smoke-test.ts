import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { createAssessment, getAssessmentDetail } from "../src/lib/services/content/assessments";
import { createConceptUnit } from "../src/lib/services/content/concept-units";
import { createItem, updateItem } from "../src/lib/services/content/items";
import { publishAssessment } from "../src/lib/services/content/publishing";
import { createEditableAssessmentRevision } from "../src/lib/services/content/assessment-revisions";
import { assertAssessmentCanStartSession } from "../src/lib/services/content/governance";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { generatePublicId } from "../src/lib/services/ids";
import {
  getStudentSessionState,
  listAvailableAssessments
} from "../src/lib/services/student-assessment/service";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function itemInput(order: number) {
  return {
    item_stem: `Revision smoke item ${order}`,
    options: [
      { label: "A", text: "Original key" },
      { label: "B", text: "Distractor" },
      { label: "C", text: "Alternative distractor" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "A plausible but unsupported choice.",
      C: "A second plausible but unsupported choice."
    },
    expected_reasoning_patterns: ["Uses the relevant course concept."],
    possible_misconception_indicators: ["Treats a distractor as definitive."],
    administration_rules: { no_feedback_during_initial_administration: true },
    included_in_published_set: true,
    item_order: order,
    media_assets:
      order === 1
        ? [
            {
              placement: "item_stem" as const,
              media_type: "image" as const,
              source_type: "external_url" as const,
              external_url: "https://example.com/revision-smoke.png",
              alt_text_or_description: "Synthetic revision smoke image.",
              order_index: 0,
              active: true
            }
          ]
        : []
  };
}

async function main() {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacherUserId = `revision_teacher_${suffix}`;
  const studentUserId = `revision_student_${suffix}`;
  const futureStudentUserId = `revision_future_student_${suffix}`;
  const createdAssessmentPublicIds: string[] = [];

  const teacher = await prisma.user.create({
    data: {
      user_id: teacherUserId,
      user_id_normalized: normalizeUserId(teacherUserId),
      role: "teacher_researcher"
    }
  });
  const student = await prisma.user.create({
    data: {
      user_id: studentUserId,
      user_id_normalized: normalizeUserId(studentUserId),
      role: "student",
      created_by_teacher_user_id: teacher.id
    }
  });
  const futureStudent = await prisma.user.create({
    data: {
      user_id: futureStudentUserId,
      user_id_normalized: normalizeUserId(futureStudentUserId),
      role: "student",
      created_by_teacher_user_id: teacher.id
    }
  });

  try {
    const sourceAssessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Correction workflow ${suffix}`,
        diagnostic_focus: "Test version-safe item correction.",
        folder_label: "Revision smoke"
      }
    });
    createdAssessmentPublicIds.push(sourceAssessment.assessment_public_id);

    const sourceConcept = await createConceptUnit({
      teacher_user_db_id: teacher.id,
      assessment_public_id: sourceAssessment.assessment_public_id,
      data: {
        title: "Correction topic",
        learning_objective: "Identify the supported answer.",
        related_concept_description: "A temporary topic for revision verification."
      }
    });
    const sourceItems: Awaited<ReturnType<typeof createItem>>[] = [];
    for (const order of [1, 2, 3]) {
      sourceItems.push(
        await createItem({
          teacher_user_db_id: teacher.id,
          concept_unit_public_id: sourceConcept.concept_unit_public_id,
          data: itemInput(order)
        })
      );
    }

    await publishAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: sourceAssessment.assessment_public_id
    });

    const sourceRows = await prisma.assessment.findUniqueOrThrow({
      where: { assessment_public_id: sourceAssessment.assessment_public_id },
      include: {
        concept_units: {
          include: { items: true },
          orderBy: { order_index: "asc" }
        }
      }
    });
    const sourceConceptRow = sourceRows.concept_units[0];
    const sourceItemRow = sourceConceptRow.items.find(
      (item) => item.item_public_id === sourceItems[0].item_public_id
    );
    assert(sourceItemRow, "Source item should exist before creating a student attempt.");

    const session = await prisma.assessmentSession.create({
      data: {
        session_public_id: generatePublicId("session"),
        user_db_id: student.id,
        assessment_db_id: sourceRows.id,
        status: "active",
        current_phase: "initial_item_administration",
        current_concept_unit_db_id: sourceConceptRow.id,
        started_at: new Date(),
        last_activity_at: new Date()
      }
    });
    const conceptSession = await prisma.conceptUnitSession.create({
      data: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: sourceConceptRow.id,
        status: "initial_in_progress",
        initial_started_at: new Date()
      }
    });
    const historicalResponse = await prisma.itemResponse.create({
      data: {
        concept_unit_session_db_id: conceptSession.id,
        item_db_id: sourceItemRow.id,
        selected_option: "A",
        correct_option_snapshot: "A",
        correctness: "correct",
        item_submitted_at: new Date(),
        item_version_snapshot: sourceItemRow.version,
        item_snapshot: {
          item_public_id: sourceItemRow.item_public_id,
          item_order: sourceItemRow.item_order,
          item_stem: sourceItemRow.item_stem,
          options: sourceItemRow.options,
          correct_option: sourceItemRow.correct_option,
          version: sourceItemRow.version
        }
      }
    });

    const revisionRequests = await Promise.all([
      createEditableAssessmentRevision({
        teacher_user_db_id: teacher.id,
        assessment_public_id: sourceAssessment.assessment_public_id,
        data: {
          revision_reason: "The first item has an incorrect answer key.",
          source_item_public_id: sourceItemRow.item_public_id
        }
      }),
      createEditableAssessmentRevision({
        teacher_user_db_id: teacher.id,
        assessment_public_id: sourceAssessment.assessment_public_id,
        data: {
          revision_reason: "The first item has an incorrect answer key.",
          source_item_public_id: sourceItemRow.item_public_id
        }
      })
    ]);
    const revision = revisionRequests.find((request) => request.created_new_revision);
    assert(revision, "One concurrent request should create the correction draft.");
    assert(
      revisionRequests.every(
        (request) =>
          request.revision_assessment_public_id === revision.revision_assessment_public_id
      ),
      "Concurrent correction requests should converge on one correction draft."
    );
    createdAssessmentPublicIds.push(revision.revision_assessment_public_id);
    assert(revision.revision_number === 2, "The correction should be revision 2.");
    assert(revision.source_content_hash?.length === 64, "The source content hash should be retained.");
    assert(revision.target_item_public_id, "The requested source item should map to a corrected item.");

    const duplicateRequest = await createEditableAssessmentRevision({
      teacher_user_db_id: teacher.id,
      assessment_public_id: sourceAssessment.assessment_public_id,
      data: {
        revision_reason: "The first item has an incorrect answer key.",
        source_item_public_id: sourceItemRow.item_public_id
      }
    });
    assert(!duplicateRequest.created_new_revision, "Repeated correction requests should be idempotent.");
    assert(
      duplicateRequest.revision_assessment_public_id === revision.revision_assessment_public_id,
      "Repeated requests should return the same correction draft."
    );
    assert(
      duplicateRequest.target_item_public_id === revision.target_item_public_id,
      "Repeated requests should return the same corrected item."
    );

    const revisionDetail = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: revision.revision_assessment_public_id
    });
    assert(revisionDetail.status === "draft", "A correction must begin as an editable draft.");
    assert(revisionDetail.content_state === "draft_editable", "The correction should be editable.");
    assert(
      revisionDetail.supersedes_assessment_public_id === sourceAssessment.assessment_public_id,
      "The correction should identify its predecessor."
    );
    const revisedItem = revisionDetail.mini_test_items.find(
      (item) => item.item_public_id === revision.target_item_public_id
    );
    assert(revisedItem, "The mapped corrected item should exist.");
    assert(
      revisedItem.supersedes_item_public_id === sourceItemRow.item_public_id,
      "The corrected item should retain item-level lineage."
    );
    assert(revisedItem.item_stem === sourceItemRow.item_stem, "The copied item should initially match its source.");
    const [sourceMedia, revisedMedia] = await Promise.all([
      prisma.itemMediaAsset.findFirstOrThrow({ where: { item_db_id: sourceItemRow.id } }),
      prisma.itemMediaAsset.findFirstOrThrow({
        where: { item: { item_public_id: revisedItem.item_public_id } }
      })
    ]);
    assert(
      revisedMedia.media_public_id !== sourceMedia.media_public_id &&
        revisedMedia.supersedes_media_public_id === sourceMedia.media_public_id,
      "Copied media should receive a new public ID with explicit source-media lineage."
    );

    await updateItem({
      teacher_user_db_id: teacher.id,
      item_public_id: revisedItem.item_public_id,
      data: {
        item_stem: "Corrected revision smoke item 1",
        correct_option: "B"
      }
    });

    const unchangedSourceItem = await prisma.item.findUniqueOrThrow({
      where: { id: sourceItemRow.id }
    });
    assert(
      unchangedSourceItem.item_stem === sourceItemRow.item_stem &&
        unchangedSourceItem.correct_option === "A",
      "Editing the correction must not mutate administered source content."
    );
    const unchangedResponse = await prisma.itemResponse.findUniqueOrThrow({
      where: { id: historicalResponse.id }
    });
    const responseSnapshot = unchangedResponse.item_snapshot as Record<string, unknown>;
    assert(
      unchangedResponse.correct_option_snapshot === "A" &&
        responseSnapshot.item_stem === sourceItemRow.item_stem,
      "Historical answer-key and item snapshots must remain unchanged."
    );

    await prisma.item.update({
      where: { id: sourceItemRow.id },
      data: { item_stem: "Unexpected source mutation" }
    });
    try {
      await publishAssessment({
        teacher_user_db_id: teacher.id,
        assessment_public_id: revision.revision_assessment_public_id
      });
      throw new Error("A correction unexpectedly published after its source content changed.");
    } catch (error) {
      assert(
        error instanceof ContentServiceError &&
          error.code === "conflict" &&
          error.details?.reason === "revision_source_content_hash_mismatch",
        "Publishing must fail closed if the administered source content changes."
      );
    }
    const correctionAfterRejectedPublish = await prisma.assessment.findUniqueOrThrow({
      where: { assessment_public_id: revision.revision_assessment_public_id }
    });
    assert(
      correctionAfterRejectedPublish.status === "draft",
      "A rejected publish must not partially publish the correction."
    );
    await prisma.item.update({
      where: { id: sourceItemRow.id },
      data: { item_stem: sourceItemRow.item_stem }
    });

    const publishResult = await publishAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: revision.revision_assessment_public_id
    });
    assert(
      publishResult.superseded_assessment_public_id === sourceAssessment.assessment_public_id,
      "Publishing should report the archived predecessor."
    );

    const [sourceAfterPublish, revisionAfterPublish, sessionAfterPublish] = await Promise.all([
      prisma.assessment.findUniqueOrThrow({
        where: { assessment_public_id: sourceAssessment.assessment_public_id }
      }),
      prisma.assessment.findUniqueOrThrow({
        where: { assessment_public_id: revision.revision_assessment_public_id }
      }),
      prisma.assessmentSession.findUniqueOrThrow({ where: { id: session.id } })
    ]);
    assert(sourceAfterPublish.status === "archived", "The prior version should be archived for new starts.");
    assert(revisionAfterPublish.status === "published", "The corrected version should become published.");
    assert(
      sessionAfterPublish.assessment_db_id === sourceRows.id,
      "The existing attempt must remain bound to the prior assessment version."
    );

    const [existingStudentAssessments, futureStudentAssessments, existingSessionState] =
      await Promise.all([
        listAvailableAssessments({ student_user_db_id: student.id }),
        listAvailableAssessments({ student_user_db_id: futureStudent.id }),
        getStudentSessionState({
          student_user_db_id: student.id,
          session_public_id: session.session_public_id,
          execution_mode: "deterministic_e1"
        })
      ]);
    const existingStudentSource = existingStudentAssessments.assessments.find(
      (candidate) => candidate.assessment_public_id === sourceAssessment.assessment_public_id
    );
    const futureStudentSource = futureStudentAssessments.assessments.find(
      (candidate) => candidate.assessment_public_id === sourceAssessment.assessment_public_id
    );
    const futureStudentRevision = futureStudentAssessments.assessments.find(
      (candidate) =>
        candidate.assessment_public_id === revision.revision_assessment_public_id
    );
    assert(
      existingStudentSource?.can_resume === true,
      "The archived source must remain visible and resumable for its existing student."
    );
    assert(
      !futureStudentSource,
      "A student without source history must not see the archived source version."
    );
    assert(
      futureStudentRevision?.can_start === true,
      "A future student should be offered the corrected published version."
    );
    assert(
      existingSessionState.assessment.assessment_public_id ===
        sourceAssessment.assessment_public_id,
      "Reading an existing session after correction publication must use the source assessment."
    );

    const sourceDetail = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: sourceAssessment.assessment_public_id
    });
    assert(
      sourceDetail.superseded_by_assessment_public_id === revision.revision_assessment_public_id,
      "The prior version should link to its corrected successor."
    );

    try {
      await assertAssessmentCanStartSession({
        assessment_public_id: sourceAssessment.assessment_public_id
      });
      throw new Error("The archived source unexpectedly accepted a future start.");
    } catch (error) {
      assert(
        error instanceof ContentServiceError && error.code === "assessment_archived",
        "The source must reject future starts after the correction is published."
      );
    }
    await assertAssessmentCanStartSession({
      assessment_public_id: revision.revision_assessment_public_id
    });

    console.log(
      JSON.stringify({
        status: "passed",
        source_version_immutable: true,
        historical_response_snapshot_immutable: true,
        corrected_version_editable: true,
        concurrent_revision_requests_idempotent: true,
        copied_media_lineage_preserved: true,
        source_hash_mismatch_fails_closed: true,
        correction_publish_archives_source: true,
        existing_attempt_binding_preserved: true,
        existing_attempt_resume_preserved: true,
        archived_source_hidden_from_future_students: true,
        future_start_uses_corrected_assessment: true,
        provider_calls: 0,
        model_auth_requests: 0
      })
    );
  } finally {
    const assessments = await prisma.assessment.findMany({
      where: { assessment_public_id: { in: createdAssessmentPublicIds } },
      select: { id: true }
    });
    const assessmentIds = assessments.map((assessment) => assessment.id);
    const sessions = await prisma.assessmentSession.findMany({
      where: { assessment_db_id: { in: assessmentIds } },
      select: { id: true }
    });
    const sessionIds = sessions.map((session) => session.id);
    const conceptSessions = await prisma.conceptUnitSession.findMany({
      where: { assessment_session_db_id: { in: sessionIds } },
      select: { id: true }
    });
    const conceptSessionIds = conceptSessions.map((conceptSession) => conceptSession.id);
    await prisma.itemResponse.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptSessionIds } }
    });
    await prisma.conceptUnitSession.deleteMany({
      where: { id: { in: conceptSessionIds } }
    });
    await prisma.assessmentSession.deleteMany({
      where: { id: { in: sessionIds } }
    });
    const concepts = await prisma.conceptUnit.findMany({
      where: { assessment_db_id: { in: assessmentIds } },
      select: { id: true }
    });
    const conceptIds = concepts.map((concept) => concept.id);
    const items = await prisma.item.findMany({
      where: { concept_unit_db_id: { in: conceptIds } },
      select: { id: true }
    });
    await prisma.itemMediaAsset.deleteMany({
      where: { item_db_id: { in: items.map((item) => item.id) } }
    });
    await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: conceptIds } } });
    await prisma.conceptUnit.deleteMany({ where: { id: { in: conceptIds } } });
    await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
    await prisma.user.deleteMany({
      where: { id: { in: [teacher.id, student.id, futureStudent.id] } }
    });
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
