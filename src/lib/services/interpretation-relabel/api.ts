import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { logProductionError } from "@/lib/observability/production-safe-logger";

export async function requireRelabelTeacher() {
  return requireRoleApi("teacher_researcher");
}

export const relabelNextBodySchema = z.object({
  skip: z.array(z.string().min(1).max(200)).max(500).default([])
}).strict();

export function relabelRouteError(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return jsonApiError("validation_failed", "The request could not be read. Reload the page and try again.", 400);
  }
  logProductionError(error, { safe_error_code: "interpretation_relabel_route_unhandled_error" });
  return jsonApiError("internal_error", "The update could not be completed. Reload the page and try again.", 500);
}
