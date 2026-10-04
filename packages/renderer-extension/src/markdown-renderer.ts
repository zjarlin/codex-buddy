/**
 * Lightweight Markdown renderer for renderer-extension UI components.
 * Supports headings, paragraphs, lists, blockquotes, fenced code blocks,
 * thematic breaks, and inline formatting (code, bold, links).
 */

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)\s*$/u;
const BLOCKQUOTE_PATTERN = /^>[ \t]?(.*?)\s*$/u;
const UNORDERED_ITEM_PATTERN = /^[-*][ \t]+(.+?)\s*$/u;
const CONTINUATION_PATTERN = /^[ \t]+(.+?)\s*$/u;
const ORDERED_ITEM_PATTERN = /^\d+[.)][ \t]+(.+?)\s*$/u;
const FENCE_PATTERN = /^```([\w+-]*)\s*$/u;
const THEMATIC_BREAK_PATTERN = /^(?:---|___|\*\*\*)[ \t]*$/u;
const INLINE_PATTERN = /(`+)((?:(?!\1).)+)\1|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/gu;

export type MarkdownDocument = Pick<Document, "createElement">;

export interface MarkdownRenderOptions {
  /** CSS class name for the root container element. */
  className?: string;
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
    if (UNORDERED_ITEM_PATTERN.test(line)) {
      index = appendList(document, root, lines, index, "ul", UNORDERED_ITEM_PATTERN);
      continue;
    }
    if (ORDERED_ITEM_PATTERN.test(line)) {
      index = appendList(document, root, lines, index, "ol", ORDERED_ITEM_PATTERN);
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

function appendList(
  document: MarkdownDocument,
  root: HTMLElement,
  lines: readonly string[],
  start: number,
  tag: "ul" | "ol",
  pattern: RegExp,
): number {
  const list = document.createElement(tag);
  let index = start;
  while (index < lines.length) {
    const item = pattern.exec(lines[index] ?? "");
    if (!item?.[1]) break;
    const entry = document.createElement("li");
    appendInline(document, entry, item[1]);
    index += 1;

    const continuationLines: string[] = [];
    while (index < lines.length) {
      const continuation = CONTINUATION_PATTERN.exec(lines[index] ?? "");
      if (!continuation?.[1]) break;
      continuationLines.push(continuation[1]);
      index += 1;
    }
    if (continuationLines.length > 0) {
      appendInline(document, entry, " " + continuationLines.join(" "));
    }
    list.append(entry);
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
    const current = lines[index] ?? "";
    if (
      current.trim().length === 0 ||
      FENCE_PATTERN.test(current) ||
      HEADING_PATTERN.test(current) ||
      BLOCKQUOTE_PATTERN.test(current) ||
      THEMATIC_BREAK_PATTERN.test(current) ||
      UNORDERED_ITEM_PATTERN.test(current) ||
      ORDERED_ITEM_PATTERN.test(current)
    ) {
      break;
    }
    paragraphLines.push(current.trim());
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
