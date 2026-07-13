"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  AlertTriangle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save
} from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import { parseJsonObject, stringifyJson } from "./form-utils";
import {
  mergeTopicDiagnosticNoteIntoRules,
  readTeacherItemMetadata,
  readTopicDiagnosticNote
} from "@/lib/services/content/teacher-diagnostic-context";
import type {
  ConceptUnitDetail,
  ItemDetail,
  ItemVerificationFinding,
  ItemVerificationStatus,
  StructuredApiError
} from "./types";
import {
  Button,
  ContentStateBadge,
  ErrorPanel,
  Field,
  LoadingRow,
  PageHeader,
  PrimaryLink,
  StatusBadge,
  SuccessPanel,
  formatDate
} from "./ui";

type ConceptUnitResponse = {
  concept_unit: ConceptUnitDetail;
  validation?: {
    ok: boolean;
    active_item_count?: number;
    errors?: unknown[];
    warnings?: unknown[];
  };
};

type ItemsResponse = {
  items: ItemDetail[];
};

type VerificationResponse = ItemVerificationStatus;

type RunVerificationResponse = {
  status: string;
  deterministic_validation: ItemVerificationStatus["deterministic_validation"];
  verification: ItemVerificationStatus["latest_verification"];
  content_fingerprint: string;
};

function itemOptions(value: unknown): Array<{ label: string; text: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label : "";
      const text = typeof record.text === "string" ? record.text : "";
      return label && text ? { label, text } : null;
    })
    .filter((entry): entry is { label: string; text: string } => Boolean(entry));
}

function itemNotesPresent(item: ItemDetail): boolean {
  const metadata = readTeacherItemMetadata(item.administration_rules);
  return Boolean(
    metadata.item_label ||
      metadata.expected_reasoning_note ||
      metadata.item_diagnostic_value_note ||
      metadata.correct_option_notes.target_reasoning_note ||
      metadata.correct_option_notes.strong_reasoning_should_mention ||
      metadata.correct_option_notes.weak_unsupported_correctness_looks_like ||
      metadata.option_notes.length > 0
  );
}

