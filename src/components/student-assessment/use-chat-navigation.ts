"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export function useChatNavigation(input: {
  sessionId: string | null; ready: boolean; stageKey: string; tutorTurnId: string | null;
  root: RefObject<HTMLDivElement | null>; busy: boolean;
}) {
  const keyboard = useRef(false);
  const nearBottom = useRef(true);
  const previous = useRef<{ session: string; stage: string; tutor: string | null } | null>(null);
  const [newReply, setNewReply] = useState(false);
  const storageKey = input.sessionId ? `cmcq-reading-v1:${input.sessionId}` : null;
  const showReply = useCallback(() => {
    const replies = document.querySelectorAll<HTMLElement>("[data-tutor-turn]");
    replies.item(replies.length - 1)?.scrollIntoView({ block: "start", behavior: "instant" });
    setNewReply(false);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (["Tab", "Enter", " "].includes(event.key)) keyboard.current = true; };
    const onPointer = () => { keyboard.current = false; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onPointer); };
  }, []);
  useEffect(() => {
    if (!input.ready || !input.sessionId || !storageKey || input.busy) return;
    const old = previous.current;
    if (!old || old.session !== input.sessionId) {
      let saved: { y: number; at: number; stage: string; tutor: string | null } | null = null;
      try { saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); } catch { /* Optional reading position. */ }
      if (saved && Number.isFinite(saved.y) && saved.y >= 0 && Date.now() - saved.at < 12 * 3600_000 &&
          saved.stage === input.stageKey && saved.tutor === input.tutorTurnId) window.scrollTo({ top: saved.y, behavior: "instant" });
      else if (input.tutorTurnId) showReply();
      else input.root.current?.scrollIntoView({ block: "start", behavior: "instant" });
    } else if (input.tutorTurnId && input.tutorTurnId !== old.tutor) {
      if (nearBottom.current) showReply();
      else setNewReply(true);
    } else if (input.stageKey !== old.stage) {
      input.root.current?.scrollIntoView({ block: "start", behavior: "instant" });
      if (keyboard.current) input.root.current?.querySelector<HTMLElement>("textarea:not(:disabled), button:not(:disabled), [tabindex='0']")?.focus({ preventScroll: true });
    }
    previous.current = { session: input.sessionId, stage: input.stageKey, tutor: input.tutorTurnId };
    const save = () => {
      nearBottom.current = document.documentElement.scrollHeight - innerHeight - scrollY < 160;
      try { sessionStorage.setItem(storageKey, JSON.stringify({ y: scrollY, at: Date.now(), stage: input.stageKey, tutor: input.tutorTurnId })); } catch { /* Optional reading position. */ }
    };
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("scroll", save); window.removeEventListener("pagehide", save); };
  }, [input.ready, input.sessionId, input.stageKey, input.tutorTurnId, input.root, input.busy, storageKey, showReply]);
  return { newReply, showReply };
}
