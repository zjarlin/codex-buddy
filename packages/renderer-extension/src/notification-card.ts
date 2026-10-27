import createElement from "lucide/dist/esm/createElement.mjs";
import X from "lucide/dist/esm/icons/x.mjs";

/**
 * 通知卡片外壳：完成提醒与定时提醒共用同一套居中的非模态弹窗。
 * 只提供背景遮罩、面板、标题行、正文容器、提示行与操作栏；
 * 内容与按钮由各自的功能模块填充，样式按属性选择器统一作用。
 */
export interface NotificationCard {
  modal: HTMLDivElement;
  panel: HTMLElement;
  heading: HTMLElement;
  headingText: HTMLElement;
  title: HTMLHeadingElement;
  queue: HTMLButtonElement;
  close: HTMLButtonElement;
  body: HTMLElement;
  notice: HTMLParagraphElement;
  actions: HTMLElement;
  dispose(): void;
}

const SHELL_STYLE_ATTRIBUTE = "data-codexhost-notification-card-style";

const style = `
[data-codexhost-card]{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:color-mix(in srgb, CanvasText 14%, transparent);pointer-events:none;font:13px/1.5 system-ui,sans-serif}
[data-codexhost-card][hidden]{display:none}
[data-codexhost-card-panel]{display:flex;flex-direction:column;box-sizing:border-box;width:min(880px,calc(100vw - 48px));max-height:min(820px,calc(100vh - 64px));overflow:hidden;border:1px solid color-mix(in srgb, CanvasText 18%, transparent);border-radius:10px;background:Canvas;color:CanvasText;box-shadow:0 18px 60px rgb(0 0 0 / 24%);pointer-events:auto}
[data-codexhost-card] header{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid color-mix(in srgb, CanvasText 12%, transparent)}
[data-codexhost-card] header h2{min-width:0;margin:0;font-size:15px;line-height:22px}
[data-codexhost-card] header > div{min-width:0;flex:1}
[data-codexhost-card-queue]{display:inline-flex;align-items:center;min-height:24px;margin-top:2px;padding:2px 7px;border:0;border-radius:999px;background:color-mix(in srgb, Highlight 14%, transparent);color:CanvasText;font:12px/18px inherit;cursor:pointer}
[data-codexhost-card-queue][hidden]{display:none}
[data-codexhost-card] button:focus-visible{outline:2px solid Highlight;outline-offset:1px}
[data-codexhost-card] .codexhost-card-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:CanvasText;cursor:pointer}
[data-codexhost-card] .codexhost-card-icon:hover:not(:disabled){background:color-mix(in srgb,CanvasText 10%,transparent)}
[data-codexhost-card] .codexhost-card-icon:disabled{opacity:.55;cursor:wait}
[data-codexhost-card-body]{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding:18px 20px}
[data-codexhost-card] footer{display:flex;align-items:center;justify-content:space-between;gap:16px 24px;padding:12px 16px;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent);flex-wrap:wrap}
[data-codexhost-card] footer button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:6px 11px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:6px;background:transparent;color:CanvasText;font:inherit;cursor:pointer}
[data-codexhost-card] footer button:hover:not(:disabled){background:color-mix(in srgb,CanvasText 8%,transparent)}
[data-codexhost-card] footer button[data-primary="true"]{border-color:Highlight;background:Highlight;color:HighlightText}
[data-codexhost-card] footer button[data-primary="true"]:hover:not(:disabled){background:Highlight}
[data-codexhost-card] footer button:disabled{opacity:.55;cursor:wait}
[data-codexhost-card] .codexhost-card-notice{min-height:18px;margin:-6px 16px 0;color:#c2410c;font-size:12px;overflow-wrap:anywhere}
[data-codexhost-card] .codexhost-card-notice:empty{visibility:hidden}
@media (max-width:520px){[data-codexhost-card]{padding:8px}[data-codexhost-card-panel]{width:calc(100vw - 16px);max-height:calc(100vh - 16px)}[data-codexhost-card-body]{padding:14px}[data-codexhost-card] footer{flex-direction:column;align-items:stretch;gap:10px}[data-codexhost-card] footer button{flex:1 1 auto}}
`;

export function createNotificationCard(options: {
  /** 卡片背景遮罩上的属性，供各功能模块与测试按身份定位。 */
  attribute: string;
  panelAttribute: string;
  queueAttribute: string;
  closeLabel(): string;
}): NotificationCard {
  const previous = document.querySelector<HTMLStyleElement>(`style[${SHELL_STYLE_ATTRIBUTE}]`);
  if (!previous) {
    const element = document.createElement("style");
    element.setAttribute(SHELL_STYLE_ATTRIBUTE, "");
    element.textContent = style;
    document.head.append(element);
  }

  const modal = document.createElement("div");
  const panel = document.createElement("section");
  const heading = document.createElement("header");
  const headingText = document.createElement("div");
  const title = document.createElement("h2");
  const queue = document.createElement("button");
  const close = document.createElement("button");
  const body = document.createElement("div");
  const notice = document.createElement("p");
  const actions = document.createElement("footer");

  modal.setAttribute("data-codexhost-card", "");
  modal.setAttribute(options.attribute, "");
  modal.setAttribute("role", "dialog");
  // 非模态：用户可以在提醒存在时继续操作桌面其余部分。
  modal.setAttribute("aria-modal", "false");
  panel.setAttribute("data-codexhost-card-panel", "");
  panel.setAttribute(options.panelAttribute, "");
  queue.type = "button";
  queue.hidden = true;
  queue.setAttribute(options.queueAttribute, "");
  queue.setAttribute("data-codexhost-card-queue", "");
  headingText.append(title, queue);
  close.type = "button";
  close.className = "codexhost-card-icon";
  close.append(createElement(X, { width: 17, height: 17, "aria-hidden": "true" }));
  close.title = options.closeLabel();
  close.setAttribute("aria-label", options.closeLabel());
  heading.append(headingText, close);
  body.setAttribute("data-codexhost-card-body", "");
  notice.className = "codexhost-card-notice";
  notice.setAttribute("role", "alert");
  actions.append(...[]);
  panel.append(heading, body, notice, actions);
  modal.append(panel);
  document.body.append(modal);

  return {
    modal,
    panel,
    heading,
    headingText,
    title,
    queue,
    close,
    body,
    notice,
    actions,
    dispose() {
      modal.remove();
    },
  };
}
