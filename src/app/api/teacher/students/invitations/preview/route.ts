import { requireStudentAccountTeacher } from "@/lib/services/student-accounts/api";
import { invitationJson, invitationRouteError } from "@/lib/services/student-invitations/api";
import { readInvitationRequest } from "@/lib/services/student-invitations/security";
import { invitationRateLimit, previewInvitations } from "@/lib/services/student-invitations/service";

export async function POST(request: Request) {
  const auth = await requireStudentAccountTeacher(); if (!auth.ok) return auth.response;
  try {
    const body = await readInvitationRequest(request);
    await invitationRateLimit(auth.user, "preview", 30);
    return invitationJson(await previewInvitations(auth.user, body));
  } catch (error) { return invitationRouteError(error); }
}
