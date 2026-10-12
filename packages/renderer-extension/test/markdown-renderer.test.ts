import { describe, expect, it } from "vitest";

import { appendMarkdownBlocks, createMarkdownElement } from "../src/markdown-renderer.js";

interface FakeElement {
  tagName: string;
  className: string;
  attributes: Record<string, string>;
  children: (FakeElement | string)[];
  textContent: string;
  append(...nodes: (FakeElement | string)[]): void;
  setAttribute(name: string, value: string): void;
  replaceChildren(): void;
}

/** 仓库没有 jsdom，用一个最小 DOM 桩覆盖 Markdown 渲染器实际使用的能力。 */
function fakeDocument(): Pick<Document, "createElement"> {
  return {
    createElement(tag: string): FakeElement {
      const element: FakeElement = {
        tagName: tag,
        className: "",
        attributes: {},
        children: [],
        textContent: "",
        append(...nodes) {
          for (const node of nodes) this.children.push(node);
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        replaceChildren() {
          this.children = [];
        },
      };
      return element;
    },
  } as unknown as Pick<Document, "createElement">;
}

function render(markdown: string): FakeElement {
  return createMarkdownElement(fakeDocument(), markdown) as unknown as FakeElement;
}

function serialize(node: FakeElement | string): string {
  if (typeof node === "string") return node;
  const attributes = [
    node.className ? ` class="${node.className}"` : "",
    ...Object.entries(node.attributes).map(([name, value]) => ` ${name}="${value}"`),
  ].join("");
  const inner = node.textContent || node.children.map(serialize).join("");
  return `<${node.tagName}${attributes}>${inner}</${node.tagName}>`;
}

function blockTags(node: FakeElement): string[] {
  return node.children
    .filter((child): child is FakeElement => typeof child !== "string")
    .map((child) => child.tagName);
}

describe("markdown renderer", () => {
  it("renders headings, paragraphs and lists as separate blocks", () => {
    const root = render("## 结论\n\n已完成三项修改：\n\n1. 第一项\n2. 第二项\n\n- 补充说明");
    expect(blockTags(root)).toEqual(["h2", "p", "ol", "ul"]);
    expect(serialize(root)).toBe(
      "<div><h2>结论</h2><p>已完成三项修改：</p><ol><li>第一项</li><li>第二项</li></ol><ul><li>补充说明</li></ul></div>",
    );
  });

  it("nests indented list items under their parent item", () => {
    const root = render("- 嵌套：\n  - 子项 A\n  - 子项 B\n- 同级");
    expect(serialize(root)).toBe(
      "<div><ul><li>嵌套：<ul><li>子项 A</li><li>子项 B</li></ul></li><li>同级</li></ul></div>",
    );
  });

  it("renders GFM tables with header and alignment", () => {
    const root = render("| 项 | 状态 |\n| --- | :--: |\n| 渲染 | 完成 |");
    expect(serialize(root)).toBe(
      '<div><table><thead><tr><th>项</th><th style="text-align:center">状态</th></tr></thead>' +
        '<tbody><tr><td>渲染</td><td style="text-align:center">完成</td></tr></tbody></table></div>',
    );
  });

  it("keeps a pipe paragraph when no delimiter row follows", () => {
    const root = render("a | b\nc | d");
    expect(blockTags(root)).toEqual(["p"]);
  });

  it("renders blockquotes, fenced code, thematic breaks and inline formatting", () => {
    const root = render(
      "> 引用\n\n```ts\nconst x = 1;\n```\n\n---\n\n**粗体** 与 `代码` 与 [链接](https://example.com)",
    );
    expect(blockTags(root)).toEqual(["blockquote", "pre", "hr", "p"]);
    const html = serialize(root);
    expect(html).toContain("<blockquote><p>引用</p></blockquote>");
    expect(html).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain("<code>代码</code>");
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">链接</a>',
    );
  });

  it("appends blocks to an existing container", () => {
    const root = render("");
    appendMarkdownBlocks(fakeDocument(), root as unknown as HTMLElement, "第一段\n\n第二段");
    expect(blockTags(root)).toEqual(["p", "p"]);
  });
});
