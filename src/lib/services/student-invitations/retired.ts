import { NextResponse } from "next/server";

// Keep old clients from sending mail after the feature has been retired.
export function retiredInvitationResponse() {
  const response = NextResponse.json(
    { error: { code: "email_sending_removed", message: "In-app email sending is no longer available." } },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
  response.cookies.set("cmcq_invitation_gmail", "", {
    httpOnly: true, sameSite: "strict", secure: process.env.APP_ENV === "production",
    path: "/api/teacher/students/invitations", maxAge: 0
  });
  return response;
}
