/**
 * Lightweight Markdown renderer for renderer-extension UI components.
 * Supports headings, paragraphs, nested lists, blockquotes, fenced code blocks,
 * GFM tables, thematic breaks, and inline formatting (code, bold, links).
 */

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)\s*$/u;
const BLOCKQUOTE_PATTERN = /^>[ \t]?(.*?)\s*$/u;
// 单个列表标记：允许缩进，`-`/`*`/`+` 为无序项，`1.`/`1)` 为有序项。
const LIST_ITEM_PATTERN = /^([ \t]*)(?:([-*+])|(\d+)[.)])[ \t]+(\S.*?)\s*$/u;
const FENCE_PATTERN = /^```([\w+-]*)\s*$/u;
const THEMATIC_BREAK_PATTERN = /^(?:---|___|\*\*\*)[ \t]*$/u;
const TABLE_DELIMITER_CELL_PATTERN = /^:?-+:?$/u;
const INLINE_PATTERN = /(`+)((?:(?!\1).)+)\1|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/gu;

export type MarkdownDocument = Pick<Document, "createElement">;

export interface MarkdownRenderOptions {
  /** CSS class name for the root container element. */
  className?: string;
}

interface ListItem {
  /** 缩进宽度（制表符按 4 列计算），用于判断嵌套层级。 */
  indent: number;
  ordered: boolean;
  text: string;
}

/**
 * Creates an HTMLElement containing rendered Markdown content.
 */
export function createMarkdownElement(
  document: MarkdownDocument,
  markdown: string,
  options?: MarkdownRenderOptions,
): HTMLElement {
  const root = document.createElement("div");
  if (options?.className) {
    root.className = options.className;
  }
  appendMarkdownBlocks(document, root, markdown);
  return root;
}

/**
 * Appends rendered Markdown blocks to an existing container element.
 */
