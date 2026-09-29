import type { SessionRouteResult } from "@codexhost/shared-contracts";
import { sessionPickerMessages } from "./renderer-session-picker-messages.js";
import type { SessionProject } from "./renderer-session-targets.js";

type Candidate = SessionRouteResult["candidates"][number];

/** 选择框同步打开，异步历史只补充候选，绝不改变默认发送目标。 */
export function showSessionPicker(input: {
  locale: string;
  composer: Element;
  hostId: string;
  cwd?: string;
  threadId?: string | null;
  signal: AbortSignal;
  isCurrent: () => boolean;
  projects: SessionProject[];
  loadCandidates: () => Promise<Candidate[]>;
  sendCurrent: () => void;
  sendNew: (project: SessionProject) => Promise<void>;
  sendExisting: (candidate: Candidate) => Promise<void>;
}): { closed: Promise<void>; confirm(): void } {
  const m = sessionPickerMessages(input.locale);
  const hostPrefix = `${input.hostId}:`;
  // Desktop 的会话 ID 可能带 Host 前缀，原生历史使用同一 Host 下的原始 ID。
  const nativeThreadId = (id: string | null | undefined) =>
    id?.startsWith(hostPrefix) ? id.slice(hostPrefix.length) : id;
  const currentThreadId = nativeThreadId(input.threadId);
  const style = document.createElement("style");
  style.textContent = `
    .codexhost-session-picker { position: fixed; z-index: 10000; display: flex; flex-direction: column; box-sizing: border-box; width: min(520px, calc(100vw - 32px)); max-height: min(540px, 70vh); overflow: hidden; padding: 8px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 8px; background: Canvas; color: CanvasText; box-shadow: 0 8px 30px rgb(0 0 0 / 18%); font: 13px/1.5 system-ui,sans-serif; }
    .codexhost-session-picker input { flex-shrink: 0; width: 100%; box-sizing: border-box; margin-bottom: 6px; padding: 8px 10px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 6px; background: Canvas; color: CanvasText; }
    .codexhost-session-picker-list { display: grid; gap: 4px; min-height: 0; overflow-y: auto; }
    .codexhost-session-picker button { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; width: 100%; padding: 8px; border: 0; border-radius: 6px; text-align: left; background: transparent; color: CanvasText; cursor: pointer; }
    .codexhost-session-picker button:hover, .codexhost-session-picker button[aria-pressed="true"] { background: color-mix(in srgb, Highlight 16%, transparent); }
    .codexhost-session-picker button:focus-visible { outline: 2px solid Highlight; }
    .codexhost-session-picker button:disabled { opacity: .55; cursor: wait; }
    .codexhost-session-picker-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
    .codexhost-session-picker-hint { color: CanvasText; opacity: .8; font-size: 12px; }
    .codexhost-session-picker-path, .codexhost-session-picker-preview, .codexhost-session-picker-status { grid-column: 1 / -1; overflow: hidden; color: GrayText; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .codexhost-session-picker-status { flex-shrink: 0; white-space: normal; overflow-wrap: anywhere; }
    .codexhost-session-picker-status:not(:empty) { padding: 6px 8px 0; }
    .codexhost-session-picker-heading { margin: 8px 4px 2px; color: GrayText; font-size: 12px; font-weight: 600; }
  `;
  document.head.append(style);
  const { promise: closed, resolve } = Promise.withResolvers<undefined>();
  const picker = document.createElement("div");
  picker.className = "codexhost-session-picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", m.title);
  const bounds = input.composer.getBoundingClientRect();
  picker.style.right = `${Math.max(16, window.innerWidth - bounds.right)}px`;
  const bottom = Math.max(
    16,
    Math.min(window.innerHeight - 180, window.innerHeight - bounds.top + 8),
  );
  picker.style.bottom = `${bottom}px`;
  picker.style.maxHeight = `${Math.max(120, Math.min(540, window.innerHeight - bottom - 32))}px`;
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = m.search;
  search.setAttribute("aria-label", m.search);
  const status = document.createElement("div");
  status.className = "codexhost-session-picker-status";
  status.setAttribute("role", "status");
  const list = document.createElement("div");
  list.className = "codexhost-session-picker-list";
  picker.append(search, list, status);
  document.body.append(picker);
  let settled = false;
  let busy = false;
  let candidates: Candidate[] = [];
  let notice = m.loading;
  let failure = "";
  let selected = "current";
  let actions: { id: string; run(): void | Promise<void> }[] = [];
  const finish = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    window.clearTimeout(timeout);
    picker.remove();
    style.remove();
    input.signal.removeEventListener("abort", finish);
    resolve(undefined);
  };
  const select = async (id: string): Promise<void> => {
    if (settled || busy) {
      return;
    }
    if (!input.isCurrent()) {
      failure = m.stale;
      render();
      return;
    }
    const action = actions.find((action) => action.id === id);
    if (!action) {
      return;
    }
    selected = id;
    failure = "";
    busy = true;
    render();
    try {
      await action.run();
      finish();
    } catch (error) {
      busy = false;
      failure = `${m.failed}${error instanceof Error ? error.message : String(error)}`;
      render();
    }
  };
  const span = (name: string, text: string): HTMLSpanElement => {
    const element = document.createElement("span");
    element.className = `codexhost-session-picker-${name}`;
    element.textContent = text;
    element.title = text;
    return element;
  };
  const heading = (label: string): void => {
    const element = document.createElement("div");
    element.className = "codexhost-session-picker-heading";
    element.textContent = label;
    list.append(element);
  };
  const option = (
    id: string,
    title: string,
    path: string,
    run: () => void | Promise<void>,
    hint = "",
    preview = "",
  ): void => {
    actions.push({ id, run });
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sessionTarget = id;
    button.setAttribute("aria-pressed", String(selected === id));
    button.disabled = busy;
    button.append(span("title", title), span("hint", hint), span("path", path));
    if (preview) {
      button.append(span("preview", preview));
    }
    button.addEventListener("click", () => void select(id));
    button.addEventListener("focus", () => {
      selected = id;
      updateSelection();
    });
    list.append(button);
  };
  const updateSelection = (): void => {
    for (const button of list.querySelectorAll<HTMLButtonElement>("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.sessionTarget === selected));
    }
  };
  const render = (): void => {
    if (settled) {
      return;
    }
    const active = document.activeElement;
    const focusedTarget =
      active instanceof HTMLButtonElement && list.contains(active)
        ? active.dataset.sessionTarget
        : undefined;
    list.replaceChildren();
    actions = [];
    const query = search.value.trim().toLocaleLowerCase();
    const matches = (text: string) => text.toLocaleLowerCase().includes(query);
    const host = input.hostId === "local" ? m.local : input.hostId;
    option(
      "current",
      m.current,
      [input.cwd ?? m.workspaceUnavailable, host].filter(Boolean).join(" · "),
      input.sendCurrent,
      m.default,
    );
    heading(m.projects);
    const projects = input.projects.toSorted((a, b) => {
      const index = (cwd: string) => {
        const found = candidates.findIndex((candidate) => candidate.cwd === cwd);
        return found < 0 ? candidates.length : found;
      };
      return index(a.cwd) - index(b.cwd);
    });
    for (const project of projects) {
      if (matches(`${project.title} ${project.cwd}`)) {
        option(`project:${project.cwd}`, m.newProject(project.title), project.cwd, () =>
          input.sendNew(project),
        );
      }
    }
    heading(m.completed);
    const matching = candidates.filter((candidate) =>
      matches(`${candidate.title ?? ""} ${candidate.cwd} ${candidate.preview}`),
    );
    const paths = [...new Set(matching.map((candidate) => candidate.cwd))];
    for (const cwd of paths) {
      heading(cwd);
      for (const candidate of matching.filter((candidate) => candidate.cwd === cwd)) {
        option(
          `thread:${candidate.threadId}`,
          candidate.title ?? m.unnamed,
          cwd,
          () => input.sendExisting(candidate),
          "",
          candidate.preview.slice(-220),
        );
      }
    }
    if (!actions.some((action) => action.id === selected)) {
      selected = "current";
    }
    if (focusedTarget) {
      const button = [...list.querySelectorAll<HTMLButtonElement>("button")].find(
        (element) => element.dataset.sessionTarget === focusedTarget,
      );
      // 只恢复列表内部焦点；提交期间按钮禁用时保留搜索框的键盘恢复入口。
      const selection = selected;
      (button && !button.disabled ? button : search).focus({ preventScroll: true });
      selected = selection;
    }
    updateSelection();
    status.textContent = failure || notice || (matching.length ? "" : m.empty);
  };
  picker.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) {
        finish();
      }
      input.composer.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
        void select(selected);
      }
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = actions.findIndex((action) => action.id === selected);
      selected =
        actions[(index + (event.key === "ArrowDown" ? 1 : -1) + actions.length) % actions.length]
          ?.id ?? "current";
      updateSelection();
      list
        .querySelector<HTMLElement>('[aria-pressed="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }
  });
  search.addEventListener("input", () => {
    selected = "current";
    render();
  });
  input.signal.addEventListener("abort", finish, { once: true });
  const timeout = window.setTimeout(() => {
    if (settled || busy) {
      return;
    }
    // 五秒只提示读取较慢，远程历史稍后返回时仍须补充候选。
    notice = m.loadingSlow;
    render();
  }, 5_000);
  render();
  search.focus();
  void input
    .loadCandidates()
    .then((result) => {
      window.clearTimeout(timeout);
      if (settled) {
        return;
      }
      candidates = result.filter(
        (candidate) => nativeThreadId(candidate.threadId) !== currentThreadId,
      );
      notice = "";
      if (!busy) {
        render();
      }
    })
    .catch((error) => {
      window.clearTimeout(timeout);
      if (settled) {
        return;
      }
      console.warn("[codexhost] Recent conversations unavailable", error);
      notice = m.loadFailed;
      if (!busy) {
        render();
      }
    });
  if (input.signal.aborted) {
    finish();
  }
  return { closed, confirm: () => void select(selected) };
}
