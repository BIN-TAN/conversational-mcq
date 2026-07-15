import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { jsonApiError } from "@/lib/http";
import { generatePublicId } from "@/lib/services/ids";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import { storageKeyForExport, writeExportBytes } from "@/lib/services/master-export/storage";
import { buildAnalysisReadyResearchDataBundle } from "@/lib/services/teacher-research-data/analysis-ready-export";
import { getResearchExportReadiness } from "@/lib/services/teacher-research-data/readiness";

function studentScopeFingerprint(studentUserId?: string) {
  if (!studentUserId) return null;
  return createHash("sha256")
    .update(`research_export_selected_student:v1:${studentUserId.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 12);
}

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

function safeJobOptions(input: ReturnType<typeof params>, extra: Record<string, unknown> = {}) {
  return {
    export_type: "research_dataset",
    export_scope: input.scope,
    restricted_fields_included: input.include_restricted_fields === true,
    explicit_confirmation_received: input.include_restricted_fields === true,
    selected_assessment_public_id: input.assessment_public_id || null,
    selected_student_requested: Boolean(input.student_user_id),
    selected_student_id_fingerprint: studentScopeFingerprint(input.student_user_id),
    selected_session_public_id: input.session_public_id || null,
    include_incomplete_sessions: input.include_incomplete_sessions !== false,
    ...extra
  } satisfies Prisma.InputJsonObject;
}

function rowCount(rowCounts: Record<string, number>) {
  return Object.values(rowCounts).reduce((total, count) => total + count, 0);
}

async function createResearchExport(request: Request, teacherUserDbId: string) {
  const requestId = randomUUID();
  const parsed = params(request);
  const exportPublicId = generatePublicId("export");
  const storageKey = storageKeyForExport(exportPublicId, "zip");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const job = await prisma.exportJob.create({
    data: {
      export_public_id: exportPublicId,
      requested_by_user_db_id: teacherUserDbId,
      status: "pending",
      storage_key: storageKey,
      row_count: 0,
      expires_at: expiresAt,
      options: safeJobOptions(parsed, { request_id: requestId })
    }
  });

  try {
    const readiness = await getResearchExportReadiness();
    if (!readiness.ready) {
      const primary = readiness.blocking_reasons[0];
      const code = primary?.code ?? "research_export_not_ready";
      const userMessage =
        code === "research_pseudonymization_key_missing"
          ? "Production research exports require a server-side pseudonymization key."
          : "Research export is not configured.";
      const failed = await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          completed_at: new Date(),
          export_schema_version: readiness.export_schema_version,
          error_message: code,
          options: safeJobOptions(parsed, {
            request_id: requestId,
            failure_code: code,
            retryable: true,
            readiness_state: readiness,
            pseudonymization_version: readiness.pseudonymization_version,
            pseudonymization_key_fingerprint: readiness.safe_key_fingerprint
          })
        }
      });
      return {
        ok: false as const,
        response: jsonApiError(code, userMessage, 503, {
          code,
          user_message: userMessage,
          operator_action: primary?.operator_action ?? "Run research-export:preflight and configure the server.",
          retryable: true,
          request_id: requestId,
          readiness_state: readiness,
          export_job: serializeResearchExportJob(failed)
        })
      };
    }

    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "processing",
        export_schema_version: readiness.export_schema_version,
        options: safeJobOptions(parsed, {
          request_id: requestId,
          pseudonymization_version: readiness.pseudonymization_version,
          pseudonymization_key_fingerprint: readiness.safe_key_fingerprint
        })
      }
    });

    const result = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacherUserDbId,
      ...parsed
    });

    await writeExportBytes(storageKey, result.buffer);
    const completed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        file_name: result.filename,
        row_count: rowCount(result.row_counts),
        export_schema_version: result.source.export_schema_version,
        completed_at: new Date(),
        options: safeJobOptions(parsed, {
          request_id: requestId,
          export_run_public_id: result.source.export_run_public_id,
          pseudonymization_version: readiness.pseudonymization_version,
          pseudonymization_key_fingerprint: readiness.safe_key_fingerprint
        })
      }
    });

    return { ok: true as const, job: serializeResearchExportJob(completed), result };
  } catch (error) {
    const code = error instanceof ContentServiceError ? error.code : "research_export_generation_failed";
    const message = error instanceof Error ? error.message : "Research export generation failed.";
    const failed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        completed_at: new Date(),
        error_message: code,
        options: safeJobOptions(parsed, {
          request_id: requestId,
          failure_code: code,
          retryable: true,
          safe_failure_message: message
        })
      }
    });
    return {
      ok: false as const,
      response: jsonApiError(code, message, error instanceof ContentServiceError ? error.status : 500, {
        code,
        user_message: message,
        operator_action: "Review the failed export job and retry after correction.",
        retryable: true,
        request_id: requestId,
        export_job: serializeResearchExportJob(failed)
      })
    };
  }
}

function serializeResearchExportJob(job: {
  export_public_id: string;
  status: string;
  file_name: string | null;
  row_count: number | null;
  options: unknown;
  export_schema_version: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  error_message: string | null;
}) {
  return {
    export_public_id: job.export_public_id,
    status: job.status,
    file_name: job.file_name,
    row_count: job.row_count,
    options: job.options,
    export_schema_version: job.export_schema_version,
    created_at: job.created_at.toISOString(),
    completed_at: job.completed_at?.toISOString() ?? null,
    expires_at: job.expires_at?.toISOString() ?? null,
    error_message: job.error_message,
    download_url:
      job.status === "completed" ? `/api/teacher/export/${job.export_public_id}/download` : null
  };
}

export async function POST(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const created = await createResearchExport(request, auth.user.user_db_id);
    if (!created.ok) return created.response;
    return NextResponse.json({ export_job: created.job }, { status: 201 });
  } catch (error) {
    return contentRouteError(error);
  }
}

export async function GET(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const created = await createResearchExport(request, auth.user.user_db_id);
    if (!created.ok) return created.response;
    return new NextResponse(created.result.buffer, {
      headers: {
        "Content-Type": created.result.content_type,
        "Content-Disposition": `attachment; filename="${created.result.filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return contentRouteError(error);
  }
}
