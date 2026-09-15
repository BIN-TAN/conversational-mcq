import { NextResponse } from "next/server";
import { z } from "zod";
import { StudentAccountServiceError } from "@/lib/services/student-accounts/errors";
import { logProductionError } from "@/lib/observability/production-safe-logger";

export function invitationJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
}
export function invitationRouteError(error: unknown) {
  if (error instanceof StudentAccountServiceError) return invitationJson({ error: { code: error.code, message: error.message } }, error.status);
  // Never serialize validation inputs or provider error bodies: they may contain credentials.
  if (error instanceof z.ZodError) return invitationJson({ error: { code: "invitation_invalid", message: "Check the email addresses, required merge fields and file format." } }, 400);
  logProductionError(error, { safe_error_code: "student_invitation_error" });
  return invitationJson({ error: { code: "invitation_failed", message: "The invitation request could not complete. Refresh the preview to check its status before trying again." } }, 500);
}
