import type {
  ProjectSyncAddParams,
  ProjectSyncBindParams,
  ProjectSyncCloneParams,
  ProjectSyncGitConfigureParams,
  ProjectSyncInvite,
  ProjectSyncPairParams,
  ProjectSyncPeerParams,
  ProjectSyncRequestParams,
  ProjectSyncSnapshot,
} from "@codexhost/shared-contracts";

export interface RendererProjectSyncClient {
  inspectProjectSync(): Promise<ProjectSyncSnapshot>;
  inviteProjectSync(): Promise<ProjectSyncInvite>;
  pairProjectSync(input: ProjectSyncPairParams): Promise<ProjectSyncSnapshot>;
  acceptProjectSync(input: ProjectSyncRequestParams): Promise<ProjectSyncSnapshot>;
  rejectProjectSync(input: ProjectSyncRequestParams): Promise<ProjectSyncSnapshot>;
  configureProjectSyncGit(input: ProjectSyncGitConfigureParams): Promise<ProjectSyncSnapshot>;
  pullProjectSyncGit(): Promise<ProjectSyncSnapshot>;
  pushProjectSyncGit(): Promise<ProjectSyncSnapshot>;
  syncProjectSync(input: ProjectSyncPeerParams): Promise<ProjectSyncSnapshot>;
  removeProjectSyncPeer(input: ProjectSyncPeerParams): Promise<ProjectSyncSnapshot>;
  addProjectSync(input: ProjectSyncAddParams): Promise<ProjectSyncSnapshot>;
  bindProjectSync(input: ProjectSyncBindParams): Promise<ProjectSyncSnapshot>;
  cloneProjectSync(input: ProjectSyncCloneParams): Promise<ProjectSyncSnapshot>;
}

export interface RendererProjectSyncPanel {
  readonly panel: HTMLElement;
  activate(): void;
  deactivate(): void;
  refresh(): void;
  dispose(): void;
}

export const PROJECT_SYNC_PANEL_ATTRIBUTE = "data-codexhost-project-sync-panel";
export const PROJECT_SYNC_INVITE_ATTRIBUTE = "data-codexhost-project-sync-invite";
export const PROJECT_SYNC_CODE_ATTRIBUTE = "data-codexhost-project-sync-code";
export const PROJECT_SYNC_PAIR_ATTRIBUTE = "data-codexhost-project-sync-pair";
export const PROJECT_SYNC_SYNC_ATTRIBUTE = "data-codexhost-project-sync-sync";
export const PROJECT_SYNC_ADD_ATTRIBUTE = "data-codexhost-project-sync-add";

function iconButton(document: Document, label: string, pathValue: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", pathValue);
  svg.append(shape);
  button.append(svg);
  return button;
}

function actionButton(document: Document, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  return button;
}

function section(document: Document, title: string): HTMLElement {
  const element = document.createElement("section");
  element.className = "codexhost-project-sync-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  element.append(heading);
  return element;
}

function empty(document: Document, text: string): HTMLParagraphElement {
  const value = document.createElement("p");
  value.className = "codexhost-project-sync-empty";
  value.textContent = text;
  return value;
}

