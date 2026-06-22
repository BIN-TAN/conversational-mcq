import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { generatePublicId } from "../src/lib/services/ids";
import {
  archiveAssessment,
  createAssessment,
  getAssessmentDetail,
  returnAssessmentToDraft,
  updateAssessment
} from "../src/lib/services/content/assessments";
import {
  archiveConceptUnit,
  createConceptUnit,
  getConceptUnitDetail,
  reorderConceptUnits,
  returnConceptUnitToDraft,
  updateConceptUnit
} from "../src/lib/services/content/concept-units";
import {
  archiveItem,
  createItem,
  listItems,
  reorderItems,
  updateItem
} from "../src/lib/services/content/items";
import {
  publishAssessment,
  publishConceptUnit,
  validateConceptUnitPublishable
} from "../src/lib/services/content/publishing";
import {
  assertAssessmentCanStartSession,
  getAssessmentContentState
} from "../src/lib/services/content/governance";
import { ContentServiceError } from "../src/lib/services/content/errors";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoInternalIds(value: unknown, path = "response") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoInternalIds(entry, `${path}.${index}`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    assert(key !== "id", `Internal id leaked at ${path}.${key}`);
    assert(!key.endsWith("_db_id"), `Internal database foreign key leaked at ${path}.${key}`);
    assertNoInternalIds(entry, `${path}.${key}`);
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
    return error;
  }

  throw new Error(`${message}: expected ${code} error.`);
}

