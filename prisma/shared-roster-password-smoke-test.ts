import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { hashSecret, verifySecret } from "../src/lib/password";
import { changeStudentPassword, commitRosterImport, previewRosterImport } from "../src/lib/services/student-accounts/service";
import { parseStudentPassword, parseStudentTemporaryPassword } from "../src/lib/services/student-accounts/validation";
import { createSmokeTeacher } from "./account-security-smoke-helpers";
import { GET as retiredConfig } from "../src/app/api/teacher/students/invitations/route";
import { POST as retiredPreview } from "../src/app/api/teacher/students/invitations/preview/route";
import { POST as retiredSend } from "../src/app/api/teacher/students/invitations/send/route";
import { POST as retiredConnect, DELETE as retiredDisconnect } from "../src/app/api/teacher/students/invitations/gmail/route";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"));
const prefix = `shared_roster_${Date.now()}`;
const shared = "Course7";
const old = "OldSynthetic123!";
const results: string[] = [];

async function main() {
  const teacher = await createSmokeTeacher({ prisma, userId: `${prefix}_teacher`, password: "SyntheticTeacher123!" });
  const other = await createSmokeTeacher({ prisma, userId: `${prefix}_other`, password: "SyntheticTeacher123!" });
  const agentsBefore = await prisma.agentCall.count();
  const sessionsBefore = await prisma.assessmentSession.count();
  const before = new Map<string, string | null>();
  const userIds = ["pending", "unchanged", "private", "signedin", "inactive", "foreign", "stale", "changed_after_preview", "reissue_profile"];
  try {
    assert.equal(parseStudentTemporaryPassword(shared), shared);
    assert.throws(() => parseStudentPassword(shared));
    assert.throws(() => parseStudentTemporaryPassword("Short6"));
    assert.throws(() => parseStudentTemporaryPassword(shared, shared));
    results.push("temporary seven-character policy; private eight-character policy unchanged");

    for (const suffix of userIds) {
      const hash = await hashSecret(old);
      before.set(suffix, hash);
      await prisma.user.create({ data: {
        id: crypto.randomUUID(), user_id: `${prefix}_${suffix}`, user_id_normalized: `${prefix}_${suffix}`,
        role: "student", created_by_teacher_user_id: suffix === "foreign" ? other.id : teacher.id,
        display_name: "Synthetic student", email: `${suffix}@example.edu`,
        account_status: suffix === "inactive" ? "inactive" : "active", auth_version: 1,
        must_change_password: suffix !== "private", password_hash: suffix === "private" ? hash : null,
        access_code_hash: suffix === "private" ? null : hash,
        password_changed_at: suffix === "private" ? new Date() : null,
        last_login_at: suffix === "signedin" ? new Date() : null
      } });
    }
    const roster = (suffixes: string[]) => "user_id,display_name,email,temporary_password\n" + suffixes.map(suffix =>
      `${prefix}_${suffix},Updated synthetic student,${suffix}@example.edu,${old}`).join("\n");
    const preview = (suffixes: string[]) => previewRosterImport({ teacher_user_db_id: teacher.id,
      data: { source_file_name: `${prefix}.csv`, csv_text: roster(suffixes) } });
    const fetchUser = (suffix: string) => prisma.user.findUniqueOrThrow({ where: { user_id: `${prefix}_${suffix}` } });
    const initial = await preview([...userIds, "newone", "newtwo"]);
    assert.equal(initial.new_student_rows, 2);
    assert.equal(initial.pending_password_reset_rows, 5);
    assert.equal(initial.invalid_rows, 1);
    assert(!JSON.stringify(initial).includes(old));
    assert.equal(initial.preview_rows.find(row => row.user_id === `${prefix}_foreign`)?.existing_display_name, null);
    await assert.rejects(() => commitRosterImport({ teacher_user_db_id: other.id, batch_public_id: initial.batch_public_id }), /another teacher/);
    await assert.rejects(() => commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: initial.batch_public_id,
      data: { password_mode: "individual", replace_pending_passwords: true } }), /shared temporary password/);
    results.push("preview redacts extra credentials and protects foreign accounts");

    const noReplace = await preview(["unchanged"]);
    await commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: noReplace.batch_public_id,
      data: { shared_temporary_password: shared } });
    assert.equal((await fetchUser("unchanged")).access_code_hash, before.get("unchanged"));
    results.push("shared-password selection alone does not reset existing accounts");

    await prisma.user.update({ where: { user_id: `${prefix}_stale` }, data: { auth_version: { increment: 1 } } });
    const changed = await fetchUser("changed_after_preview");
    await changeStudentPassword({ student_user_db_id: changed.id, data: { new_password: "ChosenPrivate123!", confirm_new_password: "ChosenPrivate123!" } });
    const commitData = { teacher_user_db_id: teacher.id, batch_public_id: initial.batch_public_id,
      data: { shared_temporary_password: shared, replace_pending_passwords: true, apply_display_name_updates: true } };
    const a = commitRosterImport(commitData);
    const b = commitRosterImport(commitData);
    const commits = await Promise.all([a, b]);
    const committed = commits.find(result => !result.already_committed)!;
    assert.equal(commits.filter(result => result.already_committed).length, 1);
    assert.equal(committed.committed_new_students, 2);
    assert.equal(committed.replaced_pending_passwords, 3);
    assert.equal(committed.one_time_credentials.length, 5);
    assert.equal(committed.skipped_password_user_ids.length, 5);
    for (const suffix of ["pending", "unchanged", "reissue_profile", "newone", "newtwo"]) {
      const user = await fetchUser(suffix);
      assert(await verifySecret(shared, user.access_code_hash));
      assert.equal(user.password_hash, null);
      assert.equal(user.must_change_password, true);
      assert.equal(user.last_login_at, null);
      assert.equal(user.display_name, "Updated synthetic student");
      assert.equal(committed.one_time_credentials.find(row => row.user_id === user.user_id)?.display_name, user.display_name);
    }
    assert.notEqual((await fetchUser("newone")).access_code_hash, (await fetchUser("newtwo")).access_code_hash);
    for (const suffix of ["signedin", "inactive", "foreign", "stale"]) {
      assert.equal((await fetchUser(suffix)).access_code_hash, before.get(suffix));
    }
    assert.equal((await fetchUser("private")).password_hash, before.get("private"));
    assert(await verifySecret("ChosenPrivate123!", (await fetchUser("changed_after_preview")).password_hash));
    results.push("atomic duplicate commit; current eligibility; independent salts; protected private, signed-in, inactive and stale accounts");

    const pending = await fetchUser("pending");
    await assert.rejects(() => changeStudentPassword({ student_user_db_id: pending.id,
      data: { new_password: shared, confirm_new_password: shared } }));
    await changeStudentPassword({ student_user_db_id: pending.id,
      data: { new_password: "PrivateChoice123!", confirm_new_password: "PrivateChoice123!" } });
    const privateUser = await fetchUser("pending");
    assert.equal(privateUser.must_change_password, false);
    assert.equal(privateUser.access_code_hash, null);
    assert.equal(privateUser.auth_version, pending.auth_version + 1);
    assert(await verifySecret("PrivateChoice123!", privateUser.password_hash));
    const sameLongPassword = await preview(["longtemp"]);
    await commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: sameLongPassword.batch_public_id,
      data: { shared_temporary_password: "SyntheticShared123!" } });
    const longUser = await fetchUser("longtemp");
    await assert.rejects(() => changeStudentPassword({ student_user_db_id: longUser.id,
      data: { new_password: "SyntheticShared123!", confirm_new_password: "SyntheticShared123!" } }), /different from your temporary/);
    results.push("first-login private password invalidates temporary credential and cannot reuse it");

    const batchRows = await prisma.rosterImportBatch.findMany({ where: { uploaded_by_user_db_id: teacher.id } });
    const events = await prisma.studentAccountEvent.findMany({ where: { performed_by_user_db_id: { in: [teacher.id, changed.id, pending.id] } } });
    for (const secret of [shared, old, "ChosenPrivate123!", "PrivateChoice123!", "SyntheticShared123!"]) {
      assert(!JSON.stringify(batchRows).includes(secret));
      assert(!JSON.stringify(events).includes(secret));
    }
    await assert.rejects(() => previewRosterImport({ teacher_user_db_id: teacher.id,
      data: { csv_text: `user_id,display_name\n${prefix},"${old}"oops` } }), error => !String(error).includes(old));
    assert.equal(await prisma.agentCall.count(), agentsBefore);
    assert.equal(await prisma.assessmentSession.count(), sessionsBefore);
    results.push("no plaintext audits, no assessment-session changes and no provider calls");

    for (const route of [retiredConfig, retiredPreview, retiredSend, retiredConnect, retiredDisconnect]) {
      const response = route();
      assert.equal(response.status, 410);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
    }
    assert(!readFileSync("src/components/teacher-students/student-list-client.tsx", "utf8").includes("Prepare login emails"));
    results.push("retired email URLs reject all sends and clear the Gmail cookie");
    console.log(JSON.stringify({ status: "passed", results }, null, 2));
  } finally {
    await prisma.studentAccountEvent.deleteMany({ where: { student: { user_id: { startsWith: prefix } } } });
    await prisma.rosterImportBatch.deleteMany({ where: { uploaded_by_user_db_id: teacher.id } });
    await prisma.user.deleteMany({ where: { user_id: { startsWith: prefix }, role: "student" } });
    await prisma.user.deleteMany({ where: { id: { in: [teacher.id, other.id] } } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
