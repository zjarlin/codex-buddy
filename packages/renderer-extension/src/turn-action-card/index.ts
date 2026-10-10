import type {
  TurnActionsSnapshot,
  TurnActionDescriptor,
  TurnActionInvocation,
} from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";
import { RendererMethodUnavailableError } from "../renderer-request-sender.js";
import { turnAnchors } from "../turn-card-anchors.js";

interface Context {
  threadId: string;
  hostId: string;
  root: HTMLElement;
  composer: Element;
  client: RendererModelClient;
  openCommands?(): void;
}
const style = `
:host{display:block;margin:10px 0;color:inherit;font:12px/1.6 var(--font-sans,system-ui)}
section{padding:10px 12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:10px;background:var(--surface-primary,transparent)}
header{display:flex;justify-content:space-between;gap:12px}strong{font-size:12px}.muted{opacity:.7}.features{margin:5px 0}.buttons{display:flex;gap:6px;flex-wrap:wrap}
button{font:inherit;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:6px;padding:4px 9px;cursor:pointer}
button:hover:not(:disabled){background:color-mix(in srgb,currentColor 8%,transparent)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--text-link,#339cff);outline-offset:2px}
form{display:flex;gap:6px;margin-top:8px}input{min-width:0;flex:1;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;padding:4px}details{margin-top:8px}summary{cursor:pointer}[role=status]{margin-top:6px;overflow-wrap:anywhere}
`;
const states: Record<string, string> = {
  pending: "判断中",
  completed: "判断完成",
  failed: "判断失败，可使用已注册动作",
  timed_out: "判断超时，可使用已注册动作",
  unsupported: "使用已注册动作",
};
const executionStates: Record<string, string> = {
  starting: "启动中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  unknown: "状态待确认，不会自动重试",
};

