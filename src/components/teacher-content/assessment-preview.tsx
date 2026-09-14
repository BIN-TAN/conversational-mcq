"use client";

import { useState } from "react";
import { Eye, X } from "lucide-react";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { normalizeOptions } from "./form-utils";
import type { AssessmentDetail, ItemDetail, ItemMediaAsset } from "./types";
import { Button, StatusBadge } from "./ui";

function isIncluded(item: ItemDetail) {
  return item.included_in_published_set && item.status !== "archived" && item.concept_unit_status !== "archived";
}

function previewMediaUrl(value: string | null) {
  if (!value) return null;
  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function PreviewMedia({ assets }: { assets: ItemMediaAsset[] }) {
  return assets.filter((asset) => asset.active).map((asset) => {
    const url = previewMediaUrl(asset.url);
    const alt = asset.student_alt_text ?? asset.alt_text_or_description;
    return (
      <figure className="my-3 space-y-1 text-sm text-muted" key={asset.media_public_id}>
        {asset.media_type === "image" && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={alt} className="max-h-80 max-w-full object-contain" src={url} />
        ) : url ? (
          <a className="font-semibold text-accent underline" href={url} rel="noreferrer" target="_blank">
            {asset.title || (asset.media_type === "video" ? "Open video" : "Open reference")}
          </a>
        ) : <p>Media unavailable</p>}
        {asset.media_type === "image" && asset.title ? <figcaption>{asset.title}</figcaption> : null}
        {alt ? <p>{alt}</p> : null}
        {asset.caption ? <p>{asset.caption}</p> : null}
        {asset.transcript_or_content_summary ? <p>{asset.transcript_or_content_summary}</p> : null}
        {asset.source_attribution ? <p>{asset.source_attribution}</p> : null}
      </figure>
    );
  });
}

function AssessmentPreview({ assessment, onClose }: { assessment: AssessmentDetail; onClose: () => void }) {
  const [showAnswers, setShowAnswers] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // The teacher detail API already orders by topic, then item order and creation time.
  const allItems = assessment.mini_test_items ?? [];
  const included = allItems.filter(isIncluded);
  const items = showAll ? allItems : included;
  const topicTitles = new Map(assessment.concept_units.map((unit) => [unit.concept_unit_public_id, unit.title]));

  return (
    <ModalDialog labelledBy="assessment-preview-title" onClose={onClose} testId="assessment-preview">
      <section className="flex max-h-[calc(100dvh-3rem)] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-white shadow-soft">
        <header className="shrink-0 border-b border-line p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 break-words">
              <h2 className="text-xl font-semibold text-ink" id="assessment-preview-title">Whole-test preview</h2>
              <p className="mt-1 text-muted">{assessment.title}</p>
              <p className="mt-1 text-sm text-muted">{items.length} {items.length === 1 ? "item" : "items"} · Revision {assessment.revision_number} · Read-only</p>
            </div>
            <Button aria-label="Close whole-test preview" onClick={onClose} type="button" variant="secondary">
              <X className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <StatusBadge status={assessment.status} />
            {included.length !== allItems.length ? (
              <label className="flex min-w-0 items-center gap-2">
                Items
                <select className="min-w-0 rounded-md border border-line bg-white p-2" onChange={(event) => setShowAll(event.target.value === "all")} value={showAll ? "all" : "included"}>
                  <option value="included">Included items ({included.length})</option>
                  <option value="all">All saved items ({allItems.length})</option>
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 font-semibold">
              <input checked={showAnswers} className="h-4 w-4 accent-accent" onChange={(event) => setShowAnswers(event.target.checked)} type="checkbox" />
              Show answer keys
            </label>
          </div>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6" data-testid="assessment-preview-items">
          {items.length === 0 ? <p className="py-8 text-muted">{showAll || allItems.length === 0 ? "No items have been added yet." : "No included items."}</p> : null}
          {items.map((item, index) => {
            const options = Array.isArray(item.options) ? normalizeOptions(item.options) : [];
            const topic = item.concept_unit_public_id ? topicTitles.get(item.concept_unit_public_id) : null;
            const media = item.media_assets ?? [];
            return (
              <article aria-labelledby={`preview-item-${index}`} className="break-words border-b border-line py-6 last:border-b-0 [overflow-wrap:anywhere]" key={item.item_public_id}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink" id={`preview-item-${index}`}>Item {index + 1} of {items.length}</h3>
                  {item.status !== "published" ? <StatusBadge status={item.status} /> : null}
                  {!isIncluded(item) ? <span className="text-sm font-semibold text-amber-800">Not included</span> : null}
                </div>
                {topic && assessment.concept_units.length > 1 ? <p className="mb-2 text-sm text-muted">{topic}</p> : null}
                <p className="whitespace-pre-wrap leading-7 text-ink">{item.item_stem || "No item wording yet."}</p>
                <PreviewMedia assets={media.filter((asset) => asset.placement === "item_stem")} />
                {options.length === 0 ? <p className="mt-4 text-muted">No answer options yet.</p> : (
                  <ol aria-label={`Options for item ${index + 1}`} className="mt-4 grid gap-2">
                    {options.map((option, optionIndex) => (
                      <li className={`rounded-md border p-3 ${showAnswers && option.label === item.correct_option ? "border-accent bg-accent-soft" : "border-line"}`} key={`${option.label}-${optionIndex}`}>
                        <p className="whitespace-pre-wrap leading-6"><span className="font-semibold">{option.label}.</span> {option.text}</p>
                        <PreviewMedia assets={media.filter((asset) => asset.placement === "option" && asset.option_label === option.label)} />
                      </li>
                    ))}
                  </ol>
                )}
                {showAnswers ? <p className="mt-3 font-semibold text-accent" data-testid="preview-answer-key">Answer key: {options.some((option) => option.label === item.correct_option) ? item.correct_option : "Not set"}</p> : null}
              </article>
            );
          })}
        </div>
      </section>
    </ModalDialog>
  );
}

export function AssessmentPreviewControl({ assessment, disabled = false }: { assessment: AssessmentDetail; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)} type="button" variant="secondary">
        <Eye aria-hidden="true" className="h-4 w-4" />
        Preview whole test
      </Button>
      {open ? <AssessmentPreview assessment={assessment} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
