import assert from "node:assert/strict";
import { PrismaClient, type User } from "@prisma/client";
import { stringify } from "csv-stringify/sync";
import { hashSecret } from "../src/lib/password";
import type { PublicUser } from "../src/types/auth";
import { assertLocalAttemptTest } from "./attempt-policy-fixture";
import { DEFAULT_INVITATION_BODY, DEFAULT_INVITATION_SUBJECT, invitationTemplateSchema, renderInvitation } from "../src/lib/services/student-invitations/contracts";
import { connectInvitationGmail, deliverInvitation, invitationMime, readGmailConnection, type GmailConnection } from "../src/lib/services/student-invitations/gmail";
import { invitationDigest, openInvitationValue, readInvitationRequest, readInvitationTicket, sealInvitationValue, signInvitationTicket } from "../src/lib/services/student-invitations/security";
import { invitationConfig, parseInvitationCredentials, previewInvitations, sendInvitation } from "../src/lib/services/student-invitations/service";

assertLocalAttemptTest();
const db = new PrismaClient();
const pass = "OnlySyntheticPassword123!";
const prefix = `invitations_${Date.now()}`;
let checks = 0;
async function check(name: string, task: () => unknown | Promise<unknown>) { await task(); checks++; console.log(`PASS ${name}`); }
const template = { sender_email: "teacher@example.edu", instructor_name: "Test Instructor", subject: DEFAULT_INVITATION_SUBJECT, body: DEFAULT_INVITATION_BODY };
const accounts: string[] = [];
async function main() {
try {
  const before = { sessions: await db.assessmentSession.count(), events: await db.processEvent.count(), calls: await db.agentCall.count() };
  const teacherRow = await db.user.create({ data: { user_id: `${prefix}_teacher`, user_id_normalized: `${prefix}_teacher`, role: "teacher_researcher", display_name: "Test Instructor", email: template.sender_email } });
  accounts.push(teacherRow.id);
  const teacher: PublicUser = { user_db_id: teacherRow.id, user_id: teacherRow.user_id, role: "teacher_researcher", auth_version: 1 };
  const otherRow = await db.user.create({ data: { user_id: `${prefix}_other`, user_id_normalized: `${prefix}_other`, role: "teacher_researcher" } }); accounts.push(otherRow.id);
  const other: PublicUser = { ...teacher, user_db_id: otherRow.id, user_id: otherRow.user_id };
  const students: User[] = [];
  for (let n = 0; n < 10; n++) {
    const user = await db.user.create({ data: { user_id: `${prefix}_s${n}`, user_id_normalized: `${prefix}_s${n}`, role: "student",
      email: `student${n}@example.edu`, display_name: n === 0 ? "Student, Example" : `Student ${n}`,
      created_by_teacher_user_id: teacherRow.id, must_change_password: true, access_code_hash: await hashSecret(pass) } });
    accounts.push(user.id); students.push(user);
  }
  const connection: GmailConnection = { teacher_id: teacherRow.id, auth_version: 1, email: template.sender_email, access_token: "synthetic-token-not-real", expires_at: Date.now() + 600_000 };
  const csvFor = (indexes: number[], password = pass) => stringify(indexes.map(n => ({ user_id: students[n].user_id, display_name: students[n].display_name,
    email: students[n].email, temporary_password: password })), { header: true });
  const preview = async (indexes: number[]) => previewInvitations(teacher, { template, csv_text: csvFor(indexes) }, db);
  const send = async (index: number, delivery: typeof deliverInvitation) => {
    const row = (await preview([index])).invitations[0];
    return sendInvitation(teacher, connection, { ticket: row.ticket, message: row.message, confirmed: true }, db, delivery);
  };
  const accepted: typeof deliverInvitation = async () => ({ status: "sent", provider_message_id: "synthetic-gmail-id", failure_code: null });
  await check("CSV preserves credentials and quoted display names", () => {
    const rows = parseInvitationCredentials(csvFor([0, 1])); assert.equal(rows.length, 2); assert.equal(rows[0].password, pass);
    const alias = csvFor([0]).replace("temporary_password", "temporary_access_code"); assert.equal(parseInvitationCredentials(alias)[0].password, pass);
  });
  await check("CSV rejects duplicates, invalid email, bad headers and row limits", () => {
    for (const csv of [csvFor([0, 0]), csvFor([0]).replace("student0@example.edu", "student0@example.edu;other@example.edu"), "user_id,email\nx,x@example.edu",
      `${csvFor([0]).repeat(101)}`, "a".repeat(300000)]) assert.throws(() => parseInvitationCredentials(csv));
  });
  await check("templates require credential fields and reject unknown fields or subject credentials", () => {
    assert(invitationTemplateSchema.safeParse(template).success);
    for (const edit of [{ body: "{{unknown}}" }, { subject: "{{temporary_password}}" }, { subject: "Title\r\nBcc: other@example.edu" }, { body: DEFAULT_INVITATION_BODY + "{" }]) {
      assert(!invitationTemplateSchema.safeParse({ ...template, ...edit }).success);
    }
  });
  await check("MIME has one recipient, preserves Unicode and cannot inject headers", () => {
    const message = renderInvitation(template, "one@example.edu", { student_name: "Synthetic \u00c9tudiant", username: "one", temporary_password: pass,
      login_url: "https://example.edu/student/login", instructor_email: template.sender_email, instructor_name: "Teacher" });
    const mime = Buffer.from(invitationMime({ ...message, subject: "\u00c9".repeat(120) }, "a".repeat(64)), "base64url").toString();
    assert.equal(mime.match(/^To:/gm)?.length, 1); assert(!/^Bcc:|^Cc:/m.test(mime));
    assert(mime.split("\r\n").every(line => line.length < 998));
    const body = Buffer.from(mime.split("\r\n\r\n")[1].replaceAll("\r\n", ""), "base64").toString(); assert(body.includes(pass)); assert(body.includes("\u00c9tudiant"));
    assert.throws(() => invitationMime({ ...message, to: "one@example.edu\r\nBcc: another@example.edu" }, "a".repeat(64)));
  });
  await check("preview checks current password, ownership, email and pending status without writing receipts", async () => {
    const result = await preview([0, 1]); assert.equal(result.invitations.length, 2); assert(!result.invitations[0].masked_body.includes(pass));
    assert.equal(await db.studentLoginInvitation.count({ where: { teacher_db_id: teacherRow.id } }), 0);
    assert.equal((await previewInvitations(other, { template, csv_text: csvFor([0]) }, db)).excluded.length, 1);
    assert.equal((await previewInvitations(teacher, { template, csv_text: csvFor([0], "WrongPassword123!") }, db)).excluded.length, 1);
    assert.equal((await previewInvitations(teacher, { template, csv_text: csvFor([0]).replace("student0@example.edu", "wrong@example.edu") }, db)).excluded.length, 1);
    await db.user.update({ where: { id: students[9].id }, data: { must_change_password: false } });
    assert.equal((await preview([9])).excluded.length, 1);
  });
  await check("masking survives edited labels and repeated password fields", async () => {
    const result = await previewInvitations(teacher, { template: { ...template, body: template.body.replace("Temporary password:", "Access:") + "\n{{temporary_password}}" }, csv_text: csvFor([0]) }, db);
    assert(!result.invitations[0].masked_body.includes(pass)); assert.equal(result.invitations[0].masked_body.match(/\[hidden\]/g)?.length, 2);
  });
  await check("encrypted Gmail session binds teacher, auth version and expiry", () => {
    const cookie = sealInvitationValue(connection); assert(!cookie.includes(connection.access_token));
    assert.deepEqual(readGmailConnection(cookie, teacher), connection); assert.equal(readGmailConnection(cookie, other), null);
    assert.equal(readGmailConnection(cookie, { ...teacher, auth_version: 2 }), null); assert.equal(readGmailConnection(cookie, teacher, Date.now() + 700000), null);
    assert.equal(openInvitationValue(cookie.slice(0, -5) + "xxxxx"), null);
  });
  await check("Google authorization exchanges code server-side and checks verified email and scope", async () => {
    process.env.GMAIL_CLIENT_ID = "synthetic.apps.googleusercontent.com"; process.env.GMAIL_CLIENT_SECRET = "synthetic-client-secret";
    let calls = 0;
    const transport: typeof fetch = async (url, options) => {
      calls++; assert(!String(url).includes(connection.access_token));
      if (String(url).includes("/token")) { assert(String(options?.body).includes("grant_type=authorization_code")); return Response.json({ access_token: "synthetic", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.send" }); }
      return Response.json({ email: connection.email, verified_email: true });
    };
    const result = await connectInvitationGmail("synthetic-code", teacher, "https://example.edu", transport); assert.equal(result.connection.email, connection.email); assert.equal(calls, 2);
    await assert.rejects(connectInvitationGmail("synthetic-code", teacher, "https://example.edu", async () => Response.json({ access_token: "synthetic", expires_in: 3600, scope: "" })));
    delete process.env.GMAIL_CLIENT_ID; delete process.env.GMAIL_CLIENT_SECRET;
    assert.equal((await invitationConfig(teacher, null, db)).gmail_client_id, null);
  });
  await check("tampered, unapproved, wrong-sender and wrong-teacher requests never send", async () => {
    const row = (await preview([0])).invitations[0]; let calls = 0;
    const delivery: typeof deliverInvitation = async () => { calls++; return accepted(connection, row.message, "x"); };
    for (const raw of [{ ticket: row.ticket, message: row.message, confirmed: false },
      { ticket: row.ticket, message: { ...row.message, to: "other@example.edu" }, confirmed: true },
      { ticket: row.ticket + "x", message: row.message, confirmed: true }]) await assert.rejects(sendInvitation(teacher, connection, raw, db, delivery));
    await assert.rejects(sendInvitation(teacher, { ...connection, email: "other@example.edu" }, { ticket: row.ticket, message: row.message, confirmed: true }, db, delivery));
    await assert.rejects(sendInvitation(other, connection, { ticket: row.ticket, message: row.message, confirmed: true }, db, delivery));
    assert.equal(calls, 0);
  });
  await check("expired previews are rejected", async () => {
    const row = (await preview([0])).invitations[0]; const ticket = readInvitationTicket(row.ticket) as Record<string, unknown>;
    await assert.rejects(sendInvitation(teacher, connection, { ticket: signInvitationTicket({ ...ticket, expires_at: 1 }), message: row.message, confirmed: true }, db, accepted));
  });
  await check("concurrent sends and newly prepared duplicate drafts send once", async () => {
    const row = (await preview([0])).invitations[0]; let calls = 0;
    const delivery: typeof deliverInvitation = async () => { calls++; await new Promise(done => setTimeout(done, 80)); return { status: "sent", provider_message_id: "one-only", failure_code: null }; };
    const input = { ticket: row.ticket, message: row.message, confirmed: true };
    await Promise.all([sendInvitation(teacher, connection, input, db, delivery), sendInvitation(teacher, connection, input, db, delivery)]);
    const again = (await preview([0])).invitations[0]; assert.equal(again.status, "sent");
    await sendInvitation(teacher, connection, { ...input, ticket: again.ticket }, db, delivery); assert.equal(calls, 1);
  });
  await check("definite rejection needs explicit retry and stops after three requests", async () => {
    let calls = 0; const delivery: typeof deliverInvitation = async () => { calls++; return { status: "failed", provider_message_id: null, failure_code: "gmail_rejected_429" }; };
    for (let n = 0; n < 4; n++) await send(1, delivery); assert.equal(calls, 3);
  });
  await check("ambiguous delivery and worker interruption cannot automatically resend", async () => {
    let calls = 0; const delivery: typeof deliverInvitation = async () => { calls++; throw new Error("synthetic timeout"); };
    assert.equal((await send(2, delivery)).status, "unknown"); await send(2, delivery); assert.equal(calls, 1);
    const row = (await preview([3])).invitations[0]; const ticket = readInvitationTicket(row.ticket) as { delivery_key: string };
    await db.studentLoginInvitation.create({ data: { delivery_key: ticket.delivery_key, student_db_id: students[3].id, teacher_db_id: teacherRow.id,
      sender_email: template.sender_email, recipient_email: students[3].email!, message_digest: invitationDigest(row.message), status: "sending", updated_at: new Date(Date.now() - 120000) } });
    assert.equal((await preview([3])).invitations[0].status, "unknown"); await send(3, delivery); assert.equal(calls, 1);
  });
  await check("password resets and account deactivation invalidate reviewed credentials", async () => {
    for (const [index, update] of [[4, { access_code_hash: await hashSecret("NewSyntheticPassword123!") }], [5, { account_status: "inactive" as const }]] as const) {
      const row = (await preview([index])).invitations[0]; await db.user.update({ where: { id: students[index].id }, data: update });
      await assert.rejects(sendInvitation(teacher, connection, { ticket: row.ticket, message: row.message, confirmed: true }, db, accepted));
    }
  });
  await check("duplicate recipient addresses are rejected", async () => {
    await db.user.update({ where: { id: students[7].id }, data: { email: students[6].email } });
    await assert.rejects(previewInvitations(teacher, { template, csv_text: csvFor([6, 7]).replace("student7@example.edu", "student6@example.edu") }, db));
  });
  await check("transport treats rate errors as failed and timeout or server errors as uncertain", async () => {
    const message = (await preview([6])).invitations[0].message;
    for (const [http, expected] of [[200, "sent"], [401, "failed"], [403, "failed"], [429, "failed"], [500, "unknown"]] as const) {
      const result = await deliverInvitation(connection, message, "a".repeat(64), async (url, options) => {
        assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
        const raw = JSON.parse(String(options?.body)).raw; const mime = Buffer.from(raw, "base64url").toString(); assert(mime.includes("To: student6@example.edu"));
        return Response.json(http === 200 ? { id: "synthetic" } : { error: "not logged" }, { status: http });
      }); assert.equal(result.status, expected);
    }
  });
  await check("request origin, custom header and size are enforced", async () => {
    const url = new URL("/api/teacher/students/invitations/preview", process.env.APP_BASE_URL);
    const headers = { origin: url.origin, "content-type": "application/json", "x-invitation-request": "1" };
    assert.deepEqual(await readInvitationRequest(new Request(url, { method: "POST", headers, body: "{}" })), {});
    assert.deepEqual(await readInvitationRequest(new Request("http://internal-proxy:8080/api/teacher/students/invitations/preview", { method: "POST", headers, body: "{}" })), {});
    await assert.rejects(readInvitationRequest(new Request(url, { method: "POST", headers: { ...headers, origin: "https://attacker.example" }, body: "{}" })));
    await assert.rejects(readInvitationRequest(new Request(url, { method: "POST", headers, body: '"aaaaaaaa"' }), 3));
  });
  await check("receipts contain no plaintext password, email body or Gmail token; research records unchanged", async () => {
    const records = JSON.stringify(await db.studentLoginInvitation.findMany({ where: { teacher_db_id: teacherRow.id } }));
    assert(!records.includes(pass)); assert(!records.includes(connection.access_token)); assert(!records.includes("Your assessment account is ready"));
    assert.deepEqual({ sessions: await db.assessmentSession.count(), events: await db.processEvent.count(), calls: await db.agentCall.count() }, before);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: students[0].id } })).access_code_hash, students[0].access_code_hash);
  });
  console.log(`${checks} invitation checks passed. Google calls mocked; no emails, real credentials or provider calls used.`);
} finally {
  await db.user.deleteMany({ where: { id: { in: accounts } } });
  await db.$disconnect();
}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
