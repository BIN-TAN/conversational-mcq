import { NextResponse } from "next/server";

// F-A3 (DESIGN_ALIGNMENT_2026-10-17.md): the free-text initial-administration route is
// retired. The student page never calls it; initial answers go through the item
// option/reasoning/confidence routes. src/middleware.ts also answers 410 here; this
// handler keeps the route closed even if the middleware matcher changes.
function retired() {
  return NextResponse.json(
    { error: { code: "route_retired", message: "This endpoint is no longer available." } },
    { status: 410 }
  );
}

export const GET = retired;
export const POST = retired;
