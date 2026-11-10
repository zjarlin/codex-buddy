import {
  mobilePairingCredentialSchema,
  type MobileClientHello,
  type MobilePairingCredential,
  type MobilePairingRequest,
} from "@codexhost/shared-contracts";

import { h, object, text, type JsonObject } from "./dom.js";
import {
  isMobileServerRequestMethod,
  renderInteraction,
  type PendingInteraction,
} from "./interactions.js";

const TOKEN_KEY = "codexhost.mobile.pairing.v1";
const CLIENT_KEY = "codexhost.mobile.client-id.v1";
const LABEL_KEY = "codexhost.mobile.label.v1";

interface ThreadRow {
  id: string;
  title: string;
  updatedAt: number;
  cwd: string | null;
}

interface TranscriptEntry {
  kind: "user" | "assistant" | "event";
  text: string;
}

export interface MobileControlOptions {
  createClientId(): string;
  createSocket(url: string): WebSocket;
  fetch(url: string, init: RequestInit): Promise<Response>;
  location: Location;
  storage: Storage;
}

function errorText(value: unknown): string {
  if (object(value)) return text(value.message) || "请求失败";
  return value instanceof Error ? value.message : String(value);
}

function threadTitle(item: JsonObject): string {
  return text(item.name) || text(item.preview) || "未命名会话";
}

function threadUpdated(item: JsonObject): number {
  for (const key of ["updatedAt", "recencyAt", "createdAt"]) {
    const value = item[key];
    if (typeof value === "number") return value > 10_000_000_000 ? value : value * 1000;
  }
  return 0;
}

