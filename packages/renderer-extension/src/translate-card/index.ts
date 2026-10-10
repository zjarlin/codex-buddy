import Languages from "lucide/dist/esm/icons/languages.mjs";
import createElement from "lucide/dist/esm/createElement.mjs";
import { detectBuddyTranslateSourceLanguage } from "@codexhost/shared-contracts";
import { injectTranslateStyle } from "./style.js";
import { translateMessages } from "./messages.js";
import type { RendererModelClient } from "../renderer-model-client.js";

interface Options {
  getLocale(): string;
  getContext(): TranslateContext | null;
}

interface TranslateContext {
  threadId: string;
  root: HTMLElement;
  client: RendererModelClient;
}

interface TranslationState {
  node: HTMLElement;
  signature: string;
  abortController?: AbortController;
}

function needsTranslation(
  lang: ReturnType<typeof detectBuddyTranslateSourceLanguage>,
  locale: string,
): boolean {
  if (!lang) return false;
  const uiCjk = locale.startsWith("zh") || locale.startsWith("ja") || locale.startsWith("ko");
  return uiCjk ? lang === "en" : lang !== "en";
}

function extractText(node: HTMLElement): { text: string; prose: string } {
  const content = node.querySelector('[data-markdown-text-style="assistant-message"]') ?? node;
  const clone = content.cloneNode(true) as HTMLElement;
  // 原生代码块使用 div + code，必须连同语言标题和复制按钮一起排除。
  for (const excluded of clone.querySelectorAll(
    'pre, [data-markdown-copy="code-block"], .sr-only, [data-codexhost-translate], [data-codexhost-turn-actions]',
  )) {
    excluded.remove();
  }
  const text = (clone.textContent?.trim() ?? "").slice(0, 8000);
  // 行内代码保留在翻译正文中，但不参与语言判断。
  for (const code of clone.querySelectorAll("code")) code.replaceWith(" ");
  return { text, prose: (clone.textContent?.trim() ?? "").slice(0, 8000) };
}

function findMessages(root: HTMLElement, threadId: string): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>();
  for (const response of root.querySelectorAll<HTMLElement>(
    "[data-response-annotation-conversation]",
  )) {
    if (response.getAttribute("data-response-annotation-conversation") !== threadId) continue;
    if (!response.getClientRects().length) continue;
    const turn = response.closest("[data-content-search-turn-key], [data-turn-key]");
    if (!turn) continue;
    const id =
      turn.getAttribute("data-content-search-turn-key") ?? turn.getAttribute("data-turn-key");
    if (!id) continue;
    // 同一回合可以包含多段进度消息，各段独立翻译。
    const siblings = Array.from(turn.querySelectorAll("[data-response-annotation-conversation]"));
    const messageId = response.getAttribute("data-response-annotation-target");
    map.set(`${threadId}:${id}:${messageId ?? siblings.indexOf(response)}`, response);
  }
  return map;
}

export function installTranslateCards(options: Options) {
  let disposed = false;
  const cards = new Map<string, TranslationState>();
  const style = injectTranslateStyle();
  const cache = new Map<string, { translated: string; model: string; latencyMs: number }>();

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
    const n = document.createElement(tag);
    n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  async function doTranslate(
    turnId: string,
    anchor: HTMLElement,
    text: string,
    locale: string,
    client: RendererModelClient,
  ) {
    if (!client.translate) return;
    const existing = cards.get(turnId);
    existing?.abortController?.abort();
    const ac = new AbortController();
    const msgs = translateMessages(locale);

    let card = existing?.node;
    if (!card?.isConnected) {
      card = el("div", "codexhost-translate");
      card.dataset.codexhostTranslate = turnId;
      anchor.appendChild(card);
    }
    card.dataset.state = "loading";
    card.innerHTML = "";
    const hdr = el("div", "codexhost-translate-header");
    hdr.append(
      createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }),
      el("span", "", msgs.translating),
    );
    card.append(hdr);
    cards.set(turnId, {
      node: card,
      signature: JSON.stringify([text, locale]),
      abortController: ac,
    });

    try {
      const ck = `${locale}:${text}`;
      let result = cache.get(ck);
      if (!result) {
        result = await client.translate({ text, targetLocale: locale });
        cache.set(ck, result);
      }
      if (disposed || ac.signal.aborted) return;

      card.dataset.state = "completed";
      card.innerHTML = "";
      const h2 = el("div", "codexhost-translate-header");
      h2.append(
        createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }),
        el("span", "", msgs.translated(result.model, result.latencyMs)),
      );
      card.append(h2);
      const content = el("div", "codexhost-translate-content", result.translated);
      card.append(content);
      const toggle = el("button", "codexhost-translate-toggle", msgs.showOriginal);
      let showTrans = true;
      toggle.addEventListener("click", () => {
        showTrans = !showTrans;
        content.hidden = !showTrans;
        toggle.textContent = showTrans ? msgs.showOriginal : msgs.showTranslation;
      });
      card.append(toggle);
      cards.set(turnId, { node: card, signature: JSON.stringify([text, locale]) });
    } catch (error) {
      if (disposed || ac.signal.aborted) return;
      card.dataset.state = "error";
      card.innerHTML = "";
      const eh = el("div", "codexhost-translate-header codexhost-translate-error");
      eh.append(
        createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }),
        el("span", "", msgs.failed),
      );
      const retry = el("button", "codexhost-translate-retry", msgs.retry);
      retry.addEventListener("click", () => void doTranslate(turnId, anchor, text, locale, client));
      eh.append(retry);
      card.append(eh);
      const message =
        typeof error === "object" && error !== null && "message" in error ? error.message : error;
      const reason = typeof message === "string" ? message.trim() : "";
      const detail = el(
        "div",
        "codexhost-translate-error-detail",
        reason.slice(0, 500) || msgs.unknownError,
      );
      detail.setAttribute("role", "status");
      card.append(detail);
    }
  }

  function tick() {
    if (disposed) return;
    const ctx = options.getContext();
    if (!ctx) return;
    const locale = options.getLocale();
    const messages = findMessages(ctx.root, ctx.threadId);
    for (const [id, state] of cards) {
      if (!state.node.isConnected || !messages.has(id)) {
        state.abortController?.abort();
        state.node.remove();
        cards.delete(id);
      }
    }
    for (const [id, node] of messages) {
      const { text, prose } = extractText(node);
      if (
        text.length < 20 ||
        !needsTranslation(detectBuddyTranslateSourceLanguage(prose), locale)
      ) {
        const state = cards.get(id);
        state?.abortController?.abort();
        state?.node.remove();
        cards.delete(id);
        continue;
      }
      if (cards.get(id)?.signature === JSON.stringify([text, locale])) continue;
      void doTranslate(id, node, text, locale, ctx.client);
    }
  }

  const timer = window.setInterval(tick, 1000);
  return {
    dispose() {
      disposed = true;
      window.clearInterval(timer);
      for (const s of cards.values()) {
        s.abortController?.abort();
        s.node.remove();
      }
      cards.clear();
      style.remove();
    },
  };
}
