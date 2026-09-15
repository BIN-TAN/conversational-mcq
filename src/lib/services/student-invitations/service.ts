import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { verifySecret } from "@/lib/password";
import type { PublicUser } from "@/types/auth";
import { invitationEmail, invitationMessageSchema, invitationTemplateSchema, MAX_CREDENTIAL_CSV_BYTES, MAX_INVITATIONS,
  renderInvitation, type InvitationPreviewResult } from "./contracts";
import { deliverInvitation, gmailConfiguration, type GmailConnection } from "./gmail";
import { invitationDigest, invitationError, readInvitationTicket, signInvitationTicket } from "./security";

const studentFields = { id: true, user_id: true, user_id_normalized: true, display_name: true, email: true, role: true,
  account_status: true, must_change_password: true, created_by_teacher_user_id: true, access_code_hash: true, auth_version: true } as const;
type InvitationStudent = Prisma.UserGetPayload<{ select: typeof studentFields }>;
function deliveryKey(student: InvitationStudent) {
  // Hash the already salted credential hash, never the teacher-supplied plaintext.
  return createHash("sha256").update(JSON.stringify(["login-invitation-v1", student.id, student.email?.trim().toLowerCase(),
    student.access_code_hash, student.auth_version])).digest("hex");
}
function eligible(student: InvitationStudent | null, teacher: PublicUser): student is InvitationStudent {
  return Boolean(student && student.role === "student" && student.account_status === "active" && student.must_change_password &&
    student.access_code_hash && student.created_by_teacher_user_id === teacher.user_db_id);
}
export async function assertInvitationTeacher(teacher: PublicUser, db: PrismaClient = prisma) {
  const current = await db.user.findFirst({ where: { id: teacher.user_db_id, role: "teacher_researcher", account_status: "active", auth_version: teacher.auth_version } });
  if (!current) invitationError("invitation_forbidden", "Sign in with an active teacher account.", 403);
  return current;
}
export async function invitationRateLimit(teacher: PublicUser, scope: string, limit: number, db: PrismaClient = prisma) {
  const now = new Date(); const window = new Date(now); window.setUTCMinutes(0, 0, 0);
  const scopeHash = createHash("sha256").update(teacher.user_db_id).digest("hex");
  const record = await db.accountSecurityRateLimit.upsert({
    where: { scope_scope_hash_window_start: { scope: `login_invitation_${scope}`, scope_hash: scopeHash, window_start: window } },
    create: { scope: `login_invitation_${scope}`, scope_hash: scopeHash, window_start: window, request_count: 1, last_request_at: now },
    update: { request_count: { increment: 1 }, last_request_at: now }
  });
  if (record.request_count > limit) invitationError("invitation_rate_limited", "Too many requests. Please try again later.", 429);
}
export async function invitationConfig(teacher: PublicUser, connection: GmailConnection | null, db: PrismaClient = prisma) {
  const current = await assertInvitationTeacher(teacher, db);
  const email = invitationEmail.safeParse(process.env.STUDENT_INVITATION_CONTACT_EMAIL || current.email || "");
  return { gmail_client_id: gmailConfiguration()?.clientId ?? null, gmail_email: connection?.email ?? null,
    default_email: email.success ? email.data : "", instructor_name: current.display_name || "Course instructor",
    login_url: new URL("/student/login", getServerEnv().APP_BASE_URL).href,
    pending_count: await db.user.count({ where: { role: "student", account_status: "active", must_change_password: true,
      created_by_teacher_user_id: teacher.user_db_id } }) };
}

