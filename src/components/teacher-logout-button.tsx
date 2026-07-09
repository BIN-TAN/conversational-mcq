"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function TeacherLogoutButton() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function onLogout() {
    setIsLoggingOut(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <button
      className="inline-flex h-9 items-center gap-2 rounded-md border border-ualberta-gold bg-white px-3 text-sm font-semibold text-ualberta-green-dark transition hover:bg-ualberta-gold-soft disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isLoggingOut}
      onClick={onLogout}
      type="button"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      {isLoggingOut ? "Logging out" : "Log out"}
    </button>
  );
}
