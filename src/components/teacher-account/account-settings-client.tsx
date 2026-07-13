"use client";

import { FormEvent, useState } from "react";
import { KeyRound, Mail, XCircle } from "lucide-react";

type AccountSecurityState = {
  user_id: string;
  email: string | null;
  masked_email: string | null;
  email_verified_at: string | Date | null;
  pending_email: string | null;
  masked_pending_email: string | null;
  email_change_requested_at: string | Date | null;
  password_changed_at: string | Date | null;
};

type ApiResponse = {
  account?: AccountSecurityState;
  message?: string;
  error?: {
    message?: string;
  };
};

function formatDate(value: string | Date | null) {
  if (!value) {
    return "Not recorded";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function AccountSettingsClient({ initialAccount }: { initialAccount: AccountSecurityState }) {
  const [account, setAccount] = useState(initialAccount);
  const [emailPassword, setEmailPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [cancelPassword, setCancelPassword] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNew, setPasswordNew] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/teacher/account/email-change/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: emailPassword, new_email: newEmail })
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !data.account) {
        setError(data.error?.message ?? "Email change could not be requested.");
        return;
      }
      setAccount(data.account);
      setEmailPassword("");
      setNewEmail("");
      setMessage(data.message ?? "A verification link has been sent to the new email address. Your current email remains active until the new address is verified.");
    } catch {
      setError("Email change request could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/teacher/account/email-change/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: cancelPassword })
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !data.account) {
        setError(data.error?.message ?? "Pending email change could not be cancelled.");
        return;
      }
      setAccount(data.account);
      setCancelPassword("");
      setMessage(data.message ?? "Pending email change cancelled.");
    } catch {
      setError("Cancel request could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/teacher/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: passwordCurrent,
          new_password: passwordNew,
          confirm_new_password: passwordConfirm
        })
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !data.account) {
        setError(data.error?.message ?? "Password could not be changed.");
        return;
      }
      setAccount(data.account);
      setPasswordCurrent("");
      setPasswordNew("");
      setPasswordConfirm("");
      setMessage(data.message ?? "Password changed.");
    } catch {
      setError("Password change request could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Account</h2>
        <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold text-muted">Username</dt>
            <dd className="mt-1 text-ink">{account.user_id}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">Current recovery email</dt>
            <dd className="mt-1 text-ink">{account.email ?? "Not configured"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">Email verification</dt>
            <dd className="mt-1 text-ink">{account.email_verified_at ? `Verified ${formatDate(account.email_verified_at)}` : "Not verified"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">Password changed</dt>
            <dd className="mt-1 text-ink">{formatDate(account.password_changed_at)}</dd>
          </div>
        </dl>
        {account.pending_email ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Pending email change: {account.pending_email}. Requested {formatDate(account.email_change_requested_at)}.
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Change recovery email</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={requestEmailChange}>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Current password
            <input
              autoComplete="current-password"
              className="rounded-md border border-line px-3 py-2"
              onChange={(event) => setEmailPassword(event.target.value)}
              required
              type="password"
              value={emailPassword}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            New email
            <input
              autoComplete="email"
              className="rounded-md border border-line px-3 py-2"
              onChange={(event) => setNewEmail(event.target.value)}
              required
              type="email"
              value={newEmail}
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            Send verification
          </button>
        </form>

        {account.pending_email ? (
          <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={cancelEmailChange}>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink md:col-span-2">
              Current password to cancel pending change
              <input
                autoComplete="current-password"
                className="rounded-md border border-line px-3 py-2"
                onChange={(event) => setCancelPassword(event.target.value)}
                required
                type="password"
                value={cancelPassword}
              />
            </label>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Cancel pending change
            </button>
          </form>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Change password</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-4" onSubmit={changePassword}>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Current password
            <input
              autoComplete="current-password"
              className="rounded-md border border-line px-3 py-2"
              onChange={(event) => setPasswordCurrent(event.target.value)}
              required
              type="password"
              value={passwordCurrent}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            New password
            <input
              autoComplete="new-password"
              className="rounded-md border border-line px-3 py-2"
              minLength={8}
              onChange={(event) => setPasswordNew(event.target.value)}
              required
              type="password"
              value={passwordNew}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Confirm new password
            <input
              autoComplete="new-password"
              className="rounded-md border border-line px-3 py-2"
              minLength={8}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              required
              type="password"
              value={passwordConfirm}
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Change password
          </button>
        </form>
      </section>
    </div>
  );
}

