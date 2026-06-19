import { prisma } from "@/lib/db";
import { TeacherReviewServiceError } from "./errors";
import {
  serializeDate,
  stripInternalKeys,
  summarizeResponsePackagePayload
} from "./serializers";

export async function getTeacherReviewResponsePackages(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: { id: true, session_public_id: true }
  });

  if (!session) {
    throw new TeacherReviewServiceError(
      "not_found",
      "Assessment session was not found.",
      404,
      { session_public_id: sessionPublicId }
    );
  }

  const packages = await prisma.responsePackage.findMany({
    where: {
      concept_unit_session: {
        assessment_session_db_id: session.id
      }
    },
    orderBy: [{ created_at: "asc" }],
    include: {
      concept_unit_session: {
        select: {
          concept_unit: {
            select: {
              concept_unit_public_id: true,
              title: true,
              order_index: true
            }
          }
        }
      }
    }
  });

  return {
    session_public_id: session.session_public_id,
    response_packages: packages.map((responsePackage, index) => ({
      package_type: responsePackage.package_type,
      created_at: serializeDate(responsePackage.created_at),
      concept_unit_public_id:
        responsePackage.concept_unit_session.concept_unit.concept_unit_public_id,
      concept_unit_title: responsePackage.concept_unit_session.concept_unit.title,
      concept_unit_order_index: responsePackage.concept_unit_session.concept_unit.order_index,
      sequence: index + 1,
      package_version: null,
      payload_summary: summarizeResponsePackagePayload(responsePackage.payload),
      payload: stripInternalKeys(responsePackage.payload)
    }))
  };
}