export function parseInvitationCredentials(csv: string) {
  if (Buffer.byteLength(csv, "utf8") > MAX_CREDENTIAL_CSV_BYTES) invitationError("credential_csv_too_large", "Use a credential CSV no larger than 256 KB.");
  let rows: string[][];
  try { rows = parse(csv, { bom: true, skip_empty_lines: true, max_record_size: 12000, to: MAX_INVITATIONS + 2 }) as string[][]; }
  catch { invitationError("credential_csv_invalid", "The credential CSV could not be read. Check its headers and quoted fields."); }
  const headers = rows[0]?.map(value => value.trim().toLowerCase()) ?? [];
  if (new Set(headers).size !== headers.length || !headers.includes("user_id") || !headers.includes("email") ||
      (!headers.includes("temporary_password") && !headers.includes("temporary_access_code"))) {
    invitationError("credential_csv_headers", "The CSV needs user_id, email, and temporary_password (or temporary_access_code) columns.");
  }
  if (rows.length < 2 || rows.length > MAX_INVITATIONS + 1) invitationError("credential_csv_count", "Upload between 1 and 100 credential rows.");
  const ids = new Set<string>();
  return rows.slice(1).map(row => {
    const field = (name: string) => row[headers.indexOf(name)] ?? "";
    const id = field("user_id").trim();
    const normalized = id.toLowerCase();
    const password = field("temporary_password") || field("temporary_access_code");
    if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id) || !password || password.length > 128 || /[\u0000-\u001f\u007f]/.test(password)) {
      invitationError("credential_csv_values", "Each row needs a valid username and temporary password.");
    }
    if (ids.has(normalized)) invitationError("credential_csv_duplicate", "A username appears more than once. Remove duplicate rows.");
    ids.add(normalized);
    return { user_id: id, normalized, email: invitationEmail.parse(field("email")), password };
  });
}
const previewSchema = z.object({ csv_text: z.string().min(1), template: invitationTemplateSchema }).strict();
const ticketSchema = z.object({ teacher_id: z.string().uuid(), auth_version: z.number().int(), student_id: z.string().uuid(),
  delivery_key: z.string().length(64), message_digest: z.string().length(64), expires_at: z.number() }).strict();
export async function previewInvitations(teacher: PublicUser, raw: unknown, db: PrismaClient = prisma): Promise<InvitationPreviewResult> {
  await assertInvitationTeacher(teacher, db);
  const input = previewSchema.parse(raw);
  const rows = parseInvitationCredentials(input.csv_text);
  const students = await db.user.findMany({ where: { user_id_normalized: { in: rows.map(row => row.normalized) },
    created_by_teacher_user_id: teacher.user_db_id, role: "student" }, select: studentFields });
  const byId = new Map(students.map(student => [student.user_id_normalized, student]));
  const receipts = await db.studentLoginInvitation.findMany({ where: { delivery_key: { in: students.map(deliveryKey) } } });
  const byKey = new Map(receipts.map(receipt => [receipt.delivery_key, receipt]));
  const expiresAt = Date.now() + 15 * 60_000;
  const result: InvitationPreviewResult = { invitations: [], excluded: [], expires_at: new Date(expiresAt).toISOString() };
  const emails = new Set<string>();
  for (const row of rows) {
    const student = byId.get(row.normalized) ?? null;
    let reason: string | null = null;
    if (!eligible(student, teacher)) reason = "Not an active pending account managed by you.";
    else if (student.email?.trim().toLowerCase() !== row.email) reason = "CSV email does not match the student account.";
    else if (!await verifySecret(row.password, student.access_code_hash)) reason = "Temporary password does not match the current account.";
    if (reason || !student) { result.excluded.push({ user_id: row.user_id, reason: reason ?? "Account unavailable." }); continue; }
    if (emails.has(row.email)) invitationError("credential_recipient_duplicate", "Two selected students share an email address. Correct the account emails before preparing invitations.");
    emails.add(row.email);
    const message = renderInvitation(input.template, row.email, { student_name: student.display_name || student.user_id,
      username: student.user_id, temporary_password: row.password, login_url: new URL("/student/login", getServerEnv().APP_BASE_URL).href,
      instructor_email: input.template.sender_email, instructor_name: input.template.instructor_name });
    const key = deliveryKey(student); const receipt = byKey.get(key);
    const status = receipt?.status === "sending" && receipt.updated_at.getTime() < Date.now() - 90_000 ? "unknown" : receipt?.status ?? "ready";
    result.invitations.push({ user_id: student.user_id, display_name: student.display_name || student.user_id, message,
      masked_body: message.body.split(row.password).join("[hidden]"),
      status: status as typeof result.invitations[number]["status"], ticket: signInvitationTicket({
        teacher_id: teacher.user_db_id, auth_version: teacher.auth_version, student_id: student.id, delivery_key: key,
        message_digest: invitationDigest(message), expires_at: expiresAt
      }) });
  }
  return result;
}

