import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import { buildAnalysisReadyResearchDataBundle } from "@/lib/services/teacher-research-data/analysis-ready-export";

function params(request: Request) {
  const url = new URL(request.url);
  const assessmentPublicId = url.searchParams.get("assessment_public_id")?.trim() || undefined;
  const studentUserId = url.searchParams.get("student_id")?.trim() || undefined;
  const sessionPublicId = url.searchParams.get("session_public_id")?.trim() || undefined;
  const includeIncomplete = url.searchParams.get("include_incomplete_sessions") !== "false";
  const includeRestricted = url.searchParams.get("include_restricted_fields") === "true";
  const confirmRestricted = url.searchParams.get("confirm_restricted_fields") === "true";
  if (includeRestricted && !confirmRestricted) {
    throw new ContentServiceError(
      "validation_failed",
      "Restricted research fields require explicit confirmation.",
      400,
      { include_restricted_fields: true, confirm_restricted_fields: false }
    );
  }
  const scope =
    sessionPublicId
      ? "selected_session"
      : assessmentPublicId
        ? "selected_assessment"
        : studentUserId
          ? "selected_student"
          : "all_authorized";

  return {
    scope,
    assessment_public_id: assessmentPublicId,
    student_user_id: studentUserId,
    session_public_id: sessionPublicId,
    include_incomplete_sessions: includeIncomplete,
    include_restricted_fields: includeRestricted
  } as const;
}

export async function GET(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: auth.user.user_db_id,
      ...params(request)
    });
    if (result.restricted_fields_included) {
      await prisma.exportJob.create({
        data: {
          requested_by_user_db_id: auth.user.user_db_id,
          status: "completed",
          file_name: result.filename,
          row_count: Object.values(result.row_counts).reduce((total, count) => total + count, 0),
          export_schema_version: result.source.export_schema_version,
          completed_at: new Date(),
          options: {
            export_type: "research_dataset",
            restricted_fields_included: true,
            explicit_confirmation_received: true,
            export_run_public_id: result.source.export_run_public_id,
            export_scope: result.source.export_scope,
            selected_assessment_public_id: result.source.selected_assessment_public_id || null,
            selected_student_id: result.source.selected_student_id || null,
            selected_session_public_id: result.source.selected_session_public_id || null
          }
        }
      });
    }

    return new NextResponse(result.buffer, {
      headers: {
        "Content-Type": result.content_type,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return contentRouteError(error);
  }
}
