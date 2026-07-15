"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, LogOut, Play, RefreshCcw } from "lucide-react";
import {
  endAssessmentAttempt,
  fetchAvailableAssessments,
  startAssessmentSession
} from "./api";
import {
  normalizeAssessmentStartErrorForStudent,
  shouldDisplayStudentApiErrorCode,
  startErrorRecoverySessionPublicId
} from "@/lib/student-assessment-ui/start-errors";
import type {
  AvailableAssessment,
  StructuredStudentApiError
} from "@/lib/student-assessment-ui/types";

function availabilityLabel(assessment: AvailableAssessment) {
  if (assessment.can_resume) {
    return "Resume available";
  }

  if (assessment.availability_status === "completed" && assessment.can_start) {
    return "New attempt available";
  }

  if (assessment.availability_status === "completed") {
    return "Completed";
  }

  if (assessment.can_start) {
    return "Available";
  }

  if (assessment.availability_state === "not_released") {
    return "Not released";
  }

  if (assessment.availability_state === "closed_to_new_starts") {
    return "Closed";
  }

  return "Unavailable";
}

function statusClass(assessment: AvailableAssessment) {
  if (assessment.availability_status === "completed" && !assessment.can_start) {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }

  if (assessment.can_resume) {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }

  if (assessment.can_start) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

function attemptCardSummary(assessment: AvailableAssessment) {
  if (assessment.existing_attempt_number && assessment.existing_session_status) {
    const status =
      assessment.existing_session_status === "paused"
        ? "paused"
        : assessment.existing_session_status === "active"
          ? "in progress"
          : assessment.existing_session_status;
    return `Attempt ${assessment.existing_attempt_number} ${status}`;
  }

  const attemptsUsed = assessment.attempt_policy?.attempts_used ?? 0;
  if (attemptsUsed === 0) {
    return "No attempts yet";
  }

  const previousLabel = attemptsUsed === 1 ? "previous attempt" : "previous attempts";
  if (assessment.can_start) {
    return `${attemptsUsed} ${previousLabel}. Next attempt: ${attemptsUsed + 1}`;
  }

  return `${attemptsUsed} ${previousLabel}`;
}

export function AvailableAssessmentsClient({ userId }: { userId: string }) {
  const router = useRouter();
  const [assessments, setAssessments] = useState<AvailableAssessment[]>([]);
  const [error, setError] = useState<StructuredStudentApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAssessment, setPendingAssessment] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function loadAssessments() {
    setError(null);
    setIsLoading(true);

    try {
      const result = await fetchAvailableAssessments();
      setAssessments(result.assessments);
      return result.assessments;
    } catch (caught) {
      const apiError = caught as StructuredStudentApiError;

      if (apiError.status === 401) {
        router.push("/student/login");
        return [];
      }

      setError(apiError);
      return [];
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAssessments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart(assessment: AvailableAssessment, options?: { newAttempt?: boolean }) {
    setPendingAssessment(assessment.assessment_public_id);
    setError(null);

    try {
      const result = await startAssessmentSession(assessment.assessment_public_id, options);
      void loadAssessments();
      startTransition(() => {
        router.push(`/student/assessment/${result.session.session_public_id}`);
      });
    } catch (caught) {
      const apiError = normalizeAssessmentStartErrorForStudent(
        caught as StructuredStudentApiError
      );
      const latestAssessments = await loadAssessments();
      const latestAssessment = latestAssessments.find(
        (candidate) => candidate.assessment_public_id === assessment.assessment_public_id
      );
      const recoverySessionPublicId =
        startErrorRecoverySessionPublicId(apiError) ??
        (latestAssessment?.can_resume ? latestAssessment.existing_session_public_id : null);

      if (recoverySessionPublicId) {
        setPendingAssessment(null);
        setError(null);
        startTransition(() => {
          router.push(`/student/assessment/${recoverySessionPublicId}`);
        });
        return;
      }

      setError(apiError);
      setPendingAssessment(null);
    }
  }

  async function handleEndCurrentAttempt(assessment: AvailableAssessment) {
    if (!assessment.existing_session_public_id) {
      return;
    }

    const confirmed = window.confirm(
      "End this attempt?\n\nYour responses so far will be saved, but you will not be able to resume this attempt. You may start another attempt only if the assessment's attempt policy allows it."
    );

    if (!confirmed) {
      return;
    }

    setPendingAssessment(assessment.assessment_public_id);
    setError(null);

    try {
      await endAssessmentAttempt(assessment.existing_session_public_id);
      await loadAssessments();
    } catch (caught) {
      const apiError = normalizeAssessmentStartErrorForStudent(
        caught as StructuredStudentApiError
      );
      const latestAssessments = await loadAssessments();
      const latestAssessment = latestAssessments.find(
        (candidate) => candidate.assessment_public_id === assessment.assessment_public_id
      );

      if (!latestAssessment?.can_resume) {
        setError(null);
        return;
      }

      setError(apiError);
    } finally {
      setPendingAssessment(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/student/login");
  }

  return (
    <main className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 md:px-6">
        <header className="flex flex-col gap-4 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">
              Student assessment
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">Assessments</h1>
            <p className="mt-2 text-sm text-muted">Signed in as {userId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
              onClick={() => void loadAssessments()}
              type="button"
            >
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
              onClick={() => void handleLogout()}
              type="button"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </header>

        <section className="py-6" aria-live="polite">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-white p-4 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading assessments
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{error.message}</p>
                  {shouldDisplayStudentApiErrorCode(error) ? (
                    <p className="mt-1 text-xs uppercase tracking-wide text-red-700">
                      {error.code}
                    </p>
                  ) : null}
                  {startErrorRecoverySessionPublicId(error) ? (
                    <button
                      className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-red-900 px-3 text-xs font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-300"
                      onClick={() => {
                        const sessionPublicId = startErrorRecoverySessionPublicId(error);

                        if (sessionPublicId) {
                          router.push(`/student/assessment/${sessionPublicId}`);
                        }
                      }}
                      type="button"
                    >
                      Resume current attempt
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {!isLoading && assessments.length === 0 ? (
            <div className="rounded-lg border border-line bg-white p-6">
              <h2 className="text-lg font-semibold text-ink">No assessments available</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Your teacher researcher has not published an available assessment yet.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3">
            {assessments.map((assessment) => {
              const isBusy =
                pendingAssessment === assessment.assessment_public_id || isPending;
              const canOpen = Boolean(assessment.can_resume && assessment.existing_session_public_id);
              const canStartNew = assessment.can_start && !canOpen;
              const startLabel =
                assessment.latest_terminal_attempt_number || assessment.latest_completed_attempt_number
                  ? "Start new attempt"
                  : "Start assessment";

              return (
                <article
                  className="rounded-lg border border-line bg-white p-4 shadow-soft"
                  key={assessment.assessment_public_id}
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-ink">{assessment.title}</h2>
                        <span
                          className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(assessment)}`}
                        >
                          {availabilityLabel(assessment)}
                        </span>
                      </div>
                      {assessment.description ? (
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                          {assessment.description}
                        </p>
                      ) : null}
                      {assessment.existing_session_status ? (
                        <p className="mt-3 text-xs uppercase tracking-wide text-muted">
                          Current attempt {assessment.existing_attempt_number ?? ""} status:{" "}
                          {assessment.existing_session_status}
                        </p>
                      ) : null}
                      {!assessment.existing_session_status && assessment.latest_completed_attempt_number ? (
                        <p className="mt-3 text-xs uppercase tracking-wide text-muted">
                          Latest completed attempt: {assessment.latest_completed_attempt_number}
                        </p>
                      ) : null}
                      <p className="mt-3 text-sm leading-6 text-muted">
                        {assessment.student_safe_availability_message}
                      </p>
                      {assessment.attempt_policy ? (
                        <p className="mt-1 text-xs text-muted">
                          {attemptCardSummary(assessment)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {canStartNew ? (
                        <button
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                          data-testid={`start-assessment-${assessment.assessment_public_id}`}
                          disabled={isBusy}
                          onClick={() =>
                            void handleStart(assessment, {
                              newAttempt: Boolean(assessment.latest_completed_attempt_number)
                            })
                          }
                          type="button"
                        >
                          {isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Play className="h-4 w-4" aria-hidden="true" />
                          )}
                          {startLabel}
                        </button>
                      ) : null}
                      {canOpen ? (
                        <>
                          <button
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid={`resume-assessment-${assessment.assessment_public_id}`}
                            disabled={isBusy}
                            onClick={() => void handleStart(assessment)}
                            type="button"
                          >
                            {isBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Play className="h-4 w-4" aria-hidden="true" />
                            )}
                            Resume attempt
                          </button>
                          <button
                            className="inline-flex h-10 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid={`end-current-attempt-${assessment.assessment_public_id}`}
                            disabled={isBusy || !assessment.attempt_policy?.student_may_end_attempt}
                            onClick={() => void handleEndCurrentAttempt(assessment)}
                            type="button"
                          >
                            End current attempt
                          </button>
                        </>
                      ) : null}
                      {!assessment.can_start && !canOpen ? (
                        <button
                          className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-slate-50 px-4 text-sm font-semibold text-muted"
                          disabled
                          type="button"
                        >
                          {assessment.availability_status === "completed"
                            ? "Completed"
                            : "Unavailable"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