const sendSchema = z.object({ ticket: z.string().min(1).max(3000), message: invitationMessageSchema, confirmed: z.literal(true) }).strict();
export async function sendInvitation(teacher: PublicUser, connection: GmailConnection, raw: unknown,
  db: PrismaClient = prisma, deliver = deliverInvitation) {
  await assertInvitationTeacher(teacher, db);
  const input = sendSchema.parse(raw); const ticket = ticketSchema.safeParse(readInvitationTicket(input.ticket));
  if (!ticket.success || ticket.data.teacher_id !== teacher.user_db_id || ticket.data.auth_version !== teacher.auth_version ||
      ticket.data.expires_at < Date.now() || ticket.data.message_digest !== invitationDigest(input.message)) {
    invitationError("invitation_preview_expired", "Prepare the email preview again before sending.", 409);
  }
  if (connection.teacher_id !== teacher.user_db_id || connection.auth_version !== teacher.auth_version ||
      connection.expires_at <= Date.now() + 30_000 || connection.email !== input.message.from) {
    invitationError("gmail_account_mismatch", "Connect the Gmail account shown in the preview before sending.", 409);
  }
  const student = await db.user.findUnique({ where: { id: ticket.data.student_id }, select: studentFields });
  if (!eligible(student, teacher) || deliveryKey(student) !== ticket.data.delivery_key || student.email?.trim().toLowerCase() !== input.message.to) {
    invitationError("invitation_account_changed", "This account or its password changed. Prepare a new preview.", 409);
  }
  const key = ticket.data.delivery_key;
  let claimed = false;
  try {
    await db.studentLoginInvitation.create({ data: { delivery_key: key, student_db_id: student.id, teacher_db_id: teacher.user_db_id,
      sender_email: connection.email, recipient_email: input.message.to, message_digest: ticket.data.message_digest, status: "sending" } });
    claimed = true;
  } catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error; }
  if (!claimed) {
    // Only an explicit new confirmation may retry a definite rejection, never an ambiguous delivery.
    const updated = await db.studentLoginInvitation.updateMany({ where: { delivery_key: key, status: "failed", attempt_count: { lt: 3 } },
      data: { status: "sending", sender_email: connection.email, message_digest: ticket.data.message_digest,
        attempt_count: { increment: 1 }, failure_code: null } });
    if (!updated.count) {
      const existing = await db.studentLoginInvitation.findUniqueOrThrow({ where: { delivery_key: key } });
      return { status: existing.status === "sending" && existing.updated_at.getTime() < Date.now() - 90_000 ? "unknown" : existing.status,
        already_processed: true, failure_code: existing.attempt_count >= 3 && existing.status === "failed" ? "retry_limit_reached" : existing.failure_code };
    }
  }
  let result: Awaited<ReturnType<typeof deliverInvitation>>;
  try { result = await deliver(connection, input.message, key); }
  catch { result = { status: "unknown", provider_message_id: null, failure_code: "gmail_delivery_uncertain" }; }
  try { await db.studentLoginInvitation.update({ where: { delivery_key: key }, data: result }); }
  catch { return { status: "unknown", already_processed: false, failure_code: "receipt_persistence_uncertain" }; }
  return { status: result.status, already_processed: false, failure_code: result.failure_code };
}
