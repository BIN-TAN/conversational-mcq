import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { StudentAccountServiceError } from "@/lib/services/student-accounts/errors";

export function invitationError(code: string, message: string, status = 400): never {
  throw new StudentAccountServiceError(code, message, status);
}
function key(purpose: string) {
  return createHmac("sha256", getServerEnv().SESSION_SECRET).update(`student-invitations-v1:${purpose}`).digest();
}
export function invitationDigest(value: unknown) {
  return createHmac("sha256", key("digest")).update(JSON.stringify(value)).digest("hex");
}
export function sealInvitationValue(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("encryption"), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openInvitationValue(value: string): unknown {
  try {
    const bytes = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key("encryption"), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  } catch { return null; }
}
export function signInvitationTicket(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", key("ticket")).update(payload).digest("base64url")}`;
}
export function readInvitationTicket(ticket: string): unknown {
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", key("ticket")).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
}

export async function readInvitationRequest(request: Request, maxBytes = 300 * 1024) {
  // Next may expose an internal host behind a proxy; trust only the configured public origin.
  const expected = new URL(getServerEnv().APP_BASE_URL).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("x-invitation-request") !== "1" ||
      !request.headers.get("content-type")?.startsWith("application/json")) {
    invitationError("invitation_origin_invalid", "Reload this page before continuing.", 403);
  }
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) invitationError("invitation_request_too_large", "The upload is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) invitationError("invitation_request_invalid", "Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); invitationError("invitation_request_too_large", "The upload is too large.", 413); }
    chunks.push(result.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { invitationError("invitation_request_invalid", "Request must contain valid JSON."); }
}