export function appendMarkdownBlocks(
  document: MarkdownDocument,
  root: HTMLElement,
  markdown: string,
): void {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      index = appendFencedCode(document, root, lines, index, fence[1] ?? "");
      continue;
    }
    const heading = HEADING_PATTERN.exec(line);
    if (heading?.[1] && heading[2]) {
      const tag = `h${heading[1].length}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      const element = document.createElement(tag);
      appendInline(document, element, heading[2]);
      root.append(element);
      index += 1;
      continue;
    }
    if (BLOCKQUOTE_PATTERN.test(line)) {
      index = appendBlockquote(document, root, lines, index);
      continue;
    }
    if (THEMATIC_BREAK_PATTERN.test(line)) {
      root.append(document.createElement("hr"));
      index += 1;
      continue;
    }
    if (isTableStart(lines, index)) {
      index = appendTable(document, root, lines, index);
      continue;
    }
    if (parseListItem(line)) {
      index = appendList(document, root, lines, index);
      continue;
    }
    index = appendParagraph(document, root, lines, index);
  }
}

function appendFencedCode(
  document: MarkdownDocument,
  root: HTMLElement,
  lines: readonly string[],
  start: number,
  language: string,
): number {
  const body: string[] = [];
  let index = start + 1;
  while (index < lines.length && !FENCE_PATTERN.test(lines[index] ?? "")) {
    body.push(lines[index] ?? "");
    index += 1;
  }
  if (index < lines.length) index += 1;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  if (language.length > 0) code.className = `language-${language}`;
  code.textContent = body.join("\n");
  pre.append(code);
  root.append(pre);
  return index;
}

function appendBlockquote(
  document: MarkdownDocument,
  root: HTMLElement,
  lines: readonly string[],
  start: number,
): number {
  const blockquote = document.createElement("blockquote");
  const content: string[] = [];
  let index = start;
  while (index < lines.length) {
    const match = BLOCKQUOTE_PATTERN.exec(lines[index] ?? "");
    if (!match) break;
    content.push(match[1] ?? "");
    index += 1;
  }
  const paragraph = document.createElement("p");
  appendInline(document, paragraph, content.join(" ").trim());
  blockquote.append(paragraph);
  root.append(blockquote);
  return index;
}

/**
 * 按缩进递归渲染列表：同层同类型的标记属于当前列表，更深的缩进成为上一项的
 * 嵌套列表，空行只要后面仍是同层列表项就继续当前列表（宽松列表）。
 */
function appendList(
  document: MarkdownDocument,
  root: HTMLElement,
  lines: readonly string[],
  start: number,
): number {
  const first = parseListItem(lines[start] ?? "");
  if (!first) return start + 1;
  const list = document.createElement(first.ordered ? "ol" : "ul");
  let index = start;
  let item: HTMLElement | null = null;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      const next = nextContentLine(lines, index);
      const marker = next < lines.length ? parseListItem(lines[next] ?? "") : null;
      if (!marker || marker.indent < first.indent || marker.ordered !== first.ordered) break;
      index = next;
      continue;
    }
    const marker = parseListItem(line);
    if (marker) {
      if (marker.indent > first.indent && item) {
        index = appendList(document, item, lines, index);
        continue;
      }
      if (marker.indent < first.indent || marker.ordered !== first.ordered) break;
      item = document.createElement("li");
      appendInline(document, item, marker.text);
      list.append(item);
      index += 1;
      continue;
    }
    // 比列表标记更深的普通行是当前项的续行。
    if (item && /^[ \t]/u.test(line)) {
      appendInline(document, item, ` ${line.trim()}`);
      index += 1;
      continue;
    }
    break;
  }
  root.append(list);
  return index;
}

function appendParagraph(
  document: MarkdownDocument,
  root: HTMLElement,
  lines: readonly string[],
  start: number,
): number {
  const paragraphLines: string[] = [];
  let index = start;
  while (index < lines.length) {
    if (breaksParagraph(lines, index)) break;
    paragraphLines.push((lines[index] ?? "").trim());
    index += 1;
  }
  const paragraph = document.createElement("p");
  paragraphLines.forEach((line, lineIndex) => {
    if (lineIndex > 0) paragraph.append(document.createElement("br"));
    appendInline(document, paragraph, line);
  });
  root.append(paragraph);
  return index;
}

function breaksParagraph(lines: readonly string[], index: number): boolean {
  const current = lines[index] ?? "";
  return (
    current.trim().length === 0 ||
    FENCE_PATTERN.test(current) ||
    HEADING_PATTERN.test(current) ||
    BLOCKQUOTE_PATTERN.test(current) ||
    THEMATIC_BREAK_PATTERN.test(current) ||
    Boolean(parseListItem(current)) ||
    isTableStart(lines, index)
  );
}

function parseListItem(line: string): ListItem | null {
  const match = LIST_ITEM_PATTERN.exec(line);
  const text = match?.[4];
  if (!match || text === undefined) return null;
  return {
    indent: indentWidth(match[1] ?? ""),
    ordered: match[3] !== undefined,
    text,
  };
}

function indentWidth(prefix: string): number {
  let width = 0;
  for (const character of prefix) width += character === "\t" ? 4 : 1;
  return width;
}

function nextContentLine(lines: readonly string[], start: number): number {
  let index = start;
  while (index < lines.length && (lines[index] ?? "").trim().length === 0) index += 1;
  return index;
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const header = parseTableRow(lines[index] ?? "");
  if (!header || header.length < 2) return false;
  const delimiter = parseTableRow(lines[index + 1] ?? "");
  if (!delimiter || delimiter.length !== header.length) return false;
  return delimiter.every((cell) => TABLE_DELIMITER_CELL_PATTERN.test(cell));
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const cells = trimmed
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 0 ? cells : null;
}

function appendTable(
  document: MarkdownDocument,
  root: HTMLElement,
  lines: readonly string[],
  start: number,
): number {
  const header = parseTableRow(lines[start] ?? "") ?? [];
  const delimiter = parseTableRow(lines[start + 1] ?? "") ?? [];
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  header.forEach((cell, cellIndex) => {
    const th = document.createElement("th");
    applyTableAlignment(th, delimiter[cellIndex] ?? "");
    appendInline(document, th, cell);
    headRow.append(th);
  });
  head.append(headRow);
  table.append(head);
  const body = document.createElement("tbody");
  let index = start + 2;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) break;
    const row = parseTableRow(line);
    if (!row) break;
    const tr = document.createElement("tr");
    row.forEach((cell, cellIndex) => {
      const td = document.createElement("td");
      applyTableAlignment(td, delimiter[cellIndex] ?? "");
      appendInline(document, td, cell);
      tr.append(td);
    });
    body.append(tr);
    index += 1;
  }
  table.append(body);
  root.append(table);
  return index;
}

function applyTableAlignment(cell: HTMLElement, delimiter: string): void {
  const trimmed = delimiter.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) cell.setAttribute("style", "text-align:center");
  else if (right) cell.setAttribute("style", "text-align:right");
  else if (left) cell.setAttribute("style", "text-align:left");
}

function appendInline(document: MarkdownDocument, parent: HTMLElement, text: string): void {
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parent.append(text.slice(lastIndex, index));
    if (match[2] !== undefined) {
      const code = document.createElement("code");
      code.textContent = match[2];
      parent.append(code);
    } else if (match[3] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[3];
      parent.append(strong);
    } else {
      const href = match[5] ?? "";
      if (!isSafeLink(href)) {
        parent.append(match[4] ?? "");
      } else {
        const link = document.createElement("a");
        link.textContent = match[4] ?? "";
        link.setAttribute("href", href);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        parent.append(link);
      }
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parent.append(text.slice(lastIndex));
}

function isSafeLink(href: string): boolean {
  try {
    const url = new URL(href, "https://codexhost.invalid");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
