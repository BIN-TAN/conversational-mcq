"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save
} from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import { parseJsonObject, stringifyJson } from "./form-utils";
import type { ConceptUnitDetail, ItemDetail, StructuredApiError } from "./types";
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
  };
};

type ItemsResponse = {
  items: ItemDetail[];
};

export function ConceptUnitDetailClient({
  conceptUnitPublicId
}: {
  conceptUnitPublicId: string;
}) {
  const [conceptUnit, setConceptUnit] = useState<ConceptUnitDetail | null>(null);
  const [title, setTitle] = useState("");
  const [learningObjective, setLearningObjective] = useState("");
  const [relatedDescription, setRelatedDescription] = useState("");
  const [administrationRules, setAdministrationRules] = useState("{}");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

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
      setAdministrationRules(stringifyJson(data.concept_unit.administration_rules));
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
      await apiRequest<ConceptUnitResponse>(`/api/teacher/concept-units/${conceptUnitPublicId}`, {
        method: "PUT",
        body: JSON.stringify({
          title,
          learning_objective: learningObjective,
          related_concept_description: relatedDescription,
          administration_rules: parseJsonObject(administrationRules, "Administration rules")
        })
      });
      setSuccess("Concept-unit metadata saved. Version increments when content changes.");
      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function publishConceptUnit() {
    setBusyAction("publish");
    setError(null);
    setSuccess(null);

    try {
      const data = await apiRequest<ConceptUnitResponse>(
        `/api/teacher/concept-units/${conceptUnitPublicId}/publish`,
        { method: "POST" }
      );
      setSuccess(
        `Concept unit published with ${data.validation?.active_item_count ?? "validated"} active items.`
      );
      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function archiveConceptUnit() {
    setBusyAction("archive");
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/concept-units/${conceptUnitPublicId}/archive`, {
        method: "POST"
      });
      setSuccess("Concept unit archived.");
      await loadConceptUnit();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function returnConceptUnitToDraft() {
    const confirmed = window.confirm(
      "Return this concept unit to draft before editing its content or item membership?"
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
      setSuccess("Concept unit returned to draft.");
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
        eyebrow="concept unit"
        title={conceptUnit?.title ?? "Concept unit detail"}
        description="Concept metadata, publish validation, and MCQ items."
        actions={
          <>
            {isConceptUnitEditable ? (
              <PrimaryLink href={`/teacher/content/concept-units/${conceptUnitPublicId}/items/new`}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                New item
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

      {isLoading ? <LoadingRow label="Loading concept unit" /> : null}

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
                      ? "Return the parent assessment to draft before editing this concept unit."
                      : conceptUnit.status === "published"
                        ? "Return the concept unit to draft before editing its content or item membership."
                        : "Return the parent assessment to draft before editing this concept unit."}
                </p>
              ) : null}
              <div className="mt-5 grid gap-4">
                <Field label="Title">
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
                <Field label="Related concept description">
                  <textarea
                    className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isConceptUnitEditable}
                    onChange={(event) => setRelatedDescription(event.target.value)}
                    required
                    value={relatedDescription}
                  />
                </Field>
                <Field label="Administration rules" hint="JSON object">
                  <textarea
                    className="min-h-28 rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isConceptUnitEditable}
                    onChange={(event) => setAdministrationRules(event.target.value)}
                    value={administrationRules}
                  />
                </Field>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={!isConceptUnitEditable || isSubmitting} type="submit">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting ? "Saving" : "Save metadata"}
                </Button>
                <Button
                  disabled={isLocked || conceptUnit.status === "archived" || busyAction === "publish"}
                  onClick={publishConceptUnit}
                  type="button"
                  variant="secondary"
                >
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  Publish concept unit
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
              <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-ink">Items</h2>
                  <p className="mt-1 text-sm text-muted">
                    Candidate items: {conceptUnit.candidate_item_count ?? conceptUnit.items.length}. Included active items: {includedActiveItemCount}. Publish requires 3 to 4 included active items.
                  </p>
                </div>
                {isConceptUnitEditable ? (
                  <PrimaryLink href={`/teacher/content/concept-units/${conceptUnitPublicId}/items/new`}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Add item
                  </PrimaryLink>
                ) : null}
              </div>

              {conceptUnit.items.length === 0 ? (
                <p className="mt-5 text-sm text-muted">No items yet.</p>
              ) : (
                <div className="mt-5 space-y-3">
                  {conceptUnit.items.map((item, index) => (
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
                          </div>
                          <h3 className="mt-3 font-semibold text-ink">{item.item_stem}</h3>
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
                    </article>
                  ))}
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
                  <dd className="font-medium text-ink">{includedActiveItemCount} of 3 to 4 required</dd>
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
