"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { CheckCircle, FileDown, FileUp, RefreshCw, Sparkles, Upload } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type {
  McqImportBatch,
  McqImportBatchResponse,
  McqImportCandidate,
  McqImportCommitResponse,
  McqImportPreviewResponse,
  StructuredApiError
} from "./types";
import {
  Button,
  ErrorPanel,
  Field,
  PageHeader,
  PrimaryLink,
  StatusBadge,
  SuccessPanel
} from "./ui";

type SourceType = "csv" | "xlsx" | "plain_text" | "project_json";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",").pop() ?? "" : value);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function suggestionRecord(candidate: McqImportCandidate): Record<string, unknown> {
  return candidate.suggestion && typeof candidate.suggestion === "object" && !Array.isArray(candidate.suggestion)
    ? (candidate.suggestion as Record<string, unknown>)
    : {};
}

function suggestionText(candidate: McqImportCandidate, key: string) {
  const value = suggestionRecord(candidate)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function currentValueForSuggestionField(candidate: McqImportCandidate, key: string) {
  if (key === "suggested_target_reasoning_note") {
    return candidate.target_reasoning_note;
  }
  if (key === "suggested_strong_reasoning_should_mention") {
    return candidate.strong_reasoning_should_mention;
  }
  if (key === "suggested_plain_language_distractor_notes") {
    return candidate.distractor_diagnostic_notes;
  }
  return null;
}

function statusTone(status: string) {
  if (status === "ready_as_draft" || status === "imported") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "needs_key" || status === "needs_review") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-red-200 bg-red-50 text-red-800";
}

