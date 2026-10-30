import { prisma } from "@/lib/db";
import { buildEvidenceIntegratedProfileBundle } from "@/lib/services/student-assessment/evidence-integrated-profile";
import { learningProfileSummary } from "@/lib/services/student-assessment/learning-profile-summary";
import { profileRecordIdentity, profileSourceCallSelect } from "@/lib/services/student-assessment/profile-record";
import { attemptContextForSession } from "@/lib/services/student-assessment/interpretation-v8/attempts";
import { callInterpretationV8, interpretationV8ApprovalStatus } from "@/lib/services/student-assessment/interpretation-v8/call";
import { INTERPRETATION_V8_PROMPT_VERSION } from "@/lib/services/student-assessment/interpretation-v8/contract";
import { chosenOptionTagsFromPackage, loadInterpretationInputV8 } from "@/lib/services/student-assessment/interpretation-v8/input-builder";
import {
  buildStoredInterpretationV8,
  readStoredInterpretationV8,
  studentProfileDataV8,
  type InterpretationRelabelRecord
} from "@/lib/services/student-assessment/interpretation-v8/profile";

/**
 * One-time reinterpretation of earlier attempts under updated interpretation rules (release 27).
 *
 * The student's submitted responses (the sealed initial response package) are interpreted again
 * with the current prompt and rules. The result is saved as a new profile beside the original;
 * nothing the student did or saw changes: responses, process data, conversations, feedback and
 * the original profile stay as they are. A reinterpretation is first a preview (pending); the
 * instructor applies the previews, after which instructor views and exports read their labels
 * from them. Undo returns to the original labels; the reinterpretations stay in the data for audit.
 */
export const INTERPRETATION_RELABEL_VERSION = "interpretation-relabel-v1" as const;
export const INTERPRETATION_RELABEL_REASON =
  "Interpreted again from the same submitted responses under the updated interpretation rules " +
  `(${INTERPRETATION_V8_PROMPT_VERSION}: an explanation is adequate when it gives the key reason that decides the item).`;

const profileSelect = { id: true, profile_type: true, item_level_evidence: true, misconception_indicators: true,
  process_interpretation_cautions: true, confidence_alignment: true, ability_profile: true, integrated_diagnostic_profile: true,
  evidence_sufficiency: true, created_at: true, based_on_agent_call: { select: profileSourceCallSelect } } as const;

async function loadUnits(teacherUserDbId: string) {
  return prisma.conceptUnitSession.findMany({
    where: {
      assessment_session: { assessment: { created_by_user_db_id: teacherUserDbId }, user: { role: "student" } },
      response_packages: { some: { package_type: "initial_concept_unit_response_package" } }
    },
    orderBy: [{ created_at: "asc" }],
    select: {
      id: true,
      assessment_session_db_id: true,
      relabeled_at: true,
      response_packages: {
        where: { package_type: "initial_concept_unit_response_package" },
        orderBy: { created_at: "desc" },
        select: { id: true, created_at: true }
      },
      latest_student_profile: { select: profileSelect },
      relabeled_student_profile: { select: profileSelect },
      pending_relabel_student_profile: { select: profileSelect },
      formative_conversation_session: { select: { initial_student_profile: { select: profileSelect } } },
      assessment_session: {
        select: {
          session_public_id: true,
          attempt_number: true,
          started_at: true,
          assessment: { select: { title: true } },
          user: { select: { user_id: true, display_name: true } }
        }
      }
    }
  });
}

type Unit = Awaited<ReturnType<typeof loadUnits>>[number];
type UnitProfile = NonNullable<Unit["latest_student_profile"]>;

/** True when this profile is a live (not fallback) interpretation under the current prompt. */
export function isCurrentInterpretation(itemLevelEvidence: unknown) {
  const stored = readStoredInterpretationV8(itemLevelEvidence);
  return Boolean(stored && stored.prompt_version === INTERPRETATION_V8_PROMPT_VERSION && stored.generation_mode !== "fallback");
}

function profileOfRecord(unit: Unit): UnitProfile | null {
  return unit.relabeled_student_profile ?? unit.formative_conversation_session?.initial_student_profile ?? unit.latest_student_profile ?? null;
}

/** The response package the original interpretation used, or the latest sealed one. */
function packageIdFor(unit: Unit) {
  const original = unit.formative_conversation_session?.initial_student_profile ?? unit.latest_student_profile;
  const stored = readStoredInterpretationV8(original?.item_level_evidence);
  const ids = unit.response_packages.map((entry) => entry.id);
  return stored && ids.includes(stored.response_package_id) ? stored.response_package_id : ids[0] ?? null;
}

