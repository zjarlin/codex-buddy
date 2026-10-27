import createElement from "lucide/dist/esm/createElement.mjs";
import ExternalLink from "lucide/dist/esm/icons/external-link.mjs";
import Globe from "lucide/dist/esm/icons/globe.mjs";
import LoaderCircle from "lucide/dist/esm/icons/loader-circle.mjs";
import MessageSquarePlus from "lucide/dist/esm/icons/message-square-plus.mjs";
import Network from "lucide/dist/esm/icons/network.mjs";
import Play from "lucide/dist/esm/icons/play.mjs";
import RotateCw from "lucide/dist/esm/icons/rotate-cw.mjs";
import Settings2 from "lucide/dist/esm/icons/settings-2.mjs";
import Terminal from "lucide/dist/esm/icons/terminal.mjs";
import Square from "lucide/dist/esm/icons/square.mjs";
import type {
  ProjectScriptAction,
  ProjectScriptId,
  ProjectToolsConfig,
} from "@codexhost/shared-contracts";

import { mutationAffectsElements } from "../renderer-dom-mutations.js";
import type { RendererModelClient } from "../renderer-model-client.js";
import { getDomMutationHub } from "../renderer-mutation-hub.js";
import { composerDraftTarget, composerDraftWorkspace } from "../renderer-composer-workspace.js";
import { PROJECT_ROW_SELECTOR, rowProject } from "../project-tabs/native-binding.js";
import type { SidebarProject } from "../project-tabs/model.js";
import { EDITOR_SELECTOR, sendButtonWithin } from "../renderer-composer-dom.js";
import { insertNativeTextAtSelection } from "../renderer-native-composer-controller.js";
import { nativeProjectStart } from "../renderer-native-project-start.js";
import { sessionDraftText } from "../renderer-session-targets.js";
import { findComposerModelTarget } from "../versioned-renderer-adapter.js";
import type {
  ProjectMenuContribution,
  ProjectMenuContributionItem,
} from "../renderer-project-actions.js";
import { configureProjectTools } from "./dialog.js";
import {
  bindingForProject,
  bindingForProjectName,
  emptyProjectTools,
  parseProjectTools,
  PROJECT_TOOLS_STORAGE_KEY,
  projectToolKey,
  projectToolLabels,
  isBuiltInScript,
  projectScriptEntries,
  projectToolTarget,
  withProjectToolBinding,
  type ProjectToolsPersistenceClient,
} from "./model.js";
import { projectToolsStyle } from "./styles.js";
import { buildProjectScriptPrompt } from "./prompt.js";

const HEADER_SELECTOR = "[data-app-action-sidebar-project-row]";
const LABEL_SELECTOR = "[data-app-action-sidebar-project-label]";
const PROJECT_ID_ATTRIBUTE = "data-app-action-sidebar-project-id";
const BUILTIN_SCRIPT_ICONS: Record<ProjectScriptAction, typeof Play> = {
  start: Play,
  restart: RotateCw,
  stop: Square,
};

const TITLEBAR_CONTENT_SELECTOR = "[data-app-shell-titlebar-content]";
const TITLEBAR_PROJECT_ATTRIBUTE = "data-codexhost-titlebar-project";

interface HeaderEntry {
  wrapper: HTMLElement;
  signature: string;
}

interface ToolDefinition {
  key: string;
  label: string;
  detail: string;
  icon: typeof ExternalLink;
  attribute: string;
  action: ProjectScriptId | null;
  onClick: (anchor: HTMLButtonElement) => void;
}

interface Picker {
  button: HTMLButtonElement;
  element: HTMLElement;
  dispose(): void;
}

export interface RendererProjectToolsControl {
  refresh(): void;
  /**
   * 侧栏“…”菜单里的项目快捷操作与打开 Prompt。两者都会直接改配置或自动发送
   * 任务，因此不再以图标形式直接摆在项目行与标题栏上。
   */
  menuContribution(): ProjectMenuContribution;
  dispose(): void;
}