export function McqImportClient({ assessmentPublicId }: { assessmentPublicId: string }) {
  const [sourceType, setSourceType] = useState<SourceType>("csv");
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [mappingJson, setMappingJson] = useState("");
  const [batch, setBatch] = useState<McqImportBatch | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const selectedCount = useMemo(
    () => batch?.candidates.filter((candidate) => candidate.import_selected).length ?? 0,
    [batch]
  );

  function updateCandidate(
    candidatePublicId: string,
    updater: (candidate: McqImportCandidate) => McqImportCandidate
  ) {
    setBatch((previous) =>
      previous
        ? {
            ...previous,
            candidates: previous.candidates.map((candidate) =>
              candidate.candidate_public_id === candidatePublicId
                ? updater(candidate)
                : candidate
            )
          }
        : previous
    );
  }

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusyAction("preview");

    try {
      const columnMapping = mappingJson.trim() ? JSON.parse(mappingJson) : undefined;
      const fileBase64 = sourceFile ? await readFileAsBase64(sourceFile) : undefined;
      const data = await apiRequest<McqImportPreviewResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/mcq-import/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            source_type: sourceType,
            source_text: sourceFile ? undefined : sourceText,
            file_base64: fileBase64,
            source_file_name: sourceFile?.name ?? null,
            column_mapping: columnMapping
          })
        }
      );

      setBatch(data.batch);
      setSuccess(`Preview created with ${data.batch.candidate_count} candidates.`);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function reloadBatch() {
    if (!batch) return;
    setBusyAction("reload");
    setError(null);
    try {
      const data = await apiRequest<McqImportBatchResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/mcq-import/${batch.batch_public_id}`
      );
      setBatch(data.batch);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function suggestForSelected() {
    if (!batch) return;
    setBusyAction("suggest");
    setError(null);
    setSuccess(null);
    try {
      const data = await apiRequest<McqImportBatchResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/mcq-import/${batch.batch_public_id}/suggest`,
        {
          method: "POST",
          body: JSON.stringify({
            mode: "live",
            candidate_public_ids: batch.candidates
              .filter((candidate) => candidate.import_selected)
              .map((candidate) => candidate.candidate_public_id),
            candidate_updates: batch.candidates.map((candidate) => ({
              candidate_public_id: candidate.candidate_public_id,
              import_selected: candidate.import_selected,
              item_label: candidate.item_label,
              stem: candidate.stem,
              options: candidate.options,
              teacher_confirmed_key: candidate.teacher_confirmed_key,
              target_reasoning_note: candidate.target_reasoning_note,
              strong_reasoning_should_mention: candidate.strong_reasoning_should_mention,
              distractor_diagnostic_notes: candidate.distractor_diagnostic_notes,
              media_assets: candidate.media_assets,
              suggestion_decisions: candidate.suggestion_decisions
            }))
          })
        }
      );
      setBatch(data.batch);
      const failed = data.batch.candidates.filter((candidate) => candidate.suggestion_status === "failed").length;
      setSuccess(
        failed > 0
          ? `Diagnostic suggestions returned with ${failed} item${failed === 1 ? "" : "s"} unavailable. You can continue reviewing and importing manually.`
          : "Diagnostic suggestions added for selected candidates. Review before accepting."
      );
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  function acceptSelectedBlankSuggestions() {
    setBatch((previous) =>
      previous
        ? {
            ...previous,
            candidates: previous.candidates.map((candidate) => {
              if (!candidate.import_selected || !candidate.suggestion) return candidate;

              const decisions = { ...(candidate.suggestion_decisions ?? {}) };
              for (const field of [
                "suggested_target_reasoning_note",
                "suggested_strong_reasoning_should_mention",
                "suggested_plain_language_distractor_notes"
              ]) {
                if (
                  suggestionText(candidate, field) &&
                  !currentValueForSuggestionField(candidate, field)
                ) {
                  decisions[field] = { decision: "accept" };
                }
              }

              return { ...candidate, suggestion_decisions: decisions };
            })
          }
        : previous
    );
  }

  async function commitImport() {
    if (!batch) return;
    setBusyAction("commit");
    setError(null);
    setSuccess(null);
    try {
      const data = await apiRequest<McqImportCommitResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/mcq-import/${batch.batch_public_id}/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            selected_candidate_public_ids: batch.candidates
              .filter((candidate) => candidate.import_selected)
              .map((candidate) => candidate.candidate_public_id),
            candidate_updates: batch.candidates.map((candidate) => ({
              candidate_public_id: candidate.candidate_public_id,
              import_selected: candidate.import_selected,
              item_label: candidate.item_label,
              stem: candidate.stem,
              options: candidate.options,
              teacher_confirmed_key: candidate.teacher_confirmed_key,
              target_reasoning_note: candidate.target_reasoning_note,
              strong_reasoning_should_mention: candidate.strong_reasoning_should_mention,
              distractor_diagnostic_notes: candidate.distractor_diagnostic_notes,
              media_assets: candidate.media_assets,
              suggestion_decisions: candidate.suggestion_decisions
            }))
          })
        }
      );
      setBatch(data.batch);
      setSuccess(
        `Imported ${data.imported_count} draft MCQ item${data.imported_count === 1 ? "" : "s"}. ${data.blocked_count} selected candidate${data.blocked_count === 1 ? "" : "s"} blocked.`
      );
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  function fileChanged(event: ChangeEvent<HTMLInputElement>) {
    setSourceFile(event.target.files?.[0] ?? null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="MCQ import"
        title="Import MCQ items"
        description="Preview extracted items, confirm keys, and keep LLM suggestions separate until reviewed."
        actions={
          <>
            <a
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent"
              href={`/api/teacher/assessments/${assessmentPublicId}/mcq-import/template`}
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              CSV template
            </a>
            <PrimaryLink href={`/teacher/content/assessments/${assessmentPublicId}`}>
              Return to mini test
            </PrimaryLink>
          </>
        }
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />

      <form className="rounded-lg border border-line bg-white p-5 shadow-soft" onSubmit={previewImport}>
        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <Field label="Source type">
            <select
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => {
                setSourceType(event.target.value as SourceType);
                setSourceFile(null);
                setSourceText("");
              }}
              value={sourceType}
            >
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
              <option value="plain_text">Pasted plain text</option>
              <option value="project_json">Project JSON item format</option>
            </select>
          </Field>

          {sourceType === "csv" || sourceType === "xlsx" ? (
            <Field label="Upload file">
              <input
                accept={sourceType === "xlsx" ? ".xlsx" : ".csv,text/csv"}
                className="rounded-md border border-line px-3 py-2 text-sm"
                onChange={fileChanged}
                type="file"
              />
            </Field>
          ) : (
            <Field label={sourceType === "plain_text" ? "Paste MCQ text" : "Paste project JSON"}>
              <textarea
                className="min-h-48 rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                onChange={(event) => setSourceText(event.target.value)}
                placeholder={
                  sourceType === "plain_text"
                    ? "1. Stem...\nA. Option\nB. Option\nAnswer: A"
                    : "{\"items\":[...]}"
                }
                value={sourceText}
              />
            </Field>
          )}
        </div>
        <Field
          label="Optional column mapping JSON"
          hint='Use canonical field names as keys, for example {"stem":"Question Text","key":"Correct"}.'
        >
          <textarea
            className="min-h-20 rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setMappingJson(event.target.value)}
            value={mappingJson}
          />
        </Field>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busyAction === "preview"} type="submit">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {busyAction === "preview" ? "Previewing" : "Preview candidates"}
          </Button>
          <p className="text-sm leading-6 text-muted">
            Missing fields remain blank. Import creates draft items only.
          </p>
        </div>
      </form>

      {batch ? (
        <section className="space-y-4 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-ink">Import preview</h2>
              <p className="mt-1 text-sm text-muted">
                {batch.candidate_count} candidates. {selectedCount} selected. Batch {batch.batch_public_id}.
              </p>
              <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
                Suggestions run only after this button is selected. Up to 10 selected items may be sent per request.
                The assistant may suggest unofficial keys, target reasoning, strong reasoning, distractor notes,
                ambiguity warnings, and recall-only warnings. Teacher review is required before any suggestion is used.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busyAction === "reload"} onClick={reloadBatch} type="button" variant="secondary">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Reload
              </Button>
              <Button disabled={selectedCount === 0 || busyAction === "suggest"} onClick={suggestForSelected} type="button" variant="secondary">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Suggest missing diagnostic information
              </Button>
              <Button disabled={selectedCount === 0} onClick={acceptSelectedBlankSuggestions} type="button" variant="secondary">
                Accept selected blank suggestions
              </Button>
              <Button disabled={selectedCount === 0 || busyAction === "commit"} onClick={commitImport} type="button">
                <FileUp className="h-4 w-4" aria-hidden="true" />
                Import selected drafts
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {batch.candidates.map((candidate) => {
              const suggestion = suggestionRecord(candidate);
              return (
                <article className="rounded-lg border border-line p-4" key={candidate.candidate_public_id}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                          <input
                            checked={candidate.import_selected}
                            onChange={(event) =>
                              updateCandidate(candidate.candidate_public_id, (entry) => ({
                                ...entry,
                                import_selected: event.target.checked
                              }))
                            }
                            type="checkbox"
                          />
                          Import
                        </label>
                        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusTone(candidate.status)}`}>
                          {candidate.status.replaceAll("_", " ")}
                        </span>
                        <span className="text-xs text-muted">{candidate.source_location}</span>
                        <span className="text-xs text-muted">
                          confidence {Math.round(candidate.parsing_confidence * 100)}%
                        </span>
                      </div>
                      {candidate.issue_flags.length > 0 ? (
                        <p className="text-xs text-amber-800">Issues: {candidate.issue_flags.join(", ")}</p>
                      ) : null}
                      {candidate.duplicate_warnings.length > 0 ? (
                        <ul className="space-y-1 text-xs text-amber-800">
                          {candidate.duplicate_warnings.map((warning, index) => (
                            <li key={`${warning.scope}-${index}`}>
                              {warning.message} {warning.existing_assessment_title ? `(${warning.existing_assessment_title})` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <StatusBadge status={candidate.imported_item_public_id ? "draft" : "draft"} />
                  </div>

                  <div className="mt-4 grid gap-4">
                    <Field label="Item label">
                      <input
                        className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                        onChange={(event) =>
                          updateCandidate(candidate.candidate_public_id, (entry) => ({
                            ...entry,
                            item_label: event.target.value || null
                          }))
                        }
                        value={candidate.item_label ?? ""}
                      />
                    </Field>
                    <Field label="Stem">
                      <textarea
                        className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                        onChange={(event) =>
                          updateCandidate(candidate.candidate_public_id, (entry) => ({
                            ...entry,
                            stem: event.target.value
                          }))
                        }
                        value={candidate.stem}
                      />
                    </Field>
                    <div className="grid gap-3 md:grid-cols-2">
                      {candidate.options.map((option, index) => (
                        <Field label={`Option ${option.label}`} key={`${candidate.candidate_public_id}-${option.label}`}>
                          <input
                            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                            onChange={(event) =>
                              updateCandidate(candidate.candidate_public_id, (entry) => ({
                                ...entry,
                                options: entry.options.map((existing, optionIndex) =>
                                  optionIndex === index
                                    ? { ...existing, text: event.target.value }
                                    : existing
                                )
                              }))
                            }
                            value={option.text}
                          />
                        </Field>
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Imported key">
                        <input
                          className="rounded-md border border-line bg-slate-50 px-3 py-2 text-muted"
                          readOnly
                          value={candidate.imported_key ?? ""}
                        />
                      </Field>
                      <Field label="Teacher-confirmed key">
                        <input
                          className="rounded-md border border-line px-3 py-2 uppercase outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          maxLength={2}
                          onChange={(event) =>
                            updateCandidate(candidate.candidate_public_id, (entry) => ({
                              ...entry,
                              teacher_confirmed_key: event.target.value.toUpperCase() || null
                            }))
                          }
                          value={candidate.teacher_confirmed_key ?? ""}
                        />
                      </Field>
                      <div className="flex items-end">
                        <Button
                          disabled={!candidate.imported_key}
                          onClick={() =>
                            updateCandidate(candidate.candidate_public_id, (entry) => ({
                              ...entry,
                              teacher_confirmed_key: entry.imported_key
                            }))
                          }
                          type="button"
                          variant="secondary"
                        >
                          <CheckCircle className="h-4 w-4" aria-hidden="true" />
                          Confirm imported key
                        </Button>
                      </div>
                    </div>

                    <Field label="Target reasoning note">
                      <textarea
                        className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                        onChange={(event) =>
                          updateCandidate(candidate.candidate_public_id, (entry) => ({
                            ...entry,
                            target_reasoning_note: event.target.value || null
                          }))
                        }
                        value={candidate.target_reasoning_note ?? ""}
                      />
                    </Field>
                    {suggestionText(candidate, "suggested_target_reasoning_note") ? (
                      <SuggestionReview
                        candidate={candidate}
                        field="suggested_target_reasoning_note"
                        label="Suggested target reasoning"
                        onUpdate={updateCandidate}
                      />
                    ) : null}

                    <Field label="Strong reasoning should mention">
                      <textarea
                        className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                        onChange={(event) =>
                          updateCandidate(candidate.candidate_public_id, (entry) => ({
                            ...entry,
                            strong_reasoning_should_mention: event.target.value || null
                          }))
                        }
                        value={candidate.strong_reasoning_should_mention ?? ""}
                      />
                    </Field>
                    {suggestionText(candidate, "suggested_strong_reasoning_should_mention") ? (
                      <SuggestionReview
                        candidate={candidate}
                        field="suggested_strong_reasoning_should_mention"
                        label="Suggested strong-reasoning note"
                        onUpdate={updateCandidate}
                      />
                    ) : null}

                    <Field label="Distractor diagnostic notes">
                      <textarea
                        className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                        onChange={(event) =>
                          updateCandidate(candidate.candidate_public_id, (entry) => ({
                            ...entry,
                            distractor_diagnostic_notes: event.target.value || null
                          }))
                        }
                        value={candidate.distractor_diagnostic_notes ?? ""}
                      />
                    </Field>
                    {suggestionText(candidate, "suggested_plain_language_distractor_notes") ? (
                      <SuggestionReview
                        candidate={candidate}
                        field="suggested_plain_language_distractor_notes"
                        label="Suggested distractor notes"
                        onUpdate={updateCandidate}
                      />
                    ) : null}

                    {Object.keys(suggestion).length > 0 ? (
                      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-950">
                        <p className="font-semibold">Assistant rationale and limitations</p>
                        {typeof suggestion.suggested_key === "string" && suggestion.suggested_key ? (
                          <p className="mt-1">
                            Unofficial key suggestion: {String(suggestion.suggested_key)}. Confirm or edit the key before import.
                          </p>
                        ) : null}
                        <p className="mt-1">
                          {String(suggestion.evidence_justification_summary ?? "Suggestion rationale unavailable.")}
                        </p>
                        {Array.isArray(suggestion.limitations) ? (
                          <ul className="mt-2 list-disc pl-5">
                            {suggestion.limitations.map((limitation, index) => (
                              <li key={index}>{String(limitation)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                    {candidate.suggestion_error ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                        <p className="font-semibold">Suggestion unavailable</p>
                        <p className="mt-1">
                          Diagnostic suggestions are temporarily unavailable for this item. You can continue reviewing and importing it manually.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SuggestionReview({
  candidate,
  field,
  label,
  onUpdate
}: {
  candidate: McqImportCandidate;
  field: string;
  label: string;
  onUpdate: (
    candidatePublicId: string,
    updater: (candidate: McqImportCandidate) => McqImportCandidate
  ) => void;
}) {
  const suggestion = suggestionText(candidate, field);
  const decision = candidate.suggestion_decisions?.[field]?.decision ?? "leave_blank";
  const editedValue = candidate.suggestion_decisions?.[field]?.edited_value ?? suggestion ?? "";
  const currentValue = currentValueForSuggestionField(candidate, field);

  if (!suggestion) return null;

  function setDecision(nextDecision: string, edited?: string | null) {
    onUpdate(candidate.candidate_public_id, (entry) => ({
      ...entry,
      suggestion_decisions: {
        ...(entry.suggestion_decisions ?? {}),
        [field]: { decision: nextDecision, edited_value: edited ?? null }
      }
    }));
  }

  function setEditedValue(nextValue: string) {
    onUpdate(candidate.candidate_public_id, (entry) => ({
      ...entry,
      suggestion_decisions: {
        ...(entry.suggestion_decisions ?? {}),
        [field]: {
          decision,
          edited_value: nextValue
        }
      }
    }));
  }

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
      <p className="font-semibold">{label}</p>
      <p className="mt-1 text-xs text-blue-900">
        Current value: {currentValue || "Blank"}
      </p>
      <p className="mt-1 leading-6">{suggestion}</p>
      <textarea
        className="mt-3 min-h-20 w-full rounded-md border border-blue-200 bg-white px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
        onChange={(event) => setEditedValue(event.target.value)}
        value={editedValue}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => setDecision("accept")} type="button" variant={decision === "accept" ? "primary" : "secondary"}>
          Accept
        </Button>
        <Button onClick={() => setDecision("edit_accept", editedValue)} type="button" variant={decision === "edit_accept" ? "primary" : "secondary"}>
          Edit and accept
        </Button>
        <Button onClick={() => setDecision("reject")} type="button" variant={decision === "reject" ? "primary" : "secondary"}>
          Reject
        </Button>
        <Button onClick={() => setDecision("leave_blank")} type="button" variant={decision === "leave_blank" ? "primary" : "secondary"}>
          Leave blank
        </Button>
      </div>
    </div>
  );
}
