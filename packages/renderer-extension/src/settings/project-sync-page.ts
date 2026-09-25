import type {
  ProjectSyncAddParams,
  ProjectSyncBindParams,
  ProjectSyncCloneParams,
  ProjectSyncInvite,
  ProjectSyncPairParams,
  ProjectSyncPeerParams,
  ProjectSyncRequestParams,
  ProjectSyncGitConfigureParams,
  ProjectSyncSnapshot,
} from "@codexhost/shared-contracts";

import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";

export interface ProjectSyncClient {
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

function button(
  document: Document,
  text: string,
  icon: "refresh" | "add" | "download" | "git" | "trash" | "ticket" | "upload" | "check" | "close",
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "settings-command-button settings-command-button--secondary";
  element.append(createRendererSettingsIcon(icon, 15), text);
  return element;
}

function input(
  document: Document,
  label: string,
  placeholder = "",
): { row: HTMLLabelElement; field: HTMLInputElement } {
  const row = document.createElement("label");
  row.className = "flex min-w-0 flex-col gap-1 text-xs text-settings-muted";
  row.textContent = label;
  const field = document.createElement("input");
  field.type = "text";
  field.placeholder = placeholder;
  field.className =
    "min-h-8 w-full min-w-0 rounded-md border border-settings-border bg-settings-panel px-2 text-sm text-settings-text outline-none focus-visible:border-settings-focus";
  row.append(field);
  return { row, field };
}

export function createProjectSyncPage(
  messages: RendererSettingsMessages,
  getClient: () => ProjectSyncClient | null,
): RendererSettingsPageDefinition {
  const words = messages.projectSync;
  return Object.freeze({
    id: "project-sync",
    label: messages.pageLabels["project-sync"],
    icon: "project-sync",
    mount({ content, signal }: RendererSettingsPageMountContext) {
      const document = content.ownerDocument;
      const root = document.createElement("div");
      root.className = "flex min-w-0 flex-col gap-5";
      const title = document.createElement("h2");
      title.className = "m-0 text-base font-semibold text-settings-text";
      title.textContent = messages.pageLabels["project-sync"];
      const invite = button(document, words.invite, "ticket");
      const inviteStatus = document.createElement("p");
      inviteStatus.className = "m-0 text-xs text-settings-muted";
      const code = input(document, words.code);
      code.field.inputMode = "numeric";
      code.field.maxLength = 8;
      const pair = button(document, words.pair, "add");
      const pairRow = document.createElement("div");
      pairRow.className = "grid min-w-0 gap-2 sm:grid-cols-2";
      pairRow.append(code.row, pair);

      const relayStatus = document.createElement("p");
      relayStatus.className = "m-0 text-xs text-settings-muted";
      const pendingTitle = document.createElement("h3");
      pendingTitle.className = "m-0 text-sm font-medium text-settings-text";
      pendingTitle.textContent = words.pending;
      const pending = document.createElement("div");
      pending.className = "min-w-0 divide-y divide-settings-divider";
      const gitTitle = document.createElement("h3");
      gitTitle.className = "m-0 text-sm font-medium text-settings-text";
      gitTitle.textContent = words.gitRemote;
      const gitRemote = input(document, words.gitRemote, words.gitPlaceholder);
      const gitSave = button(document, words.gitSave, "git");
      const gitPull = button(document, words.gitPull, "download");
      const gitPush = button(document, words.gitPush, "upload");
      const gitActions = document.createElement("div");
      gitActions.className = "flex flex-wrap gap-2";
      gitActions.append(gitSave, gitPull, gitPush);

      const folder = input(document, words.addPath);
      const add = button(document, words.add, "add");
      const addRow = document.createElement("div");
      addRow.className = "flex min-w-0 items-end gap-2 max-sm:flex-col max-sm:items-stretch";
      folder.row.classList.add("flex-1");
      addRow.append(folder.row, add);

      const notice = document.createElement("p");
      notice.className = "m-0 text-xs text-settings-muted";
      notice.setAttribute("role", "status");
      const peersTitle = document.createElement("h3");
      peersTitle.className = "m-0 text-sm font-medium text-settings-text";
      peersTitle.textContent = words.peers;
      const peers = document.createElement("div");
      peers.className = "min-w-0 divide-y divide-settings-divider";
      const list = document.createElement("div");
      list.className = "min-w-0 divide-y divide-settings-divider border-t border-settings-divider";
      root.append(
        title,
        relayStatus,
        invite,
        inviteStatus,
        pairRow,
        pendingTitle,
        pending,
        peersTitle,
        peers,
        gitTitle,
        gitRemote.row,
        gitActions,
        addRow,
        notice,
        list,
      );
      content.append(root);

      let busy = false;
      const controls = [invite, pair, add, gitSave, gitPull, gitPush];
      let rowControls: HTMLButtonElement[] = [];
      const render = (snapshot: ProjectSyncSnapshot): void => {
        peers.replaceChildren();
        pending.replaceChildren();
        list.replaceChildren();
        rowControls = [];
        relayStatus.textContent = snapshot.relay
          ? `${words.relay}: ${snapshot.connected ? snapshot.relay : words.relayUnavailable}`
          : words.relayUnavailable;
        if (document.activeElement !== gitRemote.field)
          gitRemote.field.value = snapshot.gitRemote ?? "";
        for (const request of snapshot.pending) {
          const row = document.createElement("div");
          row.className = "flex min-w-0 flex-wrap items-center gap-2 py-2";
          const label = document.createElement("span");
          label.className = "min-w-0 flex-1 truncate text-sm text-settings-text";
          label.textContent = `${request.name} · ${request.fingerprint}`;
          const accept = button(document, words.accept, "check");
          const reject = button(document, words.reject, "close");
          accept.addEventListener(
            "click",
            () =>
              void perform((client) => client.acceptProjectSync({ requestId: request.requestId })),
            { signal },
          );
          reject.addEventListener(
            "click",
            () =>
              void perform((client) => client.rejectProjectSync({ requestId: request.requestId })),
            { signal },
          );
          row.append(label, accept, reject);
          pending.append(row);
          rowControls.push(accept, reject);
        }
        for (const peer of snapshot.peers) {
          const row = document.createElement("div");
          row.className = "flex min-w-0 flex-wrap items-center gap-2 py-2";
          const name = document.createElement("span");
          name.className = "min-w-0 flex-1 truncate text-sm text-settings-text";
          name.textContent = peer.name;
          const sync = button(document, words.sync, "refresh");
          const remove = button(document, words.remove, "trash");
          sync.addEventListener(
            "click",
            () => void perform((client) => client.syncProjectSync({ peerId: peer.id })),
            { signal },
          );
          remove.addEventListener(
            "click",
            () => void perform((client) => client.removeProjectSyncPeer({ peerId: peer.id })),
            { signal },
          );
          row.append(name, sync, remove);
          peers.append(row);
          rowControls.push(sync, remove);
        }
        if (!snapshot.projects.length) {
          const empty = document.createElement("p");
          empty.className = "text-sm text-settings-muted";
          empty.textContent = words.empty;
          list.append(empty);
        }
        for (const project of snapshot.projects) {
          const row = document.createElement("div");
          row.className = "flex min-w-0 flex-wrap items-center gap-2 py-3";
          const details = document.createElement("div");
          details.className = "min-w-0 flex-1";
          const name = document.createElement("strong");
          name.className = "block truncate text-sm font-medium text-settings-text";
          name.textContent = project.name;
          const location = document.createElement("div");
          location.className = "truncate text-xs text-settings-muted";
          location.title = project.localPath ?? project.remote;
          location.textContent = project.localPath ?? project.remote;
          details.append(name, location);
          const status = document.createElement("span");
          status.className = "text-xs text-settings-muted";
          status.textContent = project.state === "ready" ? words.ready : words.missing;
          row.append(details, status);
          if (project.state === "missing") {
            const bind = button(document, words.bind, "git");
            const clone = button(document, words.clone, "download");
            bind.addEventListener(
              "click",
              () => {
                const path = window.prompt(words.addPath);
                if (path)
                  void perform((client) =>
                    client.bindProjectSync({ remote: project.remote, path }),
                  );
              },
              { signal },
            );
            clone.addEventListener(
              "click",
              () => {
                const parent = window.prompt(words.parent);
                if (parent)
                  void perform((client) =>
                    client.cloneProjectSync({ remote: project.remote, parent }),
                  );
              },
              { signal },
            );
            row.append(bind, clone);
            rowControls.push(bind, clone);
          }
          list.append(row);
        }
      };
      const perform = async (
        operation: (client: ProjectSyncClient) => Promise<ProjectSyncSnapshot>,
      ): Promise<void> => {
        const client = getClient();
        if (!client) {
          notice.textContent = words.unavailable;
          return;
        }
        if (busy) return;
        busy = true;
        for (const control of [...controls, ...rowControls]) control.disabled = true;
        notice.textContent = "";
        try {
          const result = await operation(client);
          if (!signal.aborted) render(result);
        } catch (error) {
          if (!signal.aborted)
            notice.textContent = `${words.failure}: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
          busy = false;
          if (!signal.aborted) {
            for (const control of [...controls, ...rowControls]) control.disabled = false;
          }
        }
      };
      invite.addEventListener(
        "click",
        () => {
          const client = getClient();
          if (!client || busy) return;
          busy = true;
          invite.disabled = true;
          void client
            .inviteProjectSync()
            .then((result) => {
              if (!signal.aborted) inviteStatus.textContent = `${words.inviteCode}: ${result.code}`;
            })
            .catch((error: unknown) => {
              if (!signal.aborted)
                notice.textContent = `${words.failure}: ${error instanceof Error ? error.message : String(error)}`;
            })
            .finally(() => {
              busy = false;
              invite.disabled = false;
            });
        },
        { signal },
      );
      pair.addEventListener(
        "click",
        () => {
          const client = getClient();
          if (!client || pair.disabled) return;
          pair.disabled = true;
          notice.textContent = "";
          void client
            .pairProjectSync({ code: code.field.value.trim() })
            .then((result) => {
              if (!signal.aborted) render(result);
            })
            .catch((error: unknown) => {
              if (!signal.aborted)
                notice.textContent = `${words.failure}: ${error instanceof Error ? error.message : String(error)}`;
            })
            .finally(() => {
              if (!signal.aborted) pair.disabled = false;
            });
        },
        { signal },
      );
      add.addEventListener(
        "click",
        () => void perform((client) => client.addProjectSync({ path: folder.field.value.trim() })),
        { signal },
      );
      gitSave.addEventListener(
        "click",
        () =>
          void perform((client) =>
            client.configureProjectSyncGit({ remote: gitRemote.field.value.trim() || null }),
          ),
        { signal },
      );
      gitPull.addEventListener(
        "click",
        () => void perform((client) => client.pullProjectSyncGit()),
        { signal },
      );
      gitPush.addEventListener(
        "click",
        () => void perform((client) => client.pushProjectSyncGit()),
        { signal },
      );
      const poll = window.setInterval(() => {
        const client = getClient();
        if (busy || signal.aborted || !client) return;
        void client
          .inspectProjectSync()
          .then((snapshot) => {
            if (!signal.aborted) render(snapshot);
          })
          .catch(() => undefined);
      }, 2000);
      signal.addEventListener("abort", () => window.clearInterval(poll), { once: true });
      void perform((client) => client.inspectProjectSync());
      return undefined;
    },
  });
}
