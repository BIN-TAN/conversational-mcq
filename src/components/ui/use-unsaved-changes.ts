"use client";

import { useCallback, useEffect, useRef } from "react";

const LEAVE_MESSAGE = "Leave this page? Unsaved changes will be lost. Wait for any save or generation to finish before leaving.";

export function useUnsavedChanges(enabled: boolean) {
  const enabledRef = useRef(enabled);
  const allowedUntil = useRef(0);
  enabledRef.current = enabled;
  const shouldGuard = useCallback(() => enabledRef.current && Date.now() > allowedUntil.current, []);
  const allowNavigation = useCallback(() => { allowedUntil.current = Date.now() + 1000; }, []);
  const confirmLeave = useCallback(() => {
    if (shouldGuard() && !window.confirm(LEAVE_MESSAGE)) return false;
    allowNavigation();
    return true;
  }, [allowNavigation, shouldGuard]);

  useEffect(() => {
    const currentUrl = window.location.href;
    const currentState = window.history.state;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!shouldGuard()) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const target = new URL(link.href);
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    function onPopState(event: PopStateEvent) {
      if (!shouldGuard()) return;
      if (confirmLeave()) return;
      // Stop the client router from unmounting the editor after a cancelled Back.
      event.stopImmediatePropagation();
      window.history.pushState(currentState, "", currentUrl);
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState, true);
    };
  }, [confirmLeave, shouldGuard]);

  return { allowNavigation, confirmLeave };
}
