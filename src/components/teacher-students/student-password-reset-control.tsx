"use client";

import { Check, Clipboard, Download, KeyRound, Loader2, X } from "lucide-react";
import { useState } from "react";
import { errorFromUnknown, resetStudentPassword } from "./api";
import type { CredentialResponse, StructuredApiError } from "./types";
import { downloadTextFile, ErrorPanel } from "./ui";

export function StudentPasswordResetControl({
  userId,
  displayName,
  accountStatus,
  onReset
}: {
  userId: string;
  displayName: string | null;
  accountStatus: "active" | "inactive";
  onReset?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [credentials, setCredentials] = useState<CredentialResponse | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [copied, setCopied] = useState(false);

  const temporaryPassword =
    credentials?.one_time_credentials[0]?.temporary_password ??
    credentials?.one_time_credentials[0]?.temporary_access_code ??
    null;

  function openDialog() {
    setOpen(true);
    setCredentials(null);
    setError(null);
    setCopied(false);
  }

  function closeDialog() {
    if (resetting) {
      return;
    }

    const shouldRefresh = credentials !== null;
    setOpen(false);
    setCredentials(null);
    setError(null);
    setCopied(false);

    if (shouldRefresh) {
      void onReset?.();
    }
  }

  async function confirmReset() {
    setResetting(true);
    setError(null);
    setCopied(false);

    try {
      const result = await resetStudentPassword(userId, { generate_password: true });
      setCredentials({
        one_time_credentials: result.one_time_credentials,
        credential_csv: result.credential_csv,
        credential_warning: result.credential_warning
      });
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setResetting(false);
    }
  }

  async function copyTemporaryPassword() {
    if (!temporaryPassword) {
      return;
    }

    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button
        className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-accent"
        data-testid={`reset-student-password-${userId}`}
        onClick={openDialog}
        type="button"
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        Reset password
      </button>

      {open ? (
        <div
          aria-labelledby="reset-student-password-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-6"
          data-testid="reset-student-password-dialog"
          role="dialog"
        >
          <div className="max-h-full w-full max-w-xl overflow-y-auto rounded-lg border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-ink" id="reset-student-password-title">
                  <KeyRound className="h-5 w-5" aria-hidden="true" />
                  {credentials ? "Password reset" : "Reset student password?"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {displayName ? `${displayName} (${userId})` : userId}
                </p>
              </div>
              <button
                aria-label="Close password reset dialog"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:border-accent hover:text-ink disabled:opacity-50"
                disabled={resetting}
                onClick={closeDialog}
                type="button"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4">
              <ErrorPanel error={error} />
            </div>

            {!credentials ? (
              <>
                <div className="mt-4 space-y-3 text-sm leading-6 text-ink">
                  <p>
                    A new one-time password will be generated. The current password and active login sessions will stop working immediately.
                  </p>
                  <p>
                    The student must sign in with the one-time password and create a new password before continuing.
                  </p>
                  {accountStatus === "inactive" ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
                      This account is inactive. Resetting the password will not reactivate it.
                    </p>
                  ) : null}
                </div>
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <button
                    className="h-10 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
                    disabled={resetting}
                    onClick={closeDialog}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350] disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="confirm-reset-student-password"
                    disabled={resetting}
                    onClick={() => void confirmReset()}
                    type="button"
                  >
                    {resetting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                    )}
                    {resetting ? "Resetting" : "Reset password"}
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-4">
                <p className="text-sm leading-6 text-ink">
                  Give this one-time password to the student securely. It cannot be displayed again after this dialog is closed.
                </p>
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase text-amber-900">One-time password</p>
                  <p className="mt-2 break-all font-mono text-lg font-semibold text-ink" data-testid="temporary-student-password">
                    {temporaryPassword}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
                    onClick={() => void copyTemporaryPassword()}
                    type="button"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                    ) : (
                      <Clipboard className="h-4 w-4" aria-hidden="true" />
                    )}
                    {copied ? "Copied" : "Copy password"}
                  </button>
                  <button
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
                    onClick={() =>
                      downloadTextFile(
                        "student-temporary-password.csv",
                        credentials.credential_csv
                      )
                    }
                    type="button"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download CSV
                  </button>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    className="h-10 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350]"
                    onClick={closeDialog}
                    type="button"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