function labelOf(profile: UnitProfile | null) {
  return learningProfileSummary(profile).understanding_label;
}

/**
 * current: already interpreted under the current rules; to_do: to interpret again;
 * preview_ready: a new interpretation awaits the instructor; not_ready: submitted within the
 * last two hours with no interpretation saved yet, so its own preparation may still be running.
 * An older submission without an interpretation (its preparation stopped) is interpreted too.
 */
export type RelabelUnitState = "current" | "to_do" | "preview_ready" | "not_ready";
export const RELABEL_PREPARATION_GRACE_MS = 2 * 60 * 60 * 1000;

export function relabelUnitState(unit: {
  record_evidence: unknown;
  pending_evidence: unknown;
  submitted_at?: Date | null;
  now?: Date;
}): RelabelUnitState {
  const hasRecord = unit.record_evidence !== null && unit.record_evidence !== undefined;
  if (hasRecord && isCurrentInterpretation(unit.record_evidence)) return "current";
  if (isCurrentInterpretation(unit.pending_evidence)) return "preview_ready";
  if (!hasRecord) {
    const submittedAt = unit.submitted_at?.getTime();
    const now = (unit.now ?? new Date()).getTime();
    if (submittedAt === undefined || now - submittedAt < RELABEL_PREPARATION_GRACE_MS) return "not_ready";
  }
  return "to_do";
}

function stateOf(unit: Unit): RelabelUnitState {
  return relabelUnitState({
    record_evidence: profileOfRecord(unit)?.item_level_evidence,
    pending_evidence: unit.pending_relabel_student_profile?.item_level_evidence,
    submitted_at: unit.response_packages[0]?.created_at ?? null
  });
}

function describe(unit: Unit) {
  const session = unit.assessment_session;
  return {
    session_public_id: session.session_public_id,
    student: session.user.display_name?.trim() || session.user.user_id,
    mini_test: session.assessment.title,
    attempt_number: session.attempt_number
  };
}

export async function interpretationRelabelStatus(input: { teacher_user_db_id: string }) {
  const units = await loadUnits(input.teacher_user_db_id);
  const states = units.map((unit) => ({ unit, state: stateOf(unit) }));
  const previews = states.filter((entry) => entry.state === "preview_ready").map(({ unit }) => ({
    ...describe(unit),
    label_now: labelOf(profileOfRecord(unit)),
    label_after: labelOf(unit.pending_relabel_student_profile)
  }));
  const applied = units.filter((unit) => unit.relabeled_student_profile).length;
  return {
    relabel_version: INTERPRETATION_RELABEL_VERSION,
    prompt_version: INTERPRETATION_V8_PROMPT_VERSION,
    rules_approved: interpretationV8ApprovalStatus().approved,
    submitted_attempts: units.length,
    not_ready: states.filter((entry) => entry.state === "not_ready").length,
    up_to_date: states.filter((entry) => entry.state === "current").length,
    to_do: states.filter((entry) => entry.state === "to_do").length,
    previews_ready: previews.length,
    applied,
    previews
  };
}

export type RelabelStepResult =
  | { status: "done" }
  | { status: "blocked"; reason: string }
  | { status: "kept_original"; session_public_id: string; reason: string }
  | { status: "previewed"; session_public_id: string; label_now: string; label_after: string };

/**
 * Interprets the next attempt that needs it, skipping the attempts in `skip` (those that could
 * not be interpreted earlier in this run). The result is saved as a preview, not applied.
 */
