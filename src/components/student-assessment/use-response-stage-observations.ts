"use client";

import { useEffect, useRef } from "react";
import type { ResponseStageContext } from "@/lib/student-assessment-ui/response-observation";
import { createResponseStageRecorder } from "./response-stage-recorder";
import type { FrontendProcessEvent } from "./api";

export function useResponseStageObservations(input: {
  context: ResponseStageContext | null;
  enabled: boolean;
  busy: boolean;
  send: (event: FrontendProcessEvent, keepalive?: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(input);
  latest.current = input;
  const recorder = useRef<ReturnType<typeof createResponseStageRecorder> | null>(null);
  if (!recorder.current) recorder.current = createResponseStageRecorder({
    send: (event, keepalive) => latest.current.send(event, keepalive),
    now: () => performance.now(), wallNow: () => new Date().toISOString(), newId: () => crypto.randomUUID()
  });
  const current = recorder.current;
  const key = input.context ? JSON.stringify(input.context) : "";
  useEffect(() => {
    if (!input.enabled) { current.close("view_left"); return; }
    const check = () => {
      const { context, enabled, busy } = latest.current;
      if (!enabled || busy || document.visibilityState !== "visible" || !root.current) return;
      const rect = root.current.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight || rect.width <= 0) return;
      current.controlsReady();
      if (context) current.ready(context); else current.close();
    };
    const frame = requestAnimationFrame(check);
    const observer = new IntersectionObserver(check);
    if (root.current) observer.observe(root.current);
    document.addEventListener("visibilitychange", check);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", check); };
  }, [current, input.enabled, input.busy, key]);
  useEffect(() => {
    if (!input.enabled) return;
    const visible = () => current.observe(document.visibilityState === "hidden" ? "hidden" : "visible");
    const blur = () => current.observe("blur");
    const focus = () => current.observe("focus");
    const offline = () => current.observe("offline");
    const online = () => current.observe("online");
    const left = () => current.close("view_left");
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("blur", blur); window.addEventListener("focus", focus);
    window.addEventListener("offline", offline); window.addEventListener("online", online);
    window.addEventListener("pagehide", left);
    return () => {
      left(); document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("blur", blur); window.removeEventListener("focus", focus);
      window.removeEventListener("offline", offline); window.removeEventListener("online", online);
      window.removeEventListener("pagehide", left);
    };
  }, [current, input.enabled]);
  return { root, recorder: current };
}
