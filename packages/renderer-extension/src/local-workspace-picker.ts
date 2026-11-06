import {
  LOCAL_WORKSPACE_DIRECTORIES_METHOD,
  gitRepositoryDirectoriesSchema,
  type GitRepositoryDirectories,
} from "@codexhost/shared-contracts";
import type { localWorkspaceMessages } from "./local-workspace-messages.js";

/** 浏览本机目录；仅确认选择时修改落点，取消和迟到响应都保留原路径。 */
export function createLocalWorkspacePicker(options: {
  document: Document;
  copy: ReturnType<typeof localWorkspaceMessages>;
  request(method: string, params: unknown): Promise<unknown>;
  onSelect(path: string): void;
}) {
  const { document, copy } = options;
  const panel = document.createElement("div");
  panel.setAttribute("data-local-workspace-picker", "");
  panel.hidden = true;
  const heading = document.createElement("div");
  const listing = document.createElement("div");
  listing.style.cssText = "max-height:220px;overflow:auto;display:grid;gap:4px";
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  const button = (text: string) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    return element;
  };
  const up = button(copy.up);
  const home = button(copy.home);
  const select = button(copy.selectDirectory);
  const cancel = button(copy.cancelPicker);
  panel.append(heading, up, home, listing, status, select, cancel);
  let generation = 0;
  let current: GitRepositoryDirectories | null = null;
  const close = () => {
    generation++;
    panel.hidden = true;
  };
  const load = async (path?: string) => {
    const request = ++generation;
    current = null;
    up.disabled = true;
    select.disabled = true;
    listing.replaceChildren();
    status.textContent = copy.loadingDirectories;
    try {
      const result = gitRepositoryDirectoriesSchema.parse(
        await options.request(LOCAL_WORKSPACE_DIRECTORIES_METHOD, path ? { path } : {}),
      );
      if (request !== generation || panel.hidden) return;
      current = result;
      heading.textContent = result.path;
      up.disabled = result.parent === null;
      select.disabled = false;
      status.textContent = result.truncated ? copy.truncatedDirectories : "";
      for (const entry of result.entries) {
        const row = button(`📁 ${entry.name}`);
        row.addEventListener("click", () => {
          void load(entry.path);
        });
        listing.append(row);
      }
    } catch (error) {
      if (request === generation && !panel.hidden) status.textContent = copy.failed + String(error);
    }
  };
  up.addEventListener("click", () => {
    if (current?.parent) void load(current.parent);
  });
  home.addEventListener("click", () => {
    void load();
  });
  cancel.addEventListener("click", close);
  select.addEventListener("click", () => {
    if (!current) return;
    options.onSelect(current.path);
    close();
  });
  return {
    panel,
    open(path: string) {
      panel.hidden = false;
      void load(path);
    },
    close,
  };
}
