import assert from "node:assert/strict";
import { clearStudentDrafts, DRAFT_TTL_MS, readStudentDraft, STUDENT_DRAFT_PREFIX, writeStudentDraft } from "../src/components/student-assessment/session-drafts";

const entries = new Map<string, string>();
const storage: Storage = { get length() { return entries.size; }, clear: () => entries.clear(),
  getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); },
  key: index => [...entries.keys()][index] ?? null, removeItem: key => { entries.delete(key); } };
const now = Date.now();
assert(writeStudentDraft(storage, "session-a:item-a:reason", "Unsent reasoning", now));
assert.equal(readStudentDraft(storage, "session-a:item-a:reason", now), "Unsent reasoning");
assert.equal(readStudentDraft(storage, "session-b:item-a:reason", now), "");
assert.equal(readStudentDraft(storage, "session-a:item-b:reason", now), "");
assert.equal(readStudentDraft(storage, "session-a:item-a:reason", now + DRAFT_TTL_MS), "");
storage.setItem(STUDENT_DRAFT_PREFIX + "broken", "not JSON");
assert.equal(readStudentDraft(storage, "broken"), "");
assert(writeStudentDraft(storage, "session-a:message", "draft", now));
assert(writeStudentDraft(storage, "session-b:message", "other draft", now));
clearStudentDrafts(storage, "session-a");
assert.equal(readStudentDraft(storage, "session-a:message"), "");
assert.equal(readStudentDraft(storage, "session-b:message"), "other draft");
assert(writeStudentDraft(storage, "session-b:message", "", now));
assert.equal(readStudentDraft(storage, "session-b:message"), "");
for (let i = 0; i < 50; i++) writeStudentDraft(storage, `session-${i}:message`, "bounded", now);
assert(entries.size <= 32);
clearStudentDrafts(storage);
assert.equal(entries.size, 0);
const blocked = { ...storage, setItem() { throw Error("storage blocked"); } };
assert.equal(writeStudentDraft(blocked, "session-a:message", "unsent"), false);
console.log("PASS student draft isolation, expiry, corrupt storage, accepted clearing, bounds, logout clearing and storage failure");
