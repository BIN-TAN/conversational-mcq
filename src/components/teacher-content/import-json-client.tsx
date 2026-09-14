"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileDown, FileJson, Upload } from "lucide-react";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { MINI_TEST_JSON_MAX_BYTES, MINI_TEST_JSON_SAMPLE_URL, parseMiniTestJson } from "@/lib/services/content/mini-test-json-contract";
import { apiRequest, errorFromUnknown } from "./api";
import type { StructuredApiError } from "./types";
import { Button, ErrorPanel, PageHeader } from "./ui";
import { WorkbookImportClient } from "./workbook-import-client";

export function ImportJsonClient() {
  const router = useRouter();
  const [mode, setMode] = useState<"json" | "excel">("json");
  const fileInput = useRef<HTMLInputElement>(null);
  const [jsonText, setJsonText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { allowNavigation } = useUnsavedChanges(Boolean(jsonText) && !submitted);
  const parsed = useMemo(() => {
    if (!jsonText.trim()) return { document: null, message: null };
    try { return { document: parseMiniTestJson(jsonText), message: null }; }
    catch (caught) { return { document: null, message: caught instanceof Error ? caught.message : "Invalid JSON." }; }
  }, [jsonText]);
  const document = parsed.document;

  function canReplace() {
    return !jsonText.trim() || window.confirm("Replace the current JSON? Unsaved edits will be lost.");
  }

  async function loadSample() {
    if (!canReplace()) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(MINI_TEST_JSON_SAMPLE_URL);
      if (!response.ok) throw new Error("The sample could not be loaded. Please try again.");
      setJsonText(await response.text()); setFileName("mini-test-import.json");
    } catch (caught) { setError(errorFromUnknown(caught)); }
    finally { setBusy(false); }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (!canReplace()) return;
    setBusy(true); setError(null);
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Choose a .json file.");
      if (file.size > MINI_TEST_JSON_MAX_BYTES) throw new Error("The JSON file must be 2 MB or smaller.");
      setJsonText(await file.text()); setFileName(file.name);
    } catch (caught) { setError(errorFromUnknown(caught)); }
    finally { setBusy(false); }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document || busy) return;
    setError(null); setBusy(true);
    try {
      const result = await apiRequest<{ review_url: string }>(
        `/api/teacher/content/import-json/preview${fileName ? `?filename=${encodeURIComponent(fileName)}` : ""}`,
        { method: "POST", body: jsonText }
      );
      setSubmitted(true); allowNavigation(); router.push(result.review_url);
    } catch (caught) { setError(errorFromUnknown(caught)); setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Import items" actions={mode === "json" ?
        <a className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-surface" download="mini-test-import.json" href={MINI_TEST_JSON_SAMPLE_URL}>
          <FileDown className="h-4 w-4" aria-hidden="true" />Download sample JSON
        </a>
      : undefined} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Import format">
        <Button variant={mode === "json" ? "primary" : "secondary"} aria-pressed={mode === "json"} onClick={() => setMode("json")}>JSON</Button>
        <Button variant={mode === "excel" ? "primary" : "secondary"} aria-pressed={mode === "excel"} onClick={() => setMode("excel")}>Excel workbook</Button>
      </div>
      <div hidden={mode !== "excel"}><WorkbookImportClient /></div>
      <div hidden={mode !== "json"}>
      <ErrorPanel error={error} />
      <form className="space-y-6" onSubmit={onSubmit}>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" disabled={busy} aria-label="JSON file"
            onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
          <Button type="button" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden="true" />Upload JSON
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void loadSample()}>
            <FileJson className="h-4 w-4" aria-hidden="true" />Use sample
          </Button>
          <span className="min-w-0 break-all text-sm text-muted">{fileName ?? "JSON files up to 2 MB"}</span>
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
          <label className="flex min-w-0 flex-col gap-2 text-sm font-medium text-ink">
            Mini-test JSON
            <textarea className="min-h-[440px] w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
              value={jsonText} disabled={busy} spellCheck={false} placeholder="Paste mini-test JSON..."
              onChange={event => { setJsonText(event.target.value); setError(null); }}
              aria-invalid={Boolean(parsed.message)} aria-describedby={parsed.message ? "json-validation" : undefined} />
          </label>
          <aside className="min-w-0 space-y-5 border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0" aria-label="Import summary" aria-live="polite">
            <h2 className="text-lg font-semibold text-ink">Mini-test summary</h2>
            {document ? <>
              <div><h3 className="break-words font-semibold text-ink">{document.assessment.title}</h3><p className="mt-1 text-sm text-muted">{document.assessment.folder_label || "Unfiled"}</p></div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt>Items to review</dt><dd className="text-right font-semibold">{document.items.length}</dd>
                <dt>Supplied keys</dt><dd className="text-right font-semibold">{document.items.filter(item => item.key).length} / {document.items.length}</dd>
                <dt>Objectives</dt><dd className="text-right font-semibold">{document.design?.objectives.length ?? 0}</dd>
                <dt>Evidence requirements</dt><dd className="text-right font-semibold">{document.design?.objectives.reduce((count, item) => count + item.evidence_requirements.length, 0) ?? 0}</dd>
                <dt>Misconception hypotheses</dt><dd className="text-right font-semibold">{document.design?.misconception_hypotheses.length ?? 0}</dd>
              </dl>
              {document.design ? <div className="space-y-2 border-t border-line pt-4 text-sm"><h3 className="font-semibold">{document.design.section_topic}</h3>
                <ul className="list-disc space-y-2 pl-5">{document.design.objectives.map(objective => <li key={objective.objective_id}>{objective.statement}</li>)}</ul>
              </div> : <p className="text-sm text-muted">No assessment design supplied.</p>}
              <p className="text-sm text-muted">Draft only. Answer keys require your confirmation before items are added.</p>
              {document.items.length > 12 ? <p className="text-sm text-amber-800">Select 3-12 items for this mini test during review.</p> : null}
            </> : <p className="text-sm text-muted">{jsonText.trim() ? "Fix the JSON validation errors to continue." : "No file selected."}</p>}
          </aside>
        </div>
        {parsed.message ? <p id="json-validation" role="alert" className="whitespace-pre-wrap break-words border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-800">{parsed.message}</p> : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button disabled={!document || busy} type="submit"><ArrowRight className="h-4 w-4" aria-hidden="true" />{busy ? "Preparing review..." : "Continue to item review"}</Button>
        </div>
      </form>
      </div>
    </div>
  );
}
