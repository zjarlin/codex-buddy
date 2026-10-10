import Languages from "lucide/dist/esm/icons/languages.mjs";
import createElement from "lucide/dist/esm/createElement.mjs";
import { detectBuddyTranslateSourceLanguage } from "@codexhost/shared-contracts";
import { injectTranslateStyle } from "./style.js";
import { translateMessages } from "./messages.js";
type Messages = ReturnType<typeof translateMessages>;
import type { RendererModelClient } from "../renderer-model-client.js";

interface Options {
  getLocale(): string;
  getContext(): TranslateContext | null;
  /** 读取当前会话是否仍在运行；运行期间只排队，不发起翻译请求。 */
  readActivity?(threadId: string): Promise<boolean>;
  /** 复用 Host 的 thread/usage 通知，作为回合结束的即时信号。 */
  subscribeThreadUsage?(hostId: string, listener: () => void): () => void;
}

interface TranslateContext {
  hostId: string;
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
  const style = injectTranslateStyle();
  const cache = new Map<string, { translated: string; model: string; latencyMs: number }>();
  // 每个会话的状态：完成卡片、运行中排队条目、以及并发控制字段。
  const threads = new Map<string, ThreadState>();

  interface ThreadState {
    client: RendererModelClient | null;
    active: boolean | null;
    activityPending: boolean;
    checkedAt: number;
    cards: Map<string, TranslationState>;
    pending: Map<string, { text: string; anchor: HTMLElement }>;
    batching: boolean;
    completed: boolean;
    subscribed?: boolean;
    unsubscribe?: () => void;
  }

  function thread(threadId: string): ThreadState {
    let state = threads.get(threadId);
    if (!state) {
      state = {
        client: null,
        active: null,
        activityPending: false,
        checkedAt: 0,
        cards: new Map(),
        pending: new Map(),
        batching: false,
        completed: false,
      };
      threads.set(threadId, state);
    }
    return state;
  }

  /** 卡片签名只取决于文本与语言，渲染与轮询必须使用同一个字符串。 */
  function signatureOf(text: string, locale: string): string {
    return JSON.stringify([text, locale]);
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
    const n = document.createElement(tag);
    n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function cardShell(state: ThreadState, id: string, anchor: HTMLElement, msgs: Messages) {
    const existing = state.cards.get(id);
    existing?.abortController?.abort();
    let card = existing?.node;
    if (!card?.isConnected) {
      card = el("div", "codexhost-translate");
      card.dataset.codexhostTranslate = id;
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
    return card;
  }

  /** 运行中只显示占位，等回合结束再一次性请求，避免占满 Host 请求队列。 */
  function queue(threadId: string, id: string, anchor: HTMLElement, text: string, locale: string) {
    const state = thread(threadId);
    const msgs = translateMessages(locale);
    const card = cardShell(state, id, anchor, msgs);
    state.cards.set(id, { node: card, signature: signatureOf(text, locale) });
    state.pending.set(id, { text, anchor });
  }

  function renderResult(
    threadId: string,
    id: string,
    translated: string,
    model: string,
    latencyMs: number,
    locale: string,
    signature: string,
  ) {
    const state = thread(threadId);
    const msgs = translateMessages(locale);
    const card = state.cards.get(id)?.node;
    if (!card?.isConnected) {
      return;
    }
    card.dataset.state = "completed";
    card.innerHTML = "";
    const header = el("div", "codexhost-translate-header");
    header.append(
      createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }),
      el("span", "", msgs.translated(model, latencyMs)),
    );
    card.append(header);
    const content = el("div", "codexhost-translate-content", translated);
    card.append(content);
    const toggle = el("button", "codexhost-translate-toggle", msgs.showOriginal);
    let showTrans = true;
    toggle.addEventListener("click", () => {
      showTrans = !showTrans;
      content.hidden = !showTrans;
      toggle.textContent = showTrans ? msgs.showOriginal : msgs.showTranslation;
    });
    card.append(toggle);
    state.cards.set(id, { node: card, signature });
  }

