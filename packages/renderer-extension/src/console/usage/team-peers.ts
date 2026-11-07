import type { TeamUsagePeer, TeamUsageState } from "@codexhost/shared-contracts";

import { h } from "../dom.js";
import type { ConsoleMessages } from "../messages.js";
import { createRendererSettingsIcon } from "../../settings/icons.js";
import { fill } from "./format.js";
import { focusKey } from "./controls.js";

export type TeamUsageMessages = ConsoleMessages["teamUsage"];

/** What a peer row asks the page to change; the page owns the request and its error notice. */
export interface TeamPeerActions {
  accept(requestId: string): void;
  reject(requestId: string): void;
  setDepartment(id: string, department: string | null): void;
  remove(peer: TeamUsagePeer): void;
}

function command(
  document: Document,
  label: string,
  focus: string,
  secondary = false,
): HTMLButtonElement {
  return focusKey(
    h(
      document,
      "button",
      {
        type: "button",
        className: `settings-command-button${secondary ? " settings-command-button--secondary" : ""}`,
      },
      label,
    ),
    focus,
  );
}

/**
 * Pairing attempts in flight: inbound ones wait for an answer here and carry the fingerprint that
 * identifies them; outbound ones are informational until the other member approves.
 */
export function pendingNodes(
  document: Document,
  messages: TeamUsageMessages,
  current: TeamUsageState,
  actions: TeamPeerActions,
): Node[] {
  if (current.pending.length === 0) return [];
  const waiting = current.pending.filter((entry) => entry.outbound === true);
  const incoming = current.pending.filter((entry) => entry.outbound !== true);
  return [
    h(document, "h3", { className: "console-panel__title" }, messages.pending),
    ...incoming.map((entry) => {
      const accept = command(document, messages.accept, `pending:accept:${entry.requestId}`);
      accept.addEventListener("click", () => actions.accept(entry.requestId));
      const reject = command(document, messages.reject, `pending:reject:${entry.requestId}`, true);
      reject.addEventListener("click", () => actions.reject(entry.requestId));
      return h(
        document,
        "div",
        { className: "console-notice" },
        h(
          document,
          "span",
          {},
          `${entry.name} · ${entry.address ?? messages.noAddress} · ${entry.fingerprint}`,
        ),
        accept,
        reject,
      );
    }),
    ...waiting.map((entry) =>
      h(
        document,
        "div",
        { className: "console-notice" },
        h(
          document,
          "span",
          {},
          fill(messages.outgoingApproval, { name: entry.name }),
          entry.address
            ? h(document, "small", { className: "console-muted" }, ` · ${entry.address}`)
            : null,
        ),
      ),
    ),
  ];
}

/** Members heard on the LAN that this Host does not read yet; pairing still needs a code. */
export function discoveredNodes(
  document: Document,
  messages: TeamUsageMessages,
  current: TeamUsageState,
  useAddress: (address: string) => void,
): Node[] {
  const paired = new Set(
    current.peers.filter((peer) => peer.direction === "out").map((peer) => peer.id),
  );
  const found = (current.discovered ?? []).filter((peer) => !paired.has(peer.id));
  if (found.length === 0) {
    return [h(document, "p", { className: "console-muted" }, messages.noDiscovered)];
  }
  return found.map((peer) => {
    const use = command(document, messages.useAddress, `discovered:use:${peer.id}`, true);
    use.addEventListener("click", () => useAddress(peer.address));
    return h(
      document,
      "div",
      { className: "console-notice" },
      h(
        document,
        "span",
        { className: "console-usage-name" },
        peer.department ? `${peer.name} · ${peer.department}` : peer.name,
        h(document, "small", { className: "console-muted" }, ` · ${peer.address}`),
      ),
      h(document, "span", { className: "console-muted" }, messages.discoveryNeedsCode),
      use,
    );
  });
}

/**
 * One paired person. The two directions answer different questions, so they stay separate lists:
 * only members this Host reads can be assigned a department here.
 */
export function peerNodes(
  document: Document,
  messages: TeamUsageMessages,
  current: TeamUsageState,
  actions: TeamPeerActions,
): Node[] {
  const reads = current.peers.filter((peer) => peer.direction === "out");
  const coordinators = current.peers.filter((peer) => peer.direction === "in");
  if (current.peers.length === 0) {
    return [h(document, "p", { className: "console-muted" }, messages.noMembers)];
  }
  const rows: Node[] = [];
  if (reads.length > 0) {
    rows.push(h(document, "h4", { className: "console-panel__title" }, messages.readsMembers));
    rows.push(...reads.map((peer) => memberNode(document, messages, peer, true, actions)));
  }
  if (coordinators.length > 0) {
    rows.push(
      h(document, "h4", { className: "console-panel__title" }, messages.readByMembers),
      h(document, "p", { className: "console-muted" }, messages.readByMembersNote),
      ...coordinators.map((peer) => memberNode(document, messages, peer, false, actions)),
    );
  }
  return rows;
}

function memberNode(
  document: Document,
  messages: TeamUsageMessages,
  peer: TeamUsagePeer,
  readable: boolean,
  actions: TeamPeerActions,
): HTMLElement {
  const name = h(
    document,
    "span",
    { className: "console-usage-name", title: peer.id },
    peer.name,
    peer.address
      ? h(document, "small", { className: "console-muted" }, ` · ${peer.address}`)
      : null,
  );
  const remove = focusKey(
    h(
      document,
      "button",
      {
        type: "button",
        className: "console-usage-icon-button",
        title: messages.remove,
        "aria-label": messages.remove,
      },
      createRendererSettingsIcon("trash", 15),
    ),
    `peer:remove:${peer.id}`,
  );
  remove.addEventListener("click", () => actions.remove(peer));
  if (!readable) return h(document, "div", { className: "console-usage-filters" }, name, remove);
  const department = h(document, "input", {
    type: "text",
    className: "console-input",
    maxLength: 120,
    value: peer.department ?? "",
    placeholder: messages.departmentPlaceholder,
    "aria-label": messages.department,
  });
  const save = command(document, messages.save, `peer:save:${peer.id}`, true);
  save.addEventListener("click", () => {
    const value = department.value.trim();
    actions.setDepartment(peer.id, value.length > 0 ? value : null);
  });
  return h(document, "div", { className: "console-usage-filters" }, name, department, save, remove);
}
