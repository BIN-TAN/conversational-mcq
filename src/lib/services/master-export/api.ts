import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import type { AppRole } from "@/types/auth";
import { MasterExportServiceError } from "./errors";

export function canAccessMasterExport(role: AppRole) {
  return role === "teacher_researcher";
}

export async function requireMasterExportTeacher() {
  return requireRoleApi("teacher_researcher");
}

export function masterExportRouteError(error: unknown): NextResponse {
  if (error instanceof MasterExportServiceError) {
    return jsonApiError(error.code, error.message, error.status, error.details);
  }

  if (error instanceof z.ZodError) {
    return jsonApiError("validation_failed", "Request validation failed.", 400, {
      issues: error.issues
    });
  }

  console.error(error);

  return jsonApiError("internal_error", "Master export request failed.", 500);
}