  function renderFailure(
    threadId: string,
    id: string,
    error: unknown,
    locale: string,
    retry: () => void,
  ) {
    const state = thread(threadId);
    const msgs = translateMessages(locale);
    const card = state.cards.get(id)?.node;
    if (!card?.isConnected) return;
    card.dataset.state = "error";
    card.innerHTML = "";
    const eh = el("div", "codexhost-translate-header codexhost-translate-error");
    eh.append(
      createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }),
      el("span", "", msgs.failed),
    );
    const button = el("button", "codexhost-translate-retry", msgs.retry);
    button.addEventListener("click", retry);
    eh.append(button);
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

  /** 单条翻译：仅作为批量不可用或重试时的回退路径，带 30 秒限流。 */
  async function translateSingle(
    threadId: string,
    id: string,
    text: string,
    anchor: HTMLElement,
    locale: string,
  ) {
    const state = thread(threadId);
    const client = state.client;
    if (!client?.translate) return;
    const msgs = translateMessages(locale);
    const card = cardShell(state, id, anchor, msgs);
    state.cards.set(id, { node: card, signature: signatureOf(text, locale) });
    try {
      const ck = `${locale}:${text}`;
      let result = cache.get(ck);
      if (!result) {
        result = await client.translate({ text, targetLocale: locale });
        cache.set(ck, result);
      }
      if (disposed || card.dataset.state !== "loading") return;
      renderResult(
        threadId,
        id,
        result.translated,
        result.model,
        result.latencyMs,
        locale,
        signatureOf(text, locale),
      );
    } catch (error) {
      if (disposed || card.dataset.state !== "loading") return;
      renderFailure(
        threadId,
        id,
        error,
        locale,
        () => void translateSingle(threadId, id, text, anchor, locale),
      );
    }
  }

  async function runBatch(threadId: string, locale: string) {
    const state = threads.get(threadId);
    if (!state || state.batching) return;
    const client = state.client;
    const entries = [...state.pending.entries()].filter(([, entry]) => entry.anchor.isConnected);
    state.pending.clear();
    if (!entries.length || !client) return;
    const msgs = translateMessages(locale);
    const items = entries.map(([id, entry]) => ({ id, text: entry.text }));

    if (!client.translateBatch) {
      // 旧 Host 不支持批量：退回逐条翻译，仍按顺序限流。
      for (const [id, entry] of entries) {
        await translateSingle(threadId, id, entry.text, entry.anchor, locale);
      }
      return;
    }

    state.batching = true;
    for (const [id] of entries) {
      const card = state.cards.get(id)?.node;
      if (card?.isConnected) card.dataset.state = "loading";
    }
    try {
      const result = await client.translateBatch({ items, targetLocale: locale });
      if (disposed) return;
      const byId = new Map(result.items.map((item) => [item.id, item]));
      for (const [id, entry] of entries) {
        const item = byId.get(id);
        if (!entry.anchor.isConnected) continue;
        if (!item) {
          renderFailure(
            threadId,
            id,
            new Error(msgs.unknownError),
            locale,
            () => void translateSingle(threadId, id, entry.text, entry.anchor, locale),
          );
          continue;
        }
        cache.set(`${locale}:${entry.text}`, item);
        const signature = signatureOf(entry.text, locale);
        renderResult(threadId, id, item.translated, item.model, item.latencyMs, locale, signature);
      }
    } catch (error) {
      if (disposed) return;
      for (const [id, entry] of entries) {
        if (!entry.anchor.isConnected) continue;
        renderFailure(
          threadId,
          id,
          error,
          locale,
          () => void translateSingle(threadId, id, entry.text, entry.anchor, locale),
        );
      }
    } finally {
      state.batching = false;
    }
  }

  function readActivity(state: ThreadState, threadId: string) {
    if (!options.readActivity || state.activityPending) return;
    state.activityPending = true;
    state.checkedAt = Date.now();
    void options
      .readActivity(threadId)
      .then(
        (active) => {
          if (disposed) return;
          const current = threads.get(threadId);
          if (!current) return;
          current.active = active;
          if (active) current.completed = false;
        },
        () => {
          const current = threads.get(threadId);
          if (current) current.active = null;
        },
      )
      .finally?.(() => {
        const current = threads.get(threadId);
        if (current) current.activityPending = false;
      });
  }

  function tick() {
    if (disposed) return;
    const ctx = options.getContext();
    const locale = options.getLocale();
    if (!ctx) {
      for (const state of threads.values()) {
        state.unsubscribe?.();
        state.pending.clear();
        for (const card of state.cards.values()) {
          card.abortController?.abort();
          card.node.remove();
        }
      }
      threads.clear();
      return;
    }
    const { threadId, hostId, root, client } = ctx;
    for (const [key, other] of threads) {
      if (key === threadId) continue;
      other.unsubscribe?.();
      other.pending.clear();
      for (const card of other.cards.values()) {
        card.abortController?.abort();
        card.node.remove();
      }
      threads.delete(key);
    }
    const state = thread(threadId);
    state.client = client;
    if (!state.subscribed && options.subscribeThreadUsage) {
      state.subscribed = true;
      state.unsubscribe = options.subscribeThreadUsage(hostId, () => {
        const current = threads.get(threadId);
        if (!current) return;
        // thread/usage 通知意味着回合已结束，立即允许批量翻译，无需等待下一次轮询。
        if (current.active !== false) {
          current.completed = true;
          current.checkedAt = 0;
        }
        schedule();
      });
    }

    const messages = findMessages(root, threadId);
    for (const [id, card] of state.cards) {
      if (!card.node.isConnected || !messages.has(id)) {
        card.abortController?.abort();
        card.node.remove();
        state.cards.delete(id);
        state.pending.delete(id);
      }
    }

    const now = Date.now();
    if (state.active !== false && !state.activityPending && now - state.checkedAt > 4000) {
      readActivity(state, threadId);
    }
    // 活动状态未知时按“运行中”处理；回合完成通知或轮询确认后立即放行批量翻译。
    const running = state.active !== false && !state.completed;

    for (const [id, node] of messages) {
      const { text, prose } = extractText(node);
      if (
        text.length < 20 ||
        !needsTranslation(detectBuddyTranslateSourceLanguage(prose), locale)
      ) {
        const card = state.cards.get(id);
        card?.abortController?.abort();
        card?.node.remove();
        state.cards.delete(id);
        state.pending.delete(id);
        continue;
      }
      const signature = signatureOf(text, locale);
      if (state.cards.get(id)?.signature === signature) continue;
      // 文本已变化时丢弃旧卡片，重新排队翻译。
      if (state.cards.has(id) || state.pending.has(id)) {
        const stale = state.cards.get(id);
        stale?.abortController?.abort();
        stale?.node.remove();
        state.cards.delete(id);
        state.pending.delete(id);
      }
      // 运行中只排队并显示占位；闲置时同样入队，但本 tick 末尾立刻批量翻译。
      queue(threadId, id, node, text, locale);
    }

    // 回合不在运行时就立刻批量翻译；运行中则等回合结束（readActivity/thread-usage）后触发。
    if (!running && state.pending.size > 0 && !state.batching) {
      void runBatch(threadId, locale);
    }
  }

  let scheduled = false;
  function schedule() {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      tick();
    });
  }

  const timer = window.setInterval(tick, 1000);
  window.setTimeout(tick, 0);
  return {
    dispose() {
      disposed = true;
      window.clearInterval(timer);
      for (const state of threads.values()) {
        state.unsubscribe?.();
        state.pending.clear();
        for (const card of state.cards.values()) {
          card.abortController?.abort();
          card.node.remove();
        }
      }
      threads.clear();
      style.remove();
    },
  };
}
