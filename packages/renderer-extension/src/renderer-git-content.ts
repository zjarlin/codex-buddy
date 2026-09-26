import { diffArrays } from "diff";

import type { GitContentResult, GitDiffResult } from "@codexhost/shared-contracts";
import { gitButtonLoadingStyles } from "./renderer-git-loading.js";

const MAIN_SURFACE_SELECTOR = '[data-app-shell-main-surface="default"]';
const APP_HEADER_SELECTOR = 'header[data-pip-obstacle="app-shell-header"]';

type ContentMode = "unified" | "split" | "result";

interface DiffRow {
  kind: "context" | "change";
  leftNumber: number | null;
  rightNumber: number | null;
  left: string;
  right: string;
  adoptable: boolean;
}

interface GitContentActions {
  save(content: string, revision: string): Promise<{ revision: string }>;
}

function lines(value: string): string[] {
  if (!value) return [];
  const result = value.split("\n");
  if (result.at(-1) === "") result.pop();
  return result;
}

function buildRows(base: string, working: string): DiffRow[] {
  const left = lines(base);
  const right = lines(working);
  const parts = diffArrays(left, right, { timeout: 40, maxEditLength: 2000 });
  // 极端改写限制同步对齐计算时间，仍允许逐行查看两侧正文。
  if (!parts) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => ({
      kind: left[index] === right[index] ? "context" : "change",
      leftNumber: index < left.length ? index + 1 : null,
      rightNumber: index < right.length ? index + 1 : null,
      left: left[index] ?? "",
      right: right[index] ?? "",
      adoptable: left[index] !== right[index],
    }));
  }
  const rows: DiffRow[] = [];
  let leftNumber = 1;
  let rightNumber = 1;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    const next = parts[index + 1];
    if (part.removed && next?.added) {
      for (let line = 0; line < Math.max(part.value.length, next.value.length); line += 1) {
        rows.push({
          kind: "change",
          leftNumber: part.value[line] === undefined ? null : leftNumber++,
          rightNumber: next.value[line] === undefined ? null : rightNumber++,
          left: part.value[line] ?? "",
          right: next.value[line] ?? "",
          adoptable: true,
        });
      }
      index += 1;
      continue;
    }
    if (!part.added && !part.removed) {
      for (const line of part.value) {
        rows.push({
          kind: "context",
          leftNumber: leftNumber++,
          rightNumber: rightNumber++,
          left: line,
          right: line,
          adoptable: false,
        });
      }
      continue;
    }
    for (const line of part.value) {
      rows.push({
        kind: "change",
        leftNumber: part.removed ? leftNumber++ : null,
        rightNumber: part.added ? rightNumber++ : null,
        left: part.removed ? line : "",
        right: part.added ? line : "",
        adoptable: true,
      });
    }
  }
  return rows;
}

function unifiedText(result: GitDiffResult): string {
  return result.diff || "没有差异";
}

