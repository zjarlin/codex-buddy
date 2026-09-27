import createElement from "lucide/dist/esm/createElement.mjs";
import X from "lucide/dist/esm/icons/x.mjs";

import type { RendererModelClient } from "./renderer-model-client.js";

const ERROR_ATTRIBUTE = "data-codexhost-project-actions-error";

const style = `
[${ERROR_ATTRIBUTE}]{position:fixed;right:16px;bottom:16px;z-index:1200;display:flex;align-items:flex-start;gap:12px;box-sizing:border-box;max-width:min(420px,calc(100vw - 32px));padding:12px;border:1px solid var(--color-border,rgba(127,127,127,.25));border-radius:8px;background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#24262c)));color:var(--color-token-text-primary,inherit);box-shadow:0 8px 24px #0003;font:13px/18px system-ui,sans-serif;color-scheme:inherit}
[${ERROR_ATTRIBUTE}] span{min-width:0;overflow-wrap:anywhere}
[${ERROR_ATTRIBUTE}] button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
[${ERROR_ATTRIBUTE}] button:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
[${ERROR_ATTRIBUTE}] button:focus-visible{outline:2px solid #508df2;outline-offset:1px}
`;

type Locale = "zh-CN" | "en";

export interface RendererProjectActionsBridge {
  label(): string;
  openDoubao(): Promise<void>;
}

interface ProjectActionsWindow extends Window {
  __codexhostProjectActionsV1?: RendererProjectActionsBridge;
}

function openDoubaoLabel(locale: Locale): string {
  return locale === "zh-CN" ? "在 Doubao 中打开" : "Open in Doubao";
}

export function installRendererProjectActions(options: {
  getClient(): RendererModelClient | null;
  getLocale(): Locale;
}): { dispose(): void } {
  const ownerWindow = window as ProjectActionsWindow;
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  let disposed = false;
  let opening = false;
  let errorToast: HTMLElement | null = null;

  const clearError = (): void => {
    errorToast?.remove();
    errorToast = null;
  };

  const showError = (failure: unknown): void => {
    clearError();
    const toast = document.createElement("div");
    toast.setAttribute(ERROR_ATTRIBUTE, "");
    toast.setAttribute("role", "alert");
    const message = document.createElement("span");
    const detail = failure instanceof Error ? failure.message : String(failure);
    message.textContent = `${openDoubaoLabel(options.getLocale())}: ${detail}`;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    const dismissLabel = options.getLocale() === "zh-CN" ? "关闭" : "Dismiss";
    dismiss.title = dismissLabel;
    dismiss.setAttribute("aria-label", dismissLabel);
    dismiss.append(createElement(X, { width: 16, height: 16, "aria-hidden": "true" }));
    dismiss.addEventListener("click", clearError);
    toast.append(message, dismiss);
    document.body.append(toast);
    errorToast = toast;
  };

  const openDoubao = async (): Promise<void> => {
    if (disposed || opening) {
      return;
    }
    opening = true;
    clearError();
    try {
      const client = options.getClient();
      if (!client?.openDoubao) {
        throw new Error(
          options.getLocale() === "zh-CN"
            ? "Doubao 启动连接不可用"
            : "Doubao launch connection is unavailable",
        );
      }
      await client.openDoubao();
    } catch (failure) {
      if (!disposed) {
        showError(failure);
      }
    } finally {
      opening = false;
    }
  };

  // 原生菜单由 Desktop Control 管理；Renderer 提供本地 Host 命令和错误反馈。
  const bridge: RendererProjectActionsBridge = Object.freeze({
    label: () => openDoubaoLabel(options.getLocale()),
    openDoubao,
  });
  ownerWindow.__codexhostProjectActionsV1 = bridge;

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (ownerWindow.__codexhostProjectActionsV1 === bridge) {
        delete ownerWindow.__codexhostProjectActionsV1;
      }
      clearError();
      styles.remove();
    },
  };
}