async function ensureDemoUsers() {
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret("teacher_demo_password"),
    hashSecret("student_demo_access_code")
  ]);

  const teacher = await prisma.user.upsert({
    where: { user_id: "teacher_demo" },
    update: {
      role: "teacher_researcher",
      password_hash: teacherPasswordHash,
      access_code_hash: null
    },
    create: {
      user_id: "teacher_demo",
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });

  const student = await prisma.user.upsert({
    where: { user_id: "student_demo" },
    update: {
      role: "student",
      password_hash: null,
      access_code_hash: studentAccessCodeHash
    },
    create: {
      user_id: "student_demo",
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });

  return { teacher, student };
}

function validItemInput(itemOrder: number, included: boolean) {
  return {
    item_stem: `Phase 3C governance smoke item ${itemOrder}`,
    options: [
      { label: "A", text: "A supported answer" },
      { label: "B", text: "A plausible partial answer" },
      { label: "C", text: "A common misconception answer" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "B reflects partial understanding of the teacher-defined concept.",
      C: "C reflects a possible misconception for the teacher-defined concept."
    },
    expected_reasoning_patterns: [
      "Explains why A matches the teacher-defined concept boundary."
    ],
    possible_misconception_indicators: [
      "Chooses B or C with reasoning aligned to the distractor rationale."
    ],
    administration_rules: { no_feedback_during_initial_administration: true },
    included_in_published_set: included,
    item_order: itemOrder
  };
}

async function main() {
  const prefix = `phase3c_governance_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { teacher, student } = await ensureDemoUsers();
  const created = {
    assessmentPublicIds: [] as string[],
    conceptUnitPublicIds: [] as string[],
    itemPublicIds: [] as string[],
    assessmentSessionPublicIds: [] as string[]
  };

  try {
    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Teacher-defined assessment ${prefix}`,
        description: "Temporary Phase 3C governance smoke assessment."
      }
    });
    created.assessmentPublicIds.push(assessment.assessment_public_id);
    assert(assessment.content_state === "draft_editable", "New assessment should be draft editable.");
    assertNoInternalIds(assessment);

    await assertContentError(
      () =>
        publishAssessment({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessment.assessment_public_id
        }),
      "assessment_has_no_published_concept_units",
      "Assessment publish should fail without an actually published concept unit"
    );

    const conceptUnit = await createConceptUnit({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        title: "Teacher-defined proportional reasoning",
        learning_objective: "Interpret ratios in a teacher-selected context.",
        related_concept_description:
          "The teacher chooses this broad concept boundary; no fixed taxonomy is imposed.",
        administration_rules: { initial_administration: "no_feedback" }
      }
    });
    created.conceptUnitPublicIds.push(conceptUnit.concept_unit_public_id);
    assertNoInternalIds(conceptUnit);

    const items: Array<{ item_public_id: string }> = [];
    for (const itemOrder of [1, 2, 3, 4, 5]) {
      const item = await createItem({
        teacher_user_db_id: teacher.id,
        concept_unit_public_id: conceptUnit.concept_unit_public_id,
        data: validItemInput(itemOrder, itemOrder <= 3)
      });
      created.itemPublicIds.push(item.item_public_id);
      items.push(item);
    }

    const draftDetail = await getConceptUnitDetail({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(draftDetail.candidate_item_count === 5, "Draft concept unit should keep five candidates.");
    assert(
      draftDetail.included_active_item_count === 3,
      "Draft concept unit should have three included active items."
    );
    assertNoInternalIds(draftDetail);

    const publishValidation = await validateConceptUnitPublishable({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(publishValidation.ok, "Three included active items should pass validation.");
    assert(
      publishValidation.included_active_item_count === 3,
      "Publish validation should count only included active items."
    );
    assert(
      publishValidation.candidate_item_count === 5,
      "Publish validation should preserve candidate item count."
    );

    const publishedConceptUnit = await publishConceptUnit({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(
      publishedConceptUnit.concept_unit.status === "published",
      "Concept unit should publish."
    );

    const publishedItems = await listItems({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(
      publishedItems.filter((item) => item.included_in_published_set).every(
        (item) => item.status === "published"
      ),
      "Included active items should publish."
    );
    assert(
      publishedItems.filter((item) => !item.included_in_published_set).every(
        (item) => item.status === "draft"
      ),
      "Candidate items outside the published set should remain draft."
    );

    await publishAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });

    const publishedAssessment = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(
      publishedAssessment.content_state === "published_unused",
      "Published assessment without sessions should be published_unused."
    );

    await assertContentError(
      () =>
        archiveItem({
          teacher_user_db_id: teacher.id,
          item_public_id: items[0].item_public_id
        }),
      "item_archive_would_invalidate_published_concept_unit",
      "Archiving one of exactly three included items should be rejected"
    );

    const draftAgainAssessment = await returnAssessmentToDraft({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(
      draftAgainAssessment.status === "draft",
      "Unused assessment should explicitly return to draft."
    );

    const draftAgainConceptUnit = await returnConceptUnitToDraft({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(
      draftAgainConceptUnit.status === "draft",
      "Unused concept unit should explicitly return to draft."
    );

    const editedConceptUnit = await updateConceptUnit({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id,
      data: {
        learning_objective: "Interpret and compare ratios in a teacher-selected context."
      }
    });
    assert(editedConceptUnit.version === 2, "Concept-unit edit should increment version.");

    const fourthItem = await updateItem({
      teacher_user_db_id: teacher.id,
      item_public_id: items[3].item_public_id,
      data: { included_in_published_set: true }
    });
    assert(fourthItem.included_in_published_set, "Teacher should be able to add a candidate to the included set before locking.");

    const republishValidation = await validateConceptUnitPublishable({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(
      republishValidation.ok && republishValidation.included_active_item_count === 4,
      "Republishing should rerun validation against the updated included set."
    );

    await publishConceptUnit({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    await publishAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });

    const assessmentRow = await prisma.assessment.findUniqueOrThrow({
      where: { assessment_public_id: assessment.assessment_public_id },
      select: { id: true }
    });
    const sessionPublicId = generatePublicId("session");
    await prisma.assessmentSession.create({
      data: {
        session_public_id: sessionPublicId,
        user_db_id: student.id,
        assessment_db_id: assessmentRow.id,
        status: "active",
        current_phase: "session_started",
        started_at: new Date(),
        last_activity_at: new Date()
      }
    });
    created.assessmentSessionPublicIds.push(sessionPublicId);

    const lockedState = await getAssessmentContentState({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(lockedState.state.is_content_locked, "Student session should lock content.");
    assert(
      lockedState.state.content_state === "locked_after_student_session",
      "Locked assessment should serialize as locked_after_student_session."
    );

    await assertContentError(
      () =>
        updateAssessment({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessment.assessment_public_id,
          data: { title: "Blocked locked edit" }
        }),
      "content_locked_after_student_session",
      "Locked assessment metadata edit should be rejected"
    );
    await assertContentError(
      () =>
        updateConceptUnit({
          teacher_user_db_id: teacher.id,
          concept_unit_public_id: conceptUnit.concept_unit_public_id,
          data: { title: "Blocked locked concept edit" }
        }),
      "content_locked_after_student_session",
      "Locked concept-unit edit should be rejected"
    );
    await assertContentError(
      () =>
        updateItem({
          teacher_user_db_id: teacher.id,
          item_public_id: items[0].item_public_id,
          data: { item_stem: "Blocked locked item edit" }
        }),
      "content_locked_after_student_session",
      "Locked item edit should be rejected"
    );
    await assertContentError(
      () =>
        reorderConceptUnits({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessment.assessment_public_id,
          data: { ordered_concept_unit_public_ids: [conceptUnit.concept_unit_public_id] }
        }),
      "content_locked_after_student_session",
      "Locked concept-unit reorder should be rejected"
    );
    await assertContentError(
      () =>
        reorderItems({
          teacher_user_db_id: teacher.id,
          concept_unit_public_id: conceptUnit.concept_unit_public_id,
          data: {
            ordered_item_public_ids: publishedItems
              .map((item) => item.item_public_id)
              .reverse()
          }
        }),
      "content_locked_after_student_session",
      "Locked item reorder should be rejected"
    );
    await assertContentError(
      () =>
        archiveConceptUnit({
          teacher_user_db_id: teacher.id,
          concept_unit_public_id: conceptUnit.concept_unit_public_id
        }),
      "content_locked_after_student_session",
      "Locked concept-unit archive should be rejected"
    );
    await assertContentError(
      () =>
        archiveItem({
          teacher_user_db_id: teacher.id,
          item_public_id: items[0].item_public_id
        }),
      "content_locked_after_student_session",
      "Locked individual item archive should be rejected"
    );
    await assertContentError(
      () =>
        returnAssessmentToDraft({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessment.assessment_public_id
        }),
      "cannot_return_to_draft_after_student_session",
      "Locked assessment return-to-draft should be rejected"
    );
    await assertContentError(
      () =>
        returnConceptUnitToDraft({
          teacher_user_db_id: teacher.id,
          concept_unit_public_id: conceptUnit.concept_unit_public_id
        }),
      "cannot_return_to_draft_after_student_session",
      "Locked concept-unit return-to-draft should be rejected"
    );

    const archivedAssessment = await archiveAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(
      archivedAssessment.status === "archived",
      "Whole-assessment archive should remain allowed after locking."
    );

    const sessionStillExists = await prisma.assessmentSession.count({
      where: { session_public_id: sessionPublicId }
    });
    assert(sessionStillExists === 1, "Archive should preserve the temporary session record.");

    await assertContentError(
      () =>
        assertAssessmentCanStartSession({
          assessment_public_id: assessment.assessment_public_id
        }),
      "assessment_archived",
      "Archived assessments should reject future session starts"
    );

    console.log("Phase 3C content governance smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    if (created.assessmentSessionPublicIds.length > 0) {
      const sessions = await prisma.assessmentSession.findMany({
        where: { session_public_id: { in: created.assessmentSessionPublicIds } },
        select: { id: true }
      });
      const sessionIds = sessions.map((session) => session.id);

      await prisma.workflowOverride.deleteMany({
        where: { assessment_session_db_id: { in: sessionIds } }
      });
      await prisma.workflowJob.deleteMany({
        where: { assessment_session_db_id: { in: sessionIds } }
      });
      await prisma.assessmentSession.deleteMany({
        where: { session_public_id: { in: created.assessmentSessionPublicIds } }
      });
    }
    if (created.itemPublicIds.length > 0) {
      await prisma.item.deleteMany({
        where: { item_public_id: { in: created.itemPublicIds } }
      });
    }
    if (created.conceptUnitPublicIds.length > 0) {
      await prisma.conceptUnit.deleteMany({
        where: { concept_unit_public_id: { in: created.conceptUnitPublicIds } }
      });
    }
    if (created.assessmentPublicIds.length > 0) {
      await prisma.assessment.deleteMany({
        where: { assessment_public_id: { in: created.assessmentPublicIds } }
      });
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
