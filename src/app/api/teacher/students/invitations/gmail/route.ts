import { cookies } from "next/headers";
import { z } from "zod";
import { requireStudentAccountTeacher } from "@/lib/services/student-accounts/api";
import { invitationJson, invitationRouteError } from "@/lib/services/student-invitations/api";
import { connectInvitationGmail, GMAIL_INVITATION_COOKIE, GMAIL_INVITATION_COOKIE_PATH } from "@/lib/services/student-invitations/gmail";
import { readInvitationRequest } from "@/lib/services/student-invitations/security";
import { assertInvitationTeacher, invitationRateLimit } from "@/lib/services/student-invitations/service";

export async function POST(request: Request) {
  const auth = await requireStudentAccountTeacher(); if (!auth.ok) return auth.response;
  try {
    const input = z.object({ code: z.string().min(1).max(4000) }).strict().parse(await readInvitationRequest(request, 6000));
    await assertInvitationTeacher(auth.user);
    await invitationRateLimit(auth.user, "connect", 20);
    const result = await connectInvitationGmail(input.code, auth.user, request.headers.get("origin")!);
    (await cookies()).set(GMAIL_INVITATION_COOKIE, result.cookie, { httpOnly: true, secure: process.env.APP_ENV === "production" || new URL(request.url).protocol === "https:",
      sameSite: "strict", path: GMAIL_INVITATION_COOKIE_PATH, maxAge: Math.max(0, Math.floor((result.connection.expires_at - Date.now()) / 1000)) });
    return invitationJson({ email: result.connection.email });
  } catch (error) { return invitationRouteError(error); }
}
export async function DELETE(request: Request) {
  const auth = await requireStudentAccountTeacher(); if (!auth.ok) return auth.response;
  try {
    await readInvitationRequest(request, 1000);
    (await cookies()).set(GMAIL_INVITATION_COOKIE, "", { httpOnly: true, secure: process.env.APP_ENV === "production" || new URL(request.url).protocol === "https:",
      sameSite: "strict", path: GMAIL_INVITATION_COOKIE_PATH, maxAge: 0 });
    return invitationJson({ disconnected: true });
  } catch (error) { return invitationRouteError(error); }
}
