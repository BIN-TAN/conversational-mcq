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
  const lastActivityRef = useRef(Date.now());
  const longPauseLoggedRef = useRef(false);
  const inactivityLoggedRef = useRef(false);

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
        send(
          {
            ...eventBase(),
            event_type: "page_hidden",
            visibility_duration_ms: Math.max(0, now - visibleSinceRef.current)
          },
          true
        );
        return;
      }

      visibleSinceRef.current = now;
      send({
        ...eventBase(),
        event_type: "page_visible"
      });
    }

    function handleBeforeUnload() {
      send(
        {
          ...eventBase(),
          event_type: "navigation_event",
          payload: { reason: "beforeunload" }
        },
        true
      );
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
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pointerdown", markActivity);
    window.addEventListener("keydown", markActivity);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
    };
  }, [input.sessionPublicId, input.currentItemPublicId]);
}
