import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createAssessment, getAssessmentDetail } from "../src/lib/services/content/assessments";
import { createAssessmentItem, getItemDetail } from "../src/lib/services/content/items";
import {
  assertApprovedVideoUrl,
  assertSafeExternalMediaUrl,
  llmMediaContextForAssets,
  mediaStorageStatus,
  prepareUploadedImageMedia,
  validateImageUploadForMedia,
  type MediaStorageProvider
} from "../src/lib/services/content/item-media";
import { publishAssessment } from "../src/lib/services/content/publishing";
import {
  buildDistractorRationalesFromTeacherNotes,
  buildItemAdministrationRulesFromTeacherMetadata
} from "../src/lib/services/content/teacher-diagnostic-context";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  recordSelectedOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { assert, assertStudentVisibleTextIsSafe, cleanupSmokeStudentSessions, createSmokeStudent } from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

function text(value: unknown) {
  return JSON.stringify(value);
}

function assertThrows(action: () => unknown, message: string) {
  try {
    action();
  } catch {
    return;
  }

  throw new Error(message);
}

async function ensureDemoTeacher() {
  return prisma.user.upsert({
    where: { user_id: "teacher_demo" },
    update: {
      role: "teacher_researcher",
      password_hash: await hashSecret("teacher_demo_password"),
      access_code_hash: null
    },
    create: {
      user_id: "teacher_demo",
      user_id_normalized: normalizeUserId("teacher_demo"),
      role: "teacher_researcher",
      password_hash: await hashSecret("teacher_demo_password")
    }
  });
}

function options() {
  return [
    { label: "A", text: "Theta is a person-side ability location on the latent scale." },
    { label: "B", text: "Theta is the item difficulty parameter." },
    { label: "C", text: "Theta is the number of answer choices." },
    { label: "D", text: "Theta is the item discrimination slope." }
  ];
}

function itemInput(order: number, mediaAssets: unknown[] = []) {
  const itemOptions = options();

  return {
    item_stem: `Phase 31N media smoke item ${order}: What does theta represent?`,
    options: itemOptions,
    correct_option: "A",
    distractor_rationales: buildDistractorRationalesFromTeacherNotes({
      option_labels: itemOptions.map((option) => option.label),
      correct_option: "A",
      existing_rationales: {},
      option_notes: [],
      plain_language_distractor_diagnostic_notes:
        "Option B may suggest confusing ability with item difficulty; option D may suggest confusing ability with discrimination."
    }),
    expected_reasoning_patterns: [
      "Student separates person-side ability location from item-side parameters."
    ],
    possible_misconception_indicators: [],
    administration_rules: buildItemAdministrationRulesFromTeacherMetadata({
      administration_rules: {
        difficulty: "moderate",
        knowledge_component: "theta_interpretation"
      },
      metadata: {
        item_label: `Media smoke item ${order}`,
        item_purpose: "initial_item",
        expected_reasoning_note:
          "A strong response identifies theta as person-side ability, not item difficulty.",
        item_diagnostic_value_note:
          "This item can show whether the student substitutes an item parameter for an ability parameter.",
        correct_option_notes: {
          target_reasoning_note: "Theta is a person-side ability location.",
          strong_reasoning_should_mention: "Theta differs from item difficulty and discrimination."
        },
        plain_language_distractor_diagnostic_notes:
          "Distractor choices are indirect evidence only and must be read with the student's explanation."
      }
    }),
    included_in_published_set: true,
    item_order: order,
    media_assets: mediaAssets
  };
}