export async function interpretationRelabelNext(input: { teacher_user_db_id: string; skip?: string[] }): Promise<RelabelStepResult> {
  const skip = new Set(input.skip ?? []);
  const units = await loadUnits(input.teacher_user_db_id);
  const unit = units.find((entry) => stateOf(entry) === "to_do" && !skip.has(entry.assessment_session.session_public_id));
  if (!unit) return { status: "done" };
  const sessionPublicId = unit.assessment_session.session_public_id;
  const packageId = packageIdFor(unit);
  if (!packageId) return { status: "kept_original", session_public_id: sessionPublicId, reason: "no_response_package" };

  let loaded: Awaited<ReturnType<typeof loadInterpretationInputV8>>;
  try {
    loaded = await loadInterpretationInputV8({ concept_unit_session_db_id: unit.id, response_package_id: packageId });
  } catch {
    return { status: "kept_original", session_public_id: sessionPublicId, reason: "responses_unreadable" };
  }
  if (!loaded.input.items.length) return { status: "kept_original", session_public_id: sessionPublicId, reason: "no_items" };

  const result = await callInterpretationV8({
    assessment_session_db_id: unit.assessment_session_db_id,
    concept_unit_session_db_id: unit.id,
    response_package_id: packageId,
    model_input: loaded.input,
    provider_generation_allowed: true,
    purpose: "reinterpretation"
  });
  if (result.status === "blocked") return { status: "blocked", reason: result.reason };
  if (result.status !== "validated") return { status: "kept_original", session_public_id: sessionPublicId, reason: result.reason };

  const responsePackage = await prisma.responsePackage.findUniqueOrThrow({ where: { id: packageId }, select: { payload: true } });
  const before = profileOfRecord(unit);
  const relabel: InterpretationRelabelRecord = {
    relabel_version: INTERPRETATION_RELABEL_VERSION,
    reason: INTERPRETATION_RELABEL_REASON,
    reinterpreted_at: new Date().toISOString(),
    previous_profile_record_id: before ? profileRecordIdentity(before.id) : null,
    previous_label: before ? labelOf(before) : null,
    previous_interpretation_version: before
      ? readStoredInterpretationV8(before.item_level_evidence)?.prompt_version ?? "earlier"
      : null
  };
  const stored = {
    ...buildStoredInterpretationV8({
      attempt: await attemptContextForSession(unit.assessment_session_db_id),
      model_input: loaded.input,
      output: result.output,
      generation_mode: result.generation_mode,
      fallback_reason: null,
      response_package_id: packageId,
      answer_review_v2: buildEvidenceIntegratedProfileBundle({ response_package_payload: responsePackage.payload }).profile,
      chosen_option_tags: chosenOptionTagsFromPackage(responsePackage.payload),
      output_adjustments: { repairs: result.repairs ?? [], salvage: result.salvage ?? null }
    }),
    relabel
  };
  const profile = await prisma.$transaction(async (tx) => {
    const created = await tx.studentProfile.create({
      data: studentProfileDataV8({ concept_unit_session_db_id: unit.id, based_on_agent_call_db_id: result.agent_call_id, stored }),
      select: profileSelect
    });
    await tx.conceptUnitSession.update({ where: { id: unit.id }, data: { pending_relabel_student_profile_db_id: created.id } });
    return created;
  });
  return { status: "previewed", session_public_id: sessionPublicId, label_now: labelOf(before), label_after: labelOf(profile) };
}

/** Applies every ready preview: instructor views and exports then read their labels from it. */
export async function applyInterpretationRelabels(input: { teacher_user_db_id: string }) {
  const units = (await loadUnits(input.teacher_user_db_id)).filter((unit) => stateOf(unit) === "preview_ready");
  const now = new Date();
  await prisma.$transaction(units.map((unit) => prisma.conceptUnitSession.update({
    where: { id: unit.id },
    data: {
      relabeled_student_profile_db_id: unit.pending_relabel_student_profile!.id,
      relabeled_at: now,
      pending_relabel_student_profile_db_id: null
    }
  })));
  return { applied: units.length };
}

/** Discards the previews that were not applied. The saved reinterpretations stay for audit. */
export async function discardInterpretationRelabelPreviews(input: { teacher_user_db_id: string }) {
  const units = (await loadUnits(input.teacher_user_db_id)).filter((unit) => unit.pending_relabel_student_profile);
  await prisma.$transaction(units.map((unit) => prisma.conceptUnitSession.update({
    where: { id: unit.id },
    data: { pending_relabel_student_profile_db_id: null }
  })));
  return { discarded: units.length };
}

/** Returns every attempt to the labels saved at submission. The reinterpretations stay for audit. */
export async function undoInterpretationRelabels(input: { teacher_user_db_id: string }) {
  const units = (await loadUnits(input.teacher_user_db_id)).filter((unit) => unit.relabeled_student_profile || unit.pending_relabel_student_profile);
  await prisma.$transaction(units.map((unit) => prisma.conceptUnitSession.update({
    where: { id: unit.id },
    data: { relabeled_student_profile_db_id: null, relabeled_at: null, pending_relabel_student_profile_db_id: null }
  })));
  return { returned: units.length };
}