// Git 正文覆盖主对话表面，保留原生聊天 DOM 与侧栏导航。
export function createRendererGitContent(options: {
  ownerDocument: Document;
  onClose(): void;
  actions?: GitContentActions;
}) {
  const document = options.ownerDocument;
  const ownerWindow = document.defaultView ?? window;
  const root = document.createElement("section");
  root.setAttribute("data-codexhost-git-content", "v2");
  root.setAttribute("aria-label", "Git 内容");
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    ${gitButtonLoadingStyles}
    :host { box-sizing:border-box; position:fixed; z-index:50; display:flex; flex-direction:column; overflow:hidden; color:var(--text-primary,#111); background:var(--surface-primary,#fff); font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif); }
    .head { display:flex; flex:none; min-height:44px; align-items:center; gap:8px; padding:6px 10px 6px 12px; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 12%,transparent)); }
    .title { min-width:0; flex:1; }
    .title strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
    .meta { display:flex; gap:8px; overflow:hidden; margin-top:2px; color:inherit; font-size:10px; opacity:.58; }
    .meta span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .segmented { display:flex; flex:none; padding:2px; background:color-mix(in srgb,currentColor 7%,transparent); border-radius:6px; }
    .segmented button { min-height:26px; padding:3px 9px; color:inherit; background:transparent; border:0; border-radius:4px; cursor:pointer; font-size:11px; opacity:.65; }
    .segmented button[aria-pressed="true"] { background:var(--surface-primary,#fff); box-shadow:0 1px 2px rgb(0 0 0 / 12%); opacity:1; }
    .actions { display:flex; flex:none; align-items:center; gap:4px; }
    .actions button, .icon { display:grid; min-height:28px; place-items:center; padding:3px 8px; color:inherit; background:transparent; border:1px solid transparent; border-radius:5px; cursor:pointer; font-size:11px; }
    .actions button:hover, .icon:hover { background:color-mix(in srgb,currentColor 10%,transparent); }
    button[hidden], .segmented[hidden] { display:none; }
    button:focus-visible { outline:2px solid var(--text-link,#339cff); outline-offset:1px; }
    button:disabled { cursor:default; opacity:.38; }
    .icon { width:28px; padding:0; font-size:20px; }
    .body { min-height:0; flex:1; overflow:auto; }
    .codexhost-git-diff { margin:0; padding:14px 16px; white-space:pre; font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .codexhost-git-empty { padding:14px 16px; opacity:.65; font-size:12px; }
    .status { display:flex; flex:none; min-height:32px; align-items:center; gap:10px; padding:5px 12px; color:inherit; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 10%,transparent)); font-size:11px; }
    .status[data-tone="error"] { color:var(--color-text-danger,#ef4444); }
    .status[hidden] { display:none; }
    .split { min-width:760px; color:inherit; background:var(--surface-primary,#fff); font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .split-head { position:sticky; z-index:3; top:0; display:grid; grid-template-columns:1fr 34px 1fr; color:inherit; background:var(--surface-secondary,#f5f5f7); border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 13%,transparent)); font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif); font-size:11px; font-weight:600; }
    .split-head span { overflow:hidden; padding:7px 10px; text-overflow:ellipsis; white-space:nowrap; }
    .split-head span:nth-child(2) { padding:0; border-inline:1px solid var(--border-default,color-mix(in srgb,currentColor 10%,transparent)); }
    .split-row { box-sizing:border-box; display:grid; grid-template-columns:1fr 34px 1fr; height:24px; border-bottom:1px solid color-mix(in srgb,currentColor 4%,transparent); }
    .split-row[data-kind="change"] { background:color-mix(in srgb,var(--text-link,#339cff) 5%,transparent); }
    .side { display:grid; min-width:0; grid-template-columns:48px minmax(0,1fr); }
    .left { border-right:1px solid var(--border-default,color-mix(in srgb,currentColor 9%,transparent)); }
    .right { border-left:1px solid var(--border-default,color-mix(in srgb,currentColor 9%,transparent)); }
    .number { padding:2px 8px; color:inherit; text-align:right; opacity:.42; user-select:none; }
    .line { min-width:0; padding:2px 10px; overflow:hidden; text-overflow:ellipsis; white-space:pre; }
    .split-row[data-state="removed"] .left .line { background:color-mix(in srgb,var(--color-text-danger,#ef4444) 13%,transparent); }
    .split-row[data-state="added"] .right .line { background:color-mix(in srgb,var(--green,#3fa66a) 14%,transparent); }
    .gutter { display:grid; place-items:center; padding:0; color:inherit; background:transparent; border:0; border-inline:1px solid var(--border-default,color-mix(in srgb,currentColor 8%,transparent)); cursor:pointer; opacity:.45; }
    .gutter:hover { background:color-mix(in srgb,currentColor 12%,transparent); opacity:1; }
    .gutter::before { content:"›"; font-size:16px; }
    .empty-side { color:inherit; opacity:.3; }
    .merge-editor { box-sizing:border-box; width:100%; min-height:100%; padding:12px 14px; resize:none; color:var(--text-primary,#111); background:var(--surface-primary,#fff); border:0; outline:0; font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; tab-size:2; }
    .split-body { display:grid; min-height:0; flex:1; grid-template-columns:minmax(0,1fr); overflow:auto; }
    .editor-wrap { display:grid; min-height:0; flex:1; overflow:hidden; }
    .editor-wrap[hidden], .split-wrap[hidden] { display:none; }
    .split-wrap { min-height:0; flex:1; overflow:auto; }
  `;
  const head = document.createElement("header");
  head.className = "head";
  const titleWrap = document.createElement("div");
  titleWrap.className = "title";
  const title = document.createElement("strong");
  const meta = document.createElement("div");
  meta.className = "meta";
  const baseMeta = document.createElement("span");
  const resultMeta = document.createElement("span");
  meta.append(baseMeta, resultMeta);
  titleWrap.append(title, meta);
  const segmented = document.createElement("div");
  segmented.className = "segmented";
  const unifiedButton = document.createElement("button");
  unifiedButton.type = "button";
  unifiedButton.textContent = "统一";
  const splitButton = document.createElement("button");
  splitButton.type = "button";
  splitButton.textContent = "并排";
  const resultButton = document.createElement("button");
  resultButton.type = "button";
  resultButton.textContent = "结果";
  segmented.append(unifiedButton, splitButton, resultButton);
  const actions = document.createElement("div");
  actions.className = "actions";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "保存";
  saveButton.hidden = true;
  const stageButton = document.createElement("button");
  stageButton.type = "button";
  stageButton.textContent = "暂存";
  stageButton.hidden = true;
  const oursButton = document.createElement("button");
  oursButton.type = "button";
  oursButton.textContent = "采用当前";
  oursButton.hidden = true;
  const theirsButton = document.createElement("button");
  theirsButton.type = "button";
  theirsButton.textContent = "采用传入";
  theirsButton.hidden = true;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "icon";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "关闭 Git 内容");
  closeButton.title = "返回聊天（Esc）";
  actions.append(oursButton, theirsButton, saveButton, stageButton, closeButton);
  head.append(titleWrap, segmented, actions);
  const status = document.createElement("div");
  status.className = "status";
  status.hidden = true;
  const body = document.createElement("div");
  body.className = "body";
  const editorWrap = document.createElement("div");
  editorWrap.className = "editor-wrap";
  editorWrap.hidden = true;
  const editor = document.createElement("textarea");
  editor.className = "merge-editor";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "合并结果");
  editorWrap.append(editor);
  const splitWrap = document.createElement("div");
  splitWrap.className = "split-wrap";
  splitWrap.hidden = true;
  const unified = document.createElement("pre");
  unified.className = "codexhost-git-diff";
  body.append(unified, splitWrap, editorWrap);
  const setup = document.createElement("div");
  setup.className = "codexhost-git-empty";
  shadow.append(style, head, setup, status, body);

  let opened = false;
  let disposed = false;
  let frame = 0;
  let mainSurface: HTMLElement | null = null;
  let header: HTMLElement | null = null;
  let mode: ContentMode = "unified";
  let splitRows: DiffRow[] | null = null;
  let splitValue: string | null = null;
  let splitStart = -1;
  let splitFrame = 0;
  let content: GitContentResult | null = null;
  let original = "";
  let dirty = false;
  let saving: GitContentResult | null = null;
  let staging: GitContentResult | null = null;
  let busy = false;
  let stageHandler: (() => void | Promise<void>) | null = null;
  const resizeObserver = new ResizeObserver(() => schedulePosition());
  const mutationObserver = new MutationObserver(() => schedulePosition());

  const position = (): void => {
    frame = 0;
    if (!opened || disposed) return;
    const next = document.querySelector<HTMLElement>(MAIN_SURFACE_SELECTOR);
    const nextHeader = document.querySelector<HTMLElement>(APP_HEADER_SELECTOR);
    if (next !== mainSurface || nextHeader !== header) {
      resizeObserver.disconnect();
      mainSurface = next;
      header = nextHeader;
      if (mainSurface) resizeObserver.observe(mainSurface);
      if (header) resizeObserver.observe(header);
    }
    const bounds = mainSurface?.getBoundingClientRect();
    root.style.display = bounds && bounds.width > 0 && bounds.height > 0 ? "flex" : "none";
    if (!bounds) return;
    const left = Math.max(0, bounds.left);
    const top = Math.max(0, bounds.top, header?.getBoundingClientRect().bottom ?? 0);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.width = `${Math.max(0, Math.min(ownerWindow.innerWidth, bounds.right) - left)}px`;
    root.style.height = `${Math.max(0, Math.min(ownerWindow.innerHeight, bounds.bottom) - top)}px`;
  };
  function schedulePosition(): void {
    if (opened && !disposed && !frame) frame = ownerWindow.requestAnimationFrame(position);
  }

  const setNotice = (value: string, error = false): void => {
    status.hidden = value.length === 0;
    status.dataset.tone = error ? "error" : "";
    status.textContent = value;
  };

  const close = (): void => {
    if (!opened) return;
    opened = false;
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    mainSurface = null;
    header = null;
    if (frame) ownerWindow.cancelAnimationFrame(frame);
    frame = 0;
    root.remove();
    content = null;
    splitRows = null;
    splitValue = null;
    splitStart = -1;
    unified.textContent = "";
    editor.value = "";
    splitWrap.replaceChildren();
    if (splitFrame) ownerWindow.cancelAnimationFrame(splitFrame);
    splitFrame = 0;
    dirty = false;
    stageHandler = null;
    options.onClose();
  };

  const renderSplit = (): void => {
    if (!content) return;
    if (splitValue !== editor.value || splitRows === null) {
      splitRows = buildRows(content.base, editor.value);
      splitValue = editor.value;
      splitStart = -1;
    }
    const start = Math.max(0, Math.floor(body.scrollTop / 24) - 10);
    if (start === splitStart) return;
    splitStart = start;
    splitWrap.replaceChildren();
    const split = document.createElement("section");
    split.className = "split";
    const splitHead = document.createElement("div");
    splitHead.className = "split-head";
    const leftHead = document.createElement("span");
    leftHead.textContent = content.baseLabel;
    const centerHead = document.createElement("span");
    const rightHead = document.createElement("span");
    rightHead.textContent = "工作区";
    splitHead.append(leftHead, centerHead, rightHead);
    split.append(splitHead);
    const top = document.createElement("div");
    top.style.height = `${start * 24}px`;
    split.append(top);
    const end = Math.min(splitRows.length, start + 100);
    for (const row of splitRows.slice(start, end)) {
      const rowElement = document.createElement("div");
      rowElement.className = "split-row";
      rowElement.dataset.kind = row.kind;
      if (row.kind === "change") {
        rowElement.dataset.state =
          row.left && !row.right ? "removed" : !row.left && row.right ? "added" : "changed";
      }
      const left = document.createElement("div");
      left.className = "side left";
      const leftNumber = document.createElement("span");
      leftNumber.className = "number";
      leftNumber.textContent = row.leftNumber === null ? "" : String(row.leftNumber);
      const leftLine = document.createElement("span");
      leftLine.className = "line";
      leftLine.textContent = row.left;
      leftLine.title = row.left;
      left.append(leftNumber, leftLine);
      const gutter = document.createElement("button");
      gutter.type = "button";
      gutter.className = "gutter";
      gutter.title = "使用左侧这一行";
      gutter.setAttribute("aria-label", `使用左侧第 ${row.leftNumber ?? ""} 行`);
      gutter.disabled = !row.adoptable || !row.left;
      gutter.addEventListener("click", () => adopt(row));
      const right = document.createElement("div");
      right.className = "side right";
      const rightNumber = document.createElement("span");
      rightNumber.className = "number";
      rightNumber.textContent = row.rightNumber === null ? "" : String(row.rightNumber);
      const rightLine = document.createElement("span");
      rightLine.className = "line";
      rightLine.textContent = row.right;
      rightLine.title = row.right;
      right.append(rightNumber, rightLine);
      split.append(rowElement);
      rowElement.append(left, gutter, right);
    }
    const bottom = document.createElement("div");
    bottom.style.height = `${Math.max(0, splitRows.length - end) * 24}px`;
    split.append(bottom);
    splitWrap.append(split);
  };

  const setDirty = (value: boolean): void => {
    dirty = value;
    saveButton.disabled =
      busy ||
      Boolean(saving || staging) ||
      !dirty ||
      !content ||
      (content.kind !== undefined && content.kind !== "file") ||
      content.binary ||
      content.truncated;
    stageButton.disabled =
      busy ||
      Boolean(saving || staging) ||
      !stageHandler ||
      !content ||
      content.binary ||
      content.conflicted ||
      content.truncated ||
      dirty;
    saveButton.setAttribute("aria-busy", String(saving !== null && saving === content));
    stageButton.setAttribute("aria-busy", String(staging !== null && staging === content));
  };

  const render = (): void => {
    const unifiedMode = mode === "unified" || content === null;
    const split = mode === "split" && content !== null;
    const result = mode === "result" && content !== null;
    unified.hidden = !unifiedMode;
    splitWrap.hidden = !split;
    editorWrap.hidden = !result;
    unifiedButton.setAttribute("aria-pressed", String(mode === "unified"));
    splitButton.setAttribute("aria-pressed", String(mode === "split"));
    resultButton.setAttribute("aria-pressed", String(mode === "result"));
    if (split) renderSplit();
  };

  const adopt = (row: DiffRow): void => {
    const value = lines(editor.value);
    const target = row.rightNumber === null ? value.length : row.rightNumber - 1;
    if (row.right) {
      value.splice(target, 1, ...(row.left ? [row.left] : []));
    } else {
      value.splice(target, 0, ...(row.left ? [row.left] : []));
    }
    editor.value = value.join("\n") + (editor.value.endsWith("\n") ? "\n" : "");
    setDirty(editor.value !== original);
    render();
  };

  const onInput = (): void => setDirty(editor.value !== original);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && opened) close();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !saveButton.hidden) {
      event.preventDefault();
      void save();
    }
  };
  const save = async (): Promise<void> => {
    if (!content || !options.actions || saveButton.disabled) return;
    const savedContent = content;
    const savedValue = editor.value;
    saving = savedContent;
    setNotice("正在保存合并结果…");
    setDirty(true);
    try {
      const result = await options.actions.save(savedValue, savedContent.revision);
      if (disposed || content !== savedContent) return;
      content = {
        ...savedContent,
        working: savedValue,
        revision: result.revision,
        conflicted: false,
      };
      original = savedValue;
      setDirty(editor.value !== original);
      setNotice("已保存到工作区。");
    } catch (error) {
      if (!disposed && content === savedContent) {
        setNotice(error instanceof Error ? error.message : String(error), true);
      }
    } finally {
      saving = null;
      setDirty(dirty);
    }
  };

  const stage = async (): Promise<void> => {
    if (!content || !stageHandler || stageButton.disabled) return;
    const stagedContent = content;
    staging = stagedContent;
    setDirty(dirty);
    try {
      await stageHandler();
    } catch (error) {
      if (!disposed && content === stagedContent) {
        setNotice(error instanceof Error ? error.message : String(error), true);
      }
    } finally {
      staging = null;
      setDirty(dirty);
    }
  };

  body.addEventListener("scroll", () => {
    if (mode !== "split" || splitFrame) return;
    splitFrame = ownerWindow.requestAnimationFrame(() => {
      splitFrame = 0;
      if (opened && mode === "split") renderSplit();
    });
  });
  closeButton.addEventListener("click", close);
  unifiedButton.addEventListener("click", () => {
    mode = "unified";
    render();
  });
  splitButton.addEventListener("click", () => {
    mode = "split";
    splitStart = -1;
    body.scrollTop = 0;
    render();
  });
  resultButton.addEventListener("click", () => {
    mode = "result";
    render();
  });
  editor.addEventListener("input", onInput);
  saveButton.addEventListener("click", () => void save());
  stageButton.addEventListener("click", () => void stage());
  oursButton.addEventListener("click", () => {
    if (!content?.ours) return;
    editor.value = content.ours;
    setDirty(true);
    mode = "result";
    render();
  });
  theirsButton.addEventListener("click", () => {
    if (!content?.theirs) return;
    editor.value = content.theirs;
    setDirty(true);
    mode = "result";
    render();
  });
  document.addEventListener("keydown", onKeyDown);
  ownerWindow.addEventListener("resize", schedulePosition);

  return {
    showDiff(label: string, result: GitDiffResult, work?: GitContentResult) {
      if (disposed) return;
      content = work ?? null;
      stageHandler = null;
      title.textContent = label;
      baseMeta.textContent = work ? `基准：${work.baseLabel}` : "统一差异";
      resultMeta.textContent = work?.conflicted ? "冲突：需要合并" : "工作区";
      unified.textContent = work || result.diff ? unifiedText(result) : "正在加载差异…";
      setup.hidden = true;
      meta.hidden = false;
      mode = "unified";
      splitRows = null;
      splitValue = null;
      splitStart = -1;
      body.scrollTop = 0;
      const textFile = !work?.kind || work.kind === "file";
      segmented.hidden = !work || !textFile;
      if (work) {
        original = work.working;
        editor.value = work.working;
        setDirty(false);
        saveButton.hidden = !textFile || !options.actions || work.binary || work.truncated;
        stageButton.hidden = false;
        oursButton.hidden = !textFile || !work.conflicted || work.ours === null;
        theirsButton.hidden = !textFile || !work.conflicted || work.theirs === null;
      } else {
        original = "";
        editor.value = "";
        dirty = false;
        saveButton.hidden = true;
        stageButton.hidden = true;
        oursButton.hidden = true;
        theirsButton.hidden = true;
      }
      setNotice(
        work?.kind === "submodule"
          ? "子模块仅展示提交引用差异；模块内文件请切换到该仓库查看。"
          : work?.kind === "directory"
            ? "目录仅展示差异，请选择具体文件进行编辑。"
            : work?.binary
              ? "二进制文件不支持合并编辑。"
              : work?.truncated
                ? "文件过大，只展示差异。"
                : "",
      );
      render();
      if (!opened) {
        opened = true;
        document.body.append(root);
        mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
      position();
    },
    setStageHandler(handler: (() => void | Promise<void>) | null) {
      stageHandler = handler;
      setDirty(dirty);
    },
    setBusy(value: boolean) {
      busy = value;
      setDirty(dirty);
    },
    close,
    dispose() {
      close();
      disposed = true;
      document.removeEventListener("keydown", onKeyDown);
      ownerWindow.removeEventListener("resize", schedulePosition);
    },
  };
}
