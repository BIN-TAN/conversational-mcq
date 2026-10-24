/**
 * Word tables in imported text (release CMCQ-20261024-11). A table in a Word file used to be
 * flattened into lines of text; it is now written as a Markdown pipe table, which the item
 * content renderer shows as a table. Pure functions, no dependencies.
 */

function cellText(value: string) {
  return value
    .replace(/ /g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");
}

/**
 * Rows of cell text as a Markdown pipe table. The first row is the header row (a Word table
 * has no other marker for one). Short rows are padded so every row has the same cell count.
 */
export function rowsToMarkdownTable(rows: string[][]): string {
  const cleaned = rows
    .map((row) => row.map(cellText))
    .filter((row) => row.some((cell) => cell));
  if (cleaned.length === 0) return "";
  const width = Math.max(...cleaned.map((row) => row.length));
  const padded = cleaned.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
  const line = (row: string[]) => `| ${row.join(" | ")} |`;
  return [line(padded[0]!), line(Array.from({ length: width }, () => "---")), ...padded.slice(1).map(line)].join("\n");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return ENTITIES[lower] ?? match;
  });
}

type Token = { kind: "open" | "close" | "text"; name?: string; value?: string };

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\/?>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match[2] !== undefined) {
      tokens.push({ kind: "text", value: decodeEntities(match[2]) });
      continue;
    }
    const name = match[1]!.toLowerCase();
    const tag = match[0];
    if (tag.startsWith("</")) tokens.push({ kind: "close", name });
    else {
      tokens.push({ kind: "open", name });
      if (tag.endsWith("/>") || name === "br" || name === "img") tokens.push({ kind: "close", name });
    }
  }
  return tokens;
}

const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "div", "pre"]);

/**
 * Text of mammoth's HTML output with each table as a Markdown pipe table. Paragraphs, list
 * items and headings end with an empty line, as in mammoth's raw text; line breaks stay line
 * breaks; images and other markup are dropped. Nested tables are read as the text of their
 * cell.
 */
export function htmlToTextWithMarkdownTables(html: string): string {
  const tokens = tokenize(html);
  let output = "";
  let tableDepth = 0;
  let rows: string[][] = [];
  let row: string[] | null = null;
  let cell: string | null = null;

  const append = (text: string) => {
    if (cell !== null) cell += text;
    else if (tableDepth === 0) output += text;
  };

  for (const token of tokens) {
    if (token.kind === "text") {
      append(token.value ?? "");
      continue;
    }
    const name = token.name!;
    if (name === "table") {
      if (token.kind === "open") {
        tableDepth += 1;
        if (tableDepth === 1) rows = [];
      } else if (tableDepth > 0) {
        tableDepth -= 1;
        if (tableDepth === 0) {
          const table = rowsToMarkdownTable(rows);
          if (table) output += `${table}\n\n`;
          rows = [];
          row = null;
          cell = null;
        }
      }
      continue;
    }
    if (tableDepth === 1 && name === "tr") {
      if (token.kind === "open") row = [];
      else if (row) {
        rows.push(row);
        row = null;
      }
      continue;
    }
    if (tableDepth === 1 && (name === "td" || name === "th")) {
      if (token.kind === "open") cell = "";
      else if (cell !== null) {
        (row ??= []).push(cell);
        cell = null;
      }
      continue;
    }
    if (name === "br" && token.kind === "open") {
      append(cell !== null ? " " : "\n");
      continue;
    }
    if (BLOCKS.has(name) && token.kind === "close") {
      append(cell !== null ? " " : "\n\n");
    }
  }

  return output;
}

/** A line of a Markdown pipe table ("| a | b |"). */
function isMarkdownTableLine(line: string) {
  return /^\|.*\|$/.test(line.trim()) && line.trim().length > 2;
}

/**
 * Stem lines joined as before (with spaces), except that the lines of a Markdown table stay
 * on their own lines, with an empty line around the table (release CMCQ-20261024-11).
 */
export function joinStemLines(lines: string[]) {
  let stem = "";
  let previousTable = false;
  for (const line of lines) {
    const table = isMarkdownTableLine(line);
    if (!stem) stem = line;
    else if (table && previousTable) stem += `\n${line}`;
    else if (table || previousTable) stem += `\n\n${line}`;
    else stem += ` ${line}`;
    previousTable = table;
  }
  return stem.trim();
}

/**
 * A Word table inside the item text (release CMCQ-20261024-11): a Markdown pipe table, so a
 * table in a stem stays a table. A table that holds item parts (options such as "A." or
 * "B)", numbered items, or an answer key) keeps the earlier one-line-per-row form, which the
 * item parser reads.
 */
export function docxTableLinearText(rows: string[][]) {
  const legacyLines = rows.map((row) => row.filter(Boolean).join(" | "));
  const holdsItemParts = legacyLines.some((line) =>
    /^\s*(?:\d+[.)]|[A-Ea-e][.)](?:\s|$)|(?:answer|key|correct)\s*[:\-])/i.test(line)
  );
  if (holdsItemParts) return legacyLines.join("\n");
  return `\n${rowsToMarkdownTable(rows)}\n`;
}
