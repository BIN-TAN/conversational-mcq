"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";

type ForgotPasswordResponse = {
  message?: string;
};

export function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = (await response.json().catch(() => ({}))) as ForgotPasswordResponse;
      setMessage(
        data.message ??
          "If a verified teacher account is associated with that email, a password-reset link will be sent."
      );
    } catch {
      setMessage("If a verified teacher account is associated with that email, a password-reset link will be sent.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="rounded-md border border-border-light bg-ualberta-green-soft px-3 py-2 text-sm leading-6 text-muted">
        Teacher and instructor accounts can request a password-reset link using their verified email address.
        Students should contact their instructor for credential assistance.
      </p>

      <label className="flex flex-col gap-2 text-sm font-medium text-ink">
        Email address
        <input
          autoComplete="email"
          className="rounded-md border border-border-light bg-white px-3 py-3 text-base outline-none transition focus:border-ualberta-green focus:ring-2 focus:ring-ualberta-gold"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      {message ? (
        <p className="rounded-md border border-border-light bg-white px-3 py-2 text-sm leading-6 text-muted">
          {message}
        </p>
      ) : null}

      <button
        className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ualberta-green px-4 text-sm font-semibold text-white transition hover:bg-ualberta-green-dark disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        <Mail className="h-4 w-4" aria-hidden="true" />
        {isSubmitting ? "Sending" : "Send reset link"}
      </button>

      <Link className="block text-sm font-semibold text-ualberta-green hover:text-ualberta-green-dark" href="/student/login">
        Return to sign in
      </Link>
    </form>
  );
}

