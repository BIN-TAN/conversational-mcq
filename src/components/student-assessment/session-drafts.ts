// Drafts are device-local conveniences, never submitted response evidence.
export const STUDENT_DRAFT_PREFIX = "cmcq-student-draft-v1:";
export const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_DRAFTS = 32;

export function readStudentDraft(storage: Storage, key: string, now = Date.now()): string {
  try {
    const entry = JSON.parse(storage.getItem(STUDENT_DRAFT_PREFIX + key) ?? "null");
    if (entry && typeof entry.text === "string" && entry.text.length <= 5000 &&
        Number.isFinite(entry.savedAt) && entry.savedAt <= now && now - entry.savedAt < DRAFT_TTL_MS) return entry.text;
    storage.removeItem(STUDENT_DRAFT_PREFIX + key);
  } catch { /* Unavailable or invalid storage must not block the assessment. */ }
  return "";
}

export function writeStudentDraft(storage: Storage, key: string, text: string, now = Date.now()): boolean {
  try {
    if (!text) storage.removeItem(STUDENT_DRAFT_PREFIX + key);
    else {
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
        .filter((k): k is string => Boolean(k?.startsWith(STUDENT_DRAFT_PREFIX)));
      for (const old of keys) readStudentDraft(storage, old.slice(STUDENT_DRAFT_PREFIX.length), now);
      if (!storage.getItem(STUDENT_DRAFT_PREFIX + key) && keys.length >= MAX_DRAFTS) storage.removeItem(keys[0]);
      storage.setItem(STUDENT_DRAFT_PREFIX + key, JSON.stringify({ text: text.slice(0, 5000), savedAt: now }));
    }
    return true;
  } catch { return false; }
}

export function clearStudentDrafts(storage: Storage, sessionId?: string) {
  try {
    const prefix = STUDENT_DRAFT_PREFIX + (sessionId ? `${sessionId}:` : "");
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch { /* A blocked browser store is optional. */ }
}
