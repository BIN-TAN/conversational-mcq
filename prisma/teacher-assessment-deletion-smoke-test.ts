import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createAssessment, listAssessments, restoreAssessment } from "../src/lib/services/content/assessments";
import { createConceptUnit } from "../src/lib/services/content/concept-units";
import { createItem } from "../src/lib/services/content/items";
import {
  ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION,
  ASSESSMENT_UNUSED_DELETE_CONFIRMATION,
  deleteAssessmentAndAssociatedData,
  previewAssessmentDeletion
} from "../src/lib/services/content/assessment-deletion";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertContentError(
  action: () => Promise<unknown>,
  code: string,
  message: string
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ContentServiceError, `${message}: expected ContentServiceError.`);
    assert(error.code === code, `${message}: expected ${code}, received ${error.code}.`);
    return;
  }

  throw new Error(`${message}: expected ${code} error.`);
}

async function ensureTeacher(userId: string) {
  const passwordHash = await hashSecret(`${userId}_password`);

  return prisma.user.upsert({
    where: { user_id: userId },
    update: {
      role: "teacher_researcher",
      password_hash: passwordHash,
      access_code_hash: null,
      account_status: "active"
    },
    create: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      display_name: userId,
      role: "teacher_researcher",
      password_hash: passwordHash
    }
  });
}

async function ensureStudent(userId: string) {
  const passwordHash = await hashSecret(`${userId}_password`);

  return prisma.user.upsert({
    where: { user_id: userId },
    update: {
      role: "student",
      password_hash: passwordHash,
      access_code_hash: null,
      account_status: "active"
    },
    create: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      display_name: userId,
      role: "student",
      password_hash: passwordHash
    }
  });
}

