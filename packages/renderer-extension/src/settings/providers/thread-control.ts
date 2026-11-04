import {
  PROVIDER_ROUTING_METHOD,
  hostThreadIdSchema,
  type ProviderRoutingParams,
  type ProviderRoutingSnapshot,
} from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../../renderer-model-client.js";
import { isUnsupportedMethod } from "../../renderer-request-sender.js";
import type { RendererSettingsLocale } from "../localization.js";
import { providerMessages } from "./messages.js";

const messages = {
  "zh-CN": {
    title: "会话供应商",
    automatic: "自动（按 Host 接续设置）",
    primary: "原供应商",
    save: "切换供应商",
    close: "关闭",
    applied: "已保存，从此会话的下一次模型请求生效。",
    uncovered:
      "此会话未接入供应商代理。仅支持由 CodexBuddy Host 承载的自定义 Responses 供应商会话。",
    outdated: "此 Host 不支持会话内切换，请更新匹配版本并重新连接。",
  },
  en: {
    title: "Session provider",
    automatic: "Automatic (Host failover settings)",
    primary: "Original provider",
    save: "Switch provider",
    close: "Close",
    applied: "Saved. Applies to this session's next model request.",
    uncovered:
      "This session is not connected to the provider proxy. A custom Responses provider running through CodexBuddy Host is required.",
    outdated:
      "This Host does not support session provider selection. Update the matching version and reconnect.",
  },
} as const;

interface ThreadContext {
  hostId: string;
  threadId: string;
  client: RendererModelClient;
}

export function mountThreadProviderControl(document: Document) {
  const root = document.createElement("button");
  root.type = "button";
  root.setAttribute("data-codexhost-thread-provider", "true");
  Object.assign(root.style, {
    border: "0",
    borderRadius: "8px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    padding: "0 7px",
    height: "28px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  });
  root.hidden = true;
  let context: ThreadContext | null = null;
  let locale: RendererSettingsLocale = "en";
  let close: (() => void) | undefined;
  root.addEventListener("click", () => {
    close?.();
    const captured = context;
    if (!captured) return;
    const m = messages[locale];
    const p = providerMessages[locale];
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", m.title);
    Object.assign(dialog.style, {
      width: "min(440px, calc(100vw - 32px))",
      boxSizing: "border-box",
      border: "1px solid GrayText",
      borderRadius: "10px",
      padding: "20px",
      background: "Canvas",
      color: "CanvasText",
      colorScheme:
        document.defaultView?.getComputedStyle(document.documentElement).colorScheme ?? "normal",
    });
    const heading = document.createElement("h2");
    heading.textContent = `${m.title} · ${captured.hostId}`;
    Object.assign(heading.style, {
      fontSize: "16px",
      margin: "0 0 14px",
      overflowWrap: "anywhere",
    });
    const select = document.createElement("select");
    select.setAttribute("aria-label", m.title);
    Object.assign(select.style, {
      width: "100%",
      padding: "8px",
      background: "Canvas",
      color: "CanvasText",
      border: "1px solid GrayText",
      borderRadius: "6px",
    });
    select.disabled = true;
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    Object.assign(status.style, { fontSize: "13px", overflowWrap: "anywhere" });
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = m.save;
    save.disabled = true;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = m.close;
    for (const button of [save, cancel]) {
      Object.assign(button.style, {
        padding: "6px 10px",
        marginRight: "8px",
        border: "1px solid GrayText",
        borderRadius: "6px",
        background: "Canvas",
        color: "CanvasText",
        cursor: "pointer",
      });
    }
    dialog.append(heading, select, status, save, cancel);
    document.body.append(dialog);
    let closed = false;
    let busy = false;
    let snapshot: ProviderRoutingSnapshot | null = null;
    const current = () => !closed && context === captured;
    close = () => {
      if (closed) return;
      closed = true;
      dialog.close();
      dialog.remove();
    };
    cancel.addEventListener("click", () => close?.());
    dialog.addEventListener("close", () => {
      closed = true;
      dialog.remove();
    });
    const render = (value: ProviderRoutingSnapshot) => {
      snapshot = value;
      select.replaceChildren();
      const option = (id: string, name: string) => {
        const item = document.createElement("option");
        item.value = id;
        item.textContent = name;
        select.append(item);
      };
      option("", m.automatic);
      const primary = value.primaryProviders.find(
        (provider) => provider.id === value.thread?.primaryProviderId,
      );
      if (primary) option(`primary:${primary.id}`, `${m.primary}: ${primary.name}`);
      for (const provider of value.providers) {
        if (provider.keyConfigured) option(provider.id, provider.name);
      }
      select.value = value.thread?.providerId ?? "";
      status.textContent = !value.thread ? m.outdated : value.thread.covered ? "" : m.uncovered;
    };
    const run = async (params: ProviderRoutingParams) => {
      if (busy || !current()) return;
      busy = true;
      select.disabled = save.disabled = true;
      status.textContent = params.action === "read" ? p.loading : p.saving;
      status.setAttribute("role", "status");
      try {
        if (!captured.client.providerRouting) throw new Error(p.disconnected);
        const value = await captured.client.providerRouting(params);
        if (!current()) return;
        // 旧 Host 可能忽略 select；必须回读已保存的选择，才能宣称切换成功。
        if (params.action === "select" && value.thread?.providerId !== params.providerId) {
          throw new Error(m.outdated);
        }
        render(value);
        if (params.action === "select") status.textContent = m.applied;
      } catch (error) {
        if (!current()) return;
        select.value = snapshot?.thread?.providerId ?? "";
        status.textContent = isUnsupportedMethod(error, PROVIDER_ROUTING_METHOD)
          ? p.unavailable
          : error instanceof Error
            ? error.message
            : p.error;
        status.setAttribute("role", "alert");
      } finally {
        busy = false;
        if (current()) select.disabled = save.disabled = !snapshot?.thread?.covered;
      }
    };
    const prefix = `${captured.hostId}:`;
    const threadId = hostThreadIdSchema.parse(
      captured.threadId.startsWith(prefix)
        ? captured.threadId.slice(prefix.length)
        : captured.threadId,
    );
    save.addEventListener("click", () => {
      void run({ action: "select", threadId, providerId: select.value || null });
    });
    dialog.showModal();
    void run({ action: "read", threadId });
  });
  return {
    root,
    update(next: ThreadContext | null, nextLocale: RendererSettingsLocale) {
      if (
        context?.hostId !== next?.hostId ||
        context?.threadId !== next?.threadId ||
        context?.client !== next?.client ||
        locale !== nextLocale
      ) {
        close?.();
        context = next;
      }
      locale = nextLocale;
      const title = messages[locale].title;
      if (root.textContent !== title) root.textContent = title;
      if (root.hidden !== !context) root.hidden = !context;
    },
    dispose() {
      context = null;
      close?.();
      root.remove();
    },
  };
}
