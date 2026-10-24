/**
 * Rich item content (release CMCQ-20261024-11): item stems, options and explanations may
 * contain formulas (LaTeX between $ signs, or \( \) and \[ \]), Markdown pipe tables, bold
 * text and https links. This module is pure (no React, no Markdown library) so that it can
 * be tested without the browser bundle; src/components/item-content.tsx renders with it.
 *
 * Plain text stays plain: text without any of these markers is rendered exactly as before
 * (the same element with whitespace-pre-wrap). Stored strings are never changed; the
 * preparation below happens only at display time.
 */

export const ITEM_CONTENT_AUTHORING_HINT = "You can use $...$ for formulas and | tables |." as const;

export type MathSpan = {
  /** Index of the first character of the opening delimiter in the source text. */
  start: number;
  /** Index just after the closing delimiter. */
  end: number;
  /** The TeX between the delimiters, unchanged. */
  tex: string;
  display: boolean;
  delimiter: "$" | "$$" | "\\(" | "\\[";
};

function isWhitespace(character: string | undefined) {
  return character === undefined || /\s/.test(character);
}

function isDigit(character: string | undefined) {
  return character !== undefined && character >= "0" && character <= "9";
}

/** Closing index of a code span that starts at `index` (a run of backticks), or -1. */
function codeSpanEnd(text: string, index: number) {
  let run = 0;
  while (text[index + run] === "`") run += 1;
  const fence = "`".repeat(run);
  let search = index + run;
  while (search < text.length) {
    const found = text.indexOf(fence, search);
    if (found < 0) return -1;
    let after = found + run;
    if (text[after] === "`") {
      while (text[after] === "`") after += 1;
      search = after;
      continue;
    }
    return after;
  }
  return -1;
}

/**
 * Finds formulas with the Pandoc rules for single dollars, so that prices such as
 * "$5 and $10" or "$5-$10" are not read as a formula: an opening $ must be followed by a
 * non-space character, and a closing $ must follow a non-space character and must not be
 * followed by a digit. A formula never spans an empty line.
 */
export function findMathSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (character === "\\") {
      const next = text[index + 1];
      if (next === "(" || next === "[") {
        const closer = next === "(" ? "\\)" : "\\]";
        const close = text.indexOf(closer, index + 2);
        const blank = text.indexOf("\n\n", index + 2);
        if (close > index + 2 && (blank < 0 || blank > close)) {
          const tex = text.slice(index + 2, close);
          if (tex.trim()) {
            spans.push({
              start: index,
              end: close + 2,
              tex,
              display: next === "[",
              delimiter: next === "(" ? "\\(" : "\\["
            });
            index = close + 2;
            continue;
          }
        }
      }
      // Any other backslash escapes the next character (\$ is a literal dollar sign).
      index += 2;
      continue;
    }

    if (character === "`") {
      const end = codeSpanEnd(text, index);
      if (end > 0) {
        index = end;
        continue;
      }
      while (text[index] === "`") index += 1;
      continue;
    }

    if (character === "$" && text[index + 1] === "$") {
      let close = text.indexOf("$$", index + 2);
      while (close > 0 && text[close - 1] === "\\") close = text.indexOf("$$", close + 1);
      const blank = text.indexOf("\n\n", index + 2);
      if (close > index + 2 && (blank < 0 || blank > close)) {
        const tex = text.slice(index + 2, close);
        if (tex.trim()) {
          spans.push({ start: index, end: close + 2, tex, display: true, delimiter: "$$" });
          index = close + 2;
          continue;
        }
      }
      index += 2;
      continue;
    }

    if (character === "$") {
      if (!isWhitespace(text[index + 1])) {
        let close = -1;
        for (let search = index + 1; search < text.length; search += 1) {
          const candidate = text[search];
          if (candidate === "\n" && text[search + 1] === "\n") break;
          if (candidate === "\\") {
            search += 1;
            continue;
          }
          if (candidate !== "$") continue;
          if (text[search + 1] === "$") break;
          if (!isWhitespace(text[search - 1]) && !isDigit(text[search + 1]) && search > index + 1) {
            close = search;
          }
          break;
        }
        if (close > 0) {
          spans.push({
            start: index,
            end: close + 1,
            tex: text.slice(index + 1, close),
            display: false,
            delimiter: "$"
          });
          index = close + 1;
          continue;
        }
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return spans;
}

const TABLE_DELIMITER_ROW = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function isTableRow(line: string) {
  return line.includes("|") && line.trim().length > 1;
}

function isDelimiterRow(line: string) {
  return line.includes("|") && TABLE_DELIMITER_ROW.test(line);
}

/** True when the text has a Markdown pipe table: a header row followed by a | --- | row. */
export function hasMarkdownTable(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    if (isDelimiterRow(lines[index]!) && isTableRow(lines[index - 1]!) && !isDelimiterRow(lines[index - 1]!)) {
      return true;
    }
  }
  return false;
}

