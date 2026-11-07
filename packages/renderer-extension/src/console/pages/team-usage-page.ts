import {
  TEAM_USAGE_ACCEPT_METHOD,
  TEAM_USAGE_INVITE_METHOD,
  TEAM_USAGE_MEMBER_REMOVE_METHOD,
  TEAM_USAGE_MEMBER_SET_METHOD,
  TEAM_USAGE_PAIR_METHOD,
  TEAM_USAGE_REJECT_METHOD,
  TEAM_USAGE_SETTINGS_SET_METHOD,
  TEAM_USAGE_SNAPSHOT_METHOD,
  TEAM_USAGE_STATE_METHOD,
  USAGE_STATISTICS_RANGES,
  teamUsagePairResultSchema,
  teamUsageSnapshotSchema,
  teamUsageStateSchema,
  type TeamUsageMember,
  type TeamUsageSnapshot,
  type TeamUsageState,
  type UsageStatisticsRange,
} from "@codexhost/shared-contracts";

import { h } from "../dom.js";
import type { ConsoleMessages } from "../messages.js";
import { createRendererSettingsIcon } from "../../settings/icons.js";
import type {
  RendererSettingsPageDefinition,
  RendererSettingsPageMountContext,
} from "../../settings/core.js";
import { summaryTiles } from "../usage/summary.js";
import {
  dataTable,
  download,
  rebuildKeepingFocus,
  segmented,
  type Column,
  type TableState,
} from "../usage/controls.js";
import {
  baseName,
  cacheHitRate,
  cost,
  count as formatCount,
  emptyTotals,
  fill,
  inputWithoutCache,
  percent,
  projectNames,
  tokenCount,
  unmetered,
  type Totals,
} from "../usage/format.js";
import { departmentProjectRows, departmentRows, projectRows, teamTotals } from "../usage/team.js";
import { teamUsageWorkbook } from "../usage/team-workbook.js";
import {
  discoveredNodes,
  peerNodes,
  pendingNodes,
  type TeamPeerActions,
} from "../usage/team-peers.js";

export type TeamUsageRequest = (method: string, params: unknown) => Promise<unknown>;

const POLL_MS = 30_000;
const CLOCK_MS = 1_000;
const TABLE_LIMIT = 12;

interface MemberRow extends Totals {
  name: string;
  department: string | null;
  address: string | null;
  /** False when the member's Host did not answer this snapshot. */
  reachable: boolean;
}

