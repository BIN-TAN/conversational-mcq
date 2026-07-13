import type { Assessment, AssessmentStatus, ConceptUnitStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "./errors";

export type ContentState =
  | "draft_editable"
  | "published_unused"
  | "locked_after_student_session"
  | "archived";

export type SerializedContentState = {
  content_state: ContentState;
  is_content_locked: boolean;
  content_lock_reason: string | null;
  has_student_sessions: boolean;
};

type AssessmentLike = Pick<Assessment, "assessment_public_id" | "status"> & {
  _count?: { assessment_sessions?: number };
};

export const INCLUDED_ITEM_RANGE = {
  min: 3,
  max: 12
} as const;

export function serializeContentState(input: {
  status: AssessmentStatus | ConceptUnitStatus;
  assessment_session_count: number;
}): SerializedContentState {
  const hasStudentSessions = input.assessment_session_count > 0;

  if (input.status === "archived") {
    return {
      content_state: "archived",
      is_content_locked: hasStudentSessions,
      content_lock_reason: hasStudentSessions ? "student_session_exists" : null,
      has_student_sessions: hasStudentSessions
    };
  }

  if (hasStudentSessions) {
    return {
      content_state: "locked_after_student_session",
      is_content_locked: true,
      content_lock_reason: "student_session_exists",
      has_student_sessions: true
    };
  }

  if (input.status === "published") {
    return {
      content_state: "published_unused",
      is_content_locked: false,
      content_lock_reason: null,
      has_student_sessions: false
    };
  }

  return {
    content_state: "draft_editable",
    is_content_locked: false,
    content_lock_reason: null,
    has_student_sessions: false
  };
}

export function serializeAssessmentContentState(assessment: AssessmentLike): SerializedContentState {
  return serializeContentState({
    status: assessment.status,
    assessment_session_count: assessment._count?.assessment_sessions ?? 0
  });
}

function lockedError(assessmentPublicId: string): ContentServiceError {
  return new ContentServiceError(
    "content_locked_after_student_session",
    "This content cannot be modified because student data collection has started.",
    409,
    {
      assessment_public_id: assessmentPublicId,
      lock_reason: "student_session_exists"
    }
  );
}

function publishedEditError(message = "Published content must be returned to draft before editing.") {
  return new ContentServiceError(
    "published_content_must_return_to_draft_before_editing",
    message,
    409
  );
}

export async function getAssessmentContentState(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      assessment_public_id: input.assessment_public_id,
      created_by_user_db_id: input.teacher_user_db_id
    },
    include: { _count: { select: { assessment_sessions: true } } }
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  return {
    assessment,
    state: serializeAssessmentContentState(assessment)
  };
}

export async function isAssessmentContentLocked(input: {
  assessment_db_id?: string;
  assessment_public_id?: string;
}) {
  const count = await prisma.assessmentSession.count({
    where: input.assessment_db_id
      ? { assessment_db_id: input.assessment_db_id }
      : { assessment: { assessment_public_id: input.assessment_public_id } }
  });

  return count > 0;
}

export async function assertAssessmentEditable(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const { assessment, state } = await getAssessmentContentState(input);

  if (state.is_content_locked) {
    throw lockedError(assessment.assessment_public_id);
  }

  if (assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Archived assessments cannot be edited.",
      409,
      { assessment_public_id: assessment.assessment_public_id }
    );
  }

  if (assessment.status === "published") {
    throw publishedEditError(
      "This assessment can still be returned to draft because no student session has started."
    );
  }

  return assessment;
}

