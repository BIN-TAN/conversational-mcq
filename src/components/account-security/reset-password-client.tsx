"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

type ResetPasswordResponse = {
  ok?: boolean;
  error?: {
    message?: string;
  };
};

export function ResetPasswordClient({ tokenPresent, token }: { tokenPresent: boolean; token: string }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(tokenPresent ? "" : "This password-reset link is invalid or has expired. Request a new link.");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tokenPresent) {
      return;
    }

    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          new_password: newPassword,
          confirm_new_password: confirmPassword
        })
      });
      const data = (await response.json().catch(() => ({}))) as ResetPasswordResponse;

      if (!response.ok || !data.ok) {
        setError(data.error?.message ?? "This password-reset link is invalid or has expired. Request a new link.");
        return;
      }

      setMessage("Password changed. Sign in with your new password.");
      setNewPassword("");
      setConfirmPassword("");
      router.replace("/student/login");
      router.refresh();
    } catch {
      setError("Password reset could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <label className="flex flex-col gap-2 text-sm font-medium text-ink">
        New password
        <input
          autoComplete="new-password"
          className="rounded-md border border-border-light bg-white px-3 py-3 text-base outline-none transition focus:border-ualberta-green focus:ring-2 focus:ring-ualberta-gold"
          disabled={!tokenPresent || isSubmitting}
          minLength={8}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium text-ink">
        Confirm new password
        <input
          autoComplete="new-password"
          className="rounded-md border border-border-light bg-white px-3 py-3 text-base outline-none transition focus:border-ualberta-green focus:ring-2 focus:ring-ualberta-gold"
          disabled={!tokenPresent || isSubmitting}
          minLength={8}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          type="password"
          value={confirmPassword}
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
        disabled={!tokenPresent || isSubmitting}
        type="submit"
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {isSubmitting ? "Updating" : "Reset password"}
      </button>

      <Link className="block text-sm font-semibold text-ualberta-green hover:text-ualberta-green-dark" href="/auth/forgot-password">
        Request a new link
      </Link>
    </form>
  );
}
