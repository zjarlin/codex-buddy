import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureProjectTools } from "../src/project-tools/dialog.js";
import { projectToolLabels, type ProjectToolDraft } from "../src/project-tools/model.js";

interface FakeElement {
  tagName: string;
  type: string;
  className: string;
  classList: { add(name: string): void };
  textContent: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  hidden: boolean;
  readonly: boolean;
  title: string;
  rows: number;
  spellcheck: boolean;
  inputMode: string;
  attributes: Record<string, string>;
  children: (FakeElement | string)[];
  parent: FakeElement | null;
  handlers: Map<string, ((event: FakeEvent) => void)[]>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  append(...nodes: (FakeElement | string)[]): void;
  appendChild(node: FakeElement): void;
  prepend(...nodes: (FakeElement | string)[]): void;
  before(...nodes: FakeElement[]): void;
  after(...nodes: FakeElement[]): void;
  remove(): void;
  addEventListener(name: string, handler: (event: FakeEvent) => void): void;
  click(): void;
  close(): void;
  showModal(): void;
  focus(): void;
}

interface FakeEvent {
  preventDefault(): void;
}

/** 仓库不引入 jsdom；这里只实现对话框实际用到的 DOM 能力。 */
function fakeElement(tagName: string): FakeElement {
  const element: FakeElement = {
    tagName,
    textContent: "",
    type: "",
    className: "",
    classList: {
      add(name) {
        (this as unknown as FakeElement).className =
          `${(this as unknown as FakeElement).className} ${name}`.trim();
      },
    },
    value: "",
    placeholder: "",
    disabled: false,
    hidden: false,
    readonly: false,
    title: "",
    rows: 0,
    spellcheck: true,
    inputMode: "",
    attributes: {},
    children: [],
    parent: null,
    handlers: new Map(),
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    append(...nodes) {
      for (const node of nodes) {
        if (typeof node !== "string") node.parent = this;
        this.children.push(node);
      }
    },
    appendChild(node) {
      node.parent = this;
      this.children.push(node);
    },
    prepend(...nodes) {
      for (const node of nodes) {
        if (typeof node !== "string") node.parent = this;
        this.children.unshift(node);
      }
    },
    before(...nodes) {
      const parent = this.parent;
      if (!parent) return;
      const index = parent.children.indexOf(this);
      for (const node of nodes) if (typeof node !== "string") node.parent = parent;
      parent.children.splice(index, 0, ...nodes);
    },
    after(...nodes) {
      const parent = this.parent;
      if (!parent) return;
      const index = parent.children.indexOf(this);
      for (const node of nodes) if (typeof node !== "string") node.parent = parent;
      parent.children.splice(index + 1, 0, ...nodes);
    },
    remove() {
      const parent = this.parent;
      if (!parent) return;
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
      this.parent = null;
    },
    addEventListener(name, handler) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    },
    click() {
      for (const handler of this.handlers.get("click") ?? []) {
        handler({ preventDefault() {} });
      }
    },
    close() {
      for (const handler of this.handlers.get("close") ?? []) handler({ preventDefault() {} });
    },
    showModal() {},
    focus() {},
  };
  return element;
}

function requireElement(element: FakeElement | undefined): FakeElement {
  if (!element) throw new Error("expected element");
  return element;
}

function findAll(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = [];
  const visit = (element: FakeElement): void => {
    if (predicate(element)) found.push(element);
    for (const child of element.children) if (typeof child !== "string") visit(child);
  };
  visit(root);
  return found;
}

const byAttribute = (name: string) => (element: FakeElement) =>
  Object.prototype.hasOwnProperty.call(element.attributes, name);

let body: FakeElement;
let originalDocument: unknown;

beforeEach(() => {
  body = fakeElement("body");
  originalDocument = Reflect.get(globalThis, "document");
  if (!("HTMLElement" in globalThis)) {
    Reflect.set(globalThis, "HTMLElement", function HTMLElement() {});
  }
  Reflect.set(globalThis, "document", {
    createElement: fakeElement,
    createElementNS: fakeElement,
    body,
    activeElement: null,
  });
});

afterEach(() => {
  Reflect.set(globalThis, "document", originalDocument);
});

describe("Project tools dialog", () => {
  it("opens with existing custom scripts and saves added rows", async () => {
    const saved: ProjectToolDraft[] = [];
    const dialog = configureProjectTools({
      project: { projectKind: "local", projectId: "project", label: "demo" },
      binding: {
        target: { projectKind: "local", projectId: "project" },
        label: "demo",
        scripts: { start: "/repo/start.sh" },
        customScripts: [{ id: "deploy", name: "部署", path: "/repo/deploy.sh" }],
      },
      metadataPath: "/root/.codexhost/project-tools.json",
      projectPath: "/repo",
      labels: projectToolLabels("zh-CN"),
      save: async (draft) => {
        saved.push(draft);
      },
      remove: async () => {},
      onClose: () => {},
    }) as unknown as FakeElement;

    const rows = () => findAll(dialog, (element) => element.className.includes("custom-row"));
    expect(rows()).toHaveLength(1);
    const existingInputs = findAll(
      requireElement(rows()[0]),
      (element) => element.tagName === "input",
    );
    expect(existingInputs.map((input) => input.value)).toEqual(["部署", "/repo/deploy.sh"]);

    requireElement(
      findAll(dialog, byAttribute("data-codexhost-project-tool-add-script"))[0],
    ).click();
    expect(rows()).toHaveLength(2);
    const addedInputs = findAll(
      requireElement(rows()[1]),
      (element) => element.tagName === "input",
    );
    requireElement(addedInputs[0]).value = "构建";
    requireElement(addedInputs[1]).value = "/repo/build.sh";

    const form = requireElement(findAll(dialog, (element) => element.tagName === "form")[0]);
    for (const handler of form.handlers.get("submit") ?? []) handler({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saved[0]?.customScripts).toEqual([
      { id: "deploy", name: "部署", path: "/repo/deploy.sh" },
      { name: "构建", path: "/repo/build.sh" },
    ]);

    const removeButton = findAll(dialog, (element) =>
      element.className.includes("custom-remove"),
    )[0];
    requireElement(removeButton).click();
    expect(rows()).toHaveLength(1);
  });
});
