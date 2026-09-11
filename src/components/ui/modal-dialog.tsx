"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function ModalDialog({
  children,
  labelledBy,
  onClose,
  busy = false,
  testId
}: {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  busy?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;

  // Native modal dialogs provide focus containment and an inert background.
  return createPortal(
    <dialog
      aria-labelledby={labelledBy}
      aria-modal="true"
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none items-center justify-center overflow-y-auto border-0 bg-transparent px-4 py-6 text-ink backdrop:bg-ink/40 open:flex"
      data-testid={testId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      ref={ref}
    >
      {children}
    </dialog>,
    document.body
  );
}