export function ConceptUnitDetailClient({
  conceptUnitPublicId
}: {
  conceptUnitPublicId: string;
}) {
  const [conceptUnit, setConceptUnit] = useState<ConceptUnitDetail | null>(null);
  const [title, setTitle] = useState("");
  const [learningObjective, setLearningObjective] = useState("");
  const [relatedDescription, setRelatedDescription] = useState("");
  const [teacherDiagnosticNote, setTeacherDiagnosticNote] = useState("");
  const [administrationRules, setAdministrationRules] = useState("{}");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [verification, setVerification] = useState<ItemVerificationStatus | null>(null);

  const loadConceptUnit = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiRequest<ConceptUnitResponse>(
        `/api/teacher/concept-units/${conceptUnitPublicId}`
      );
      setConceptUnit(data.concept_unit);
      setTitle(data.concept_unit.title);
      setLearningObjective(data.concept_unit.learning_objective);
      setRelatedDescription(data.concept_unit.related_concept_description);
      setTeacherDiagnosticNote(readTopicDiagnosticNote(data.concept_unit.administration_rules));
      setAdministrationRules(stringifyJson(data.concept_unit.administration_rules));
      const verificationData = await apiRequest<VerificationResponse>(
        `/api/teacher/concept-units/${conceptUnitPublicId}/verification`
      );
      setVerification(verificationData);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsLoading(false);
    }
  }, [conceptUnitPublicId]);

  useEffect(() => {
    void loadConceptUnit();
  }, [loadConceptUnit]);

  async function saveConceptUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const rules = mergeTopicDiagnosticNoteIntoRules({
        administration_rules: parseJsonObject(administrationRules, "Advanced settings"),
        topic_diagnostic_note: teacherDiagnosticNote
      });
      await apiRequest<ConceptUnitResponse>(`/api/teacher/concept-units/${conceptUnitPublicId}`, {
        method: "PUT",
        body: JSON.stringify({
          title,
          learning_objective: learningObjective,
          related_concept_description: relatedDescription,
          administration_rules: rules
        })
      });
      setSuccess("Topic metadata saved. Version increments when content changes.");
      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function publishConceptUnit(confirmWithoutCurrentVerification = false) {
    setBusyAction("publish");
    setError(null);
    setSuccess(null);

    try {
      const data = await apiRequest<ConceptUnitResponse>(
        `/api/teacher/concept-units/${conceptUnitPublicId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({
            confirm_publish_without_current_verification: confirmWithoutCurrentVerification
          })
        }
      );
      setSuccess(
        `Topic published with ${data.validation?.active_item_count ?? "validated"} active items.`
      );
      await loadConceptUnit();
    } catch (caught) {
      const parsed = errorFromUnknown(caught);

      if (parsed.code === "current_verification_missing_or_stale") {
        const confirmed = window.confirm(
          "The deterministic format checks passed, but there is no current AI semantic verification for this exact item-set version. You may still publish based on your own review."
        );

        if (confirmed) {
          setBusyAction(null);
          await publishConceptUnit(true);
          return;
        }
      }

      setError(parsed);
    } finally {
      setBusyAction(null);
    }
  }

  async function runVerification(mockMode?: string) {
    setBusyAction("verify");
    setError(null);
    setSuccess(null);

    try {
      const data = await apiRequest<RunVerificationResponse>(
        `/api/teacher/concept-units/${conceptUnitPublicId}/verify`,
        {
          method: "POST",
          body: JSON.stringify(mockMode ? { mock_mode: mockMode } : {})
        }
      );

      if (data.status === "deterministic_validation_failed") {
        setSuccess("Deterministic validation must pass before AI semantic verification can run.");
      } else if (data.status === "already_verified") {
        setSuccess("Current item-set fingerprint already has a completed verification.");
      } else if (data.status.endsWith("failed")) {
        setSuccess("Verification did not complete. Deterministic validation remains available.");
      } else {
        setSuccess("Verification completed.");
      }

      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function acknowledgeWarnings() {
    if (!verification?.latest_verification) {
      return;
    }

    const confirmed = window.confirm(
      "These are advisory AI-generated warnings. Review them using your subject-matter judgment. Acknowledging them does not mean the warnings are correct; it confirms that you reviewed them before publishing."
    );

    if (!confirmed) {
      return;
    }

    setBusyAction("acknowledge-verification");
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(
        `/api/teacher/concept-units/${conceptUnitPublicId}/verification/${verification.latest_verification.verification_public_id}/acknowledge`,
        { method: "POST" }
      );
      setSuccess("Verification warnings acknowledged for this item-set fingerprint.");
      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  function renderFinding(finding: ItemVerificationFinding, index: number) {
    return (
      <li className="rounded-md border border-amber-200 bg-amber-50 p-3" key={`${finding.issue_code}-${index}`}>
        <p className="font-semibold text-amber-950">{finding.issue_code.replaceAll("_", " ")}</p>
        <p className="mt-1 text-xs text-amber-900">
          {finding.location}
          {finding.option_label ? ` · option ${finding.option_label}` : ""}
          {finding.item_public_id ? ` · ${finding.item_public_id}` : ""}
        </p>
        <p className="mt-2 text-sm text-amber-950">{finding.brief_explanation}</p>
      </li>
    );
  }

  async function archiveConceptUnit() {
    setBusyAction("archive");
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/concept-units/${conceptUnitPublicId}/archive`, {
        method: "POST"
      });
      setSuccess("Topic archived.");
      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function returnConceptUnitToDraft() {
    const confirmed = window.confirm(
      "Return this topic to draft before editing its content or item membership?"
    );

    if (!confirmed) {
      return;
    }

    setBusyAction("return-to-draft");
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/concept-units/${conceptUnitPublicId}/return-to-draft`, {
        method: "POST"
      });
      setSuccess("Topic returned to draft.");
      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function archiveItem(item: ItemDetail) {
    setBusyAction(`archive-${item.item_public_id}`);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/items/${item.item_public_id}/archive`, { method: "POST" });
      setSuccess(`Archived item ${item.item_public_id}.`);
      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function reorderItem(item: ItemDetail, direction: -1 | 1) {
    if (!conceptUnit) {
      return;
    }

    const currentIndex = conceptUnit.items.findIndex(
      (entry) => entry.item_public_id === item.item_public_id
    );
    const nextIndex = currentIndex + direction;

    if (nextIndex < 0 || nextIndex >= conceptUnit.items.length) {
      return;
    }

    const reordered = [...conceptUnit.items];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    setBusyAction(`reorder-${item.item_public_id}`);
    setError(null);
    setSuccess(null);

    try {
      const data = await apiRequest<ItemsResponse>(
        `/api/teacher/concept-units/${conceptUnitPublicId}/reorder-items`,
        {
          method: "POST",
          body: JSON.stringify({
            ordered_item_public_ids: reordered.map((entry) => entry.item_public_id)
          })
        }
      );
      setConceptUnit({ ...conceptUnit, items: data.items });
      setSuccess("Item order updated.");
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  const activeItemCount = conceptUnit?.items.filter((item) => item.status !== "archived").length ?? 0;
  const includedActiveItemCount =
    conceptUnit?.items.filter(
      (item) => item.status !== "archived" && item.included_in_published_set
    ).length ?? 0;
  const isParentDraftEditable = conceptUnit?.content_state === "draft_editable";
  const isLocked = Boolean(conceptUnit?.is_content_locked);
  const isConceptUnitEditable = Boolean(
    conceptUnit && isParentDraftEditable && conceptUnit.status === "draft"
  );
  const canReturnToDraft = Boolean(
    conceptUnit &&
      isParentDraftEditable &&
      conceptUnit.status === "published" &&
      !conceptUnit.has_student_sessions
  );
  const isReadOnly = Boolean(conceptUnit && !isConceptUnitEditable);

  return (
    <div className="space-y-6">
      <PageHeader
        title={conceptUnit?.title ?? "Topic detail"}
        actions={
          <>
            {isConceptUnitEditable ? (
              <PrimaryLink href={`/teacher/content/concept-units/${conceptUnitPublicId}/items/new`}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add MCQ item
              </PrimaryLink>
            ) : null}
            <Button disabled={isLoading} onClick={loadConceptUnit} type="button" variant="secondary">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
          </>
        }
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />

      {isLoading ? <LoadingRow label="Loading topic" /> : null}

      {conceptUnit ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6">
            <form className="rounded-lg border border-line bg-white p-5 shadow-soft" onSubmit={saveConceptUnit}>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={conceptUnit.status} />
                <ContentStateBadge state={conceptUnit.content_state} />
                <span className="font-mono text-xs text-muted">{conceptUnit.concept_unit_public_id}</span>
                <span className="text-xs text-muted">Version {conceptUnit.version}</span>
                <span className="text-xs text-muted">Order {conceptUnit.order_index}</span>
              </div>
              {isReadOnly ? (
                <p className="mt-4 rounded-md border border-line bg-slate-50 p-3 text-sm leading-6 text-muted">
                  {isLocked
                    ? "Student data collection has started. The administered content is now read-only to preserve research consistency."
                    : !isParentDraftEditable
                      ? "Return the parent assessment to draft before editing this topic."
                      : conceptUnit.status === "published"
                        ? "Return the topic to draft before editing its content or item membership."
                        : "Return the parent assessment to draft before editing this topic."}
                </p>
              ) : null}
              <div className="mt-5 grid gap-4">
                <Field label="Topic title">
                  <input
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isConceptUnitEditable}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </Field>
                <Field label="Learning objective">
                  <textarea
                    className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isConceptUnitEditable}
                    onChange={(event) => setLearningObjective(event.target.value)}
                    required
                    value={learningObjective}
                  />
                </Field>
                <Field label="Concept description">
                  <textarea
                    className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isConceptUnitEditable}
                    onChange={(event) => setRelatedDescription(event.target.value)}
                    required
                    value={relatedDescription}
                  />
                </Field>
                <Field
                  label="Optional teacher diagnostic note for topic"
                  hint="Teacher-only guidance for later interpretation. Students do not see this note."
                >
                  <textarea
                    className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isConceptUnitEditable}
                    onChange={(event) => setTeacherDiagnosticNote(event.target.value)}
                    value={teacherDiagnosticNote}
                  />
                </Field>
                <details className="rounded-md border border-line bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-ink">
                    Advanced settings
                  </summary>
                  <div className="mt-3">
                    <Field label="Administration rules JSON" hint="Optional advanced JSON object. Standard topic fields above are preferred.">
                      <textarea
                        className="min-h-28 rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                        disabled={!isConceptUnitEditable}
                        onChange={(event) => setAdministrationRules(event.target.value)}
                        value={administrationRules}
                      />
                    </Field>
                  </div>
                </details>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={!isConceptUnitEditable || isSubmitting} type="submit">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting ? "Saving" : "Save metadata"}
                </Button>
                <Button
                  disabled={isLocked || conceptUnit.status === "archived" || busyAction === "publish"}
                  onClick={() => publishConceptUnit(false)}
                  type="button"
                  variant="secondary"
                >
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  Publish topic
                </Button>
                {canReturnToDraft ? (
                  <Button
                    disabled={busyAction === "return-to-draft"}
                    onClick={returnConceptUnitToDraft}
                    type="button"
                    variant="secondary"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Return to draft
                  </Button>
                ) : null}
                <Button
                  disabled={isLocked || conceptUnit.status === "archived" || busyAction === "archive"}
                  onClick={archiveConceptUnit}
                  type="button"
                  variant="danger"
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  Archive
                </Button>
              </div>
            </form>

            <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-ink">Verification</h2>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    You define the concepts and items. The system checks structure and highlights possible relevance or quality issues for your review.
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    Verification does not replace teacher subject-matter judgment.
                  </p>
                </div>
                <Button
                  disabled={Boolean(busyAction) || isLocked || conceptUnit.status === "archived"}
                  onClick={() => runVerification()}
                  type="button"
                  variant="secondary"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Run verification
                </Button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-line p-3 text-sm">
                  <p className="text-muted">Deterministic validation</p>
                  <p className="font-semibold text-ink">
                    {verification?.deterministic_validation.ok ? "passes" : "needs fixes"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Included active items: {verification?.deterministic_validation.included_active_item_count ?? includedActiveItemCount}
                  </p>
                </div>
                <div className="rounded-md border border-line p-3 text-sm">
                  <p className="text-muted">Current AI verification</p>
                  <p className="font-semibold text-ink">
                    {verification?.latest_verification
                      ? verification.latest_verification.is_current
                        ? verification.latest_verification.verification_status.replaceAll("_", " ")
                        : "stale"
                      : "not run"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Warnings: {verification?.latest_verification?.warning_count ?? 0}
                  </p>
                </div>
              </div>

              {verification?.deterministic_validation.errors?.length ? (
                <ul className="mt-4 space-y-2 text-sm">
                  {verification.deterministic_validation.errors.map((issue) => (
                    <li className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900" key={`${issue.path}-${issue.code}`}>
                      <span className="font-semibold">{issue.path}</span>: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}

              {verification?.deterministic_validation.warnings?.length ? (
                <ul className="mt-4 space-y-2 text-sm">
                  {verification.deterministic_validation.warnings.map((issue) => (
                    <li className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950" key={`${issue.path}-${issue.code}`}>
                      <span className="font-semibold">{issue.path}</span>: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}

              {verification?.latest_verification ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-md border border-line bg-slate-50 p-3 text-sm text-muted">
                    <p>
                      Source: {verification.latest_verification.agent_call?.provider ?? "none"} · model{" "}
                      {verification.latest_verification.agent_call?.model_name ?? "not recorded"} · prompt{" "}
                      {verification.latest_verification.agent_call?.prompt_version ?? "not recorded"} · schema{" "}
                      {verification.latest_verification.agent_call?.schema_version ?? "not recorded"}
                    </p>
                    <p className="mt-1">
                      Status: {verification.latest_verification.status} · current{" "}
                      {verification.latest_verification.is_current ? "yes" : "no"} · acknowledged{" "}
                      {verification.latest_verification.acknowledged ? "yes" : "no"}
                    </p>
                  </div>

                  {verification.latest_verification.warning_count > 0 &&
                  verification.latest_verification.is_current &&
                  !verification.latest_verification.acknowledged ? (
                    <Button
                      disabled={busyAction === "acknowledge-verification"}
                      onClick={acknowledgeWarnings}
                      type="button"
                      variant="secondary"
                    >
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      Acknowledge warnings
                    </Button>
                  ) : null}

                  {verification.latest_verification.failure_message ? (
                    <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                      {verification.latest_verification.failure_message}
                    </p>
                  ) : null}

                  {verification.latest_verification.output?.set_level_findings.length ? (
                    <div>
                      <h3 className="font-semibold text-ink">Set-level findings</h3>
                      <ul className="mt-2 space-y-2">
                        {verification.latest_verification.output.set_level_findings.map(renderFinding)}
                      </ul>
                    </div>
                  ) : null}

                  {verification.latest_verification.output?.item_results.some(
                    (result) => result.findings.length > 0
                  ) ? (
                    <div>
                      <h3 className="font-semibold text-ink">Per-item findings</h3>
                      <div className="mt-2 space-y-3">
                        {verification.latest_verification.output.item_results
                          .filter((result) => result.findings.length > 0)
                          .map((result) => (
                            <div className="rounded-md border border-line p-3" key={result.item_public_id}>
                              <p className="font-mono text-xs text-muted">{result.item_public_id}</p>
                              <ul className="mt-2 space-y-2">
                                {result.findings.map(renderFinding)}
                              </ul>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 rounded-md border border-line bg-slate-50 p-3 text-sm text-muted">
                  No AI semantic verification has been recorded for this topic.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-ink">Items</h2>
                  <p className="mt-1 text-sm text-muted">
                    Candidate items: {conceptUnit.candidate_item_count ?? conceptUnit.items.length}. Included active items: {includedActiveItemCount}. Publish requires at least 3 included active items.
                  </p>
                </div>
                {isConceptUnitEditable ? (
                  <PrimaryLink href={`/teacher/content/concept-units/${conceptUnitPublicId}/items/new`}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Add MCQ item
                  </PrimaryLink>
                ) : null}
              </div>

              {conceptUnit.items.length === 0 ? (
                <p className="mt-5 text-sm text-muted">No MCQ items yet.</p>
              ) : (
                <div className="mt-5 space-y-3">
                  {conceptUnit.items.map((item, index) => {
                    const options = itemOptions(item.options);
                    const notesPresent = itemNotesPresent(item);
                    const metadata = readTeacherItemMetadata(item.administration_rules);
                    const label = metadata.item_label || `Item ${item.item_order}`;

                    return (
                      <article className="rounded-lg border border-line p-4" key={item.item_public_id}>
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge status={item.status} />
                              <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${item.included_in_published_set ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                                {item.included_in_published_set ? "included" : "candidate"}
                              </span>
                              <span className="text-xs text-muted">Order {item.item_order}</span>
                              <span className="text-xs text-muted">Version {item.version}</span>
                              <span className="text-xs text-muted">Options {options.length}</span>
                              <span className="text-xs text-muted">
                                Notes {notesPresent ? "present" : "absent"}
                              </span>
                            </div>
                            <h3 className="mt-3 font-semibold text-ink">{label}</h3>
                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{item.item_stem}</p>
                            <p className="mt-2 font-mono text-xs text-muted">{item.item_public_id}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              aria-label="Move item up"
                              disabled={!isConceptUnitEditable || index === 0 || Boolean(busyAction)}
                              onClick={() => reorderItem(item, -1)}
                              type="button"
                              variant="secondary"
                            >
                              <ArrowUp className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              aria-label="Move item down"
                              disabled={!isConceptUnitEditable || index === conceptUnit.items.length - 1 || Boolean(busyAction)}
                              onClick={() => reorderItem(item, 1)}
                              type="button"
                              variant="secondary"
                            >
                              <ArrowDown className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Link
                              className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-semibold text-ink transition hover:border-accent"
                              href={`/teacher/content/items/${item.item_public_id}`}
                            >
                              Edit
                            </Link>
                            <Button
                              disabled={item.status === "archived" || busyAction === `archive-${item.item_public_id}`}
                              onClick={() => archiveItem(item)}
                              type="button"
                              variant="danger"
                            >
                              <Archive className="h-4 w-4" aria-hidden="true" />
                              Archive
                            </Button>
                          </div>
                        </div>
                        <details className="mt-4 rounded-md border border-line bg-slate-50 p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-ink">
                            Preview student view
                          </summary>
                          <div className="mt-3 rounded-md border border-line bg-white p-3 text-sm leading-6 text-ink">
                            <p className="font-semibold">{item.item_stem}</p>
                            <ol className="mt-2 space-y-1">
                              {options.map((option) => (
                                <li key={option.label}>
                                  <span className="font-semibold">{option.label}.</span> {option.text}
                                </li>
                              ))}
                            </ol>
                          </div>
                        </details>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </section>

          <aside className="space-y-4">
            <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <h2 className="font-semibold text-ink">Publish readiness</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                  Backend validation checks item count, option labels, correct option, distractor
                  rationales, expected reasoning patterns, and misconception indicators.
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Active items</dt>
                  <dd className="font-medium text-ink">{activeItemCount}</dd>
                </div>
                <div>
                  <dt className="text-muted">Included active items</dt>
                  <dd className="font-medium text-ink">{includedActiveItemCount} included; at least 3 required</dd>
                </div>
                <div>
                  <dt className="text-muted">Candidate items</dt>
                  <dd className="font-medium text-ink">{conceptUnit.candidate_item_count ?? conceptUnit.items.length}</dd>
                </div>
                <div>
                  <dt className="text-muted">Student sessions</dt>
                  <dd className="font-medium text-ink">
                    {conceptUnit.has_student_sessions ? "Started" : "None"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Updated</dt>
                  <dd className="font-medium text-ink">{formatDate(conceptUnit.updated_at)}</dd>
                </div>
              </dl>
            </section>
            <section className="rounded-lg border border-line bg-white p-5 text-sm leading-6 text-muted shadow-soft">
              Before classroom use, you choose item membership and ordering. After a student session
              starts, content is read-only and only whole-assessment archive remains available.
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
