import { NextResponse } from "next/server";

/**
 * Retired routes (F-A3, audit F12; docs/DESIGN_ALIGNMENT_2026-10-17.md).
 *
 * The free-text initial-response route (POST /api/student/sessions/:id/initial/messages)
 * was not used by the student interface but could still overwrite saved reasoning
 * through direct API calls. It is answered here with 410 so the route handler never
 * runs. Answers, reasoning, confidence and alternative-option reasoning are collected
 * only through the item routes.
 */
export function middleware() {
  return NextResponse.json(
    {
      error: {
        code: "route_retired",
        message: "This response route is no longer available. Refresh the page to continue.",
        details: {}
      }
    },
    { status: 410 }
  );
}

export const config = {
  matcher: ["/api/student/sessions/:sessionPublicId/initial/messages"]
};
