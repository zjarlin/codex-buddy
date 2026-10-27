import Languages from "lucide/dist/esm/icons/languages.mjs";
import createElement from "lucide/dist/esm/createElement.mjs";
import {
  BUDDY_TRANSLATE_IMAGE_MAX_CHARS,
  detectBuddyTranslateSourceLanguage,
  isBuddyTranslateImageSource,
} from "@codexhost/shared-contracts";
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

interface ImageEntry {
  id: string;
  anchor: HTMLElement;
  src: string;
}

/**
 * 收集助手消息里可直接翻译的图片（base64 或 https）。
 * 只认原生 markdown 正文里的 img，不碰附件缩略图、头像和我们自己的卡片。
 * 本地文件路径、file: 和 http 一律跳过：它们要么不该出网，要么 Host 拿不到。
 */
function findImages(root: HTMLElement, threadId: string): Map<string, ImageEntry> {
  const map = new Map<string, ImageEntry>();
  for (const response of root.querySelectorAll<HTMLElement>(
    "[data-response-annotation-conversation]",
  )) {
    if (response.getAttribute("data-response-annotation-conversation") !== threadId) continue;
    if (!response.getClientRects().length) continue;
    const turn = response.closest("[data-content-search-turn-key], [data-turn-key]");
    if (!turn) continue;
    const turnId =
      turn.getAttribute("data-content-search-turn-key") ?? turn.getAttribute("data-turn-key");
    if (!turnId) continue;
    const content =
      response.querySelector('[data-markdown-text-style="assistant-message"]') ?? response;
    const messageId = response.getAttribute("data-response-annotation-target") ?? "";
    let index = 0;
    for (const img of content.querySelectorAll<HTMLImageElement>("img")) {
      if (img.closest("[data-codexhost-translate]")) continue;
      const src = img.currentSrc || img.getAttribute("src") || "";
      if (!src || src.length > BUDDY_TRANSLATE_IMAGE_MAX_CHARS) continue;
      if (!isBuddyTranslateImageSource(src)) continue;
      const id = `img:${threadId}:${turnId}:${messageId}:${index}`;
      index += 1;
      if (map.has(id)) continue;
      map.set(id, { id, anchor: response, src });
    }
  }
  return map;
}

/** 图片没有可靠的语言线索：只要 UI 不是英文就尝试翻译，英文界面默认不额外花钱。 */
function needsImageTranslation(locale: string): boolean {
  return !locale.startsWith("en");
}