export function installTurnActionCards(options: { getContext(): Context | null }): {
  dispose(): void;
} {
  let context: Context | null = null;
  let generation = 0;
  let disposed = false;
  let reading: number | null = null;
  let unsupported = false;
  let nextRead = 0;
  const snapshots = new Map<string, TurnActionsSnapshot>();
  const historyRead = new Map<string, number>();
  const cards = new Map<string, { node: HTMLElement; signature: string }>();
  const invoking = new Set<string>();
  const attempts = new Map<string, { id: string; argumentText?: string }>();
  const receipts = new Map<string, TurnActionInvocation>();
  let error = "";

  function clear() {
    for (const card of cards.values()) card.node.remove();
    cards.clear();
    snapshots.clear();
    historyRead.clear();
    receipts.clear();
  }
  function refreshContext() {
    const next = options.getContext();
    if (
      context?.threadId !== next?.threadId ||
      context?.hostId !== next?.hostId ||
      context?.client !== next?.client ||
      context?.root !== next?.root
    ) {
      generation++;
      reading = null;
      unsupported = false;
      nextRead = 0;
      error = "";
      clear();
    }
    context = next;
  }
  function build(snapshot: TurnActionsSnapshot, request: Context): HTMLElement {
    const node = document.createElement("div");
    node.dataset.codexhostTurnActions = snapshot.sourceTurnId;
    const shadow = node.attachShadow({ mode: "open" });
    const css = document.createElement("style");
    css.textContent = style;
    const section = document.createElement("section");
    section.setAttribute("aria-label", "回合动作与 System One 判断");
    const header = document.createElement("header");
    const title = document.createElement("strong");
    const judgment = snapshot.recommendation;
    title.textContent = "回合动作";
    const hasSystemOne = Boolean(
      judgment && (judgment.source !== "none" || judgment.state === "pending"),
    );
    const state = document.createElement("span");
    state.className = "muted";
    const current = snapshot.sourceTurnId === snapshot.latestTurnId;
    state.textContent = current
      ? `${hasSystemOne ? "System One · " : ""}${states[judgment?.state ?? "unsupported"] ?? ""}`
      : "历史推荐 · 只读";
    header.append(title, state);
    section.append(header);
    if (judgment) {
      const features = document.createElement("div");
      features.className = "features muted";
      const f = judgment.features;
      features.textContent = [
        judgment.model ? `判断模型 ${judgment.model}` : "",
        f.git_changes ? `${f.git_changes} 项改动` : "",
        f.git_conflicts ? `${f.git_conflicts} 个冲突文件` : "",
        f.git_ahead ? `${f.git_ahead} 个待推送提交` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      section.append(features);
    }
    const recommendations = judgment?.actions ?? [];
    const ranked = [...snapshot.actions].sort((a, b) => {
      const score = (action: TurnActionDescriptor) =>
        recommendations.find(
          ({ action_id, version }) => action_id === action.actionId && version === action.version,
        )?.confidence ?? 0;
      return Number(b.enabled) - Number(a.enabled) || score(b) - score(a);
    });
    const row = document.createElement("div");
    row.className = "buttons";
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    const sourceTurnId = snapshot.sourceTurnId;
    if (!sourceTurnId) throw new Error("动作卡片缺少回合身份");
    const turnReceipts = snapshot.invocations.filter(
      (entry) => entry.sourceTurnId === sourceTurnId,
    );
    const latestReceipt = turnReceipts[0];
    status.textContent =
      error ||
      (latestReceipt ? (latestReceipt.message ?? executionStates[latestReceipt.state] ?? "") : "");
    if (!current) {
      const summary = document.createElement("div");
      summary.className = "features muted";
      summary.textContent = recommendations
        .map((recommendation) => {
          const action = snapshot.actions.find(
            (entry) =>
              entry.actionId === recommendation.action_id &&
              entry.version === recommendation.version,
          );
          return `${action?.label ?? recommendation.action_id} · ${(recommendation.confidence * 100).toFixed(0)}%`;
        })
        .join(" · ");
      if (summary.textContent) section.append(summary);
      section.append(status);
      shadow.append(css, section);
      return node;
    }
    const version = generation;
    const addButton = (action: TurnActionDescriptor, parent: HTMLElement) => {
      const key = `${request.hostId}:${request.threadId}:${sourceTurnId}:${action.actionId}`;
      const receipt =
        receipts.get(key) ?? turnReceipts.find((entry) => entry.actionId === action.actionId);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      const recommendation = recommendations.find(
        ({ action_id, version }) => action_id === action.actionId && version === action.version,
      );
      if (recommendation)
        button.textContent += ` · ${(recommendation.confidence * 100).toFixed(0)}%`;
      button.title =
        action.disabledReason ??
        (recommendation
          ? `${recommendation.reason} · ${(recommendation.confidence * 100).toFixed(0)}%`
          : action.description);
      button.disabled =
        !current ||
        !action.enabled ||
        snapshot.busy ||
        invoking.has(key) ||
        Boolean(receipt && ["starting", "running", "unknown", "completed"].includes(receipt.state));
      const execute = async (argumentText?: string) => {
        refreshContext();
        if (version !== generation || invoking.has(key) || !request.client.executeTurnAction)
          return;
        invoking.add(key);
        button.disabled = true;
        status.textContent = "正在启动…";
        let attempt = attempts.get(key);
        if (!attempt || attempt.argumentText !== argumentText) {
          attempt = { id: crypto.randomUUID(), ...(argumentText ? { argumentText } : {}) };
          attempts.set(key, attempt);
        }
        try {
          const result = await request.client.executeTurnAction({
            threadId: snapshot.threadId,
            sourceTurnId,
            actionId: action.actionId,
            version: action.version,
            invocationId: attempt.id,
            ...(argumentText ? { argumentText } : {}),
          });
          if (version !== generation || disposed) return;
          receipts.set(key, result);
          status.textContent = result.message ?? executionStates[result.state] ?? "";
        } catch (cause) {
          if (version === generation)
            status.textContent = cause instanceof Error ? cause.message : String(cause);
        } finally {
          invoking.delete(key);
          if (version === generation && !disposed) {
            nextRead = 0;
            void poll();
          }
        }
      };
      button.addEventListener("click", () => {
        if (action.argumentMode === "none") {
          void execute();
          return;
        }
        if (section.querySelector("form")) return;
        const form = document.createElement("form");
        const input = document.createElement("input");
        input.setAttribute("aria-label", `${action.label} 参数`);
        input.placeholder = "可选参数";
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.textContent = "运行";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "取消";
        cancel.onclick = () => form.remove();
        form.onsubmit = (event) => {
          event.preventDefault();
          void execute(input.value);
          form.remove();
        };
        form.append(input, submit, cancel);
        section.append(form);
        input.focus();
      });
      parent.append(button);
    };
    for (const action of ranked.slice(0, 3)) addButton(action, row);
    section.append(row);
    if (current && ranked.slice(3).some(({ kind }) => kind === "command") && request.openCommands) {
      const commands = document.createElement("button");
      commands.type = "button";
      commands.textContent = "更多命令";
      commands.onclick = () => {
        refreshContext();
        if (version === generation) request.openCommands?.();
      };
      row.append(commands);
    }
    const extra = ranked.slice(3).filter(({ kind }) => kind !== "command" || !request.openCommands);
    if (extra.length > 0 && current) {
      const more = document.createElement("details");
      const label = document.createElement("summary");
      label.textContent = "更多动作";
      const menu = document.createElement("div");
      menu.className = "buttons";
      for (const action of extra) addButton(action, menu);
      more.append(label, menu);
      section.append(more);
    }
    section.append(status);
    shadow.append(css, section);
    return node;
  }

  // 只保留影响卡片结构的内容（动作列表、推荐动作、调用 ID/状态），
  // 忽略 updated_at/updatedAt 等时间戳和 busy 抖动，避免按钮被反复重建而闪烁。
  function stableSignature(snapshot: TurnActionsSnapshot, err: string): string {
    const judgment = snapshot.recommendation;
    return JSON.stringify([
      err,
      snapshot.sourceTurnId,
      snapshot.latestTurnId,
      snapshot.private,
      snapshot.actions.map((a) => [a.actionId, a.version, a.enabled, a.disabledReason]),
      judgment
        ? [
            judgment.state,
            judgment.source,
            judgment.model,
            judgment.features,
            judgment.actions.map((r) => [r.action_id, r.version, r.confidence, r.reason]),
          ]
        : null,
      snapshot.invocations.map((i) => [i.invocationId, i.actionId, i.version, i.state, i.message]),
    ]);
  }

  function render() {
    if (!context || unsupported) return;
    const anchors = turnAnchors(context);
    for (const [turnId, snapshot] of snapshots) {
      if (snapshot.private) {
        cards.get(turnId)?.node.remove();
        cards.delete(turnId);
        continue;
      }
      const anchor = anchors.get(turnId);
      if (!anchor && snapshot.latestTurnId !== turnId) {
        cards.get(turnId)?.node.remove();
        cards.delete(turnId);
        snapshots.delete(turnId);
        historyRead.delete(turnId);
        continue;
      }
      const signature = stableSignature(snapshot, error);
      let card = cards.get(turnId);
      // 正在填写参数时保留表单与焦点，执行端仍会重新校验真实上下文。
      if (!card || (card.signature !== signature && !card.node.shadowRoot?.querySelector("form"))) {
        const node = build(snapshot, context);
        card?.node.replaceWith(node);
        card = { node, signature };
        cards.set(turnId, card);
      }
      if (anchor) {
        if (card.node.parentElement !== anchor) anchor.append(card.node);
      } else if (card.node.nextElementSibling !== context.composer)
        context.composer.before(card.node);
    }
  }
  async function poll() {
    if (disposed) return;
    refreshContext();
    if (
      document.hidden ||
      !context ||
      unsupported ||
      reading === generation ||
      Date.now() < nextRead
    ) {
      // 节流期间不再每个 500ms 都跑一次全量 turnAnchors（对每个回合 getClientRects
      // 会触发强制布局）。快照只在 fetch 完成后变化，fetch 路径自身会调用 render()；
      // 卡片挂在回合锚点内部，锚点被原生虚拟化移除时卡片也随之脱离 DOM，无需再扫描。
      return;
    }
    const request = context;
    if (!request.client.inspectTurnActions) return;
    const version = generation;
    reading = version;
    nextRead = Date.now() + 2_000;
    try {
      const snapshot = await request.client.inspectTurnActions({
        threadId: request.threadId as TurnActionsSnapshot["threadId"],
      });
      if (version !== generation || disposed) return;
      if (snapshot.threadId !== request.threadId) throw new Error("动作结果所属聊天不匹配");
      if (snapshot.private) {
        clear();
        return;
      }
      for (const [id, previous] of snapshots)
        snapshots.set(id, {
          ...previous,
          latestTurnId: snapshot.latestTurnId,
          busy: snapshot.busy,
        });
      if (snapshot.sourceTurnId) snapshots.set(snapshot.sourceTurnId, snapshot);
      error = "";
      render();
      const historical = [...turnAnchors(request).keys()]
        .filter((id) => id !== snapshot.latestTurnId && Date.now() >= (historyRead.get(id) ?? 0))
        .slice(0, 4);
      for (const id of historical) {
        historyRead.set(id, Date.now() + 30_000);
        const prior = await request.client.inspectTurnActions({
          threadId: snapshot.threadId,
          sourceTurnId: id,
        });
        if (version !== generation || disposed) return;
        if (prior.threadId !== request.threadId || prior.sourceTurnId !== id)
          throw new Error("历史动作回合不匹配");
        snapshots.set(id, prior);
      }
    } catch (cause) {
      if (version !== generation || disposed) return;
      if (cause instanceof RendererMethodUnavailableError) {
        unsupported = true;
        clear();
      } else error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (reading === version) reading = null;
      if (version === generation && !disposed) render();
    }
  }
  const timer = window.setInterval(() => void poll(), 500);
  void poll();
  return {
    dispose() {
      disposed = true;
      generation++;
      window.clearInterval(timer);
      clear();
    },
  };
}
