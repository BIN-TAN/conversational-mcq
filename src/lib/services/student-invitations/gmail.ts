import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import type { PublicUser } from "@/types/auth";
import { invitationEmail, invitationMessageSchema, type InvitationMessage } from "./contracts";
import { invitationError, openInvitationValue, sealInvitationValue } from "./security";

export const GMAIL_INVITATION_COOKIE = "cmcq_invitation_gmail";
export const GMAIL_INVITATION_COOKIE_PATH = "/api/teacher/students/invitations";
export const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email";
const connectionSchema = z.object({ teacher_id: z.string().uuid(), auth_version: z.number().int(), email: invitationEmail,
  access_token: z.string().min(1).max(2048), expires_at: z.number() });
export type GmailConnection = z.infer<typeof connectionSchema>;
export function gmailConfiguration() {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const secret = process.env.GMAIL_CLIENT_SECRET?.trim();
  return clientId && secret && clientId.endsWith(".apps.googleusercontent.com") ? { clientId, secret } : null;
}
export function readGmailConnection(cookie: string | undefined, teacher: PublicUser, now = Date.now()) {
  const parsed = connectionSchema.safeParse(cookie ? openInvitationValue(cookie) : null);
  return parsed.success && parsed.data.teacher_id === teacher.user_db_id && parsed.data.auth_version === teacher.auth_version &&
    parsed.data.expires_at > now + 30_000 ? parsed.data : null;
}
export async function connectInvitationGmail(code: string, teacher: PublicUser, origin: string, transport = fetch) {
  const config = gmailConfiguration();
  if (!config) invitationError("gmail_not_configured", "Gmail sending needs administrator setup. Email previews are still available.", 503);
  let connection: GmailConnection;
  try {
    const response = await transport("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.secret,
        redirect_uri: origin, grant_type: "authorization_code" }) });
    if (!response.ok) throw new Error("authorization_failed");
    const token = z.object({ access_token: z.string().min(1).max(2048), expires_in: z.number().positive(), scope: z.string() }).parse(await response.json());
    if (!token.scope.split(" ").includes("https://www.googleapis.com/auth/gmail.send")) throw new Error("send_permission_missing");
    const identity = await transport("https://www.googleapis.com/oauth2/v2/userinfo", { cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
    if (!identity.ok) throw new Error("identity_failed");
    const user = z.object({ email: invitationEmail, verified_email: z.literal(true) }).parse(await identity.json());
    connection = { teacher_id: teacher.user_db_id, auth_version: teacher.auth_version, email: user.email,
      access_token: token.access_token, expires_at: Date.now() + Math.min(token.expires_in, 3600) * 1000 };
  } catch { invitationError("gmail_connection_failed", "Google authorization did not complete. Check the selected account and Gmail permission, then reconnect.", 400); }
  return { connection, cookie: sealInvitationValue(connection) };
}
export function invitationMime(message: InvitationMessage, messageId: string) {
  const parsed = invitationMessageSchema.parse(message);
  if (!/^[a-f0-9]{64}$/.test(messageId)) throw new Error("invalid_message_id");
  const words: string[] = [];
  let part = "";
  for (const character of parsed.subject) {
    if (Buffer.byteLength(part + character) > 42) { words.push(part); part = ""; }
    part += character;
  }
  if (part) words.push(part);
  const subject = words.map(word => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
  const body = Buffer.from(parsed.body.replace(/\r?\n/g, "\r\n")).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  return Buffer.from([
    `From: ${parsed.from}`, `To: ${parsed.to}`, `Reply-To: ${parsed.from}`, `Subject: ${subject}`,
    `Message-ID: <${messageId}@${new URL(getServerEnv().APP_BASE_URL).hostname}>`,
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", body
  ].join("\r\n")).toString("base64url");
}
export async function deliverInvitation(connection: GmailConnection, message: InvitationMessage, key: string, transport = fetch) {
  try {
    const response = await transport("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${connection.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: invitationMime(message, key) })
    });
    if (response.ok) {
      const result = z.object({ id: z.string().min(1).max(200) }).safeParse(await response.json());
      return result.success ? { status: "sent" as const, provider_message_id: result.data.id, failure_code: null } :
        { status: "unknown" as const, provider_message_id: null, failure_code: "gmail_receipt_missing" };
    }
    const definiteFailure = [400, 401, 403, 404, 413, 429].includes(response.status);
    return { status: definiteFailure ? "failed" as const : "unknown" as const, provider_message_id: null,
      failure_code: definiteFailure ? `gmail_rejected_${response.status}` : "gmail_delivery_uncertain" };
  } catch { return { status: "unknown" as const, provider_message_id: null, failure_code: "gmail_delivery_uncertain" }; }
}