const BOLD = /\*\*[^\s*](?:[^*\n]*[^\s*])?\*\*/;
const HTTPS_LINK = /\[[^\]\n]+\]\(https:\/\/[^\s)]+\)/;

export type ItemContentFeatures = {
  math: boolean;
  table: boolean;
  emphasis: boolean;
  link: boolean;
};

export function itemContentFeatures(text: string | null | undefined): ItemContentFeatures {
  const value = typeof text === "string" ? text : "";
  return {
    math: value.includes("$") || value.includes("\\(") || value.includes("\\[")
      ? findMathSpans(value).length > 0
      : false,
    table: value.includes("|") ? hasMarkdownTable(value) : false,
    emphasis: value.includes("**") ? BOLD.test(value) : false,
    link: value.includes("](https://") ? HTTPS_LINK.test(value) : false
  };
}

/**
 * Whether the text uses any rich-content marker. When it does not, the text is shown as
 * plain text exactly as before; when it does, it is shown through the Markdown renderer.
 */
export function hasRichItemContent(text: string | null | undefined) {
  const features = itemContentFeatures(text);
  return features.math || features.table || features.emphasis || features.link;
}

/**
 * Prepares item text for the Markdown renderer (display only, never stored):
 * - dollar signs that do not open or close a formula are escaped, so prices stay text;
 * - \( \) becomes $ $; a display formula ($$ $$ or \[ \]) on its own line becomes a
 *   display block, and one inside a sentence or a table cell is shown inline in display style;
 * - a table gets an empty line before and after it, so it never merges with a paragraph.
 */
export function prepareItemContentMarkdown(text: string, options: { tables?: boolean } = {}) {
  const source = text.replace(/\r\n?/g, "\n");
  const spans = findMathSpans(source);
  let output = "";
  let cursor = 0;

  const lineOf = (index: number) => {
    const start = source.lastIndexOf("\n", index - 1) + 1;
    const end = source.indexOf("\n", index);
    return { start, end: end < 0 ? source.length : end };
  };

  const escapeDollars = (segment: string) => {
    let escaped = "";
    for (let index = 0; index < segment.length; index += 1) {
      const character = segment[index]!;
      if (character === "\\") {
        escaped += character + (segment[index + 1] ?? "");
        index += 1;
        continue;
      }
      if (character === "`") {
        const end = codeSpanEnd(segment, index);
        if (end > 0) {
          escaped += segment.slice(index, end);
          index = end - 1;
          continue;
        }
      }
      escaped += character === "$" ? "\\$" : character;
    }
    return escaped;
  };

  for (const span of spans) {
    output += escapeDollars(source.slice(cursor, span.start));
    const tex = span.tex.trim();
    if (span.display) {
      const line = lineOf(span.start);
      const ownLine =
        !source.slice(line.start, span.start).trim() &&
        !source.slice(span.end, lineOf(span.end).end).trim() &&
        !source.slice(line.start, span.start).includes("|");
      output += ownLine ? `\n\n$$\n${tex}\n$$\n\n` : `$\\displaystyle ${tex}$`;
    } else {
      output += `$${tex}$`;
    }
    cursor = span.end;
  }
  output += escapeDollars(source.slice(cursor));

  if (options.tables === false) {
    return output;
  }

  const lines = output.split("\n");
  const result: string[] = [];
  let inTable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const startsTable = !inTable && isTableRow(line) && index + 1 < lines.length && isDelimiterRow(lines[index + 1]!);
    if (startsTable) {
      if (result.length > 0 && result[result.length - 1]!.trim()) result.push("");
      inTable = true;
      result.push(line);
      continue;
    }
    if (inTable && (!line.trim() || !line.includes("|"))) {
      inTable = false;
      if (line.trim()) result.push("");
    }
    result.push(line);
  }
  return result.join("\n");
}

/** Only https links open, in a new tab; anything else is shown as its text. */
export function safeItemContentUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