export function createTeamUsagePage(
  consoleMessages: ConsoleMessages,
  request: TeamUsageRequest,
  pageLocale?: string,
): RendererSettingsPageDefinition {
  const messages = consoleMessages.teamUsage;
  return Object.freeze({
    id: "team-usage",
    label: messages.label,
    icon: "accounts" as const,
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const locale = pageLocale ?? (document.documentElement.lang || "en");
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const count = (value: number): string => formatCount(value, locale);
      let range: UsageStatisticsRange = "30d";
      let state: TeamUsageState | null = null;
      let snapshot: TeamUsageSnapshot | null = null;
      let error: string | null = null;
      let busy = false;
      let seconds = 0;
      let poll: number | undefined;
      let projectLabel = new Map<string, string>();
      const tables: Record<"member" | "department" | "departmentProject" | "project", TableState> =
        {
          member: { sort: "cost", descending: true, expanded: false },
          department: { sort: "cost", descending: true, expanded: false },
          departmentProject: { sort: "cost", descending: true, expanded: false },
          project: { sort: "cost", descending: true, expanded: false },
        };

      const projectName = (key: string | null): string =>
        key === null ? messages.unknownProject : (projectLabel.get(key) ?? baseName(key));

      const notice = h(document, "p", { className: "console-muted", role: "status" });
      const costBasis = h(document, "p", { className: "console-muted" }, messages.costBasis);
      const updated = h(document, "span", { className: "console-muted console-usage-updated" });
      const body = h(document, "div", { className: "console-usage" });

      // --- This Host: name, department, listener -------------------------------------------------
      const nameField = h(document, "input", {
        type: "text",
        className: "console-input",
        maxLength: "120",
        placeholder: messages.namePlaceholder,
        "aria-label": messages.name,
      });
      const departmentField = h(document, "input", {
        type: "text",
        className: "console-input",
        maxLength: "120",
        placeholder: messages.departmentPlaceholder,
        "aria-label": messages.department,
      });
      const portField = h(document, "input", {
        type: "number",
        className: "console-input console-usage-port",
        min: "1",
        max: "65535",
        step: "1",
        "aria-label": messages.port,
        placeholder: "45871",
      });
      const saveSettings = h(
        document,
        "button",
        { type: "button", className: "settings-command-button" },
        messages.save,
      );
      const enableToggle = h(document, "button", {
        type: "button",
        className: "settings-command-button settings-command-button--secondary",
      });
      const addresses = h(document, "p", { className: "console-muted" });
      const invite = h(
        document,
        "button",
        { type: "button", className: "settings-command-button settings-command-button--secondary" },
        messages.invite,
      );
      const inviteValue = h(document, "code", { className: "console-usage-name" });
      const pairAddressField = h(document, "input", {
        type: "text",
        className: "console-input",
        placeholder: messages.addressPlaceholder,
        "aria-label": messages.address,
      });
      const pairCodeField = h(document, "input", {
        type: "text",
        className: "console-input console-usage-code",
        inputMode: "numeric",
        maxLength: "8",
        placeholder: messages.codePlaceholder,
        "aria-label": messages.code,
      });
      const pair = h(
        document,
        "button",
        { type: "button", className: "settings-command-button" },
        messages.pair,
      );
      const pendingList = h(document, "div", { className: "console-usage-notices" });
      const discoveredList = h(document, "div", { className: "console-usage-notices" });
      const peerList = h(document, "div", { className: "console-usage" });

      const settingsPanel = h(
        document,
        "section",
        { className: "console-panel" },
        h(
          document,
          "div",
          { className: "console-panel__header" },
          h(document, "h2", { className: "console-panel__title" }, messages.thisHost),
          enableToggle,
        ),
        h(
          document,
          "div",
          { className: "console-usage-filters" },
          nameField,
          departmentField,
          portField,
          saveSettings,
        ),
        addresses,
        h(document, "div", { className: "console-usage-filters" }, invite, inviteValue),
        h(document, "p", { className: "console-muted" }, messages.inviteNote),
        pendingList,
      );

      const pairingPanel = h(
        document,
        "section",
        { className: "console-panel" },
        h(
          document,
          "div",
          { className: "console-panel__header" },
          h(document, "h2", { className: "console-panel__title" }, messages.discovered),
        ),
        h(document, "p", { className: "console-muted" }, messages.discoveredNote),
        discoveredList,
        h(document, "p", { className: "console-muted" }, messages.pairNote),
        h(
          document,
          "div",
          { className: "console-usage-filters" },
          pairAddressField,
          pairCodeField,
          pair,
        ),
      );

      const membersPanel = h(
        document,
        "section",
        { className: "console-panel" },
        h(
          document,
          "div",
          { className: "console-panel__header" },
          h(document, "h2", { className: "console-panel__title" }, messages.members),
        ),
        peerList,
      );

      const rangeSlot = h(document, "div", { className: "console-usage-slot" });
      const exportButton = h(
        document,
        "button",
        { type: "button", className: "settings-command-button settings-command-button--secondary" },
        messages.exportXlsx,
      );
      exportButton.addEventListener("click", () => exportWorkbook());
      const toolbar = h(
        document,
        "div",
        { className: "console-usage-filters" },
        rangeSlot,
        updated,
        exportButton,
      );

      // --- Data ---------------------------------------------------------------------------------
      function describe(failure: unknown): string {
        return failure instanceof Error ? failure.message : String(failure);
      }

      function readState(value: unknown): void {
        const parsed = teamUsageStateSchema.safeParse(value);
        if (!parsed.success) return;
        state = parsed.data;
        // Keep a draft the operator typed but has not saved.
        if (document.activeElement !== nameField) nameField.value = parsed.data.name;
        if (document.activeElement !== departmentField) {
          departmentField.value = parsed.data.department ?? "";
        }
        renderState();
      }

      function readSnapshot(value: unknown): void {
        const parsed = teamUsageSnapshotSchema.safeParse(value);
        if (!parsed.success) {
          snapshot = null;
          error = messages.incompatibleHost;
          renderBody();
          return;
        }
        snapshot = parsed.data;
        error = null;
        seconds = 0;
        projectLabel = projectNames(
          parsed.data.members.flatMap((member) =>
            (member.usage?.byProject ?? []).flatMap((row) =>
              row.project === null ? [] : [row.project],
            ),
          ),
        );
        renderBody();
      }

      /**
       * Reads the settings and the figures as one request: `runLatest` cancels the previous read,
       * so two separate calls would cancel each other and leave the panel blank.
       */
      function load(): void {
        void context
          .runLatest(
            async () => {
              const [settings, figures] = await Promise.allSettled([
                request(TEAM_USAGE_STATE_METHOD, {}),
                request(TEAM_USAGE_SNAPSHOT_METHOD, { range, timeZone }),
              ]);
              return { settings, figures };
            },
            {
              success({ settings, figures }) {
                if (context.signal.aborted) return;
                if (settings.status === "fulfilled") readState(settings.value);
                // The panel keeps the figures it can show; a failed read replaces the body.
                else notice.textContent = `${messages.failure}: ${describe(settings.reason)}`;
                if (figures.status === "fulfilled") {
                  readSnapshot(figures.value);
                  return;
                }
                snapshot = null;
                error = describe(figures.reason);
                renderBody();
              },
              failure(failure) {
                if (context.signal.aborted) return;
                snapshot = null;
                error = describe(failure);
                renderBody();
              },
            },
          )
          .catch(() => undefined);
      }

      /**
       * Applies one change and re-reads both the configuration and the figures. Pairing answers
       * `pending` until the other member approves, so the message says to wait instead of failing.
       */
      async function perform(action: () => Promise<unknown>): Promise<void> {
        if (busy) return;
        busy = true;
        notice.textContent = messages.working;
        try {
          const value = await action();
          if (context.signal.aborted) return;
          notice.textContent = "";
          error = null;
          readState(value);
          const pairResult = teamUsagePairResultSchema.safeParse(value);
          if (pairResult.success && pairResult.data.status === "pending") {
            notice.textContent = messages.waitingApproval;
          }
        } catch (failure) {
          if (context.signal.aborted) return;
          notice.textContent = `${messages.failure}: ${describe(failure)}`;
        } finally {
          busy = false;
          if (context.signal.aborted) return;
          load();
        }
      }

      const peerActions: TeamPeerActions = {
        accept: (requestId) => void perform(() => request(TEAM_USAGE_ACCEPT_METHOD, { requestId })),
        reject: (requestId) => void perform(() => request(TEAM_USAGE_REJECT_METHOD, { requestId })),
        setDepartment: (id, department) =>
          void perform(() => request(TEAM_USAGE_MEMBER_SET_METHOD, { id, department })),
        remove: (peer) =>
          void perform(() =>
            request(TEAM_USAGE_MEMBER_REMOVE_METHOD, { id: peer.id, direction: peer.direction }),
          ),
      };

      // --- This Host panel ----------------------------------------------------------------------
      function renderState(): void {
        if (!state) return;
        enableToggle.textContent = state.enabled ? messages.enabled : messages.disabled;
        enableToggle.setAttribute("aria-pressed", state.enabled ? "true" : "false");
        addresses.textContent = state.enabled
          ? state.addresses.length > 0
            ? fill(messages.listening, { addresses: state.addresses.join(", ") })
            : messages.listeningNoAddress
          : messages.disabledHint;
        if (document.activeElement !== portField && state.port !== null) {
          portField.value = String(state.port);
        }
        inviteValue.textContent = state.invite
          ? `${state.invite.code} · ${state.invite.addresses[0] ?? messages.noAddress}`
          : "";
        rebuildKeepingFocus(pendingList, pendingNodes(document, messages, state, peerActions));
        rebuildKeepingFocus(
          discoveredList,
          discoveredNodes(document, messages, state, (address) => {
            pairAddressField.value = address;
            pairCodeField.focus();
          }),
        );
        rebuildKeepingFocus(peerList, peerNodes(document, messages, state, peerActions));
      }

      // --- Figures ------------------------------------------------------------------------------
      function shareCell(row: Totals, whole: number): string | HTMLElement {
        if (unmetered(row) || !(whole > 0)) return "—";
        const share = row.costUsd / whole;
        const bar = h(document, "span", { className: "console-usage-share__fill" });
        bar.style.width = `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%`;
        return h(
          document,
          "span",
          { className: "console-usage-share" },
          h(
            document,
            "span",
            { className: "console-usage-share__track", "aria-hidden": "true" },
            bar,
          ),
          h(document, "span", { className: "console-usage-share__value" }, percent(share)),
        );
      }

      /** Cost share and the four figures every team table shows; `whole` is the team's cost. */
      function figureColumns<Row extends Totals>(whole: number): Column<Row>[] {
        return [
          {
            key: "share",
            label: messages.share,
            className: "console-usage-table__share",
            sort: (row) => row.costUsd,
            cell: (row) => shareCell(row, whole),
          },
          {
            key: "requests",
            label: messages.requests,
            sort: (row) => row.requests,
            cell: (row) => count(row.requests),
          },
          {
            key: "input",
            label: messages.input,
            sort: inputWithoutCache,
            cell: (row) => tokenCount(row, inputWithoutCache(row), locale),
          },
          {
            key: "cacheRead",
            label: messages.cacheRead,
            sort: (row) => row.cachedInputTokens,
            cell: (row) => tokenCount(row, row.cachedInputTokens, locale),
          },
          {
            key: "output",
            label: messages.output,
            sort: (row) => row.outputTokens,
            cell: (row) => tokenCount(row, row.outputTokens, locale),
          },
          {
            key: "cacheHit",
            label: messages.cacheHit,
            sort: (row) =>
              row.cacheHitInputTokens > 0
                ? row.cacheHitCachedInputTokens / row.cacheHitInputTokens
                : -1,
            cell: (row) => cacheHitRate(row),
          },
          {
            key: "cost",
            label: messages.cost,
            sort: (row) => row.costUsd,
            cell: (row) => cost(row),
          },
        ];
      }

      function panel(title: string, content: Node, extra: Node | null = null): HTMLElement {
        return h(
          document,
          "section",
          { className: "console-panel console-usage-panel" },
          h(
            document,
            "div",
            { className: "console-panel__header" },
            h(document, "h2", { className: "console-panel__title" }, title),
            extra,
          ),
          content,
        );
      }

      function table<Row extends Totals>(
        key: "member" | "department" | "departmentProject" | "project",
        rows: readonly Row[],
        columns: Column<Row>[],
        whole: number,
      ): HTMLElement {
        return dataTable(document, {
          key,
          columns: [...columns, ...figureColumns<Row>(whole)],
          rows: [...rows],
          state: tables[key],
          limit: TABLE_LIMIT,
          sortLabel: (label) => fill(messages.sortBy, { name: label }),
          moreLabel: (hidden) => fill(messages.showMore, { count: hidden }),
          lessLabel: messages.showLess,
          onState: (next) => {
            tables[key] = next;
            renderBody();
          },
        });
      }

      function memberTableRows(members: readonly TeamUsageMember[]): MemberRow[] {
        return members.map((member) => ({
          name: member.name,
          department: member.department,
          address: member.address,
          reachable: member.usage !== undefined,
          ...(member.usage?.totals ?? emptyTotals()),
        }));
      }

      function renderBody(): void {
        rebuildKeepingFocus(rangeSlot, [
          segmented(
            document,
            messages.label,
            USAGE_STATISTICS_RANGES.map((value) => ({ value, label: messages.ranges[value] })),
            range,
            (value) => {
              range = value;
              snapshot = null;
              renderBody();
              load();
            },
            "team-range",
          ),
        ]);
        updated.textContent = snapshot
          ? fill(messages.updated, {
              time:
                seconds < 5
                  ? messages.justNow
                  : fill(messages.secondsAgo, { count: Math.round(seconds) }),
            })
          : "";
        if (!snapshot) {
          body.replaceChildren(
            h(
              document,
              "p",
              { className: "console-muted", role: error ? "alert" : "status" },
              error ?? messages.loading,
            ),
          );
          return;
        }
        const data = snapshot;
        const totals = teamTotals(data.members);
        const departments = departmentRows(data.members);
        const departmentProjects = departmentProjectRows(data.members);
        const projects = projectRows(data.members);
        const reachable = data.members.filter((member) => member.usage !== undefined).length;
        rebuildKeepingFocus(body, [
          summaryTiles(document, totals, messages, locale),
          h(
            document,
            "p",
            { className: "console-muted" },
            fill(messages.coverage, { reachable, total: data.members.length }),
          ),
          ...data.members
            .filter((member) => member.error !== undefined)
            .map((member) =>
              h(
                document,
                "div",
                { className: "console-notice", role: "alert" },
                createRendererSettingsIcon("alert", 16),
                h(
                  document,
                  "span",
                  {},
                  fill(messages.memberFailed, {
                    name: member.name,
                    message: member.error ?? "",
                  }),
                ),
              ),
            ),
          panel(
            messages.byMember,
            table(
              "member",
              memberTableRows(data.members),
              [
                {
                  key: "name",
                  label: messages.member,
                  sort: (row) => row.name,
                  cell: (row) =>
                    h(
                      document,
                      "span",
                      { className: "console-usage-name", title: row.address ?? undefined },
                      row.name,
                      row.department
                        ? h(document, "small", { className: "console-muted" }, ` ${row.department}`)
                        : null,
                      row.reachable
                        ? null
                        : h(
                            document,
                            "small",
                            { className: "console-muted" },
                            ` · ${messages.unreachable}`,
                          ),
                    ),
                },
              ],
              totals.costUsd,
            ),
          ),
          panel(
            messages.byDepartment,
            table(
              "department",
              departments,
              [
                {
                  key: "name",
                  label: messages.department,
                  sort: (row) => row.department ?? messages.unassigned,
                  cell: (row) =>
                    h(
                      document,
                      "span",
                      { className: "console-usage-name" },
                      row.department ?? messages.unassigned,
                      row.unreachable > 0
                        ? h(
                            document,
                            "small",
                            { className: "console-muted" },
                            ` · ${fill(messages.missingMembers, { count: row.unreachable })}`,
                          )
                        : null,
                    ),
                },
                {
                  key: "members",
                  label: messages.membersColumn,
                  sort: (row) => row.members,
                  cell: (row) => count(row.members),
                },
              ],
              totals.costUsd,
            ),
          ),
          panel(
            messages.byDepartmentProject,
            table(
              "departmentProject",
              departmentProjects,
              [
                {
                  key: "name",
                  label: messages.departmentProject,
                  sort: (row) => `${row.department ?? ""} ${row.project ?? ""}`,
                  cell: (row) =>
                    h(
                      document,
                      "span",
                      { className: "console-usage-name" },
                      `${row.department ?? messages.unassigned} / ${projectName(row.project)}`,
                    ),
                },
              ],
              totals.costUsd,
            ),
          ),
          panel(
            messages.byProject,
            table(
              "project",
              projects,
              [
                {
                  key: "name",
                  label: messages.project,
                  sort: (row) => projectName(row.project),
                  cell: (row) =>
                    h(
                      document,
                      "span",
                      { className: "console-usage-name", title: row.project ?? undefined },
                      projectName(row.project),
                    ),
                },
              ],
              totals.costUsd,
            ),
          ),
        ]);
      }

      // --- Excel --------------------------------------------------------------------------------
      function exportWorkbook(): void {
        if (!snapshot) return;
        const book = teamUsageWorkbook(
          snapshot,
          {
            ranges: messages.ranges,
            costBasis: messages.costBasis,
            unassigned: messages.unassigned,
          },
          projectName,
        );
        download(
          document,
          `codexhost-team-usage-${snapshot.range}-${snapshot.to}.xlsx`,
          book.toBytes(),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      }

      // --- Wiring -------------------------------------------------------------------------------
      saveSettings.addEventListener("click", () => {
        const name = nameField.value.trim();
        const department = departmentField.value.trim();
        const port = Number(portField.value);
        void perform(() =>
          request(TEAM_USAGE_SETTINGS_SET_METHOD, {
            ...(name.length > 0 ? { name } : {}),
            department: department.length > 0 ? department : null,
            ...(Number.isInteger(port) && port >= 1 && port <= 65_535 ? { port } : {}),
          }),
        );
      });
      enableToggle.addEventListener("click", () => {
        if (!state) return;
        void perform(() => request(TEAM_USAGE_SETTINGS_SET_METHOD, { enabled: !state?.enabled }));
      });
      invite.addEventListener(
        "click",
        () => void perform(() => request(TEAM_USAGE_INVITE_METHOD, {})),
      );
      pair.addEventListener("click", () => {
        const address = pairAddressField.value.trim();
        const code = pairCodeField.value.trim();
        if (address.length === 0 || code.length !== 8) {
          notice.textContent = messages.needPairing;
          return;
        }
        void perform(() => request(TEAM_USAGE_PAIR_METHOD, { address, code }));
      });

      const clock = window.setInterval(() => {
        if (!snapshot) return;
        seconds = (Date.now() - snapshot.generatedAtMs) / 1_000;
        renderBody();
      }, CLOCK_MS);
      const schedule = (): void => {
        window.clearTimeout(poll);
        if (context.signal.aborted) return;
        poll = window.setTimeout(() => {
          load();
          schedule();
        }, POLL_MS);
      };

      context.content.replaceChildren(
        h(document, "h1", { className: "settings-section-label" }, messages.label),
        h(document, "p", { className: "console-muted" }, messages.description),
        settingsPanel,
        pairingPanel,
        membersPanel,
        toolbar,
        costBasis,
        notice,
        body,
      );
      renderState();
      renderBody();
      load();
      schedule();
      return () => {
        window.clearInterval(clock);
        window.clearTimeout(poll);
      };
    },
  });
}
