import type { RendererModelClient } from "../renderer-model-client.js";
import type { ModelShortcutView } from "../renderer-model-shortcuts.js";
import { createInterruptedPanel } from "./interrupted-panel.js";
import { RendererMethodUnavailableError } from "../renderer-request-sender.js";
import { BUDDY_SETTINGS_CHANGED_EVENT } from "./settings-events.js";

const style = `
[data-buddy-recovery]{font:12px/1.5 system-ui;color:inherit;margin:6px 0;max-width:100%}
[data-buddy-recovery] .buddy-interrupted{display:flex;flex-direction:column;gap:5px;margin:5px 0}
[data-buddy-recovery] .buddy-interrupted-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
[data-buddy-recovery] .buddy-interrupted-toolbar b{flex:1 0 auto;white-space:nowrap;font-size:11px;font-weight:500}
[data-buddy-recovery] .buddy-interrupted-model-resume{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto;max-width:100%}
[data-buddy-recovery] :is(select,input){min-width:0;max-width:220px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:6px;padding:3px 6px;font:inherit;height:26px;background:color-mix(in srgb,currentColor 4%,transparent);color:inherit}
[data-buddy-recovery] button{display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;font:inherit;background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;padding:4px 8px;cursor:pointer}
[data-buddy-recovery] button:disabled{opacity:.55;cursor:default}
[data-buddy-recovery] :is(button,select,input):focus-visible{outline:2px solid #4385ff;outline-offset:2px}
[data-buddy-recovery] .buddy-interrupted-note{font-size:11px;opacity:.65}
[data-buddy-recovery] .buddy-interrupted-list{display:flex;flex-direction:column;gap:4px;min-width:0}
[data-buddy-recovery] .buddy-interrupted-item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-width:0;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:7px;padding:6px 7px}
[data-buddy-recovery] .buddy-interrupted-copy{min-width:0}
[data-buddy-recovery] .buddy-interrupted-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
[data-buddy-recovery] .buddy-interrupted-status{display:block;margin-top:2px;font-size:10px;opacity:.65}
[data-buddy-recovery] .buddy-interrupted-error{color:#d65f55;overflow-wrap:anywhere}
[data-buddy-recovery] option{background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:inherit}
`;

export interface BuddyControlContext {
  anchor: Element;
  threadId: string | null;
  client: RendererModelClient;
}

// 输入区只保留会话恢复，路由设置由设置窗口管理。
export function installBuddyControl(
  getContext: () => BuddyControlContext | null,
  getLocale: () => "zh-CN" | "en",
): {
  dispose(): void;
  refresh(): Promise<void>;
  refreshContext(): void;
  setModelShortcutsView(view: ModelShortcutView | null, harnessId: string): void;
} {
  const recovery = document.createElement("section");
  recovery.dataset.buddyRecovery = "";
  const styles = document.createElement("style");
  styles.textContent = style;
  const interrupted = createInterruptedPanel(getLocale);
  recovery.append(styles, interrupted.root);
  let context: BuddyControlContext | null = null;
  let disposed = false;
  let epoch = 0;
  let privateMode = true;
  let modelView: ModelShortcutView | null = null;
  let harnessId = "";
  let pending: { client: RendererModelClient; epoch: number; promise: Promise<void> } | null = null;
  const render = (): void => {
    interrupted.update(context?.client ?? null, privateMode, modelView, harnessId);
  };
  const refreshContext = (): void => {
    const next = disposed ? null : getContext();
    const changed = context?.client !== next?.client;
    if (changed) {
      epoch += 1;
      privateMode = true;
    }
    context = next;
    render();
    if (!next) {
      recovery.remove();
      return;
    }
    const shortcuts = Array.from(next.anchor.parentElement?.children ?? []).find((element) =>
      element.hasAttribute("data-codexhost-model-shortcuts"),
    );
    const anchor = shortcuts ?? next.anchor;
    if (recovery.nextElementSibling !== anchor) anchor.before(recovery);
    if (changed) void readStatus(next);
  };
  function readStatus(target: BuddyControlContext): Promise<void> {
    const generation = epoch;
    if (pending?.client === target.client && pending.epoch === generation) return pending.promise;
    const promise = (async () => {
      try {
        const snapshot = await target.client.buddyStatus?.();
        if (disposed || context?.client !== target.client || epoch !== generation) return;
        privateMode = snapshot?.settings.privateMode ?? false;
      } catch (error) {
        // 恢复接口独立探测；不支持路由的官方连接仍可能提供会话恢复。
        if (disposed || context?.client !== target.client || epoch !== generation) return;
        privateMode = !(error instanceof RendererMethodUnavailableError);
      }
      render();
    })();
    pending = { client: target.client, epoch: generation, promise };
    void promise.finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    return promise;
  }
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    refreshContext();
    if (context) await readStatus(context);
  };
  const settingsChanged = (): void => {
    void refresh();
  };
  window.addEventListener(BUDDY_SETTINGS_CHANGED_EVENT, settingsChanged);
  void refresh();
  return {
    refresh,
    refreshContext,
    setModelShortcutsView(view, nextHarnessId) {
      modelView = view;
      harnessId = nextHarnessId;
      render();
    },
    dispose() {
      disposed = true;
      epoch += 1;
      window.removeEventListener(BUDDY_SETTINGS_CHANGED_EVENT, settingsChanged);
      interrupted.dispose();
      recovery.remove();
    },
  };
}