function itemInput(order: number) {
  return {
    item_stem: `Assessment deletion smoke item ${order}`,
    options: [
      { label: "A", text: "Correct option" },
      { label: "B", text: "Plausible misconception" },
      { label: "C", text: "Surface feature" },
      { label: "D", text: "Parameter confusion" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "B is a plausible diagnostic distractor.",
      C: "C is a plausible diagnostic distractor.",
      D: "D is a plausible diagnostic distractor."
    },
    expected_reasoning_patterns: ["Student distinguishes the target construct."],
    possible_misconception_indicators: ["Misconception evidence remains teacher-only."],
    administration_rules: {
      no_feedback_during_initial_administration: true
    },
    included_in_published_set: true,
    item_order: order,
    media_assets: order === 1
      ? [
          {
            placement: "item_stem",
            media_type: "image",
            source_type: "external_url",
            external_url: "https://example.com/deletion-smoke-image.png",
            title: "Deletion smoke media",
            alt_text_or_description: "Safe deletion smoke media description.",
            caption: "Synthetic media metadata for deletion smoke.",
            order_index: 0,
            active: true
          }
        ]
      : []
  };
}

async function createAssessmentWithItems(input: {
  teacherUserDbId: string;
  title: string;
  folderLabel?: string;
}) {
  const assessment = await createAssessment({
    teacher_user_db_id: input.teacherUserDbId,
    data: {
      title: input.title,
      diagnostic_focus: "Assessment deletion smoke diagnostic focus.",
      folder_label: input.folderLabel ?? "Deletion smoke"
    }
  });
  const conceptUnit = await createConceptUnit({
    teacher_user_db_id: input.teacherUserDbId,
    assessment_public_id: assessment.assessment_public_id,
    data: {
      title: `${input.title} topic`,
      learning_objective: "Verify permanent deletion graph.",
      related_concept_description: "Synthetic deletion smoke topic.",
      administration_rules: { initial_administration: "no_feedback" }
    }
  });
  const items = [];

  for (const order of [1, 2, 3]) {
    items.push(
      await createItem({
        teacher_user_db_id: input.teacherUserDbId,
        concept_unit_public_id: conceptUnit.concept_unit_public_id,
        data: itemInput(order)
      })
    );
  }

  return { assessment, conceptUnit, items };
}

async function addSyntheticSessionGraph(input: {
  assessmentPublicId: string;
  conceptUnitPublicId: string;
  itemPublicId: string;
  studentDbId: string;
}) {
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { assessment_public_id: input.assessmentPublicId }
  });
  const conceptUnit = await prisma.conceptUnit.findUniqueOrThrow({
    where: { concept_unit_public_id: input.conceptUnitPublicId }
  });
  const item = await prisma.item.findUniqueOrThrow({
    where: { item_public_id: input.itemPublicId }
  });
  await prisma.assessment.update({
    where: { id: assessment.id },
    data: { status: "published" }
  });
  await prisma.conceptUnit.update({
    where: { id: conceptUnit.id },
    data: { status: "published" }
  });
  await prisma.item.updateMany({
    where: { concept_unit_db_id: conceptUnit.id },
    data: { status: "published" }
  });

  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: `sess_del_${randomUUID().slice(0, 12)}`,
      user_db_id: input.studentDbId,
      assessment_db_id: assessment.id,
      status: "active",
      current_phase: "initial_item_administration",
      workflow_mode_snapshot: "automatic",
      response_collection_mode_snapshot: "llm_assisted",
      current_concept_unit_db_id: conceptUnit.id,
      started_at: new Date(),
      last_activity_at: new Date()
    }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: "initial_completed",
      initial_started_at: new Date(),
      initial_completed_at: new Date()
    }
  });
  await prisma.itemResponse.create({
    data: {
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      selected_option: "B",
      correct_option_snapshot: "A",
      correctness: "not_scored",
      reasoning_text: "Synthetic reasoning text for deletion smoke.",
      confidence_rating: "medium",
      item_version_snapshot: item.version,
      item_snapshot: {
        item_public_id: item.item_public_id,
        item_order: item.item_order
      },
      client_submission_id: `client_${randomUUID()}`
    }
  });
  await prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      phase: "initial_item_administration",
      actor_type: "student",
      message_text: "Synthetic student-visible message."
    }
  });
  await prisma.processEvent.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      event_type: "assessment_deletion_smoke_event",
      event_category: "smoke",
      event_source: "backend",
      payload: { safe: true },
      occurred_at: new Date()
    }
  });
  await prisma.responsePackage.create({
    data: {
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: "initial_three_item_package",
      payload: { response_count: 1 }
    }
  });
  const agentCall = await prisma.agentCall.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      agent_name: "formative_value_and_planning_agent",
      agent_version: "assessment-deletion-smoke",
      model_name: "mock",
      provider: "mock",
      prompt_version: "smoke",
      schema_version: "smoke",
      input_payload: { redacted: true },
      raw_output: { redacted: true },
      output_payload: { redacted: true },
      output_validated: true,
      call_status: "succeeded",
      started_at: new Date(),
      completed_at: new Date()
    }
  });
  const activityAttempt = await prisma.activityRuntimeAttempt.create({
    data: {
      activity_attempt_public_id: `act_del_${randomUUID().slice(0, 12)}`,
      session_public_id: session.session_public_id,
      student_public_id: "deletion_smoke_student",
      assessment_public_id: assessment.assessment_public_id,
      concept_unit_id: conceptUnit.concept_unit_public_id,
      source_activity_packet_ref: { redacted: true },
      activity_family: "distractor_contrast",
      diagnostic_purpose: "smoke",
      generation_source: "live_llm",
      first_turn_agent_call_db_id: agentCall.id,
      status: "completed",
      limitations: []
    }
  });
  const evidence = await prisma.activityMisconceptionEvidenceRecord.create({
    data: {
      evidence_public_id: `ev_del_${randomUUID().slice(0, 12)}`,
      session_public_id: session.session_public_id,
      student_public_id: "deletion_smoke_student",
      assessment_public_id: assessment.assessment_public_id,
      concept_unit_id: conceptUnit.concept_unit_public_id,
      activity_attempt_id: activityAttempt.activity_attempt_public_id,
      source_evaluator_agent_call_db_id: agentCall.id,
      schema_version: "smoke",
      evaluation_source: "mock",
      review_only: false,
      runtime_servable_to_student: true,
      production_mode: "smoke",
      diagnostic_purpose: "smoke",
      activity_family: "distractor_contrast",
      student_response_kind: "free_text",
      evidence_elicited_types: ["misconception_status"],
      misconception_update_status: "no_change",
      evidence_quality: "limited",
      recommended_next_diagnostic_purpose: "none",
      student_safe_feedback: { message: "Synthetic safe feedback." },
      safety_flags: [],
      limitations: [],
      evidence_packet: { redacted: true },
      evidence_hash: `hash_${randomUUID()}`
    }
  });
  await prisma.postActivityDiagnosticSnapshot.create({
    data: {
      snapshot_public_id: `snap_del_${randomUUID().slice(0, 12)}`,
      evidence_record_db_id: evidence.id,
      session_public_id: session.session_public_id,
      student_public_id: "deletion_smoke_student",
      assessment_public_id: assessment.assessment_public_id,
      concept_unit_id: conceptUnit.concept_unit_public_id,
      activity_attempt_id: activityAttempt.activity_attempt_public_id,
      pre_activity_diagnostic_state: "developing",
      activity_update_status: "unchanged",
      post_activity_diagnostic_state: "developing",
      update_strength: "none",
      evidence_quality: "limited",
      next_diagnostic_purpose: "none",
      student_safe_feedback: { message: "Synthetic safe feedback." },
      limitations: [],
      snapshot_payload: { redacted: true }
    }
  });

  return {
    sessionPublicId: session.session_public_id,
    conceptUnitSessionId: conceptUnitSession.id,
    activityAttemptPublicId: activityAttempt.activity_attempt_public_id
  };
}