export function createRendererProjectSyncPanel(options: {
  ownerDocument: Document;
  container: ShadowRoot | HTMLElement;
  getClient(): RendererProjectSyncClient | null;
  signal?: AbortSignal;
}): RendererProjectSyncPanel {
  const document = options.ownerDocument;
  const ownerWindow = document.defaultView ?? window;
  const listenerOptions = options.signal ? { signal: options.signal } : undefined;
  const panel = document.createElement("section");
  panel.className = "codexhost-project-sync-panel";
  panel.setAttribute(PROJECT_SYNC_PANEL_ATTRIBUTE, "v1");
  panel.hidden = true;
  const style = document.createElement("style");
  style.textContent = `
    .codexhost-project-sync-panel { position:absolute; inset:0 0 0 38px; display:flex; min-width:0; flex-direction:column; overflow:hidden; color:var(--text-primary,inherit); background:var(--surface-primary,inherit); border-left:0; pointer-events:auto; }
    .codexhost-project-sync-panel[hidden] { display:none; }
    .codexhost-project-sync-head { display:flex; min-height:38px; align-items:center; gap:6px; padding:5px 7px 5px 11px; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 12%,transparent)); }
    .codexhost-project-sync-head strong { flex:0 0 auto; font-size:12px; }
    .codexhost-project-sync-head-status { min-width:0; flex:1; overflow:hidden; color:inherit; font-size:10px; opacity:.58; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-project-sync-head-status[data-state="online"] { color:var(--green,#3fa66a); opacity:.9; }
    .codexhost-project-sync-head-status[data-state="offline"] { color:var(--color-text-danger,#ef4444); opacity:.9; }
    .codexhost-project-sync-head button { display:grid; width:28px; height:28px; place-items:center; padding:0; color:inherit; background:transparent; border:0; border-radius:6px; cursor:pointer; }
    .codexhost-project-sync-head button:hover { background:color-mix(in srgb,currentColor 10%,transparent); }
    .codexhost-project-sync-body { display:flex; min-height:0; flex:1; flex-direction:column; gap:12px; padding:10px; overflow:auto; }
    .codexhost-project-sync-section { display:flex; min-width:0; flex-direction:column; gap:6px; }
    .codexhost-project-sync-section h3 { margin:0; font-size:11px; font-weight:600; }
    .codexhost-project-sync-section button { min-height:27px; padding:3px 8px; color:inherit; background:transparent; border:1px solid var(--border-default,color-mix(in srgb,currentColor 16%,transparent)); border-radius:5px; cursor:pointer; font-size:10px; }
    .codexhost-project-sync-section button:hover:not(:disabled) { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-project-sync-section button:disabled { cursor:default; opacity:.4; }
    .codexhost-project-sync-invite { display:flex; align-items:center; gap:8px; min-height:36px; padding:6px 8px; background:color-mix(in srgb,currentColor 5%,transparent); border:1px solid var(--border-default,color-mix(in srgb,currentColor 10%,transparent)); border-radius:6px; }
    .codexhost-project-sync-invite[hidden] { display:none; }
    .codexhost-project-sync-invite strong { font:600 19px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; letter-spacing:1px; }
    .codexhost-project-sync-invite span { color:inherit; font-size:10px; opacity:.58; }
    .codexhost-project-sync-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:6px; padding:6px 0; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 8%,transparent)); }
    .codexhost-project-sync-row-copy { min-width:0; }
    .codexhost-project-sync-row-copy strong { display:block; overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-project-sync-row-copy span { display:block; overflow:hidden; color:inherit; font-size:9px; opacity:.55; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-project-sync-row-actions { display:flex; flex:none; gap:4px; }
    .codexhost-project-sync-input-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:5px; }
    .codexhost-project-sync-input { box-sizing:border-box; width:100%; min-width:0; height:27px; padding:3px 7px; color:inherit; background:var(--surface-secondary,transparent); border:1px solid var(--border-default,color-mix(in srgb,currentColor 16%,transparent)); border-radius:5px; font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .codexhost-project-sync-notice { margin:0; color:var(--text-link,inherit); font-size:10px; line-height:1.45; overflow-wrap:anywhere; }
    .codexhost-project-sync-notice[data-state="error"] { color:var(--color-text-danger,#ef4444); }
    .codexhost-project-sync-notice[data-state="success"] { color:var(--green,#3fa66a); }
    .codexhost-project-sync-empty { margin:0; padding:1px 0 4px; color:inherit; font-size:10px; opacity:.55; }
    .codexhost-project-sync-project { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:5px; padding:6px 0; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 8%,transparent)); }
    .codexhost-project-sync-project-state { color:inherit; font-size:9px; opacity:.55; white-space:nowrap; }
    .codexhost-project-sync-project-state[data-ready="true"] { color:var(--green,#3fa66a); opacity:.9; }
    .codexhost-project-sync-project-actions { grid-column:1 / -1; display:flex; gap:4px; }
  `;
  const head = document.createElement("div");
  head.className = "codexhost-project-sync-head";
  const title = document.createElement("strong");
  title.textContent = "设备";
  const status = document.createElement("span");
  status.className = "codexhost-project-sync-head-status";
  const refresh = iconButton(document, "刷新设备", "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6");
  head.append(title, status, refresh);

  const body = document.createElement("div");
  body.className = "codexhost-project-sync-body";
  const pairing = section(document, "设备配对");
  const invite = actionButton(document, "生成配对码");
  invite.setAttribute(PROJECT_SYNC_INVITE_ATTRIBUTE, "v1");
  const inviteValue = document.createElement("div");
  inviteValue.className = "codexhost-project-sync-invite";
  inviteValue.hidden = true;
  const inviteCode = document.createElement("strong");
  const inviteHint = document.createElement("span");
  inviteHint.textContent = "5 分钟内有效";
  inviteValue.append(inviteCode, inviteHint);
  const code = document.createElement("input");
  code.className = "codexhost-project-sync-input";
  code.type = "text";
  code.inputMode = "numeric";
  code.maxLength = 8;
  code.autocomplete = "one-time-code";
  code.placeholder = "输入八位配对码";
  code.setAttribute("aria-label", "对端配对码");
  code.setAttribute(PROJECT_SYNC_CODE_ATTRIBUTE, "v1");
  const pair = actionButton(document, "配对");
  pair.setAttribute(PROJECT_SYNC_PAIR_ATTRIBUTE, "v1");
  const pairRow = document.createElement("div");
  pairRow.className = "codexhost-project-sync-input-row";
  pairRow.append(code, pair);
  pairing.append(invite, inviteValue, pairRow);

  const pending = section(document, "待确认");
  const pendingList = document.createElement("div");
  pending.append(pendingList);
  const peers = section(document, "已配对设备");
  const peerList = document.createElement("div");
  peers.append(peerList);
  const projects = section(document, "项目列表");
  const addProject = actionButton(document, "添加本机项目");
  addProject.setAttribute(PROJECT_SYNC_ADD_ATTRIBUTE, "v1");
  const projectList = document.createElement("div");
  projects.append(addProject, projectList);
  const notice = document.createElement("p");
  notice.className = "codexhost-project-sync-notice";
  notice.setAttribute("role", "status");
  body.append(pairing, pending, peers, projects, notice);
  panel.append(style, head, body);
  options.container.append(panel);

  let active = false;
  let busy = false;
  let disposed = false;
  let polling = false;
  let generation = 0;

  const setNotice = (message: string, state: "info" | "success" | "error" = "info"): void => {
    notice.textContent = message;
    notice.dataset.state = state;
  };

  const setBusy = (value: boolean): void => {
    busy = value;
    for (const control of panel.querySelectorAll<HTMLButtonElement>("button")) {
      control.disabled = value;
    }
  };

  const render = (snapshot: ProjectSyncSnapshot): void => {
    status.textContent = snapshot.relay
      ? snapshot.connected
        ? "中继已连接"
        : "正在连接中继"
      : "未配置中继";
    status.dataset.state = snapshot.relay ? (snapshot.connected ? "online" : "") : "offline";

    pendingList.replaceChildren();
    if (!snapshot.pending.length) pendingList.append(empty(document, "暂无待确认请求"));
    for (const request of snapshot.pending) {
      const row = document.createElement("div");
      row.className = "codexhost-project-sync-row";
      const copy = document.createElement("div");
      copy.className = "codexhost-project-sync-row-copy";
      const name = document.createElement("strong");
      name.textContent = request.name;
      const fingerprint = document.createElement("span");
      fingerprint.textContent = request.fingerprint;
      copy.append(name, fingerprint);
      const actions = document.createElement("div");
      actions.className = "codexhost-project-sync-row-actions";
      const accept = actionButton(document, "同意");
      const reject = actionButton(document, "拒绝");
      accept.addEventListener(
        "click",
        () =>
          void run(
            (client) => client.acceptProjectSync({ requestId: request.requestId }),
            "正在确认…",
            "设备已配对。",
          ),
        listenerOptions,
      );
      reject.addEventListener(
        "click",
        () =>
          void run(
            (client) => client.rejectProjectSync({ requestId: request.requestId }),
            "正在拒绝…",
            "已拒绝配对请求。",
          ),
        listenerOptions,
      );
      actions.append(accept, reject);
      row.append(copy, actions);
      pendingList.append(row);
    }

    peerList.replaceChildren();
    if (!snapshot.peers.length) peerList.append(empty(document, "暂无已配对设备"));
    for (const peer of snapshot.peers) {
      const row = document.createElement("div");
      row.className = "codexhost-project-sync-row";
      const copy = document.createElement("div");
      copy.className = "codexhost-project-sync-row-copy";
      const name = document.createElement("strong");
      name.textContent = peer.name;
      const id = document.createElement("span");
      id.textContent = peer.id;
      copy.append(name, id);
      const actions = document.createElement("div");
      actions.className = "codexhost-project-sync-row-actions";
      const sync = actionButton(document, "同步");
      sync.setAttribute(PROJECT_SYNC_SYNC_ATTRIBUTE, peer.id);
      const remove = actionButton(document, "移除");
      sync.addEventListener(
        "click",
        () =>
          void run(
            (client) => client.syncProjectSync({ peerId: peer.id }),
            "正在同步项目列表…",
            (result) => `已同步，共 ${result.projects.length} 个项目。`,
          ),
        listenerOptions,
      );
      remove.addEventListener(
        "click",
        () =>
          void run(
            (client) => client.removeProjectSyncPeer({ peerId: peer.id }),
            "正在移除设备…",
            "已移除设备。",
          ),
        listenerOptions,
      );
      actions.append(sync, remove);
      row.append(copy, actions);
      peerList.append(row);
    }

    projectList.replaceChildren();
    if (!snapshot.projects.length) projectList.append(empty(document, "暂无项目"));
    for (const project of snapshot.projects) {
      const row = document.createElement("div");
      row.className = "codexhost-project-sync-project";
      const copy = document.createElement("div");
      copy.className = "codexhost-project-sync-row-copy";
      const name = document.createElement("strong");
      name.textContent = project.name;
      const remote = document.createElement("span");
      remote.textContent = project.localPath ?? project.remote;
      copy.append(name, remote);
      const state = document.createElement("span");
      state.className = "codexhost-project-sync-project-state";
      state.dataset.ready = String(project.state === "ready");
      state.textContent = project.state === "ready" ? "本机可用" : "本机缺少";
      row.append(copy, state);
      if (project.state === "missing") {
        const actions = document.createElement("div");
        actions.className = "codexhost-project-sync-project-actions";
        const bind = actionButton(document, "绑定目录");
        const clone = actionButton(document, "克隆");
        bind.addEventListener(
          "click",
          () => {
            const pathValue = ownerWindow.prompt("选择已有仓库根目录", "");
            if (!pathValue) return;
            void run(
              (client) => client.bindProjectSync({ remote: project.remote, path: pathValue }),
              "正在绑定目录…",
              `${project.name} 已绑定。`,
            );
          },
          listenerOptions,
        );
        clone.addEventListener(
          "click",
          () => {
            const parent = ownerWindow.prompt("选择克隆目标父目录", "");
            if (!parent) return;
            void run(
              (client) => client.cloneProjectSync({ remote: project.remote, parent }),
              "正在克隆项目…",
              `${project.name} 已克隆。`,
            );
          },
          listenerOptions,
        );
        actions.append(bind, clone);
        row.append(actions);
      }
      projectList.append(row);
    }
    setBusy(busy);
  };

  const run = async (
    operation: (client: RendererProjectSyncClient) => Promise<ProjectSyncSnapshot>,
    pendingMessage: string,
    successMessage: string | ((snapshot: ProjectSyncSnapshot) => string),
  ): Promise<void> => {
    const client = options.getClient();
    if (!client) {
      setNotice("本地 Host 不可用。", "error");
      return;
    }
    if (busy || disposed) return;
    setBusy(true);
    setNotice(pendingMessage);
    try {
      const snapshot = await operation(client);
      if (disposed) return;
      render(snapshot);
      setNotice(
        typeof successMessage === "function" ? successMessage(snapshot) : successMessage,
        "success",
      );
    } catch (error) {
      if (!disposed) setNotice(error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (!disposed) setBusy(false);
    }
  };

  const inspect = async (silent = false): Promise<void> => {
    if (!active || disposed || polling) return;
    const client = options.getClient();
    if (!client) {
      if (!silent) setNotice("本地 Host 不可用。", "error");
      return;
    }
    polling = true;
    const requestGeneration = ++generation;
    try {
      const snapshot = await client.inspectProjectSync();
      if (active && !disposed && requestGeneration === generation) render(snapshot);
    } catch (error) {
      if (!silent && active && requestGeneration === generation)
        setNotice(error instanceof Error ? error.message : String(error), "error");
    } finally {
      polling = false;
    }
  };

  invite.addEventListener(
    "click",
    async () => {
      const client = options.getClient();
      if (!client) {
        setNotice("本地 Host 不可用。", "error");
        return;
      }
      if (busy || disposed) return;
      setBusy(true);
      setNotice("正在生成配对码…");
      try {
        const result = await client.inviteProjectSync();
        if (disposed) return;
        inviteCode.textContent = result.code;
        inviteValue.hidden = false;
        code.value = result.code;
        setNotice("把配对码发到另一台设备。", "success");
      } catch (error) {
        if (!disposed) setNotice(error instanceof Error ? error.message : String(error), "error");
      } finally {
        if (!disposed) setBusy(false);
      }
    },
    listenerOptions,
  );
  pair.addEventListener(
    "click",
    () => {
      const value = code.value.trim();
      if (!/^\d{8}$/u.test(value)) {
        setNotice("请输入八位数字配对码。", "error");
        return;
      }
      void run(
        (client) => client.pairProjectSync({ code: value }),
        "等待另一台设备确认…",
        "配对成功。",
      );
    },
    listenerOptions,
  );
  addProject.addEventListener(
    "click",
    () => {
      const pathValue = ownerWindow.prompt("选择 Git 仓库根目录", "");
      if (!pathValue) return;
      void run(
        (client) => client.addProjectSync({ path: pathValue }),
        "正在添加项目…",
        "项目已加入同步列表。",
      );
    },
    listenerOptions,
  );
  refresh.addEventListener("click", () => void inspect(), listenerOptions);

  const poll = ownerWindow.setInterval(() => void inspect(true), 2000);
  options.signal?.addEventListener("abort", () => ownerWindow.clearInterval(poll), { once: true });

  return {
    panel,
    activate() {
      if (disposed || active) return;
      active = true;
      panel.hidden = false;
      setNotice("正在读取设备状态…");
      void inspect();
    },
    deactivate() {
      active = false;
      panel.hidden = true;
    },
    refresh() {
      if (active) void inspect();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      generation += 1;
      ownerWindow.clearInterval(poll);
      panel.remove();
    },
  };
}