export function installProjectTools(options: {
  getLocale(): string;
  getClient?(): RendererModelClient | null;
}): RendererProjectToolsControl {
  const styles = document.createElement("style");
  styles.textContent = projectToolsStyle;
  document.head.append(styles);
  let config = emptyProjectTools();
  let metadataPath: string | null = null;
  let failure: unknown = null;
  let loadedClient: ProjectToolsPersistenceClient | null = null;
  let loading = false;
  let resolveReady: () => void = () => undefined;
  let readySettled = false;
  const ready = new Promise<void>((resolve) => {
    resolveReady = () => {
      if (readySettled) return;
      readySettled = true;
      resolve();
    };
  });
  let openingDialog = false;
  let disposed = false;
  let scheduled = false;
  let dialog: { element: HTMLDialogElement; projectKey: string } | null = null;
  let picker: Picker | null = null;
  let toast: HTMLElement | null = null;
  let toastTimer: number | null = null;
  let titlebarWrapper: HTMLElement | null = null;
  let titlebarSignature = "";
  let observedTitlebar: HTMLElement | null = null;
  let titlebarObserver: MutationObserver | null = null;
  const headers = new Map<HTMLElement, HeaderEntry>();
  const busy = new Map<string, ProjectScriptId>();
  const prompting = new Set<string>();

  try {
    config = parseProjectTools(window.localStorage.getItem(PROJECT_TOOLS_STORAGE_KEY));
  } catch (error) {
    failure = error;
  }

  const mirror = (next: ProjectToolsConfig): void => {
    config = next;
    try {
      window.localStorage.setItem(PROJECT_TOOLS_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      failure = error;
    }
  };

  // 每个底层 client 只包装一次：refresh 用包装对象身份判断是否需要重新拉取配置，
  // 每次新建包装会让判断永远成立，退化成不停重取。
  let persistenceSource: RendererModelClient | null = null;
  let persistence: Required<ProjectToolsPersistenceClient> | null = null;
  const persistenceClient = (): Required<ProjectToolsPersistenceClient> | null => {
    const client = options.getClient?.() ?? null;
    if (client === persistenceSource) return persistence;
    persistenceSource = client;
    const { getProjectTools, setProjectTools, runProjectScript } = client ?? {};
    persistence =
      client && getProjectTools && setProjectTools && runProjectScript
        ? {
            getProjectTools: () => getProjectTools.call(client),
            setProjectTools: (config) => setProjectTools.call(client, config),
            runProjectScript: (params) => runProjectScript.call(client, params),
          }
        : null;
    return persistence;
  };

  const showToast = (message: string, state: "ok" | "failed" = "ok"): void => {
    if (disposed) return;
    toast?.remove();
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    const element = document.createElement("div");
    element.setAttribute("data-codexhost-project-tool-toast", "");
    element.setAttribute("data-state", state);
    element.setAttribute("role", state === "failed" ? "alert" : "status");
    element.textContent = message;
    document.body.append(element);
    toast = element;
    toastTimer = window.setTimeout(
      () => {
        element.remove();
        if (toast === element) toast = null;
        toastTimer = null;
      },
      state === "failed" ? 8_000 : 3_000,
    );
  };

  const closePicker = (): void => {
    picker?.dispose();
    picker = null;
  };

  const openUrl = (url: string): void => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const activeComposer = (): HTMLElement | null => {
    const editors = [
      ...document.querySelectorAll<HTMLElement>(`[data-codex-composer-root] ${EDITOR_SELECTOR}`),
    ].filter((editor) => editor.isConnected && editor.getClientRects().length > 0);
    const focused = editors.find(
      (editor) =>
        editor === document.activeElement ||
        (document.activeElement instanceof Node && editor.contains(document.activeElement)),
    );
    if (focused) return focused;
    const composers = editors
      .map((editor) => editor.closest("[data-codex-composer-root]"))
      .filter(
        (composer): composer is Element => composer !== null && sendButtonWithin(composer) !== null,
      );
    if (composers.length !== 1) return null;
    const editable = composers[0]?.querySelectorAll<HTMLElement>(EDITOR_SELECTOR) ?? [];
    return editable.length === 1 ? (editable[0] ?? null) : null;
  };

  const waitForPromptEditor = (
    started: number,
    project: SidebarProject & { path?: string },
  ): Promise<HTMLElement> =>
    new Promise((resolve, reject) => {
      const poll = (): void => {
        if (disposed) {
          reject(new Error("项目快捷操作已卸载。"));
          return;
        }
        const editor = activeComposer();
        if (editor) {
          const composer = editor.closest("[data-codex-composer-root]");
          const hostId = project.hostId ?? "local";
          const isNewDraft = composer
            ? findComposerModelTarget(composer)?.[0] === "default"
            : false;
          if (
            composer &&
            isNewDraft &&
            (composerDraftWorkspace(composer, hostId) === project.path ||
              composerDraftTarget(composer, hostId) === project.path)
          ) {
            resolve(editor);
            return;
          }
        }
        if (Date.now() - started >= 8_000) {
          reject(new Error("新的项目会话输入框尚未就绪，请重新点击 Prompt。"));
          return;
        }
        window.setTimeout(poll, 50);
      };
      poll();
    });

  const openPrompt = async (project: SidebarProject): Promise<void> => {
    const key = projectToolKey(project);
    if (disposed || prompting.has(key)) return;
    prompting.add(key);
    try {
      await sendPrompt(project);
    } finally {
      prompting.delete(key);
    }
  };

  const sendPrompt = async (project: SidebarProject): Promise<void> => {
    if (disposed) return;
    const waitForDraftCleared = (
      editor: HTMLElement,
      expected: string,
      timeoutMs: number,
    ): Promise<boolean> =>
      new Promise((resolve) => {
        const started = Date.now();
        const poll = (): void => {
          if (!editor.isConnected || !sessionDraftText(editor).trim()) {
            resolve(true);
            return;
          }
          if (sessionDraftText(editor).trim() !== expected || Date.now() - started >= timeoutMs) {
            resolve(false);
            return;
          }
          window.setTimeout(poll, 50);
        };
        poll();
      });
    const binding = bindingForProject(config, project);
    const labels = projectToolLabels(options.getLocale());
    const started = Date.now();
    const row = [...document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)].find(
      (candidate) => projectToolKey(rowProject(candidate) ?? project) === projectToolKey(project),
    );
    if (!row) throw new Error(labels.promptUnavailable);
    const nativeProject = rowProject(row) as (SidebarProject & { path?: string }) | null;
    if (typeof nativeProject?.path !== "string" || !nativeProject.path) {
      throw new Error(labels.promptUnavailable);
    }
    const start = nativeProjectStart(row, project.projectId);
    if (!start) throw new Error(labels.promptUnavailable);
    if (!metadataPath) {
      throw new Error("Codex Buddy 元数据路径尚未就绪，请重新打开配置后重试。");
    }
    start();
    const editor = await waitForPromptEditor(started, nativeProject);
    const promptText =
      binding?.prompt?.trim() ||
      buildProjectScriptPrompt({
        project: { ...nativeProject, path: nativeProject.path },
        metadataPath,
        currentBinding: binding,
      });
    if (disposed) return;
    const existing = sessionDraftText(editor).trim();
    if (existing && existing !== promptText) {
      throw new Error("目标新会话中已有其他草稿，未覆盖 Prompt。");
    }
    if (existing !== promptText) {
      let inserted = insertNativeTextAtSelection(editor, () => promptText);
      if (!inserted && editor.getAttribute("contenteditable") === "true") {
        const selection = editor.ownerDocument.getSelection();
        const range = editor.ownerDocument.createRange();
        range.selectNodeContents(editor);
        range.collapse(true);
        editor.focus({ preventScroll: true });
        selection?.removeAllRanges();
        selection?.addRange(range);
        inserted =
          typeof editor.ownerDocument.execCommand === "function" &&
          editor.ownerDocument.execCommand("insertText", false, promptText);
      }
      if (!inserted && editor instanceof HTMLTextAreaElement) {
        const textarea = editor;
        const view = textarea.ownerDocument.defaultView;
        const setter = view
          ? Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, "value")?.set
          : undefined;
        if (setter && !textarea.value) {
          setter.call(textarea, promptText);
          if (view) {
            textarea.dispatchEvent(
              new view.InputEvent("input", {
                bubbles: true,
                composed: true,
                data: promptText,
                inputType: "insertText",
              }),
            );
          }
          inserted = true;
        }
      }
      if (!inserted || sessionDraftText(editor).trim() !== promptText) {
        throw new Error("无法填入项目 Prompt，草稿未覆盖任何内容。");
      }
    }
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const composer = editor.closest("[data-codex-composer-root]");
    const send = composer ? sendButtonWithin(composer) : null;
    if (!composer || !editor.isConnected || !send || send.disabled) {
      throw new Error(labels.promptFilled);
    }
    if (sessionDraftText(editor).trim() !== promptText) {
      throw new Error("Prompt 草稿在发送前发生变化，未自动发送。");
    }
    send.click();
    const sent = await waitForDraftCleared(editor, promptText, 5_000);
    if (!sent) throw new Error(labels.promptFilled);
    editor.focus({ preventScroll: true });
    showToast(labels.promptSent);
  };

  const openPicker = (button: HTMLButtonElement, project: SidebarProject): void => {
    const binding = bindingForProject(config, project);
    if (!binding) return;
    const urls = [
      ...(binding.intranetUrl ? [{ kind: "intranet" as const, url: binding.intranetUrl }] : []),
      ...(binding.publicUrl ? [{ kind: "public" as const, url: binding.publicUrl }] : []),
    ];
    if (urls.length === 1 && urls[0]) {
      openUrl(urls[0].url);
      return;
    }
    closePicker();
    const labels = projectToolLabels(options.getLocale());
    const element = document.createElement("div");
    element.setAttribute("data-codexhost-project-tool-picker", "");
    element.setAttribute("role", "menu");
    element.setAttribute("aria-label", `${project.label} · ${labels.title}`);
    for (const entry of urls) {
      const link = document.createElement("a");
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("role", "menuitem");
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = entry.kind === "intranet" ? labels.intranet : labels.public;
      const detail = document.createElement("small");
      detail.textContent = entry.url;
      text.append(title, detail);
      link.append(
        createElement(entry.kind === "intranet" ? Network : Globe, {
          width: 16,
          height: 16,
          "aria-hidden": "true",
        }),
        text,
      );
      link.addEventListener("click", closePicker);
      element.append(link);
    }
    document.body.append(element);
    const rect = button.getBoundingClientRect();
    const pickerRect = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - pickerRect.width - 8));
    const top =
      rect.bottom + pickerRect.height + 8 <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(8, rect.top - pickerRect.height - 6);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    button.setAttribute("aria-expanded", "true");
    let cleaned = false;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || element.contains(target) || button.contains(target)) return;
      dispose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dispose();
      button.focus();
    };
    const onViewportChange = (): void => dispose();
    const dispose = (): void => {
      if (cleaned) return;
      cleaned = true;
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      button.setAttribute("aria-expanded", "false");
      element.remove();
      if (picker?.element === element) picker = null;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    picker = { button, element, dispose };
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  };

  const titlebarProject = (): SidebarProject | null => {
    const content = document.querySelector<HTMLElement>(TITLEBAR_CONTENT_SELECTOR);
    const label = content?.getAttribute(TITLEBAR_PROJECT_ATTRIBUTE)?.trim();
    if (!label) return null;
    const binding = bindingForProjectName(config, label);
    if (!binding) return null;
    return {
      projectId: binding.target.projectId,
      projectKind: binding.target.projectKind,
      ...(binding.target.projectKind === "remote" ? { hostId: binding.target.hostId } : {}),
      label: binding.label,
    };
  };

  const scriptDefinition = (
    project: SidebarProject,
    entry: ReturnType<typeof projectScriptEntries>[number],
  ): ToolDefinition =>
    definition(
      entry.id,
      entry.name,
      entry.path,
      isBuiltInScript(entry.id) ? BUILTIN_SCRIPT_ICONS[entry.id] : Terminal,
      "data-codexhost-project-tool-action",
      entry.id,
      () => void runAction(project, entry.id),
    );

  const projectToolbarTools = (
    project: SidebarProject,
  ): { binding: ReturnType<typeof bindingForProject>; tools: ToolDefinition[] } => {
    const binding = bindingForProject(config, project);
    const labels = projectToolLabels(options.getLocale());
    const tools: ToolDefinition[] = [];
    if (binding?.intranetUrl || binding?.publicUrl) {
      tools.push(
        definition(
          "url",
          labels.title,
          [
            binding.intranetUrl ? `${labels.intranet}: ${binding.intranetUrl}` : "",
            binding.publicUrl ? `${labels.public}: ${binding.publicUrl}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          ExternalLink,
          "data-codexhost-project-tool-url",
          null,
          (anchor) => openPicker(anchor, project),
        ),
      );
    }
    for (const entry of projectScriptEntries(binding, labels)) {
      tools.push(scriptDefinition(project, entry));
    }
    return { binding, tools };
  };
  const persist = async (next: ProjectToolsConfig): Promise<void> => {
    const client = persistenceClient();
    if (!client) {
      if (!metadataPath) {
        throw new Error("Codex Buddy 元数据路径尚未就绪，无法保存配置。");
      }
      mirror(next);
      failure = null;
      loadedClient = null;
      refresh();
      return;
    }
    const state = await client.setProjectTools(next);
    if (!state.config) throw new Error("Local Host returned an empty project tools configuration");
    mirror(state.config);
    loadedClient = client;
    failure = null;
    refresh();
  };

  // 项目行上的原生绝对路径；远程项目同样由 Desktop 提供。
  const nativeProjectPath = (project: SidebarProject): string | null => {
    const row = [...document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)].find(
      (candidate) => projectToolKey(rowProject(candidate) ?? project) === projectToolKey(project),
    );
    const native = row ? (rowProject(row) as (SidebarProject & { path?: string }) | null) : null;
    return typeof native?.path === "string" && native.path ? native.path : null;
  };

  const openDialog = async (project: SidebarProject): Promise<void> => {
    // 立即打开表单：配置已在 refresh 中预取并镜像到本地；Host 读取稍后补齐元数据路径。
    if (disposed || dialog || openingDialog) return;
    openingDialog = true;
    try {
      await ready;
    } catch {
      // 预取失败不阻塞表单，保存时会再次校验元数据路径。
    } finally {
      openingDialog = false;
    }
    if (disposed || dialog) return;
    const labels = projectToolLabels(options.getLocale());
    const binding = bindingForProject(config, project);
    const projectPath = nativeProjectPath(project);
    if (!projectPath) throw new Error("项目绝对路径尚未就绪，请刷新项目列表后重试。");
    const dialogElement = configureProjectTools({
      project,
      binding,
      metadataPath,
      projectPath,
      labels,
      save: async (draft) => {
        await persist(withProjectToolBinding(config, project, draft));
        showToast(labels.saved);
      },
      remove: async () => {
        await persist(withProjectToolBinding(config, project, {}));
        showToast(labels.saved);
      },
      onClose: () => {
        if (dialog?.element === dialogElement) dialog = null;
      },
    });
    dialog = { element: dialogElement, projectKey: projectToolKey(project) };
  };

  const runAction = async (project: SidebarProject, action: ProjectScriptId): Promise<void> => {
    const key = projectToolKey(project);
    if (busy.has(key)) return;
    const client = persistenceClient();
    if (!client) {
      showToast("Local Host project script execution is unavailable.", "failed");
      return;
    }
    const labels = projectToolLabels(options.getLocale());
    busy.set(key, action);
    refresh();
    try {
      const result = await client.runProjectScript({ target: projectToolTarget(project), action });
      if (result.state === "failed") {
        showToast(
          `${labels.failed}\n${result.output.trim() || `exit ${result.exitCode ?? "unknown"}`}`,
          "failed",
        );
      } else {
        showToast(result.state === "running" ? labels.started : labels.completed);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "failed");
    } finally {
      busy.delete(key);
      refresh();
    }
  };

  const definition = (
    key: string,
    label: string,
    detail: string,
    icon: typeof ExternalLink,
    attribute: string,
    action: ProjectScriptId | null,
    onClick: (button: HTMLButtonElement) => void,
  ): ToolDefinition => ({
    key,
    label,
    detail,
    icon,
    attribute,
    action,
    onClick,
  });

  const iconButton = (
    project: SidebarProject,
    tool: ToolDefinition,
    disabled = false,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = disabled;
    button.title = `${tool.label} · ${project.label}\n${tool.detail}`;
    button.setAttribute("aria-label", `${tool.label}: ${project.label}`);
    button.setAttribute(tool.attribute, "");
    button.append(
      createElement(disabled ? LoaderCircle : tool.icon, {
        width: 14,
        height: 14,
        "aria-hidden": "true",
        ...(disabled ? { class: "codexhost-project-tool-spin" } : {}),
      }),
    );
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      tool.onClick(button);
    });
    return button;
  };

  const renderHeader = (header: HTMLElement, project: SidebarProject): void => {
    const binding = bindingForProject(config, project);
    const mounted = headers.get(header);
    const labels = projectToolLabels(options.getLocale());
    const key = projectToolKey(project);
    const active = busy.get(key) ?? null;
    const scriptAction = active;

    const signature = JSON.stringify([binding, labels, scriptAction]);
    if (mounted?.wrapper.isConnected && mounted.signature === signature) return;
    mounted?.wrapper.remove();
    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-codexhost-project-tools", "");
    const tools: ToolDefinition[] = [];
    if (binding?.intranetUrl || binding?.publicUrl) {
      tools.push(
        definition(
          "url",
          labels.title,
          [
            binding.intranetUrl ? `${labels.intranet}: ${binding.intranetUrl}` : "",
            binding.publicUrl ? `${labels.public}: ${binding.publicUrl}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          ExternalLink,
          "data-codexhost-project-tool-url",
          null,
          (anchor) => openPicker(anchor, project),
        ),
      );
    }
    for (const entry of projectScriptEntries(binding, labels)) {
      tools.push(scriptDefinition(project, entry));
    }
    for (const tool of tools) {
      // 只有正在执行的脚本动作进入忙碌态；访问地址这类无动作的按钮不能被禁用。
      const busyHere = active !== null && active === tool.action;
      const button = iconButton(project, tool, busyHere);
      if (busyHere) button.setAttribute("aria-busy", "true");
      wrapper.append(button);
    }
    if (tools.length === 0) {
      mounted?.wrapper.remove();
      headers.delete(header);
      return;
    }
    const label =
      header.querySelector<HTMLElement>(LABEL_SELECTOR) ??
      header.querySelector<HTMLElement>(`[${PROJECT_ID_ATTRIBUTE}]`);
    if (label?.parentElement) label.after(wrapper);
    else header.append(wrapper);
    headers.set(header, { wrapper, signature });
  };

  let titlebarRenderScheduled = false;
  const renderTitlebarSoon = (): void => {
    if (disposed || titlebarRenderScheduled) return;
    titlebarRenderScheduled = true;
    queueMicrotask(() => {
      titlebarRenderScheduled = false;
      renderTitlebar();
    });
  };
  const renderTitlebar = (): void => {
    const content = document.querySelector<HTMLElement>(TITLEBAR_CONTENT_SELECTOR);
    if (observedTitlebar !== content) {
      titlebarObserver?.disconnect();
      observedTitlebar = content;
      if (content) {
        titlebarObserver = new MutationObserver(() => {
          if (titlebarWrapper && !content.contains(titlebarWrapper)) titlebarSignature = "";
          renderTitlebarSoon();
        });
        titlebarObserver.observe(content, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [TITLEBAR_PROJECT_ATTRIBUTE],
        });
      } else {
        titlebarObserver = null;
      }
    }
    const project = titlebarProject();
    if (!content || !project) {
      titlebarWrapper?.remove();
      titlebarWrapper = null;
      titlebarSignature = "";
      return;
    }
    const { binding, tools } = projectToolbarTools(project);
    const labels = projectToolLabels(options.getLocale());
    const active = busy.get(projectToolKey(project)) ?? null;
    const signature = JSON.stringify([binding, labels, active, project.label]);
    if (
      titlebarWrapper?.isConnected &&
      content.contains(titlebarWrapper) &&
      titlebarSignature === signature
    ) {
      return;
    }
    titlebarWrapper?.remove();
    if (tools.length === 0) {
      titlebarWrapper = null;
      titlebarSignature = signature;
      return;
    }
    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-codexhost-project-titlebar-tools", "");
    wrapper.setAttribute("role", "toolbar");
    wrapper.setAttribute("aria-label", `${project.label} · ${labels.title}`);
    wrapper.addEventListener("pointerdown", (event) => event.stopPropagation());
    wrapper.addEventListener("click", (event) => event.stopPropagation());
    for (const tool of tools) {
      // 只有正在执行的脚本动作进入忙碌态；访问地址这类无动作的按钮不能被禁用。
      const busyHere = active !== null && active === tool.action;
      const button = iconButton(project, tool, busyHere);
      if (busyHere) button.setAttribute("aria-busy", "true");
      wrapper.append(button);
    }
    if (tools.length > 0) content.append(wrapper);
    else wrapper.remove();
    titlebarWrapper = wrapper;
    titlebarSignature = signature;
  };

  const refresh = (): void => {
    if (disposed) return;
    const client = persistenceClient();
    if (!client) resolveReady();
    if (client && client !== loadedClient && !loading) {
      loading = true;
      loadedClient = client;
      void client
        .getProjectTools()
        .then(
          (state) => {
            if (disposed) return;
            mirror(state.config ?? emptyProjectTools());
            metadataPath = state.metadataPath ?? null;
            failure = null;
            resolveReady();
          },
          (error) => {
            failure = error;
          },
        )
        .finally(() => {
          loading = false;
          refresh();
        });
    }
    const rows = [...document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)];
    for (const [header, entry] of headers) {
      if (!header.isConnected || !rows.some((row) => row.contains(header))) {
        entry.wrapper.remove();
        headers.delete(header);
      }
    }
    for (const row of rows) {
      const project = rowProject(row);
      const header = row.querySelector<HTMLElement>(HEADER_SELECTOR);
      if (!project || !header) continue;
      renderHeader(header, project);
    }
    renderTitlebar();
    if (failure && !dialog) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (toast?.textContent !== message) showToast(message, "failed");
    }
  };

  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList"],
    test: (record) =>
      mutationAffectsElements(record, "#app-shell-sidebar") ||
      mutationAffectsElements(record, TITLEBAR_CONTENT_SELECTOR),
    onMutate: () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        refresh();
      });
    },
  });
  refresh();

  const menuContribution = (): ProjectMenuContribution => ({
    id: "project-tools",
    signature: () => JSON.stringify([projectToolLabels(options.getLocale()), config]),
    resolve: ({ project, close }) => {
      const labels = projectToolLabels(options.getLocale());
      const binding = bindingForProject(config, project);
      const items: ProjectMenuContributionItem[] = [
        {
          attribute: "data-codexhost-project-tool-configure",
          label: labels.configure,
          icon: Settings2,
          onSelect: () => {
            close();
            void openDialog(project).catch((error) => {
              showToast(error instanceof Error ? error.message : String(error), "failed");
            });
          },
        },
      ];
      if (binding?.prompt || nativeProjectPath(project)) {
        items.push({
          attribute: "data-codexhost-project-tool-prompt",
          label: labels.prompt,
          icon: MessageSquarePlus,
          onSelect: () => {
            close();
            void openPrompt(project).catch((error) => {
              showToast(error instanceof Error ? error.message : String(error), "failed");
            });
          },
        });
      }
      return items;
    },
  });

  return {
    refresh,
    menuContribution,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopObserving();
      closePicker();
      dialog?.element.close();
      dialog = null;
      for (const entry of headers.values()) entry.wrapper.remove();
      headers.clear();
      busy.clear();
      toast?.remove();
      toast = null;
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      titlebarWrapper?.remove();
      titlebarWrapper = null;
      titlebarObserver?.disconnect();
      titlebarObserver = null;
      styles.remove();
    },
  };
}
