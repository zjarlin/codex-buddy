import Languages from "lucide/dist/esm/icons/languages.mjs";
import createElement from "lucide/dist/esm/createElement.mjs";
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

function detectLanguage(text: string): "cjk" | "latin" | "other" {
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  if (cjk / Math.max(text.length, 1) > 0.3) return "cjk";
  const latin = text.match(/[a-zA-Z]/g)?.length ?? 0;
  if (latin / Math.max(text.length, 1) > 0.5) return "latin";
  return "other";
}

function needsTranslation(lang: "cjk" | "latin" | "other", locale: string): boolean {
  const uiCjk = locale.startsWith("zh") || locale.startsWith("ja") || locale.startsWith("ko");
  return uiCjk ? lang === "latin" : lang === "cjk";
}

function extractText(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;
  for (const pre of clone.querySelectorAll("pre")) pre.remove();
  return (clone.textContent?.trim() ?? "").slice(0, 8000);
}

function findMessages(root: HTMLElement, threadId: string): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>();
  for (const turn of root.querySelectorAll<HTMLElement>("[data-turn-key]")) {
    const id = turn.getAttribute("data-turn-key")?.replace(/^history-content:turn:/, "");
    if (!id || id.startsWith("history-content:")) continue;
    const resp = turn.querySelector<HTMLElement>(`[data-response-annotation-conversation="${threadId}"]`);
    if (!resp?.getClientRects().length) continue;
    if (resp.querySelector(".markdown, .prose, [class*='message']")) map.set(id, resp);
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

  async function doTranslate(turnId: string, anchor: HTMLElement, text: string, locale: string, client: RendererModelClient) {
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
    hdr.append(createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }), el("span", "", msgs.translating));
    card.append(hdr);
    cards.set(turnId, { node: card, signature: "", abortController: ac });

    try {
      const ck = `${locale}:${text.slice(0, 200)}`;
      let result = cache.get(ck);
      if (!result) {
        result = await client.translate({ text, targetLocale: locale });
        cache.set(ck, result);
      }
      if (disposed || ac.signal.aborted) return;

      card.dataset.state = "completed";
      card.innerHTML = "";
      const h2 = el("div", "codexhost-translate-header");
      h2.append(createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }), el("span", "", msgs.translated(result.model, result.latencyMs)));
      card.append(h2);
      const content = el("div", "codexhost-translate-content", result.translated);
      card.append(content);
      const toggle = el("button", "codexhost-translate-toggle", msgs.showOriginal);
      let showTrans = true;
      toggle.addEventListener("click", () => { showTrans = !showTrans; content.hidden = !showTrans; toggle.textContent = showTrans ? msgs.showOriginal : msgs.showTranslation; });
      card.append(toggle);
      cards.set(turnId, { node: card, signature: JSON.stringify([text, locale]) });
    } catch {
      if (disposed || ac.signal.aborted) return;
      card.dataset.state = "error";
      card.innerHTML = "";
      const eh = el("div", "codexhost-translate-header codexhost-translate-error");
      eh.append(createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }), el("span", "", msgs.failed));
      const retry = el("button", "codexhost-translate-retry", msgs.retry);
      retry.addEventListener("click", () => void doTranslate(turnId, anchor, text, locale, client));
      eh.append(retry);
      card.append(eh);
    }
  }

  function tick() {
    if (disposed) return;
    const ctx = options.getContext();
    if (!ctx) return;
    const locale = options.getLocale();
    const messages = findMessages(ctx.root, ctx.threadId);
    for (const [id, state] of cards) {
      if (!state.node.isConnected || !messages.has(id)) { state.abortController?.abort(); state.node.remove(); cards.delete(id); }
    }
    for (const [id, node] of messages) {
      if (cards.has(id)) continue;
      const text = extractText(node);
      if (!text || text.length < 20) continue;
      if (!needsTranslation(detectLanguage(text), locale)) continue;
      void doTranslate(id, node, text, locale, ctx.client);
    }
  }

  const timer = window.setInterval(tick, 1000);
  return {
    dispose() {
      disposed = true;
      window.clearInterval(timer);
      for (const s of cards.values()) { s.abortController?.abort(); s.node.remove(); }
      cards.clear();
      style.remove();
    },
  };
}
