"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, FileDown, Upload } from "lucide-react";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { WORKBOOK_MAX_BYTES, type WorkbookPreview, type WorkbookStageResult } from "@/lib/services/content/mini-test-workbook-contract";
import { apiRequest, errorFromUnknown } from "./api";
import type { StructuredApiError } from "./types";
import { Button, ErrorPanel } from "./ui";
import { WorkbookGuides } from "./workbook-guide";

export function WorkbookImportClient() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<WorkbookStageResult | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(Boolean(file) && !result);

  async function loadFile(next?: File) {
    if (!next || busy) return;
    if (file && !result && !window.confirm("Replace the current workbook selection?")) return;
    setBusy(true); setError(null);
    try {
      if (!/\.xlsx$/i.test(next.name) || next.size > WORKBOOK_MAX_BYTES) throw new Error("Choose a standard .xlsx workbook up to 2 MB.");
      const inspected = await apiRequest<WorkbookPreview>(`/api/teacher/content/import-workbook?filename=${encodeURIComponent(next.name)}`,
        { method: "POST", body: next, headers: { "Content-Type": "application/octet-stream" } });
      setFile(next); setPreview(inspected); setSelected(inspected.sheets.map(sheet => sheet.sheet_name)); setResult(null);
    } catch (caught) { setError(errorFromUnknown(caught)); }
    finally { setBusy(false); }
  }

  async function stage() {
    if (!file || !selected.length || busy) return;
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams({ action: "stage", filename: file.name });
      selected.forEach(name => query.append("sheet", name));
      setResult(await apiRequest<WorkbookStageResult>(`/api/teacher/content/import-workbook?${query}`,
        { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } }));
    } catch (caught) { setError(errorFromUnknown(caught)); }
    finally { setBusy(false); }
  }

  return <div className="min-w-0 space-y-6">
    <ErrorPanel error={error} />
    <div className="flex flex-wrap items-center gap-3">
      <input ref={input} className="hidden" type="file" accept=".xlsx" aria-label="Excel workbook" disabled={busy}
        onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />Upload Excel workbook</Button>
      <a href="/api/teacher/content/import-workbook/template" download="mini-test-import.xlsx" className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold"><FileDown className="h-4 w-4" aria-hidden="true" />Download sample Excel</a>
      <span className="min-w-0 break-all text-sm text-muted">{busy ? "Preparing..." : file?.name ?? "XLSX, up to 2 MB"}</span>
    </div>
    {preview ? <>
      <section className="space-y-3" aria-label="Mini tests in workbook">
        <h2 className="text-lg font-semibold">Mini tests in workbook</h2>
        {preview.sheets.map(sheet => <label key={sheet.sheet_name} className="flex items-start gap-3 border-b border-line py-4">
          <input className="mt-1 h-4 w-4 shrink-0" type="checkbox" checked={selected.includes(sheet.sheet_name)} disabled={busy || Boolean(result)}
            onChange={event => setSelected(current => event.target.checked ? [...current, sheet.sheet_name] : current.filter(name => name !== sheet.sheet_name))} />
          <span className="min-w-0"><span className="block break-words font-semibold">{sheet.sheet_name}</span>
            <span className="text-sm text-muted">{sheet.item_count} items · {sheet.supplied_keys} supplied keys</span>
          </span>
        </label>)}
      </section>
      {preview.warnings.length ? <ul className="list-disc space-y-2 border-l-4 border-amber-400 bg-amber-50 p-4 pl-8 text-sm text-amber-900">{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul> : null}
      <WorkbookGuides guides={preview.guides} />
      {preview.guides.length ? <p className="text-sm text-muted">Reference sheets stay in teacher review; their follow-up notes do not change student conversation rules.</p> : null}
      {result ? <section className="space-y-3 border-t border-line pt-5" aria-label="Prepared mini tests">
        <h2 className="text-lg font-semibold">Draft mini tests ready for review</h2>
        {result.tests.map(test => <div key={test.assessment_public_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <div className="min-w-0"><h3 className="break-words font-semibold">{test.sheet_name}</h3><p className="text-sm text-muted">{test.item_count} items · {test.reused ? "Existing draft reused" : "Draft created"}</p></div>
          <Link className="inline-flex items-center gap-2 font-semibold text-accent underline" href={test.review_url}>Review items<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>)}
        <Link className="inline-block font-semibold text-accent underline" href="/teacher/content/assessments">Assessment library</Link>
      </section> : <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <Button disabled={busy || !selected.length} onClick={() => void stage()}><ArrowRight className="h-4 w-4" aria-hidden="true" />Prepare {selected.length} mini tests</Button>
        <p className="text-sm text-muted">Draft only. Confirm answer keys in each item review before adding items.</p>
      </div>}
    </> : <p className="text-sm text-muted">No workbook selected.</p>}
  </div>;
}