export async function assertConceptUnitEditable(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await prisma.conceptUnit.findFirst({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    include: {
      assessment: { include: { _count: { select: { assessment_sessions: true } } } }
    }
  });

  if (!conceptUnit) {
    throw new ContentServiceError("not_found", "Concept unit was not found.", 404);
  }

  const state = serializeAssessmentContentState(conceptUnit.assessment);

  if (state.is_content_locked) {
    throw lockedError(conceptUnit.assessment.assessment_public_id);
  }

  if (conceptUnit.assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Content under an archived assessment cannot be edited.",
      409,
      { assessment_public_id: conceptUnit.assessment.assessment_public_id }
    );
  }

  if (conceptUnit.assessment.status === "published") {
    throw publishedEditError(
      "Return the assessment to draft before changing concept-unit membership or order."
    );
  }

  if (conceptUnit.status === "archived") {
    throw new ContentServiceError(
      "conflict",
      "Archived concept units cannot be edited.",
      409,
      { concept_unit_public_id: conceptUnit.concept_unit_public_id }
    );
  }

  if (conceptUnit.status === "published") {
    throw publishedEditError("Return the concept unit to draft before editing its content.");
  }

  return conceptUnit;
}

export async function assertItemEditable(input: {
  teacher_user_db_id: string;
  item_public_id: string;
}) {
  const item = await prisma.item.findFirst({
    where: {
      item_public_id: input.item_public_id,
      concept_unit: { assessment: { created_by_user_db_id: input.teacher_user_db_id } }
    },
    include: {
      concept_unit: {
        include: {
          assessment: { include: { _count: { select: { assessment_sessions: true } } } }
        }
      }
    }
  });

  if (!item) {
    throw new ContentServiceError("not_found", "Item was not found.", 404);
  }

  const state = serializeAssessmentContentState(item.concept_unit.assessment);

  if (state.is_content_locked) {
    throw lockedError(item.concept_unit.assessment.assessment_public_id);
  }

  if (item.concept_unit.assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Items under an archived assessment cannot be edited.",
      409,
      { assessment_public_id: item.concept_unit.assessment.assessment_public_id }
    );
  }

  if (item.concept_unit.assessment.status === "published") {
    throw publishedEditError("Return the assessment to draft before changing item content.");
  }

  if (item.concept_unit.status === "published") {
    throw publishedEditError("Return the concept unit to draft before editing published items.");
  }

  if (item.status === "archived") {
    throw new ContentServiceError(
      "conflict",
      "Archived items cannot be edited.",
      409,
      { item_public_id: item.item_public_id }
    );
  }

  return item;
}

export async function assertAssessmentCanPublish(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const { assessment, state } = await getAssessmentContentState(input);

  if (state.is_content_locked) {
    throw lockedError(assessment.assessment_public_id);
  }

  if (assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Archived assessments cannot be published.",
      409,
      { assessment_public_id: assessment.assessment_public_id }
    );
  }

  return assessment;
}

export async function assertConceptUnitCanPublish(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await prisma.conceptUnit.findFirst({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    include: {
      assessment: { include: { _count: { select: { assessment_sessions: true } } } }
    }
  });

  if (!conceptUnit) {
    throw new ContentServiceError("not_found", "Concept unit was not found.", 404);
  }

  const state = serializeAssessmentContentState(conceptUnit.assessment);

  if (state.is_content_locked) {
    throw lockedError(conceptUnit.assessment.assessment_public_id);
  }

  if (conceptUnit.assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Concept units under an archived assessment cannot be published.",
      409,
      { assessment_public_id: conceptUnit.assessment.assessment_public_id }
    );
  }

  if (conceptUnit.status === "archived") {
    throw new ContentServiceError(
      "conflict",
      "Archived concept units cannot be published.",
      409,
      { concept_unit_public_id: conceptUnit.concept_unit_public_id }
    );
  }

  return conceptUnit;
}

