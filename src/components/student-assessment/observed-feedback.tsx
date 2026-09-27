"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FEEDBACK_DISPLAY_MIN_VISIBLE_MS, FEEDBACK_DISPLAY_VERSION } from "@/lib/student-assessment-ui/feedback-display";
import type { FrontendProcessEvent } from "./api";

// A partial viewport exposure is not proof of reading the entire message.
export function ObservedFeedback({ children, event, send, enabled }: {
  children: ReactNode;
  event: FrontendProcessEvent;
  send: (event: FrontendProcessEvent) => void;
  enabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ event, send });
  latest.current = { event, send };
  const contentId = String(event.payload?.content_id ?? "");
  useEffect(() => {
    const element = root.current;
    if (!enabled || !element || !contentId || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let acknowledged = false;
    let intersecting = false;
    const visible = () => {
      const rect = element.getBoundingClientRect();
      return document.visibilityState === "visible" && intersecting && rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    };
    const check = () => {
      if (!visible()) { clearTimeout(timer); timer = undefined; return; }
      if (acknowledged || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!visible() || acknowledged) return;
        acknowledged = true;
        latest.current.send({ ...latest.current.event, client_occurred_at: new Date().toISOString(),
          payload: { ...latest.current.event.payload, display_event_contract_version: FEEDBACK_DISPLAY_VERSION,
            observation_method: "partial_viewport_500ms", minimum_visible_ms: FEEDBACK_DISPLAY_MIN_VISIBLE_MS } });
      }, FEEDBACK_DISPLAY_MIN_VISIBLE_MS);
    };
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; check(); });
    observer.observe(element);
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener("visibilitychange", check); };
  }, [contentId, enabled]);
  return <div ref={root}>{children}</div>;
}
