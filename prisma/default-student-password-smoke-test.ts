import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { verifySecret } from "../src/lib/password";
import { createStudentAccount, commitRosterImport, previewRosterImport, changeStudentPassword } from "../src/lib/services/student-accounts/service";
import { getDefaultStudentTemporaryPassword } from "../src/lib/services/student-accounts/temporary-password-policy";
import { createSmokeTeacher } from "./account-security-smoke-helpers";

async function main() {
  const db = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(db.hostname));
  assert(db.pathname.startsWith("/conversational_mcq_classroom_audit_"));
  const prefix = `default_password_${Date.now()}`;
  const previousDefault = process.env.STUDENT_DEFAULT_TEMPORARY_PASSWORD;
  delete process.env.STUDENT_DEFAULT_TEMPORARY_PASSWORD;
  const teacher = await createSmokeTeacher({ prisma, userId: `${prefix}_teacher`, password: "SyntheticTeacher123!" });
  const agentsBefore = await prisma.agentCall.count();
  const sessionsBefore = await prisma.assessmentSession.count();
  let generated = 0;
  const generator = () => { generated++; return "SyntheticRandom123!"; };
  const student = (suffix: string) => prisma.user.findUniqueOrThrow({ where: { user_id: `${prefix}_${suffix}` } });
  const preview = (suffixes: string[]) => previewRosterImport({ teacher_user_db_id: teacher.id,
    data: { csv_text: "user_id,display_name\n" + suffixes.map(suffix => `${prefix}_${suffix},Synthetic student`).join("\n") } });
  try {
    assert.equal(getDefaultStudentTemporaryPassword(), "edpy507");
    const single = await createStudentAccount({ teacher_user_db_id: teacher.id, data: { user_id: `${prefix}_single` }, accessCodeGenerator: generator });
    assert.equal(single.one_time_credentials[0].temporary_password, "edpy507");
    const batch = await preview(["one", "two"]);
    const imported = await commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: batch.batch_public_id, accessCodeGenerator: generator });
    assert.equal(imported.committed_new_students, 2);
    assert(imported.one_time_credentials.every(row => row.temporary_password === "edpy507"));
    assert.equal(generated, 0, "Default creation must never invoke random generation");
    for (const suffix of ["single", "one", "two"]) {
      const record = await student(suffix);
      assert(await verifySecret("edpy507", record.access_code_hash));
      assert.equal(record.must_change_password, true);
      assert.equal(record.password_hash, null);
    }
    assert.notEqual((await student("one")).access_code_hash, (await student("two")).access_code_hash);

    await createStudentAccount({ teacher_user_db_id: teacher.id, data: { user_id: `${prefix}_random`, generate_password: true }, accessCodeGenerator: generator });
    const randomBatch = await preview(["random_import"]);
    const random = await commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: randomBatch.batch_public_id,
      data: { password_mode: "individual" }, accessCodeGenerator: generator });
    assert.equal(generated, 2);
    assert.equal(random.one_time_credentials[0].temporary_password, "SyntheticRandom123!");
    const unchanged = await student("random");
    const noReset = await preview(["random"]);
    await commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: noReset.batch_public_id });
    assert.equal((await student("random")).access_code_hash, unchanged.access_code_hash);

    const privateStudent = await student("one");
    await assert.rejects(() => changeStudentPassword({ student_user_db_id: privateStudent.id,
      data: { new_password: "edpy507", confirm_new_password: "edpy507" } }));
    await changeStudentPassword({ student_user_db_id: privateStudent.id,
      data: { new_password: "PrivateChoice123!", confirm_new_password: "PrivateChoice123!" } });
    const replaceBatch = await preview(["random", "one"]);
    const replaced = await commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: replaceBatch.batch_public_id,
      data: { replace_pending_passwords: true } });
    assert.equal(replaced.replaced_pending_passwords, 1);
    assert.equal(replaced.one_time_credentials[0].temporary_password, "edpy507");
    assert(await verifySecret("edpy507", (await student("random")).access_code_hash));
    assert(await verifySecret("PrivateChoice123!", (await student("one")).password_hash));
    assert.equal((await student("one")).access_code_hash, null);
    assert((await commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: replaceBatch.batch_public_id })).already_committed);

    const invalidBatch = await preview(["invalid"]);
    await assert.rejects(() => commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: invalidBatch.batch_public_id,
      data: { password_mode: "course_default", shared_temporary_password: "CustomPass123!" } }), /custom shared password/);
    await assert.rejects(() => commitRosterImport({ teacher_user_db_id: teacher.id, batch_public_id: invalidBatch.batch_public_id,
      data: { password_mode: "shared" } }));
    assert.equal(await prisma.user.count({ where: { user_id: `${prefix}_invalid` } }), 0);

    process.env.STUDENT_DEFAULT_TEMPORARY_PASSWORD = "ConfiguredTemp123!";
    const configured = await createStudentAccount({ teacher_user_db_id: teacher.id, data: { user_id: `${prefix}_configured` } });
    assert.equal(configured.one_time_credentials[0].temporary_password, "ConfiguredTemp123!");
    const audit = JSON.stringify(await prisma.studentAccountEvent.findMany({ where: { performed_by_user_db_id: teacher.id } }));
    const batches = JSON.stringify(await prisma.rosterImportBatch.findMany({ where: { uploaded_by_user_db_id: teacher.id } }));
    for (const password of ["edpy507", "PrivateChoice123!", "SyntheticRandom123!", "ConfiguredTemp123!"]) {
      assert(!audit.includes(password));
      assert(!batches.includes(password));
    }
    assert.equal(await prisma.agentCall.count(), agentsBefore);
    assert.equal(await prisma.assessmentSession.count(), sessionsBefore);
    console.log("Default student password smoke passed: default creation/import/reissue, explicit random opt-in, private-password protection, no plaintext audits or provider calls.");
  } finally {
    if (previousDefault === undefined) delete process.env.STUDENT_DEFAULT_TEMPORARY_PASSWORD;
    else process.env.STUDENT_DEFAULT_TEMPORARY_PASSWORD = previousDefault;
    await prisma.studentAccountEvent.deleteMany({ where: { student: { user_id: { startsWith: prefix } } } });
    await prisma.rosterImportBatch.deleteMany({ where: { uploaded_by_user_db_id: teacher.id } });
    await prisma.user.deleteMany({ where: { user_id: { startsWith: prefix }, role: "student" } });
    await prisma.user.delete({ where: { id: teacher.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
