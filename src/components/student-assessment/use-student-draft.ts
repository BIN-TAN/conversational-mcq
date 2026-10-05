"use client";

import { useCallback, useEffect, useState } from "react";
import { readStudentDraft, writeStudentDraft } from "./session-drafts";

export function useStudentDraft(key: string | null) {
  const [draft, setDraft] = useState({ key, text: "", stored: true });
  useEffect(() => {
    let text = "";
    try { if (key) text = readStudentDraft(window.sessionStorage, key); } catch { /* Storage may be blocked. */ }
    setDraft({ key, text, stored: true });
  }, [key]);
  const setText = useCallback((text: string) => {
    let stored = !text;
    try { if (key) stored = writeStudentDraft(window.sessionStorage, key, text); } catch { /* Warn before losing unpersisted text. */ }
    setDraft({ key, text, stored });
  }, [key]);
  return [draft.key === key ? draft.text : "", setText, draft.key === key && Boolean(draft.text) && !draft.stored] as const;
}