export async function assertItemCanArchive(input: {
  teacher_user_db_id: string;
  item_public_id: string;
}) {
  const item = await prisma.item.findFirst({
    where: {
      item_public_id: input.item_public_id,
      concept_unit: { assessment: { created_by_user_db_id: input.teacher_user_db_id } }
    },
    include: {
      concept_unit: {
        include: {
          assessment: { include: { _count: { select: { assessment_sessions: true } } } }
        }
      }
    }
  });

  if (!item) {
    throw new ContentServiceError("not_found", "Item was not found.", 404);
  }

  const state = serializeAssessmentContentState(item.concept_unit.assessment);

  if (state.is_content_locked) {
    throw lockedError(item.concept_unit.assessment.assessment_public_id);
  }

  if (item.concept_unit.assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Items under an archived assessment cannot be archived individually.",
      409,
      { assessment_public_id: item.concept_unit.assessment.assessment_public_id }
    );
  }

  if (
    item.concept_unit.status === "published" &&
    item.status !== "archived" &&
    item.included_in_published_set
  ) {
    const includedActiveCount = await prisma.item.count({
      where: {
        concept_unit_db_id: item.concept_unit_db_id,
        status: { not: "archived" },
        included_in_published_set: true
      }
    });

    if (includedActiveCount <= INCLUDED_ITEM_RANGE.min) {
      throw new ContentServiceError(
        "item_archive_would_invalidate_published_concept_unit",
        "Archive the concept unit or return it to draft before removing one of exactly three included items.",
        409,
        {
          item_public_id: item.item_public_id,
          concept_unit_public_id: item.concept_unit.concept_unit_public_id,
          included_active_item_count: includedActiveCount
        }
      );
    }
  }

  return item;
}

export async function assertConceptUnitCanArchive(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await prisma.conceptUnit.findFirst({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    include: {
      assessment: { include: { _count: { select: { assessment_sessions: true } } } }
    }
  });

  if (!conceptUnit) {
    throw new ContentServiceError("not_found", "Concept unit was not found.", 404);
  }

  const state = serializeAssessmentContentState(conceptUnit.assessment);

  if (state.is_content_locked) {
    throw lockedError(conceptUnit.assessment.assessment_public_id);
  }

  if (conceptUnit.assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Concept units under an archived assessment cannot be archived individually.",
      409,
      { assessment_public_id: conceptUnit.assessment.assessment_public_id }
    );
  }

  if (conceptUnit.assessment.status === "published" && conceptUnit.status === "published") {
    const publishedCount = await prisma.conceptUnit.count({
      where: {
        assessment_db_id: conceptUnit.assessment_db_id,
        status: "published"
      }
    });

    if (publishedCount <= 1) {
      throw new ContentServiceError(
        "concept_unit_archive_would_invalidate_published_assessment",
        "Return the assessment to draft or archive it before archiving its only published concept unit.",
        409,
        {
          assessment_public_id: conceptUnit.assessment.assessment_public_id,
          concept_unit_public_id: conceptUnit.concept_unit_public_id
        }
      );
    }
  }

  return conceptUnit;
}

export async function returnAssessmentToDraft(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const { assessment, state } = await getAssessmentContentState(input);

  if (state.is_content_locked) {
    throw new ContentServiceError(
      "cannot_return_to_draft_after_student_session",
      "This assessment cannot return to draft because student data collection has started.",
      409,
      {
        assessment_public_id: assessment.assessment_public_id,
        lock_reason: "student_session_exists"
      }
    );
  }

  if (assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Archived assessments cannot be returned to draft.",
      409,
      { assessment_public_id: assessment.assessment_public_id }
    );
  }

  return prisma.assessment.update({
    where: { id: assessment.id },
    data: { status: "draft" },
    include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
  });
}

export async function restoreArchivedAssessment(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const { assessment } = await getAssessmentContentState(input);

  if (assessment.status !== "archived") {
    throw new ContentServiceError(
      "assessment_not_archived",
      "Only archived assessments can be restored.",
      409,
      { assessment_public_id: assessment.assessment_public_id }
    );
  }

  const restoredStatus = (assessment._count?.assessment_sessions ?? 0) > 0 ? "published" : "draft";

  return prisma.assessment.update({
    where: { id: assessment.id },
    data: { status: restoredStatus },
    include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
  });
}

