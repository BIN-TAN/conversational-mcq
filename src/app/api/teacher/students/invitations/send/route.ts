import { cookies } from "next/headers";
import { requireStudentAccountTeacher } from "@/lib/services/student-accounts/api";
import { invitationJson, invitationRouteError } from "@/lib/services/student-invitations/api";
import { GMAIL_INVITATION_COOKIE, gmailConfiguration, readGmailConnection } from "@/lib/services/student-invitations/gmail";
import { invitationError, readInvitationRequest } from "@/lib/services/student-invitations/security";
import { invitationRateLimit, sendInvitation } from "@/lib/services/student-invitations/service";

export async function POST(request: Request) {
  const auth = await requireStudentAccountTeacher(); if (!auth.ok) return auth.response;
  try {
    const body = await readInvitationRequest(request, 64000);
    if (!gmailConfiguration()) invitationError("gmail_not_configured", "Gmail sending needs administrator setup.", 503);
    const connection = readGmailConnection((await cookies()).get(GMAIL_INVITATION_COOKIE)?.value, auth.user);
    if (!connection) invitationError("gmail_not_connected", "Connect Gmail before sending these invitations.", 409);
    await invitationRateLimit(auth.user, "send", 300);
    return invitationJson(await sendInvitation(auth.user, connection, body));
  } catch (error) { return invitationRouteError(error); }
}
