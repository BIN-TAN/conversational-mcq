"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

type LoginResponse = {
  user?: {
    user_id: string;
    role: "student" | "teacher_researcher";
  };
  error?: string;
};

export function LoginForm() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId.trim(),
          password: credential,
          access_code: credential
        })
      });
      const data = (await response.json()) as LoginResponse;

      if (!response.ok || !data.user) {
        setError(data.error ?? "Login failed.");
        return;
      }

      router.push(
        data.user.role === "teacher_researcher" ? "/teacher/dashboard" : "/student/assessment"
      );
    } catch {
      setError("The login request could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <label className="flex flex-col gap-2 text-sm font-medium text-ink">
        Classroom ID
        <input
          className="rounded-md border border-line bg-white px-3 py-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
          autoComplete="username"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          required
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium text-ink">
        Access code or password
        <input
          className="rounded-md border border-line bg-white px-3 py-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
          autoComplete="current-password"
          type="password"
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
          required
        />
      </label>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <button
        className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {isSubmitting ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
