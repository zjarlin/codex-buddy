import {
  findRendererSettingsHeaderInsertionPoint,
  PROVIDERS_TRIGGER_ATTRIBUTE,
  RECOVERY_TRIGGER_ATTRIBUTE,
} from "../settings/trigger.js";

export interface RecoveryHeaderState {
  available: boolean;
  busy: boolean;
  loading: boolean;
  batch: boolean;
  count: number;
  completed: number;
  total: number | null;
  succeeded: number;
  error: string;
  unreadable: number;
  vanished: number;
}

// 顶部与输入区共用同一个恢复会话状态；此模块只负责展示和定位。
export function createRecoveryHeader(
  getLocale: () => "zh-CN" | "en",
  onResume: () => Promise<void>,
) {
  const root = document.createElement("div");
  root.setAttribute(RECOVERY_TRIGGER_ATTRIBUTE, "");
  Object.assign(root.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    flex: "0 1 auto",
    minWidth: "0",
    marginInline: "4px",
    pointerEvents: "auto",
  });
  root.style.setProperty("-webkit-app-region", "no-drag");
  const button = document.createElement("button");
  button.type = "button";
  Object.assign(button.style, {
    flex: "0 0 auto",
    whiteSpace: "nowrap",
    padding: "5px 9px",
    border: "1px solid light-dark(#b7cfee, #345477)",
    borderRadius: "7px",
    background: "light-dark(#eaf2fd, #1b304b)",
    color: "light-dark(#185bb1, #93c5fd)",
    font: "500 12px system-ui",
    outlineOffset: "2px",
  });
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  Object.assign(status.style, {
    font: "11px system-ui",
    maxWidth: "240px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  root.append(button, status);
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void onResume();
  };
  button.addEventListener("click", onClick);
  let signature = "";
  let disposed = false;

  return {
    update(state: RecoveryHeaderState) {
      const zh = getLocale() === "zh-CN";
      const key = JSON.stringify([zh, state]);
      if (disposed || key === signature) return;
      signature = key;
      const label = zh ? "一键恢复中断会话" : "Resume interrupted chats";
      const progress = `${state.completed}/${state.total ?? 0}`;
      button.textContent = state.loading
        ? zh
          ? "正在补录历史中断…"
          : "Importing interrupted history…"
        : state.batch
          ? zh
            ? `正在恢复 ${progress}`
            : `Resuming ${progress}`
          : `${label}${state.count > 0 ? ` (${state.count})` : ""}`;
      button.setAttribute("aria-label", button.textContent);
      button.disabled = !state.available || state.busy || state.count === 0;
      button.style.opacity = button.disabled ? "0.55" : "1";
      button.style.cursor = button.disabled ? "default" : "pointer";
      button.title = zh
        ? "逐条恢复当前连接的中断队列，沿用各会话的模型设置。"
        : "Resume queued interrupted chats on this connection, keeping each chat's model.";
      let result = "";
      if (!state.available) {
        result = zh ? "当前连接无法恢复" : "Recovery unavailable on this connection";
      } else if (!state.busy && state.total !== null) {
        const failed = Math.max(0, state.completed - state.succeeded - state.vanished);
        result =
          state.total === 0
            ? zh
              ? "暂无中断会话"
              : "No interrupted chats"
            : zh
              ? `已提交恢复 ${state.succeeded}，失败 ${failed}`
              : `Resume submitted: ${state.succeeded}; failed: ${failed}`;
      }
      if (state.vanished > 0) {
        result += `${result ? " · " : ""}${
          zh
            ? `已清理 ${state.vanished} 条已不存在的会话`
            : `removed ${state.vanished} missing chats`
        }`;
      }
      if (state.unreadable > 0) {
        result += `${result ? " · " : ""}${state.unreadable} ${zh ? "条历史无法读取" : "unreadable histories"}`;
      }
      if (state.error) result += `${result ? " · " : ""}${state.error}`;
      status.textContent = result;
      status.title = result;
      status.style.color = state.error ? "light-dark(#b42318, #ff8b82)" : "inherit";
    },
    reposition(): void {
      if (disposed) return;
      const point = findRendererSettingsHeaderInsertionPoint(document);
      if (!point) {
        root.remove();
        return;
      }
      const provider = point.parent.querySelector(`[${PROVIDERS_TRIGGER_ATTRIBUTE}]`);
      if (provider?.parentElement === point.parent) {
        if (provider.nextSibling !== root) point.parent.insertBefore(root, provider.nextSibling);
      } else if (root.parentElement !== point.parent) {
        point.parent.insertBefore(root, point.before);
      }
    },
    dispose() {
      disposed = true;
      button.removeEventListener("click", onClick);
      root.remove();
    },
  };
}
