import { prisma } from "@/lib/db";
import { buildItemVerificationFingerprintPayload } from "./input-builder";
import { hashVerificationContent } from "./fingerprint";

export type VerificationPublicationPolicy =
  | { allowed: true; reason: "current_no_warnings" | "warnings_acknowledged" | "teacher_confirmed_without_current_verification" }
  | { allowed: false; reason: "warnings_need_acknowledgement" | "current_verification_missing_or_stale" };

export async function getVerificationPublicationPolicy(input: {
  concept_unit_db_id: string;
  teacher_confirmed_without_current_verification?: boolean;
}): Promise<VerificationPublicationPolicy & { content_fingerprint?: string }> {
  const conceptUnit = await prisma.conceptUnit.findUnique({
    where: { id: input.concept_unit_db_id },
    include: {
      latest_item_verification_run: true,
      items: {
        where: {
          status: { not: "archived" },
          included_in_published_set: true
        },
        orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
      }
    }
  });

  if (!conceptUnit) {
    return { allowed: false, reason: "current_verification_missing_or_stale" };
  }

  const contentFingerprint = hashVerificationContent(
    buildItemVerificationFingerprintPayload({
      conceptUnit,
      items: conceptUnit.items
    })
  );
  const latest = conceptUnit.latest_item_verification_run;

  if (
    latest?.status === "completed" &&
    latest.content_fingerprint === contentFingerprint
  ) {
    if (latest.warning_count === 0) {
      return { allowed: true, reason: "current_no_warnings", content_fingerprint: contentFingerprint };
    }

    if (latest.acknowledged_at) {
      return { allowed: true, reason: "warnings_acknowledged", content_fingerprint: contentFingerprint };
    }

    return { allowed: false, reason: "warnings_need_acknowledgement", content_fingerprint: contentFingerprint };
  }

  if (input.teacher_confirmed_without_current_verification) {
    return {
      allowed: true,
      reason: "teacher_confirmed_without_current_verification",
      content_fingerprint: contentFingerprint
    };
  }

  return { allowed: false, reason: "current_verification_missing_or_stale", content_fingerprint: contentFingerprint };
}