async function cleanup(prefix: string) {
  const assessments = await prisma.assessment.findMany({
    where: { title: { contains: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const conceptUnits = await prisma.conceptUnit.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true }
  });
  const conceptUnitIds = conceptUnits.map((unit) => unit.id);
  const sessions = await prisma.assessmentSession.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true, user_db_id: true, session_public_id: true }
  });
  const userIds = sessions.map((session) => session.user_db_id);

  for (const session of sessions) {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: session.user_db_id,
      sessionPublicIds: [session.session_public_id]
    });
  }

  await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: conceptUnitIds } } });
  await prisma.conceptUnit.deleteMany({ where: { id: { in: conceptUnitIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  const prefix = `phase31n_media_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await ensureDemoTeacher();
  const sessionPublicIds: string[] = [];

  try {
    const storageStatus = mediaStorageStatus({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    assert(storageStatus.uploads_enabled === false, "Uploads should be disabled without storage env.");

    assertSafeExternalMediaUrl("https://example.com/theta-plot.png");
    assertThrows(
      () => assertSafeExternalMediaUrl("javascript:alert(1)"),
      "javascript: URL should be rejected."
    );
    assertThrows(() => assertSafeExternalMediaUrl("http://example.com/a.png"), "HTTP URL should be rejected.");
    assertThrows(
      () => assertSafeExternalMediaUrl("https://127.0.0.1/a.png"),
      "Private/local media URL should be rejected."
    );
    assertApprovedVideoUrl("https://www.youtube.com/watch?v=abc123");
    assertThrows(
      () => assertApprovedVideoUrl("https://videos.example.com/lecture"),
      "Unapproved video host should be rejected."
    );
    validateImageUploadForMedia({
      content_type: "image/png",
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    });
    assertThrows(
      () =>
        validateImageUploadForMedia({
          content_type: "image/png",
          bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00])
        }),
      "Mismatched MIME/signature should be rejected."
    );

    const fakeStorage: MediaStorageProvider = {
      async putObject() {
        return {
          storage_key: "item-media/smoke/theta-plot.png",
          public_or_signed_url: "https://cdn.example.com/item-media/smoke/theta-plot.png"
        };
      }
    };
    const uploadedImage = await prepareUploadedImageMedia({
      file: {
        content_type: "image/png",
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
      },
      alt_text_or_description: "A small plot showing a theta scale with a student point.",
      caption: "Theta scale illustration.",
      storage: fakeStorage,
      order_index: 0
    });

    const mediaAssets = [
      uploadedImage,
      {
        media_type: "image",
        source_type: "external_url",
        placement: "item_stem",
        external_url: "https://example.com/theta-boundary.webp",
        alt_text_or_description: "Diagram comparing a person ability location with item parameters.",
        student_alt_text: "Diagram comparing a person ability location with item parameters.",
        teacher_llm_media_description:
          "Teacher-only LLM description: the diagram intentionally contrasts theta with item difficulty without revealing the keyed answer.",
        caption: "Teacher-authored illustration for the stem.",
        source_attribution: "Example course note",
        order_index: 1
      },
      {
        media_type: "video",
        source_type: "external_url",
        placement: "item_stem",
        external_url: "https://www.youtube.com/watch?v=abc123",
        title: "Theta interpretation clip",
        alt_text_or_description: "Short video reviewing theta as a latent ability location.",
        transcript_or_content_summary:
          "The clip describes theta as a student ability location and contrasts it with item difficulty.",
        order_index: 2
      },
      {
        media_type: "reference_link",
        source_type: "external_url",
        placement: "option",
        option_label: "B",
        external_url: "https://example.com/item-difficulty-note",
        alt_text_or_description: "Reference note about item difficulty, used to contextualize option B.",
        caption: "Reference for option B terminology.",
        order_index: 3
      }
    ];

    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Temporary ${prefix}`,
        diagnostic_focus: "Interpret theta separately from item-side parameters.",
        workflow_mode: "automatic",
        response_collection_mode: "llm_assisted",
        auto_create_primary_topic: true
      }
    });
    const assessmentDetail = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    const conceptUnit = assessmentDetail.concept_units[0];
    assert(conceptUnit, "Auto-created concept unit missing.");

    const mediaItem = await createAssessmentItem({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: itemInput(1, mediaAssets)
    });
    await createAssessmentItem({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: itemInput(2)
    });
    await createAssessmentItem({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: itemInput(3)
    });

    const detail = await getItemDetail({
      teacher_user_db_id: teacher.id,
      item_public_id: mediaItem.item_public_id
    });
    assert(detail.media_assets.length === 4, "Teacher item detail should include four media assets.");
    assert(detail.media_present_count === 4, "Teacher serializer should count media assets.");
    assert(detail.media_type_summary?.includes("image:2"), "Media type summary should include images.");
    assert(detail.media_type_summary?.includes("video:1"), "Media type summary should include video.");
    assert(!text(detail).includes("MEDIA_STORAGE_SECRET_ACCESS_KEY"), "Teacher media serialization leaked env names.");
    assert(!text(detail).includes("storage_key"), "Teacher media serialization should not expose storage keys.");
    assert(text(detail.llm_media_context).includes("llm_must_not_infer_unseen_media_content"), "LLM media context should include limitations.");
    assert(text(detail.llm_media_context).includes('"direct_multimodal_input_supplied":false'), "LLM media context should say direct multimodal input is false.");
    assert(
      text(detail.llm_media_context).includes("Teacher-only LLM description"),
      "LLM media context should include teacher-only media descriptions."
    );

    await publishAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });

    const student = await createSmokeStudent({
      prisma,
      prefix: `${prefix}_student`,
      accessCode: `${prefix}_access`
    });
    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: assessment.assessment_public_id
    });
    sessionPublicIds.push(started.session.session_public_id);
    let state = await startConceptUnitInitialAdministration({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
    });
    assert(state.current_item?.media_assets.length === 4, "Student state should expose safe media assets.");
    assertStudentVisibleTextIsSafe(state);
    assert(!text(state).includes("media_context_hash"), "Student state should not expose media hashes.");
    assert(!text(state).includes("storage_key"), "Student state should not expose storage keys.");
    assert(
      !text(state).includes("Teacher-only LLM description"),
      "Student state should not expose teacher-only media descriptions."
    );
    assert(
      text(state).includes("Diagram comparing a person ability location with item parameters."),
      "Student state should include the student-facing media alt text."
    );

    const selected = state.current_item.options[0]?.label;
    assert(selected, "Media smoke current item needs an option.");
    state = (
      await recordSelectedOption({
        student_user_db_id: student.id,
        session_public_id: started.session.session_public_id,
        item_public_id: state.current_item.item_public_id,
        data: {
          selected_option: selected,
          client_action_id: `${prefix}_select_media_item`
        }
      })
    ).state;
    assert(state.assessment_state === "AWAIT_REASON", "Selecting media item answer should advance to reasoning.");

    const response = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: mediaItem.item_public_id }
      },
      select: { item_snapshot: true }
    });
    assert(text(response.item_snapshot).includes("llm_media_context"), "Item snapshot should freeze LLM media context.");
    assert(text(response.item_snapshot).includes("theta scale with a student point"), "Item snapshot should include media description.");
    await prisma.itemMediaAsset.updateMany({
      where: { item: { item_public_id: mediaItem.item_public_id }, order_index: 0 },
      data: {
        alt_text_or_description: "Edited media description after administration.",
        student_alt_text: "Edited student media description after administration.",
        teacher_llm_media_description: "Edited teacher media description after administration."
      }
    });
    const unchangedResponse = await prisma.itemResponse.findFirstOrThrow({
      where: {
        item: { item_public_id: mediaItem.item_public_id }
      },
      select: { item_snapshot: true }
    });
    assert(
      text(unchangedResponse.item_snapshot).includes("theta scale with a student point"),
      "Item snapshot should not change after later media edits."
    );
    assert(
      !text(unchangedResponse.item_snapshot).includes("Edited media description after administration"),
      "Later media edits should not rewrite the item response snapshot."
    );
    assert(
      !text(unchangedResponse.item_snapshot).includes("Edited teacher media description after administration"),
      "Later teacher-only media edits should not rewrite the item response snapshot."
    );

    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session: { session_public_id: started.session.session_public_id } },
      select: { id: true }
    });
    const responsePackage = await createResponsePackage({
      concept_unit_session_db_id: conceptUnitSession.id
    });
    assert(text(responsePackage.payload).includes("llm_media_context"), "Response package should include LLM media context.");
    assert(!text(responsePackage.payload).includes("storage_key"), "Response package should not expose storage keys.");

    const directContext = llmMediaContextForAssets(
      await prisma.itemMediaAsset.findMany({ where: { item: { item_public_id: mediaItem.item_public_id } } })
    );
    assert(directContext.length === 4, "Direct LLM media context helper should include active assets.");
    assert(
      text(directContext).includes("Teacher-only LLM description"),
      "Direct LLM media context should preserve teacher-only media description."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          media_assets: detail.media_assets.length,
          student_media_assets: state.current_item?.media_assets.length ?? 0,
          response_package_media_context: true,
          uploads_enabled_without_env: storageStatus.uploads_enabled,
          openai_calls: 0
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(prefix);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