async function main() {
  const suffix = `phase31k_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await ensureTeacher(`teacher_${suffix}`);
  const student = await ensureStudent(`student_${suffix}`);
  const deletionAuditPublicIds: string[] = [];
  const unrelatedAssessment = await createAssessment({
    teacher_user_db_id: teacher.id,
    data: {
      title: `Unrelated ${suffix}`,
      diagnostic_focus: "Must remain after deletion.",
      folder_label: "Unrelated"
    }
  });

  try {
    const unused = await createAssessmentWithItems({
      teacherUserDbId: teacher.id,
      title: `Unused deletion ${suffix}`
    });
    const unusedMediaPublicIds = unused.items.flatMap((item) =>
      item.media_assets.map((asset) => asset.media_public_id)
    );
    const unusedPreview = await previewAssessmentDeletion({
      teacher_user_db_id: teacher.id,
      assessment_public_id: unused.assessment.assessment_public_id
    });
    assert(unusedPreview.counts.item_count === 3, "Unused preview should count items.");
    assert(unusedPreview.counts.item_media_asset_count === 1, "Unused preview should count item media assets.");
    assert(unusedPreview.deletion_modes.unused_assessment.allowed, "Unused draft should be deleteable.");
    assert(unusedPreview.counts.assessment_session_count === 0, "Unused draft should have no sessions.");
    assert(
      unusedPreview.deletion_limitations.some((limitation) => limitation.includes("Externally hosted URLs")),
      "Preview should document external media object deletion limitations."
    );

    await assertContentError(
      () =>
        deleteAssessmentAndAssociatedData({
          teacher_user_db_id: teacher.id,
          assessment_public_id: unused.assessment.assessment_public_id,
          deletion_mode: "unused_assessment",
          assessment_confirmation: unused.assessment.title,
          delete_confirmation: "DELETE NOW"
        }),
      "assessment_delete_confirmation_mismatch",
      "Wrong unused delete confirmation should be rejected"
    );

    const unusedDeletion = await deleteAssessmentAndAssociatedData({
      teacher_user_db_id: teacher.id,
      assessment_public_id: unused.assessment.assessment_public_id,
      deletion_mode: "unused_assessment",
      assessment_confirmation: unused.assessment.assessment_public_id,
      delete_confirmation: ASSESSMENT_UNUSED_DELETE_CONFIRMATION
    });
    deletionAuditPublicIds.push(unusedDeletion.deletion_event_public_id);
    assert(unusedDeletion.deleted_counts.item_count === 3, "Unused delete should report item counts.");
    assert(unusedDeletion.deleted_counts.item_media_asset_count === 1, "Unused delete should report media counts.");
    assert(
      !(await prisma.assessment.findUnique({
        where: { assessment_public_id: unused.assessment.assessment_public_id }
      })),
      "Unused assessment should be deleted."
    );
    assert(
      (await prisma.itemMediaAsset.count({ where: { media_public_id: { in: unusedMediaPublicIds } } })) === 0,
      "Unused assessment delete should remove item media metadata."
    );

    const withData = await createAssessmentWithItems({
      teacherUserDbId: teacher.id,
      title: `Data deletion ${suffix}`,
      folderLabel: "Deletion smoke data"
    });
    const syntheticGraph = await addSyntheticSessionGraph({
      assessmentPublicId: withData.assessment.assessment_public_id,
      conceptUnitPublicId: withData.conceptUnit.concept_unit_public_id,
      itemPublicId: withData.items[0].item_public_id,
      studentDbId: student.id
    });
    const dataMediaPublicIds = withData.items.flatMap((item) =>
      item.media_assets.map((asset) => asset.media_public_id)
    );
    const withDataPreview = await previewAssessmentDeletion({
      teacher_user_db_id: teacher.id,
      assessment_public_id: withData.assessment.assessment_public_id
    });
    assert(!withDataPreview.deletion_modes.unused_assessment.allowed, "Data assessment should block unused delete.");
    assert(withDataPreview.counts.assessment_session_count === 1, "Preview should count assessment session.");
    assert(withDataPreview.counts.item_media_asset_count === 1, "Preview should count data assessment media assets.");
    assert(withDataPreview.counts.item_response_count === 1, "Preview should count item response.");
    assert(withDataPreview.counts.conversation_turn_count === 1, "Preview should count conversation turn.");
    assert(withDataPreview.counts.process_event_count === 1, "Preview should count process event.");
    assert(withDataPreview.counts.post_activity_evidence_count === 1, "Preview should count activity evidence.");
    assert(withDataPreview.counts.diagnostic_snapshot_count === 1, "Preview should count diagnostic snapshot.");

    await assertContentError(
      () =>
        deleteAssessmentAndAssociatedData({
          teacher_user_db_id: teacher.id,
          assessment_public_id: withData.assessment.assessment_public_id,
          deletion_mode: "unused_assessment",
          assessment_confirmation: withData.assessment.title,
          delete_confirmation: ASSESSMENT_UNUSED_DELETE_CONFIRMATION
        }),
      "assessment_unused_delete_blocked",
      "Simple delete must not remove assessment with student data"
    );

    await assertContentError(
      () =>
        deleteAssessmentAndAssociatedData({
          teacher_user_db_id: teacher.id,
          assessment_public_id: withData.assessment.assessment_public_id,
          deletion_mode: "assessment_and_all_data",
          assessment_confirmation: withData.assessment.title,
          delete_confirmation: ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION
        }),
      "assessment_delete_all_confirmation_mismatch",
      "Delete all should require second confirmation"
    );

    const dataDeletion = await deleteAssessmentAndAssociatedData({
      teacher_user_db_id: teacher.id,
      assessment_public_id: withData.assessment.assessment_public_id,
      deletion_mode: "assessment_and_all_data",
      assessment_confirmation: withData.assessment.title,
      delete_confirmation: ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION,
      confirm_delete_all_assessment_data: true
    });
    deletionAuditPublicIds.push(dataDeletion.deletion_event_public_id);
    assert(dataDeletion.deleted_counts.assessment_session_count === 1, "Delete all should report deleted session.");
    assert(dataDeletion.deleted_counts.item_response_count === 1, "Delete all should report deleted response.");
    assert(dataDeletion.deleted_counts.item_media_asset_count === 1, "Delete all should report deleted media metadata.");
    assert(dataDeletion.deleted_counts.diagnostic_snapshot_count === 1, "Delete all should report deleted snapshot.");
    assert(
      !(await prisma.assessment.findUnique({
        where: { assessment_public_id: withData.assessment.assessment_public_id }
      })),
      "Assessment with data should be deleted by strong confirmation."
    );
    assert(
      (await prisma.assessmentSession.count({ where: { session_public_id: syntheticGraph.sessionPublicId } })) === 0,
      "No assessment sessions should remain."
    );
    assert((await prisma.itemResponse.count({ where: { item: { item_public_id: withData.items[0].item_public_id } } })) === 0, "No item responses should remain.");
    assert(
      (await prisma.activityMisconceptionEvidenceRecord.count({
        where: { assessment_public_id: withData.assessment.assessment_public_id }
      })) === 0,
      "No activity evidence should remain."
    );
    assert(
      (await prisma.postActivityDiagnosticSnapshot.count({
        where: { assessment_public_id: withData.assessment.assessment_public_id }
      })) === 0,
      "No diagnostic snapshot should remain."
    );
    assert(
      (await prisma.itemMediaAsset.count({ where: { media_public_id: { in: dataMediaPublicIds } } })) === 0,
      "Delete all assessment data should remove item media metadata."
    );

    const archiveCandidate = await createAssessmentWithItems({
      teacherUserDbId: teacher.id,
      title: `Archived ${suffix}`,
      folderLabel: "Archive smoke"
    });
    await prisma.assessment.update({
      where: { assessment_public_id: archiveCandidate.assessment.assessment_public_id },
      data: { status: "archived" }
    });
    const activeList = await listAssessments({ teacher_user_db_id: teacher.id });
    assert(
      activeList.some((assessment) => assessment.assessment_public_id === archiveCandidate.assessment.assessment_public_id),
      "Service list should still return archived rows for teacher UI filtering."
    );
    const restored = await restoreAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: archiveCandidate.assessment.assessment_public_id
    });
    assert(restored.status === "draft", "Archived unused assessment should restore to draft.");

    assert(
      await prisma.assessment.findUnique({
        where: { assessment_public_id: unrelatedAssessment.assessment_public_id }
      }),
      "Unrelated assessment should remain."
    );
    assert(await prisma.user.findUnique({ where: { id: teacher.id } }), "Teacher account should remain.");
    assert(await prisma.user.findUnique({ where: { id: student.id } }), "Student account should remain.");

    const deletionAudits = await prisma.assessmentDeletionEvent.findMany({
      where: { deletion_public_id: { in: deletionAuditPublicIds } }
    });
    assert(deletionAudits.length >= 2, "Deletion audit rows should be retained.");
    assert(
      !JSON.stringify(deletionAudits).includes("Synthetic reasoning text"),
      "Deletion audit should not retain raw student reasoning."
    );
  } finally {
    const remainingAssessments = await prisma.assessment.findMany({
      where: { created_by_user_db_id: teacher.id },
      select: { assessment_public_id: true, title: true }
    });
    for (const assessment of remainingAssessments) {
      await deleteAssessmentAndAssociatedData({
        teacher_user_db_id: teacher.id,
        assessment_public_id: assessment.assessment_public_id,
        deletion_mode: "assessment_and_all_data",
        assessment_confirmation: assessment.title,
        delete_confirmation: ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION,
        confirm_delete_all_assessment_data: true
      }).catch(() => undefined);
    }
    await prisma.assessmentDeletionEvent.deleteMany({
      where: { performed_by_user_db_id: teacher.id }
    }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: {
        user_id: { in: [teacher.user_id, student.user_id] }
      }
    }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log("teacher assessment deletion smoke passed");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
