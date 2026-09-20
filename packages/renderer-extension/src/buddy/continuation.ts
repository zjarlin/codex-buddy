import createElement from "lucide/dist/esm/createElement.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import type { RendererModelClient } from "../renderer-model-client.js";

export function interruptedControl(client: RendererModelClient, chinese: boolean): HTMLElement {
  const section = document.createElement("section");
  section.dataset.buddyInterrupted = "";
  const load = document.createElement("button");
  load.type = "button";
  load.append(
    createElement(RefreshCw, { width: 14, height: 14 }),
    document.createTextNode(chinese ? " 最近中断会话" : " Recent interrupted conversations"),
  );
  const list = document.createElement("div");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  section.append(load, list, status);
  load.addEventListener("click", () => {
    load.disabled = true;
    status.textContent = chinese ? "读取中…" : "Loading…";
    void (async () => {
      try {
        if (!client.buddyInterrupted) throw new Error("Continuation unavailable");
        const result = await client.buddyInterrupted();
        list.replaceChildren();
        status.textContent = result.unreadable
          ? chinese
            ? `${result.unreadable} 个会话历史不可读`
            : `${result.unreadable} histories unavailable`
          : result.threads.length
            ? ""
            : chinese
              ? "最近 30 个会话中没有已确认的中断"
              : "No confirmed interruptions in the last 30 conversations";
        for (const thread of result.threads) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:8px";
          const title = document.createElement("a");
          title.href = `codex://threads/${encodeURIComponent(thread.threadId)}`;
          title.textContent = thread.title;
          title.style.cssText = "flex:1;min-width:0;overflow-wrap:anywhere;color:inherit";
          const resume = document.createElement("button");
          resume.type = "button";
          resume.textContent = chinese ? "一键继续" : "Continue";
          resume.style.flexShrink = "0";
          resume.addEventListener("click", () => {
            resume.disabled = true;
            void (async () => {
              try {
                if (!client.buddyContinue) throw new Error("Continuation unavailable");
                await client.buddyContinue(thread.threadId, thread.turnId);
                status.textContent = "";
                resume.textContent = chinese ? "已续接" : "Continued";
              } catch (error) {
                status.textContent = error instanceof Error ? error.message : String(error);
                resume.disabled = false;
              }
            })();
          });
          row.append(title, resume);
          list.append(row);
        }
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        load.disabled = false;
      }
    })();
  });
  return section;
}
