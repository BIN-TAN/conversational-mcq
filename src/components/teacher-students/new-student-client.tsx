"use client";

import { useState } from "react";
import { Clipboard, UserPlus } from "lucide-react";
import { createStudent, errorFromUnknown } from "./api";
import type { CredentialResponse, StructuredApiError } from "./types";
import { CredentialResult, ErrorPanel } from "./ui";

export function NewStudentClient() {
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [credentials, setCredentials] = useState<CredentialResponse | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    setCredentials(null);
    setCreatedUserId(null);

    try {
      const result = await createStudent({
        user_id: userId,
        display_name: displayName
      });
      setCredentials({
        one_time_credentials: result.one_time_credentials,
        credential_csv: result.credential_csv,
        credential_warning: result.credential_warning
      });
      setCreatedUserId(result.student.user_id);
      setUserId("");
      setDisplayName("");
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }

  const firstCode = credentials?.one_time_credentials[0]?.temporary_access_code;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Create one student</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          The canonical user_id cannot be edited later. If an incorrect ID is created, create the
          correct account and deactivate the incorrect account.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            user_id
            <input
              className="h-10 rounded-md border border-line px-3 text-sm"
              onChange={(event) => setUserId(event.target.value)}
              placeholder="student001"
              value={userId}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Display name
            <input
              className="h-10 rounded-md border border-line px-3 text-sm"
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Optional"
              value={displayName}
            />
          </label>
        </div>
        <button
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350] disabled:opacity-50"
          disabled={loading}
          onClick={() => void submit()}
          type="button"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {loading ? "Creating" : "Create student"}
        </button>
      </section>

      <ErrorPanel error={error} />

      {createdUserId ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Created student account {createdUserId}.
        </section>
      ) : null}

      {firstCode ? (
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
          onClick={() => navigator.clipboard.writeText(firstCode)}
          type="button"
        >
          <Clipboard className="h-4 w-4" aria-hidden="true" />
          Copy temporary access code
        </button>
      ) : null}

      {credentials ? (
        <CredentialResult
          credentials={credentials.one_time_credentials}
          credentialCsv={credentials.credential_csv}
          warning={credentials.credential_warning}
        />
      ) : null}
    </div>
  );
}
