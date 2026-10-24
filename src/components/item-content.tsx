import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  ITEM_CONTENT_AUTHORING_HINT,
  hasRichItemContent,
  prepareItemContentMarkdown,
  safeItemContentUrl
} from "@/lib/item-content/rich-text";

/**
 * The one renderer for item content (release CMCQ-20261024-11): stems, options, explanations
 * and instructor notes. Text without formulas, tables, bold text or https links is rendered
 * exactly as before (the same element and classes, line breaks preserved). Text with them is
 * rendered from a Markdown subset: GitHub tables, formulas through KaTeX (no \href, \url or
 * HTML extensions: KaTeX `trust` stays off), bold and italic text, lists, quotes, code, and
 * https links that open in a new tab. Raw HTML is never rendered (it shows as text), Markdown
 * images show only their description (item images belong in the item's media), and nothing
 * can run a script. The KaTeX stylesheet is loaded by src/app/layout.tsx.
 */

/** Elements the Markdown subset can produce. */
const MARKDOWN_ELEMENTS = [
  "p", "br", "strong", "em", "del", "code", "pre", "hr", "ul", "ol", "li", "blockquote",
  "table", "thead", "tbody", "tr", "th", "td", "a", "img"
] as const;

/** Elements KaTeX produces (HTML for display, MathML for screen readers, SVG for some glyphs). */
export const KATEX_ELEMENTS = [
  "span", "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace",
  "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "mover", "munder", "munderover",
  "mtable", "mtr", "mtd", "mlabeledtr", "mpadded", "mphantom", "mstyle", "menclose", "mglyph",
  "svg", "path", "line"
] as const;

const ALLOWED_ITEM_CONTENT_ELEMENTS: string[] = [...MARKDOWN_ELEMENTS, ...KATEX_ELEMENTS];

/** KaTeX options: no trusted commands (no links, classes, ids or styles from the author). */
export const ITEM_CONTENT_KATEX_OPTIONS = {
  throwOnError: false,
  strict: "ignore",
  trust: false,
  maxSize: 20,
  maxExpand: 300,
  output: "htmlAndMathml"
} as const;

function itemContentComponents(input: { inline: boolean; linksInteractive: boolean }) {
  const { inline, linksInteractive } = input;
  return {
    p: ({ children }: { children?: React.ReactNode }) =>
      inline ? (
        <span className="item-content-p whitespace-pre-wrap">{children}</span>
      ) : (
        <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{children}</p>
      ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => <li className="whitespace-pre-wrap pl-1">{children}</li>,
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="my-2 border-l-2 border-accent/40 pl-3 text-inherit">{children}</blockquote>
    ),
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="my-2 max-w-full overflow-x-auto rounded bg-slate-100 p-2 font-mono text-[0.9em]">{children}</pre>
    ),
    code: ({ children }: { children?: React.ReactNode }) => (
      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-inherit">{children}</code>
    ),
    // Tables scroll sideways inside their own box on narrow screens.
    table: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(
        inline ? "span" : "div",
        { className: "item-content-table", "data-testid": "item-content-table" },
        <table>{children}</table>
      ),
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => {
      const safeHref = safeItemContentUrl(href);
      return safeHref && linksInteractive ? (
        <a
          className="font-semibold text-accent underline underline-offset-4"
          href={safeHref}
          rel="noreferrer"
          target="_blank"
        >
          {children}
        </a>
      ) : (
        <span className="font-semibold">{children}</span>
      );
    },
    img: ({ alt }: { alt?: string }) => (alt ? <span>[{alt}]</span> : null)
  };
}

/** Markdown + math, after the display-time preparation; used for rich text only. */
export function ItemContentMarkdown({
  text,
  inline = false,
  linksInteractive = true
}: {
  text: string;
  inline?: boolean;
  linksInteractive?: boolean;
}) {
  return (
    <ReactMarkdown
      allowedElements={ALLOWED_ITEM_CONTENT_ELEMENTS}
      components={itemContentComponents({ inline, linksInteractive })}
      rehypePlugins={[[rehypeKatex, ITEM_CONTENT_KATEX_OPTIONS]]}
      remarkPlugins={[remarkGfm, remarkMath]}
      unwrapDisallowed
      urlTransform={(url: string) => safeItemContentUrl(url)}
    >
      {prepareItemContentMarkdown(text)}
    </ReactMarkdown>
  );
}

function withoutPreservedWhitespace(className?: string) {
  return (className ?? "")
    .split(/\s+/)
    .filter((token) => token && token !== "whitespace-pre-wrap" && token !== "whitespace-pre-line")
    .join(" ");
}

type ItemContentElement = "p" | "div" | "span" | "dd" | "li" | "fragment";

/**
 * Item text. `as` is the element plain text has always used (default p); `prefix` is a
 * label shown before the text (as in "Why: ..."). `inline` is for text inside a line, such as
 * an option after its letter: plain text renders as bare text and rich text inside a span.
 */
export function ItemContent({
  text,
  as = "p",
  className,
  prefix,
  suffix,
  inline = false,
  linksInteractive = true,
  testId
}: {
  text: string | null | undefined;
  as?: ItemContentElement;
  className?: string;
  prefix?: React.ReactNode;
  /** Shown after the text, such as " (answer key)". */
  suffix?: React.ReactNode;
  inline?: boolean;
  linksInteractive?: boolean;
  testId?: string;
}) {
  const value = text ?? "";
  if (!hasRichItemContent(value)) {
    if (as === "fragment" || inline) {
      return (
        <>
          {prefix}
          {prefix ? " " : null}
          {value}
          {suffix}
        </>
      );
    }
    return React.createElement(
      as,
      { className, ...(testId ? { "data-testid": testId } : {}) },
      prefix,
      prefix ? " " : null,
      value,
      suffix
    );
  }

  const markdown = <ItemContentMarkdown inline={inline} linksInteractive={linksInteractive} text={value} />;
  const richClassName = ["item-content", inline ? "item-content-inline" : null, withoutPreservedWhitespace(className)]
    .filter(Boolean)
    .join(" ");
  const wrapper: "span" | "div" | "dd" | "li" =
    inline || as === "span" ? "span" : as === "dd" || as === "li" ? as : "div";
  return React.createElement(
    wrapper,
    { className: richClassName, "data-item-content": "rich", ...(testId ? { "data-testid": testId } : {}) },
    prefix,
    prefix ? " " : null,
    markdown,
    suffix
  );
}

/**
 * Authoring aid shown under item text fields: a one-line hint and, when the text uses
 * formulas, tables, bold text or links, a small preview drawn by the same renderer.
 */
export function ItemContentAuthoringPreview({
  text,
  label = "Preview",
  showHint = true,
  testId
}: {
  text: string | null | undefined;
  label?: string;
  /** false where a hint is already shown nearby (each option, each note). */
  showHint?: boolean;
  testId?: string;
}) {
  const value = text ?? "";
  if (!showHint && !hasRichItemContent(value)) return null;
  return (
    <div className="mt-1 grid gap-1 font-normal" data-testid={testId ?? "item-content-authoring-preview"}>
      {showHint ? <p className="text-xs text-muted">{ITEM_CONTENT_AUTHORING_HINT}</p> : null}
      {hasRichItemContent(value) ? (
        <div className="rounded-md border border-dashed border-line bg-white px-3 py-2 text-sm leading-6 text-ink">
          <span className="mb-1 block text-[0.68rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
          <ItemContent as="div" text={value} />
        </div>
      ) : null}
    </div>
  );
}