/** The app speaks the native app-server JSON-RPC protocol; the Host only filters its methods. */
export function startMobileControl(document: Document, options: MobileControlOptions): void {
  const root = document.querySelector("#root") ?? document.body;
  const invite = new URL(options.location.href).searchParams.get("invite");
  const stored = readCredential(options.storage);
  let credential = stored;
  let clientId = options.storage.getItem(CLIENT_KEY) ?? options.createClientId();
  options.storage.setItem(CLIENT_KEY, clientId);
  let label = options.storage.getItem(LABEL_KEY) ?? defaultLabel();
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let initialized = false;
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve(value: JsonObject): void; reject(error: Error): void }
  >();
  let threads: ThreadRow[] = [];
  let activeThread: ThreadRow | null = null;
  let activeTurnId: string | null = null;
  let transcript: TranscriptEntry[] = [];
  let interactions: PendingInteraction[] = [];
  let status = invite ? "正在配对…" : stored ? "正在连接电脑…" : "需要配对";
  let busy = false;
  let draft = "";

  const render = (): void => {
    if (!credential) {
      root.replaceChildren(pairingView());
      return;
    }
    root.replaceChildren(threadView());
  };

  const setStatus = (value: string): void => {
    status = value;
    const element = document.querySelector("[data-mobile-status]");
    if (element) element.textContent = value;
  };

  const setBusy = (value: boolean): void => {
    busy = value;
    render();
  };

  const pairingView = (): HTMLElement => {
    const labelField = h(document, "input", {
      type: "text",
      maxlength: "80",
      value: label,
      "aria-label": "手机名称",
    });
    labelField.addEventListener("input", () => {
      label = labelField.value.trim() || defaultLabel();
    });
    const pairButton = h(document, "button", { type: "button", class: "primary" }, "完成配对");
    pairButton.disabled = !invite;
    pairButton.addEventListener("click", () => {
      if (!invite || busy) return;
      pairButton.disabled = true;
      void pair(invite, labelField.value.trim() || defaultLabel()).then(
        (value) => {
          credential = value;
          writeCredential(options.storage, value);
          options.storage.setItem(CLIENT_KEY, value.clientId);
          options.storage.setItem(LABEL_KEY, value.label);
          clientId = value.clientId;
          label = value.label;
          // The invite is single-use; drop it so a reload reconnects with this credential.
          const clean = new URL(options.location.href);
          clean.searchParams.delete("invite");
          window.history.replaceState(null, "", clean);
          render();
          connect();
        },
        (error: unknown) => {
          setStatus(`配对失败：${errorText(error)}`);
          pairButton.disabled = false;
        },
      );
    });
    return h(
      document,
      "main",
      {},
      h(
        document,
        "section",
        {},
        h(document, "h2", {}, "扫码配对"),
        h(
          document,
          "p",
          {},
          invite
            ? "这台手机会获得一枚独立凭据，可在电脑的 Console 页面随时撤销。"
            : "这个链接没有有效的配对码。请在电脑 Console 中重新生成二维码。",
        ),
      ),
      h(
        document,
        "section",
        {},
        h(document, "label", {}, "手机名称"),
        labelField,
        h(document, "div", { class: "row" }, pairButton),
      ),
      h(document, "p", { class: "status", "data-mobile-status": true }, status),
    );
  };

  const threadView = (): HTMLElement => {
    const statusElement = h(document, "span", { "data-mobile-status": true }, status);
    const disconnect = h(document, "button", { type: "button" }, "断开");
    disconnect.addEventListener("click", () => {
      window.clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
      initialized = false;
      credential = null;
      for (const reply of pending.values()) reply.reject(new Error("连接已断开"));
      pending.clear();
      options.storage.removeItem(TOKEN_KEY);
      render();
    });
    const list = h(document, "div", { class: "threads" });
    if (threads.length === 0) {
      list.append(h(document, "p", { class: "empty" }, "还没有会话。发送第一条消息后会创建一个。"));
    } else {
      for (const thread of threads) {
        const item = h(
          document,
          "button",
          {
            type: "button",
            class: "thread",
            "aria-current": activeThread?.id === thread.id ? "true" : undefined,
          },
          h(document, "span", {}, thread.title),
          h(
            document,
            "small",
            {},
            thread.updatedAt ? new Date(thread.updatedAt).toLocaleString() : "—",
          ),
        );
        item.addEventListener("click", () => openThread(thread));
        list.append(item);
      }
    }

    const messages = h(document, "div", { class: "messages" });
    for (const entry of transcript) {
      messages.append(h(document, "div", { class: `msg ${entry.kind}` }, entry.text));
    }
    messages.scrollTop = messages.scrollHeight;

    const input = h(document, "textarea", {
      placeholder: "输入消息，或按麦克风发送语音转写…",
      "aria-label": "消息",
    });
    input.value = draft;
    input.addEventListener("input", () => {
      draft = input.value;
      send.disabled = busy || !initialized || input.value.trim().length === 0;
    });
    const send = h(
      document,
      "button",
      { type: "button", class: "primary" },
      busy ? "运行中…" : "发送",
    );
    send.disabled = busy || !initialized || draft.trim().length === 0;
    send.addEventListener("click", () => {
      const value = input.value.trim();
      if (!value || busy) return;
      input.value = "";
      draft = "";
      void sendMessage(value);
    });
    const stop = h(document, "button", { type: "button" }, "停止");
    stop.disabled = !busy || !activeThread;
    stop.addEventListener("click", () => {
      const threadId = activeThread?.id;
      const turnId = activeTurnId;
      if (!threadId || !turnId || !busy) return;
      setStatus("正在停止…");
      void request("turn/interrupt", { threadId, turnId }).then(
        () => setBusy(false),
        (error: unknown) => setStatus(`停止失败：${errorText(error)}`),
      );
    });

    const interaction = interactions[0];
    const interactionView = interaction
      ? renderInteraction(document, interaction, { index: 1, total: interactions.length }, respond)
      : null;
    return h(
      document,
      "main",
      {},
      h(
        document,
        "section",
        {},
        h(
          "div",
          { class: "row" },
          h(document, "h2", {}, "会话"),
          h(document, "span", { class: "status" }, statusElement),
          disconnect,
        ),
        list,
      ),
      activeThread
        ? h(
            document,
            "section",
            { class: "transcript" },
            h(document, "h2", {}, activeThread.title),
            messages,
          )
        : null,
      interactionView,
      h(
        document,
        "section",
        {},
        h(document, "label", {}, activeThread ? `发给「${activeThread.title}」` : "新会话"),
        input,
        h(document, "div", { class: "row" }, send, stop),
      ),
    );
  };

  const respond = (result: JsonObject): void => {
    const [interaction] = interactions;
    if (!interaction) return;
    sendRaw({ id: interaction.id, result });
    interactions = interactions.slice(1);
    render();
  };

  const pair = async (secret: string, name: string): Promise<MobilePairingCredential> => {
    const request: MobilePairingRequest = {
      invite: secret,
      clientId,
      label: name,
    };
    const response = await options.fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(object(payload) ? errorText(payload.error) : `HTTP ${response.status}`);
    }
    const parsed = mobilePairingCredentialSchema.safeParse(payload);
    if (!parsed.success) throw new Error("电脑返回了无效的配对结果");
    return parsed.data;
  };

  const connect = (): void => {
    if (!credential) return;
    window.clearTimeout(reconnectTimer);
    const secure = options.location.protocol === "https:" ? "wss:" : "ws:";
    socket = options.createSocket(`${secure}//${options.location.host}/ws`);
    socket.addEventListener("open", () => {
      const hello: MobileClientHello = {
        schemaVersion: 1,
        kind: "mobile",
        clientId: credential?.clientId ?? clientId,
        label: credential?.label ?? label,
        token: credential?.token ?? "",
      };
      socket?.send(JSON.stringify(hello));
      setStatus("已连接");
      void initialize();
    });
    socket.addEventListener("message", (event) => {
      let value: unknown;
      try {
        value = JSON.parse(String(event.data));
      } catch {
        return;
      }
      handle(value);
    });
    socket.addEventListener("close", (event) => {
      initialized = false;
      socket = null;
      for (const reply of pending.values()) reply.reject(new Error("连接已断开"));
      pending.clear();
      interactions = [];
      if (!credential) return;
      if (event.code === 1008) {
        credential = null;
        options.storage.removeItem(TOKEN_KEY);
        setStatus("配对已失效，请在电脑 Console 中重新生成二维码");
        render();
        return;
      }
      setStatus("连接已断开，正在重试…");
      reconnectTimer = window.setTimeout(() => {
        if (credential && (!socket || socket.readyState !== WebSocket.OPEN)) connect();
      }, 1200);
    });
    socket.addEventListener("error", () => {
      // `close` follows and owns the retry/revocation decision.
    });
  };

  const initialize = async (): Promise<void> => {
    try {
      await request("initialize", {
        clientInfo: { name: "codexhost-mobile", version: "1" },
      });
      initialized = true;
      sendRaw({ method: "initialized" });
      await refreshThreads();
    } catch (error) {
      setStatus(`初始化失败：${errorText(error)}`);
    }
  };

  const refreshThreads = async (): Promise<void> => {
    const result = await request("thread/list", {
      limit: 30,
      sortKey: "updated_at",
      sortDirection: "desc",
    });
    const data = Array.isArray(result.data) ? result.data : [];
    threads = data.flatMap((value) => {
      if (!object(value) || typeof value.id !== "string") return [];
      return [
        {
          id: value.id,
          title: threadTitle(value),
          updatedAt: threadUpdated(value),
          cwd: text(value.cwd) || null,
        },
      ];
    });
    render();
  };

  const openThread = (thread: ThreadRow): void => {
    activeThread = thread;
    activeTurnId = null;
    transcript = [];
    setStatus("正在加载会话…");
    void request("thread/read", { threadId: thread.id, includeTurns: true }).then(
      (result) => {
        if (activeThread?.id !== thread.id) return;
        transcript = transcriptFromThread(result.thread);
        setStatus("已连接");
        render();
      },
      (error: unknown) => {
        if (activeThread?.id !== thread.id) return;
        setStatus(`读取失败：${errorText(error)}`);
      },
    );
  };

  const sendMessage = async (message: string): Promise<void> => {
    setBusy(true);
    transcript.push({ kind: "user", text: message });
    render();
    try {
      let threadId = activeThread?.id;
      if (!threadId) {
        // External Harnesses require a workspace; continue in the most recent Thread's cwd.
        const cwd = threads[0]?.cwd;
        if (!cwd) throw new Error("没有可用于新会话的工作目录，请先打开一个已有会话");
        const created = await request("thread/start", { cwd });
        const thread = object(created.thread) ? created.thread : null;
        if (!thread || typeof thread.id !== "string") throw new Error("未能创建会话");
        threadId = thread.id;
        activeThread = {
          id: thread.id,
          title: threadTitle(thread),
          updatedAt: threadUpdated(thread),
          cwd: text(thread.cwd) || null,
        };
        const begun = await request("turn/start", {
          threadId,
          input: [{ type: "text", text: message }],
        });
        const turn = object(begun.turn) ? begun.turn : null;
        if (turn && typeof turn.id === "string") activeTurnId = turn.id;
      } else {
        const begun = await request("turn/start", {
          threadId,
          input: [{ type: "text", text: message }],
        });
        const turn = object(begun.turn) ? begun.turn : null;
        if (turn && typeof turn.id === "string") activeTurnId = turn.id;
      }
      await refreshThreads();
    } catch (error) {
      transcript.push({ kind: "event", text: `发送失败：${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const transcriptFromThread = (value: unknown): TranscriptEntry[] => {
    if (!object(value) || !Array.isArray(value.turns)) return [];
    const entries: TranscriptEntry[] = [];
    for (const turn of value.turns) {
      if (!object(turn) || !Array.isArray(turn.items)) continue;
      for (const item of turn.items) {
        if (!object(item)) continue;
        const type = text(item.type);
        if (type === "userMessage" && Array.isArray(item.content)) {
          const content = item.content
            .flatMap((part) => (object(part) && part.type === "text" ? [text(part.text)] : []))
            .join("");
          if (content) entries.push({ kind: "user", text: content });
        } else if (type === "agentMessage") {
          const content = text(item.text);
          if (content) entries.push({ kind: "assistant", text: content });
        } else if (type === "commandExecution") {
          const command = text(item.command);
          if (command) entries.push({ kind: "event", text: `$ ${command}` });
        } else if (type === "reasoning") {
          const summary = Array.isArray(item.summary)
            ? item.summary.flatMap((part) => (object(part) ? [text(part.text)] : [])).join("\n")
            : "";
          if (summary) entries.push({ kind: "event", text: summary });
        }
      }
    }
    return entries;
  };

  const sendRaw = (value: JsonObject): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(value));
  };

  const request = (method: string, params: JsonObject): Promise<JsonObject> => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("还没有连接到电脑"));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      sendRaw({ id, method, params });
      window.setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error("请求超时"));
      }, 60_000);
    });
  };

  const handle = (value: unknown): void => {
    if (!object(value)) return;
    if (typeof value.id === "number" && !("method" in value)) {
      const reply = pending.get(value.id);
      if (!reply) return;
      pending.delete(value.id);
      if (object(value.error)) reply.reject(new Error(errorText(value.error)));
      else reply.resolve(object(value.result) ? value.result : {});
      return;
    }
    const method = text(value.method);
    const params = object(value.params) ? value.params : {};
    if (isMobileServerRequestMethod(method)) {
      if (typeof value.id === "number" || typeof value.id === "string") {
        interactions.push({ method, id: value.id, params });
        setStatus("需要你的确认");
        render();
      }
      return;
    }
    if (method === "serverRequest/resolved") {
      const requestId = params.requestId;
      if (typeof requestId === "number" || typeof requestId === "string") {
        interactions = interactions.filter((interaction) => interaction.id !== requestId);
        render();
      }
      return;
    }
    if (method === "turn/started") {
      const turn = object(params.turn) ? params.turn : null;
      if (turn && typeof turn.id === "string") activeTurnId = turn.id;
      setBusy(true);
      return;
    }
    if (method === "turn/completed") {
      activeTurnId = null;
      setBusy(false);
      void refreshThreads();
      if (activeThread) openThread(activeThread);
      return;
    }
    if (method === "item/agentMessage/delta") {
      appendStream(text(params.delta));
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      appendStream(text(params.delta), "event");
      return;
    }
    if (method === "thread/started" && object(params.thread)) {
      void refreshThreads();
    }
  };

  const appendStream = (delta: string, kind: TranscriptEntry["kind"] = "assistant"): void => {
    if (!delta) return;
    const last = transcript.at(-1);
    if (last?.kind === kind) last.text += delta;
    else transcript.push({ kind, text: delta });
    render();
  };

  if (invite && !credential) {
    render();
    return;
  }
  if (credential) {
    render();
    connect();
    return;
  }
  render();
}

function defaultLabel(): string {
  return navigator.platform ? `手机 · ${navigator.platform}`.slice(0, 80) : "手机";
}

function readCredential(storage: Storage): MobilePairingCredential | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(TOKEN_KEY) ?? "null");
    const parsed = mobilePairingCredentialSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCredential(storage: Storage, value: MobilePairingCredential): void {
  storage.setItem(TOKEN_KEY, JSON.stringify(value));
}
