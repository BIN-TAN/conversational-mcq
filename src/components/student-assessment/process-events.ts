"use client";

import { useEffect, useRef } from "react";
import { sendProcessEvents, type FrontendProcessEvent } from "./api";

const LONG_PAUSE_MS = Number(process.env.NEXT_PUBLIC_LONG_PAUSE_MS ?? 120000);
const INACTIVITY_MS = Number(process.env.NEXT_PUBLIC_INACTIVITY_MS ?? 300000);

export function useStudentProcessEvents(input: {
  sessionPublicId: string;
  currentItemPublicId?: string | null;
}) {
  const visibleSinceRef = useRef(Date.now());
  const focusedSinceRef = useRef(Date.now());
  const lastActivityRef = useRef(Date.now());
  const longPauseLoggedRef = useRef(false);
  const inactivityLoggedRef = useRef(false);
  const typingSummaryRef = useRef<{
    startedAt: number | null;
    keyCount: number;
    backspaceCount: number;
    enterCount: number;
  }>({
    startedAt: null,
    keyCount: 0,
    backspaceCount: 0,
    enterCount: 0
  });

  useEffect(() => {
    function eventBase(): Pick<FrontendProcessEvent, "item_public_id" | "client_occurred_at"> {
      return {
        item_public_id: input.currentItemPublicId ?? undefined,
        client_occurred_at: new Date().toISOString()
      };
    }

    function send(event: FrontendProcessEvent, useBeacon = false) {
      void sendProcessEvents(input.sessionPublicId, [event], useBeacon).catch(() => undefined);
    }

    function textLengthBand(length: number) {
      if (length === 0) return "empty";
      if (length <= 20) return "1_20";
      if (length <= 100) return "21_100";
      if (length <= 500) return "101_500";
      return "over_500";
    }

    function targetKind(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return "unknown";
      if (target instanceof HTMLTextAreaElement) return "textarea";
      if (target instanceof HTMLInputElement) return "input";
      if (target.isContentEditable) return "contenteditable";
      return "other";
    }

    function flushTypingSummary(useBeacon = false) {
      const summary = typingSummaryRef.current;
      if (!summary.startedAt || summary.keyCount === 0) {
        return;
      }

      const now = Date.now();
      send(
        {
          ...eventBase(),
          event_type: "typing_activity_summary",
          payload: {
            key_count: summary.keyCount,
            backspace_count: summary.backspaceCount,
            enter_key_count: summary.enterCount,
            duration_ms: Math.max(0, now - summary.startedAt)
          }
        },
        useBeacon
      );
      typingSummaryRef.current = {
        startedAt: null,
        keyCount: 0,
        backspaceCount: 0,
        enterCount: 0
      };
    }

    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;

    if (navigation?.type === "reload") {
      send({
        ...eventBase(),
        event_type: "refresh_recovery",
        payload: { navigation_type: "reload" }
      });
    }

    function markActivity() {
      lastActivityRef.current = Date.now();
      longPauseLoggedRef.current = false;
      inactivityLoggedRef.current = false;
    }

    function handleVisibilityChange() {
      const now = Date.now();

      if (document.visibilityState === "hidden") {
        flushTypingSummary(true);
        send(
          {
            ...eventBase(),
            event_type: "page_visibility_hidden",
            visibility_duration_ms: Math.max(0, now - visibleSinceRef.current)
          },
          true
        );
        return;
      }

      visibleSinceRef.current = now;
      send({
        ...eventBase(),
        event_type: "page_visibility_visible"
      });
    }

    function handleBeforeUnload() {
      flushTypingSummary(true);
      send(
        {
          ...eventBase(),
          event_type: "navigation_event",
          payload: { reason: "beforeunload" }
        },
        true
      );
    }

    function handleWindowBlur() {
      flushTypingSummary(true);
      send(
        {
          ...eventBase(),
          event_type: "window_blur",
          payload: {
            focus_duration_ms: Math.max(0, Date.now() - focusedSinceRef.current)
          }
        },
        true
      );
    }

    function handleWindowFocus() {
      focusedSinceRef.current = Date.now();
      send({
        ...eventBase(),
        event_type: "window_focus"
      });
    }

    function handlePaste(event: ClipboardEvent) {
      markActivity();
      const pastedText = event.clipboardData?.getData("text") ?? "";
      send({
        ...eventBase(),
        event_type: "paste_detected",
        payload: {
          target_kind: targetKind(event.target),
          pasted_text_length_band: textLengthBand(pastedText.length),
          clipboard_type_count: event.clipboardData?.types.length ?? 0,
          includes_plain_text: event.clipboardData?.types.includes("text/plain") ?? false
        }
      });
    }

    function handleKeydown(event: KeyboardEvent) {
      markActivity();

      if (targetKind(event.target) === "other" || targetKind(event.target) === "unknown") {
        return;
      }

      const summary = typingSummaryRef.current;
      summary.startedAt ??= Date.now();
      summary.keyCount += 1;
      if (event.key === "Backspace" || event.key === "Delete") {
        summary.backspaceCount += 1;
      }
      if (event.key === "Enter") {
        summary.enterCount += 1;
      }

      if (summary.keyCount >= 60) {
        flushTypingSummary();
      }
    }

    const interval = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;

      if (elapsed >= LONG_PAUSE_MS && !longPauseLoggedRef.current) {
        longPauseLoggedRef.current = true;
        send({
          ...eventBase(),
          event_type: "long_pause",
          pause_duration_ms: elapsed
        });
      }

      if (elapsed >= INACTIVITY_MS && !inactivityLoggedRef.current) {
        inactivityLoggedRef.current = true;
        send({
          ...eventBase(),
          event_type: "inactivity_detected",
          pause_duration_ms: elapsed
        });
      }
    }, 30000);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("paste", handlePaste);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pointerdown", markActivity);
    window.addEventListener("keydown", handleKeydown);

    return () => {
      flushTypingSummary(true);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("paste", handlePaste);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [input.sessionPublicId, input.currentItemPublicId]);
}
