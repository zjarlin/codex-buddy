import createElement from "lucide/dist/esm/createElement.mjs";
import ExternalLink from "lucide/dist/esm/icons/external-link.mjs";
import Settings2 from "lucide/dist/esm/icons/settings-2.mjs";
import Globe from "lucide/dist/esm/icons/globe.mjs";
import LoaderCircle from "lucide/dist/esm/icons/loader-circle.mjs";
import Network from "lucide/dist/esm/icons/network.mjs";
import Play from "lucide/dist/esm/icons/play.mjs";
import RotateCw from "lucide/dist/esm/icons/rotate-cw.mjs";
import Square from "lucide/dist/esm/icons/square.mjs";
import type { ProjectScriptAction, ProjectToolsConfig } from "@codexhost/shared-contracts";

import { mutationAffectsElements } from "../renderer-dom-mutations.js";
import type { RendererModelClient } from "../renderer-model-client.js";
import { getDomMutationHub } from "../renderer-mutation-hub.js";
import { PROJECT_ROW_SELECTOR, rowProject } from "../project-tabs/native-binding.js";
import type { SidebarProject } from "../project-tabs/model.js";
import { configureProjectTools } from "./dialog.js";
import {
  bindingForProject,
  emptyProjectTools,
  parseProjectTools,
  PROJECT_TOOLS_STORAGE_KEY,
  projectToolKey,
  projectToolLabels,
  projectToolTarget,
  withProjectToolBinding,
  type ProjectToolsPersistenceClient,
} from "./model.js";
import { projectToolsStyle } from "./styles.js";

const HEADER_SELECTOR = "[data-app-action-sidebar-project-row]";
const LABEL_SELECTOR = "[data-app-action-sidebar-project-label]";
const PROJECT_ID_ATTRIBUTE = "data-app-action-sidebar-project-id";

interface HeaderEntry {
  wrapper: HTMLElement;
  signature: string;
}

interface Picker {
  button: HTMLButtonElement;
  element: HTMLElement;
  dispose(): void;
}

export interface RendererProjectToolsControl {
  refresh(): void;
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
  let failure: unknown = null;
  let loadedClient: ProjectToolsPersistenceClient | null = null;
  let loading = false;
  let disposed = false;
  let scheduled = false;
  let dialog: { element: HTMLDialogElement; projectKey: string } | null = null;
  let picker: Picker | null = null;
  let toast: HTMLElement | null = null;
  let toastTimer: number | null = null;
  const headers = new Map<HTMLElement, HeaderEntry>();
  const busy = new Map<string, ProjectScriptAction>();

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

  const persistenceClient = (): Required<ProjectToolsPersistenceClient> | null => {
    const client = options.getClient?.();
    const { getProjectTools, setProjectTools, runProjectScript } = client ?? {};
    return getProjectTools && setProjectTools && runProjectScript
      ? {
          getProjectTools: () => getProjectTools.call(client),
          setProjectTools: (config) => setProjectTools.call(client, config),
          runProjectScript: (params) => runProjectScript.call(client, params),
        }
      : null;
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
    const configure = document.createElement("button");
    configure.type = "button";
    configure.setAttribute("role", "menuitem");
    const configureText = document.createElement("span");
    const configureTitle = document.createElement("strong");
    configureTitle.textContent = labels.configure;
    configureText.append(configureTitle);
    configure.append(
      createElement(Settings2, { width: 16, height: 16, "aria-hidden": "true" }),
      configureText,
    );
    configure.addEventListener("click", () => {
      closePicker();
      openDialog(project);
    });
    element.append(configure);
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

  const persist = async (next: ProjectToolsConfig): Promise<void> => {
    const client = persistenceClient();
    if (!client) {
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

  const openDialog = (project: SidebarProject): void => {
    if (disposed || dialog) return;
    const labels = projectToolLabels(options.getLocale());
    const binding = bindingForProject(config, project);
    const dialogElement = configureProjectTools({
      project,
      binding,
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

  const runAction = async (project: SidebarProject, action: ProjectScriptAction): Promise<void> => {
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

  const iconButton = (
    project: SidebarProject,
    label: string,
    icon: typeof ExternalLink,
    attribute: string,
    onClick: (button: HTMLButtonElement) => void,
    disabled = false,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = disabled;
    button.title = `${label} · ${project.label}`;
    button.setAttribute("aria-label", `${label}: ${project.label}`);
    button.setAttribute(attribute, "");
    button.append(
      createElement(disabled ? LoaderCircle : icon, {
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
      onClick(button);
    });
    return button;
  };

  const renderHeader = (header: HTMLElement, project: SidebarProject): void => {
    const binding = bindingForProject(config, project);
    if (!binding) {
      headers.get(header)?.wrapper.remove();
      headers.delete(header);
      return;
    }
    const labels = projectToolLabels(options.getLocale());
    const key = projectToolKey(project);
    const active = busy.get(key) ?? null;
    const signature = JSON.stringify([binding, labels, active]);
    const mounted = headers.get(header);
    if (mounted?.wrapper.isConnected && mounted.signature === signature) return;
    mounted?.wrapper.remove();
    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-codexhost-project-tools", "");
    if (binding.intranetUrl || binding.publicUrl) {
      wrapper.append(
        iconButton(
          project,
          labels.title,
          ExternalLink,
          "data-codexhost-project-tool-url",
          (button) => {
            openPicker(button, project);
          },
        ),
      );
    }
    const actions: Array<[ProjectScriptAction, string, typeof Play]> = [
      ["start", labels.start, Play],
      ["restart", labels.restart, RotateCw],
      ["stop", labels.stop, Square],
    ];
    for (const [action, label, icon] of actions) {
      if (!binding.scripts?.[action]) continue;
      const button = iconButton(
        project,
        label,
        icon,
        "data-codexhost-project-tool-action",
        () => void runAction(project, action),
        active === action,
      );
      button.setAttribute("data-action", action);
      if (active === action) button.setAttribute("aria-busy", "true");
      wrapper.append(button);
    }
    const label =
      header.querySelector<HTMLElement>(LABEL_SELECTOR) ??
      header.querySelector<HTMLElement>(`[${PROJECT_ID_ATTRIBUTE}]`);
    if (label?.parentElement) {
      label.after(wrapper);
    } else {
      header.append(wrapper);
    }
    headers.set(header, { wrapper, signature });
  };

  const refresh = (): void => {
    if (disposed) return;
    const client = persistenceClient();
    if (client && client !== loadedClient && !loading) {
      loading = true;
      void client
        .getProjectTools()
        .then(
          (state) => {
            if (disposed) return;
            if (state.config) mirror(state.config);
            loadedClient = client;
            failure = null;
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
    if (failure && !dialog) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (toast?.textContent !== message) showToast(message, "failed");
    }
  };

  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList"],
    test: (record) => mutationAffectsElements(record, "#app-shell-sidebar"),
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

  return {
    refresh,
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
      styles.remove();
    },
  };
}
