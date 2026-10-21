"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requestErrorMessage } from "@/components/server-unavailable-message";

type PasswordChangeResponse = {
  student?: {
    user_id: string;
    must_change_password: boolean;
  };
  error?: {
    code?: string;
    message?: string;
    details?: { issues?: Array<{ message?: string }> };
  };
};

export function PasswordChangeClient({
  mustChangePassword
}: {
  mustChangePassword: boolean;
}) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/student/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword || undefined,
          new_password: newPassword,
          confirm_new_password: confirmPassword
        })
      });
      const data = (await response.json().catch(() => ({}))) as PasswordChangeResponse;

      if (!response.ok || data.student?.must_change_password) {
        // A password rule that was not met is named in the issue, not in the general message.
        const issue = data.error?.details?.issues?.find((entry) => entry.message)?.message;
        setError(issue ?? data.error?.message ?? "Your password could not be changed.");
        return;
      }

      setMessage("Your password has been changed. Taking you to your assessments...");
      router.replace("/student/assessment");
      router.refresh();
    } catch (caught) {
      setError(requestErrorMessage(caught, "Your password could not be changed. Try again in a moment."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="rounded-md border border-border-light bg-ualberta-green-soft px-3 py-2 text-sm leading-6 text-muted">
        {mustChangePassword
          ? "Please choose a new password before continuing."
          : "Choose a new password for your student account."}
      </p>

      {!mustChangePassword ? (
        <label className="flex flex-col gap-2 text-sm font-medium text-ink">
          Current password
          <input
            autoComplete="current-password"
            className="rounded-md border border-border-light bg-white px-3 py-3 text-base outline-none transition focus:border-ualberta-green focus:ring-2 focus:ring-ualberta-gold"
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            value={currentPassword}
          />
        </label>
      ) : null}

      <label className="flex flex-col gap-2 text-sm font-medium text-ink">
        New password
        <input
          autoComplete="new-password"
          className="rounded-md border border-border-light bg-white px-3 py-3 text-base outline-none transition focus:border-ualberta-green focus:ring-2 focus:ring-ualberta-gold"
          minLength={8}
          onChange={(event) => setNewPassword(event.target.value)}
          type="password"
          value={newPassword}
          required
        />
        <span className="text-xs font-normal text-muted">
          Use at least 8 characters. Do not use your username or a common password.
        </span>
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium text-ink">
        Confirm new password
        <input
          autoComplete="new-password"
          className="rounded-md border border-border-light bg-white px-3 py-3 text-base outline-none transition focus:border-ualberta-green focus:ring-2 focus:ring-ualberta-gold"
          minLength={8}
          onChange={(event) => setConfirmPassword(event.target.value)}
          type="password"
          value={confirmPassword}
          required
        />
      </label>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}

      <button
        className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ualberta-green px-4 text-sm font-semibold text-white transition hover:bg-ualberta-green-dark disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {isSubmitting ? "Saving..." : "Set password"}
      </button>
    </form>
  );
}
