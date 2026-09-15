import { cookies } from "next/headers";
import { requireStudentAccountTeacher } from "@/lib/services/student-accounts/api";
import { invitationJson, invitationRouteError } from "@/lib/services/student-invitations/api";
import { GMAIL_INVITATION_COOKIE, readGmailConnection } from "@/lib/services/student-invitations/gmail";
import { invitationConfig } from "@/lib/services/student-invitations/service";

export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await requireStudentAccountTeacher(); if (!auth.ok) return auth.response;
  try {
    return invitationJson(await invitationConfig(auth.user, readGmailConnection((await cookies()).get(GMAIL_INVITATION_COOKIE)?.value, auth.user)));
  } catch (error) { return invitationRouteError(error); }
}
