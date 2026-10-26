import type { RendererModelClient } from "../renderer-model-client.js";
import type { ModelShortcutView } from "../renderer-model-shortcuts.js";
import type { InterruptedQueue } from "./interrupted-queue.js";
import { createInterruptedPanel } from "./interrupted-panel.js";

const style = `
[data-buddy-recovery]{font:12px/1.5 system-ui;color:inherit;margin:6px 0;max-width:100%}
[data-buddy-recovery] .buddy-interrupted{display:flex;flex-direction:column;gap:5px;margin:5px 0}
[data-buddy-recovery] .buddy-interrupted-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
[data-buddy-recovery] .buddy-interrupted-heading{display:inline-flex;align-items:center;justify-content:flex-start;gap:4px;flex:1 0 auto;min-width:0;padding:0;border:0;border-radius:0;background:transparent;font:inherit;text-align:left;white-space:nowrap;cursor:pointer}
[data-buddy-recovery] .buddy-interrupted-heading:hover{background:transparent;opacity:.8}
[data-buddy-recovery] .buddy-interrupted-heading b{font-size:11px;font-weight:500}
[data-buddy-recovery] .buddy-interrupted-count{min-width:16px;padding:0 5px;border-radius:999px;font-size:10px;text-align:center;background:color-mix(in srgb,currentColor 14%,transparent)}
[data-buddy-recovery] .buddy-interrupted-model-resume{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto;max-width:100%}
[data-buddy-recovery] :is(select,input){min-width:0;max-width:220px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:6px;padding:3px 6px;font:inherit;height:26px;background:color-mix(in srgb,currentColor 4%,transparent);color:inherit}
[data-buddy-recovery] button{display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;font:inherit;background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;padding:4px 8px;cursor:pointer}
[data-buddy-recovery] button:disabled{opacity:.55;cursor:default}
[data-buddy-recovery] :is(button,select,input):focus-visible{outline:2px solid #4385ff;outline-offset:2px}
[data-buddy-recovery] .buddy-interrupted-note{font-size:11px;opacity:.65}
[data-buddy-recovery] .buddy-interrupted-list{display:flex;flex-direction:column;gap:4px;min-width:0;max-height:min(38vh,300px);overflow-y:auto;overscroll-behavior:contain}
[data-buddy-recovery] .buddy-interrupted-item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-width:0;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:7px;padding:6px 7px}
[data-buddy-recovery] .buddy-interrupted-actions{display:flex;gap:6px}
[data-buddy-recovery] .buddy-interrupted-copy{min-width:0}
[data-buddy-recovery] .buddy-interrupted-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
[data-buddy-recovery] .buddy-interrupted-status{display:block;margin-top:2px;font-size:10px;opacity:.65}
[data-buddy-recovery] .buddy-interrupted-error{color:#d65f55;overflow-wrap:anywhere}
[data-buddy-recovery] option{background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:inherit}
`;

export interface BuddyControlContext {
  anchor: Element;
  hostId: string;
  threadId: string | null;
  client: RendererModelClient;
}

// 输入区只保留会话恢复，路由设置由设置窗口管理。
export function installBuddyControl(
  getContext: () => BuddyControlContext | null,
  getLocale: () => "zh-CN" | "en",
  options: {
    queue: InterruptedQueue;
    getRecoveryContext?: () => { client: RendererModelClient; hostId: string } | null;
    onResumed?: () => void;
    openThread?: (threadId: string, options: { hostId: string }) => Promise<void>;
  },
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
  const interrupted = createInterruptedPanel(
    getLocale,
    options.queue,
    options.onResumed,
    options.openThread,
  );
  recovery.append(styles, interrupted.root);
  let client: RendererModelClient | null = null;
  let hostId: string | null = null;
  let disposed = false;
  let modelView: ModelShortcutView | null = null;
  let harnessId = "";
  const render = (): void => {
    interrupted.update(client, modelView, harnessId, hostId);
  };
  const refreshContext = (): void => {
    const next = disposed ? null : getContext();
    const fallback = disposed ? null : (next ?? options.getRecoveryContext?.());
    const nextClient = fallback?.client ?? null;
    const nextHostId = fallback?.hostId ?? null;
    client = nextClient;
    hostId = nextHostId;
    render();
    interrupted.repositionHeader();
    if (!next) {
      recovery.remove();
      return;
    }
    const shortcuts = Array.from(next.anchor.parentElement?.children ?? []).find((element) =>
      element.hasAttribute("data-codexhost-model-shortcuts"),
    );
    const anchor = shortcuts ?? next.anchor;
    if (recovery.nextElementSibling !== anchor) anchor.before(recovery);
  };
  const refresh = async (): Promise<void> => {
    if (!disposed) refreshContext();
  };
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
      interrupted.dispose();
      recovery.remove();
    },
  };
}
