import type { GitLogResult } from "@codexhost/shared-contracts";
import type { RendererGitContext } from "./renderer-git-sidebar.js";
import type { RendererGitCache } from "./renderer-git-cache.js";
import { gitTargetKey, hasGitTarget } from "./renderer-git-target.js";

// 以真实父提交分配轨道；图底部仍延伸的线表示更早的历史未在当前批次中显示。
export function gitHistoryGraph(commits: GitLogResult["commits"]) {
  let lanes: string[] = [];
  return commits.map((commit) => {
    const incoming = [...lanes];
    let column = lanes.indexOf(commit.commit);
    if (column < 0) {
      column = lanes.length;
      lanes.push(commit.commit);
    }
    const next = lanes.filter((id) => id !== commit.commit);
    for (const parent of commit.parents) {
      if (!next.includes(parent)) next.splice(Math.min(column, next.length), 0, parent);
    }
    const lines: { from: number; to: number; half: "top" | "bottom" | "full" }[] = incoming.flatMap(
      (id, from) =>
        id === commit.commit
          ? { from, to: column, half: "top" as const }
          : { from, to: next.indexOf(id), half: "full" as const },
    );
    lines.push(
      ...commit.parents.map((id) => ({
        from: column,
        to: next.indexOf(id),
        half: "bottom" as const,
      })),
    );
    const width = Math.max(lanes.length, next.length, 1);
    lanes = next;
    return { column, width, lines };
  });
}

export function createGitHistory(document: Document, cache: RendererGitCache) {
  const root = document.createElement("div");
  root.className = "codexhost-git-history";
  root.hidden = true;
  const title = document.createElement("div");
  title.className = "codexhost-git-history-title";
  title.textContent = "提交历史 · 本地与远端跟踪引用";
  const list = document.createElement("div");
  list.className = "codexhost-git-history-list";
  root.append(title, list);
  let version = 0;
  let context: RendererGitContext | null = null;
  let loading = false;
  let rendered: GitLogResult | null = null;
  const notice = (message: string) => {
    const text = document.createElement("p");
    text.className = "codexhost-git-empty";
    text.setAttribute("role", "status");
    text.textContent = message;
    list.replaceChildren(text);
  };
  const render = (result: GitLogResult) => {
    if (rendered === result) return;
    rendered = result;
    if (!result.commits.length) return notice("暂无提交历史");
    const graph = gitHistoryGraph(result.commits);
    const width = Math.max(...graph.map((row) => row.width)) * 14 + 12;
    const fragment = document.createDocumentFragment();
    for (const [index, commit] of result.commits.entries()) {
      const row = document.createElement("div");
      row.className = "codexhost-git-history-row";
      row.style.gridTemplateColumns = `${width}px minmax(0,1fr)`;
      row.title = `${commit.commit}\n${commit.subject}\n${commit.authorName} · ${commit.authoredAt}`;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${width} 48`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", "28");
      svg.setAttribute("aria-hidden", "true");
      const layout = graph[index];
      if (!layout) continue;
      const color = (column: number) =>
        ["#339cff", "#b284e8", "#40ad8c", "#da9b38"][column % 4] ?? "#339cff";
      for (const edge of layout.lines) {
        const line = document.createElementNS(svg.namespaceURI, "path");
        const y1 = edge.half === "bottom" ? 24 : 0;
        const y2 = edge.half === "top" ? 24 : 48;
        line.setAttribute("d", `M${edge.from * 14 + 10} ${y1} L${edge.to * 14 + 10} ${y2}`);
        line.setAttribute("stroke", color(edge.from));
        line.setAttribute("stroke-width", "2");
        svg.append(line);
      }
      const dot = document.createElementNS(svg.namespaceURI, "circle");
      dot.setAttribute("cx", String(layout.column * 14 + 10));
      dot.setAttribute("cy", "24");
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", color(layout.column));
      svg.append(dot);
      const body = document.createElement("div");
      body.className = "codexhost-git-history-body";
      const subject = document.createElement("strong");
      subject.textContent = commit.subject || "（无提交说明）";
      const meta = document.createElement("span");
      const refs = [
        ...new Set(
          [
            ...result.refs.filter((ref) => ref.commit === commit.commit).map((ref) => ref.name),
            ...commit.refs,
          ].map((name) =>
            name.replace(/^(HEAD -> |tag: )/u, "").replace(/^refs\/(heads|remotes|tags)\//u, ""),
          ),
        ),
      ];
      meta.title = `${refs.join("\n")}\n${commit.authorName} · ${commit.authoredAt}`;
      const author = document.createElement("span");
      author.textContent = commit.authorName;
      author.title = `${commit.authorName} · ${commit.authoredAt}`;
      meta.className = "codexhost-git-ref";
      meta.textContent = refs.join(" · ");
      body.append(subject, author);
      if (refs.length) body.append(meta);
      row.append(svg, body);
      fragment.append(row);
    }
    list.replaceChildren(fragment);
  };
  const reset = () => {
    version++;
    context = null;
    rendered = null;
    loading = false;
    list.replaceChildren();
  };
  return {
    root,
    reset,
    async load(request: RendererGitContext) {
      const same =
        context?.client === request.client &&
        context?.hostId === request.hostId &&
        gitTargetKey(context ?? {}) === gitTargetKey(request) &&
        context?.repository === request.repository;
      if (!same) reset();
      if (loading) return;
      context = request;
      if (!request.client || !hasGitTarget(request)) return notice("未选择可用的 Git 工作区。");
      const currentVersion = version;
      loading = true;
      if (!rendered) notice("正在读取提交历史…");
      try {
        const result = await cache.history(request.client, request, request.repository);
        if (currentVersion === version) render(result);
      } catch (error) {
        if (currentVersion === version) {
          rendered = null;
          notice(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (currentVersion === version) loading = false;
      }
    },
  };
}