export async function returnConceptUnitToDraft(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await prisma.conceptUnit.findFirst({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    include: {
      assessment: { include: { _count: { select: { assessment_sessions: true } } } }
    }
  });

  if (!conceptUnit) {
    throw new ContentServiceError("not_found", "Concept unit was not found.", 404);
  }

  const state = serializeAssessmentContentState(conceptUnit.assessment);

  if (state.is_content_locked) {
    throw new ContentServiceError(
      "cannot_return_to_draft_after_student_session",
      "This concept unit cannot return to draft because student data collection has started.",
      409,
      {
        assessment_public_id: conceptUnit.assessment.assessment_public_id,
        concept_unit_public_id: conceptUnit.concept_unit_public_id,
        lock_reason: "student_session_exists"
      }
    );
  }

  if (conceptUnit.assessment.status === "published") {
    throw publishedEditError("Return the parent assessment to draft before returning this concept unit to draft.");
  }

  if (conceptUnit.status === "archived") {
    throw new ContentServiceError(
      "conflict",
      "Archived concept units cannot be returned to draft.",
      409,
      { concept_unit_public_id: conceptUnit.concept_unit_public_id }
    );
  }

  return prisma.conceptUnit.update({
    where: { id: conceptUnit.id },
    data: { status: "draft" },
    include: {
      assessment: {
        include: { _count: { select: { assessment_sessions: true } } }
      },
      _count: { select: { items: true } }
    }
  });
}

export async function archiveAssessmentSafely(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      assessment_public_id: input.assessment_public_id,
      created_by_user_db_id: input.teacher_user_db_id
    },
    select: { id: true, assessment_public_id: true }
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  return prisma.assessment.update({
    where: { id: assessment.id },
    data: { status: "archived" },
    include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
  });
}

export async function assertAssessmentCanStartSession(input: {
  assessment_public_id: string;
}) {
  const assessment = await prisma.assessment.findUnique({
    where: { assessment_public_id: input.assessment_public_id },
    include: { _count: { select: { assessment_sessions: true } } }
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  if (assessment.status === "archived") {
    throw new ContentServiceError(
      "assessment_archived",
      "Archived assessments do not accept new sessions.",
      409,
      { assessment_public_id: assessment.assessment_public_id }
    );
  }

  if (assessment.status !== "published") {
    throw new ContentServiceError(
      "conflict",
      "Only published assessments can start student sessions.",
      409,
      { assessment_public_id: assessment.assessment_public_id }
    );
  }

  const publishedConceptUnits = await prisma.conceptUnit.findMany({
    where: {
      assessment_db_id: assessment.id,
      status: "published"
    },
    select: {
      concept_unit_public_id: true,
      items: {
        where: {
          status: { not: "archived" },
          included_in_published_set: true
        },
        select: { id: true }
      }
    }
  });

  if (publishedConceptUnits.length < 1) {
    throw new ContentServiceError(
      "assessment_has_no_published_concept_units",
      "At least one valid published concept unit is required before student sessions can start.",
      409,
      { assessment_public_id: assessment.assessment_public_id }
    );
  }

  const invalidConceptUnits = publishedConceptUnits
    .map((conceptUnit) => ({
      concept_unit_public_id: conceptUnit.concept_unit_public_id,
      included_active_item_count: conceptUnit.items.length
    }))
    .filter(
      (conceptUnit) =>
        conceptUnit.included_active_item_count < INCLUDED_ITEM_RANGE.min ||
        conceptUnit.included_active_item_count > INCLUDED_ITEM_RANGE.max
    );

  if (invalidConceptUnits.length > 0) {
    throw new ContentServiceError(
      "concept_unit_item_count_invalid",
      "Published concept units must have at least 3 included active items before sessions can start.",
      409,
      {
        assessment_public_id: assessment.assessment_public_id,
        concept_units: invalidConceptUnits
      }
    );
  }

  return assessment;
}
