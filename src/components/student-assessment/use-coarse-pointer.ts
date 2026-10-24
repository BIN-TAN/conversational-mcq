"use client";

import { useSyncExternalStore } from "react";

/**
 * Release CMCQ-20261024-09: on a touch screen (primary pointer coarse), Enter inserts a new
 * line and only the send button sends, because the on-screen keyboard's Enter key is where
 * students expect a new line. With a mouse or trackpad, Enter sends and Shift+Enter adds a line,
 * as before. The server render and browsers without matchMedia use the desktop behaviour.
 */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(COARSE_POINTER_QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function snapshot() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COARSE_POINTER_QUERY).matches;
}

export function useCoarsePointer() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Whether this key press sends the message: plain Enter, not while composing, and not on a touch screen. */
export function enterKeySends(
  event: { key: string; shiftKey: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean } },
  coarsePointer: boolean
) {
  return !coarsePointer && event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing && event.keyCode !== 229;
}