export function installTranslateCards(options: Options) {
  let disposed = false;
  const style = injectTranslateStyle();
  const cache = new Map<string, { translated: string; model: string; latencyMs: number }>();
  // 图片按 base64 原文做键，单条体积大，因此条目上限比文本更小。
  const imageCache = new Map<string, { translated: string; model: string; latencyMs: number }>();
  // 每个会话的状态：完成卡片、运行中排队条目、以及并发控制字段。
  const threads = new Map<string, ThreadState>();

  type PendingEntry = [string, { text: string; anchor: HTMLElement }];

  interface ThreadState {
    client: RendererModelClient | null;
    active: boolean | null;
    activityPending: boolean;
    checkedAt: number;
    cards: Map<string, TranslationState>;
    pending: Map<string, { text: string; anchor: HTMLElement }>;
    pendingImages: Map<string, { src: string; anchor: HTMLElement }>;
    batching: boolean;
    imageBatching: boolean;
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
        pendingImages: new Map(),
        batching: false,
        imageBatching: false,
        completed: false,
      };
      threads.set(threadId, state);
    }
    return state;
  }

  /** 单个网关请求承载的段落数；网关逐条调用上游，段数越多越接近单次超时。 */
  const BATCH_CHUNK = 8;
  /** 分片并发数：保持请求量很小，同时避免长会话等待过久。 */
  const BATCH_CONCURRENCY = 2;
  /** 图片并发：视觉模型有账号级并发上限，两张同时足够覆盖常见截图。 */
  const IMAGE_CONCURRENCY = 2;

  /** 卡片签名只取决于文本与语言，渲染与轮询必须使用同一个字符串。 */
  function signatureOf(text: string, locale: string): string {
    return JSON.stringify([text, locale]);
  }

  /**
   * 图片签名与缓存键都用 32 位 FNV-1a，而不是把十几 MB 的 base64 原文留作键：
   * 卡片状态和缓存会活到会话结束，直接存原文等于把图片再复制一份到 JS 堆里。
   */
  function hashSource(source: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${source.length.toString(36)}-${hash.toString(36)}`;
  }

  function imageSignature(source: string, locale: string): string {
    return JSON.stringify(["image", hashSource(source), locale]);
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
    label?: string,
  ) {
    const state = thread(threadId);
    const msgs = translateMessages(locale);
    const card = state.cards.get(id)?.node;
    if (!card?.isConnected) {
      return;
    }
    card.dataset.state = "completed";
    card.innerHTML = "";
    if (label) card.append(el("div", "codexhost-translate-label", label));
    const header = el("div", "codexhost-translate-header");
    header.append(
      createElement(Languages, { width: 14, height: 14, "aria-hidden": "true" }),
      el("span", "", msgs.translated(model, latencyMs)),
    );
    card.append(header);
    const content = el("div", "codexhost-translate-content", translated);
    card.append(content);
    // 图片卡没有可切换的原文正文，不放大一个无意义的开关。
    if (label) {
      state.cards.set(id, { node: card, signature });
      return;
    }
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
    const detail = el("div", "codexhost-translate-error-detail", reason || msgs.unknownError);
    detail.setAttribute("role", "status");
    const details = el("details", "codexhost-translate-error-details");
    details.append(el("summary", "", msgs.failureDetails), detail);
    card.append(details);
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

    if (!client.translateBatch) {
      // 旧 Host 不支持批量：退回逐条翻译，仍按顺序限流。
      for (const [id, entry] of entries) {
        await translateSingle(threadId, id, entry.text, entry.anchor, locale);
      }
      return;
    }
    const translateBatch = client.translateBatch.bind(client);

    state.batching = true;
    for (const [id] of entries) {
      const card = state.cards.get(id)?.node;
      if (card?.isConnected) card.dataset.state = "loading";
    }

    // 网关对每个服务商只有约 10 秒预算，且逐条调用上游，段落越多越容易整批超时。
    // 按小分片并发发送，既保持请求量很小，又让每个请求都能稳定完成。
    const chunks: PendingEntry[][] = [];
    for (let index = 0; index < entries.length; index += BATCH_CHUNK) {
      chunks.push(entries.slice(index, index + BATCH_CHUNK));
    }

    const translateChunk = async (chunk: PendingEntry[]): Promise<void> => {
      const items = chunk.map(([id, entry]) => ({ id, text: entry.text }));
      try {
        const result = await translateBatch({ items, targetLocale: locale });
        if (disposed) return;
        const byId = new Map(result.items.map((item) => [item.id, item]));
        for (const [id, entry] of chunk) {
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
          renderResult(
            threadId,
            id,
            item.translated,
            item.model,
            item.latencyMs,
            locale,
            signature,
          );
        }
      } catch (error) {
        if (disposed) return;
        for (const [id, entry] of chunk) {
          if (!entry.anchor.isConnected) continue;
          renderFailure(
            threadId,
            id,
            error,
            locale,
            () => void translateSingle(threadId, id, entry.text, entry.anchor, locale),
          );
        }
      }
    };

    try {
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(BATCH_CONCURRENCY, chunks.length) },
        async () => {
          while (!disposed) {
            const chunk = chunks[cursor++];
            if (!chunk) return;
            await translateChunk(chunk);
          }
        },
      );
      await Promise.all(workers);
    } finally {
      state.batching = false;
    }
  }

  /** 单张图片：一次视觉模型调用直接出译文，失败可按图重试。 */
  async function translateImageEntry(
    threadId: string,
    id: string,
    src: string,
    anchor: HTMLElement,
    locale: string,
  ) {
    const state = thread(threadId);
    const client = state.client;
    if (!client?.translateImage) return;
    const msgs = translateMessages(locale);
    const card = cardShell(state, id, anchor, msgs);
    card.dataset.kind = "image";
    const signature = imageSignature(src, locale);
    state.cards.set(id, { node: card, signature });
    try {
      const ck = `${locale}:${hashSource(src)}`;
      let result = imageCache.get(ck);
      if (!result) {
        result = await client.translateImage({ image: src, targetLocale: locale });
        if (imageCache.size >= 32) imageCache.clear();
        imageCache.set(ck, result);
      }
      if (disposed || card.dataset.state !== "loading") return;
      renderResult(
        threadId,
        id,
        result.translated || msgs.noText,
        result.model,
        result.latencyMs,
        locale,
        signature,
        msgs.imageLabel,
      );
    } catch (error) {
      if (disposed || card.dataset.state !== "loading") return;
      renderFailure(
        threadId,
        id,
        error,
        locale,
        () => void translateImageEntry(threadId, id, src, anchor, locale),
      );
    }
  }

  /** 一回合内的图片有界并发翻译：视觉模型一次只处理一张，避免同时吃掉并发额度。 */
  async function runImages(threadId: string, locale: string) {
    const state = threads.get(threadId);
    if (!state || state.imageBatching) return;
    if (!state.client?.translateImage) return;
    const entries = [...state.pendingImages.entries()].filter(
      ([, entry]) => entry.anchor.isConnected,
    );
    state.pendingImages.clear();
    if (!entries.length) return;

    state.imageBatching = true;
    try {
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(IMAGE_CONCURRENCY, entries.length) },
        async () => {
          while (!disposed) {
            const entry = entries[cursor++];
            if (!entry) return;
            const [id, { src, anchor }] = entry;
            await translateImageEntry(threadId, id, src, anchor, locale);
          }
        },
      );
      await Promise.all(workers);
    } finally {
      state.imageBatching = false;
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
        state.pendingImages.clear();
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
      other.pendingImages.clear();
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
    const images = state.client?.translateImage
      ? findImages(root, threadId)
      : new Map<string, ImageEntry>();
    for (const [id, card] of state.cards) {
      if (!card.node.isConnected || (!messages.has(id) && !images.has(id))) {
        card.abortController?.abort();
        card.node.remove();
        state.cards.delete(id);
        state.pending.delete(id);
        state.pendingImages.delete(id);
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

    if (needsImageTranslation(locale)) {
      for (const [id, entry] of images) {
        const signature = imageSignature(entry.src, locale);
        if (state.cards.get(id)?.signature === signature) continue;
        const stale = state.cards.get(id);
        stale?.abortController?.abort();
        stale?.node.remove();
        state.cards.delete(id);
        state.pendingImages.set(id, { src: entry.src, anchor: entry.anchor });
        // 先占位，避免同一张图在下一 tick 被重复入队；真正请求等回合结束后发出。
        const card = cardShell(state, id, entry.anchor, translateMessages(locale));
        card.dataset.kind = "image";
        state.cards.set(id, { node: card, signature });
      }
    } else {
      for (const [id] of images) {
        const card = state.cards.get(id);
        card?.node.remove();
        state.cards.delete(id);
        state.pendingImages.delete(id);
      }
    }

    // 回合不在运行时就立刻批量翻译；运行中则等回合结束（readActivity/thread-usage）后触发。
    if (!running && state.pending.size > 0 && !state.batching) {
      void runBatch(threadId, locale);
    }
    if (!running && state.pendingImages.size > 0 && !state.imageBatching) {
      void runImages(threadId, locale);
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
        state.pendingImages.clear();
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
