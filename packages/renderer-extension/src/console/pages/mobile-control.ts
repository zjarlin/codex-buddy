import {
  MOBILE_PAIRING_INVITE_METHOD,
  MOBILE_PAIRING_MAX_CLIENTS,
  MOBILE_PAIRING_REVOKE_METHOD,
  MOBILE_PAIRING_STATUS_METHOD,
  mobilePairingStatusSchema,
  type MobilePairingStatus,
} from "@codexhost/shared-contracts";

import { h } from "../dom.js";
import type { ConsoleMessages } from "../messages.js";
import { createRendererSettingsIcon } from "../../settings/icons.js";
import type {
  RendererSettingsPageDefinition,
  RendererSettingsPageMountContext,
} from "../../settings/core.js";
import { encodeQr, qrSvg } from "../qr.js";

export type MobileControlRequest = (method: string, params: unknown) => Promise<unknown>;

const POLL_MS = 4_000;
const CLOCK_MS = 1_000;

interface Invite {
  url: string;
  expiresAt: number;
}

function formatTime(value: number, locale: string): string {
  return new Date(value).toLocaleString(locale);
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function unsupportedHost(value: unknown): boolean {
  const code =
    value instanceof Error
      ? (value as Error & { code?: unknown }).code
      : typeof value === "object" && value !== null
        ? (value as { code?: unknown }).code
        : undefined;
  return code === -32090;
}

export function createMobileControlPage(
  consoleMessages: ConsoleMessages,
  request: MobileControlRequest,
  pageLocale?: string,
): RendererSettingsPageDefinition {
  const messages = consoleMessages.mobileControl;
  return Object.freeze({
    id: "mobile-control",
    label: messages.label,
    icon: "mobile-control" as const,
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const locale = pageLocale ?? (document.documentElement.lang || "en");
      let status: MobilePairingStatus | null = null;
      let invite: Invite | null = null;
      let error: string | null = null;
      let unsupported = false;
      let busy = false;
      let ended = false;
      let poll: number | undefined;

      const notice = h(document, "p", { className: "console-muted", role: "status" });
      const statusBanner = h(document, "p", { className: "console-muted", role: "status" });
      const showError = (value: string): void => {
        statusBanner.textContent = value;
        statusBanner.dataset.tone = "bad";
      };
      const invitePanel = h(document, "section", { className: "console-panel" });
      const clientsPanel = h(document, "section", { className: "console-panel" });
      const body = h(document, "div", { className: "console-mobile" });

      const setNotice = (value: string, tone?: "bad" | "ok"): void => {
        notice.textContent = value;
        if (tone) notice.dataset.tone = tone;
        else delete notice.dataset.tone;
      };

      const createButton = (
        label: string,
        onClick: () => void,
        variant: "primary" | "secondary" = "secondary",
      ): HTMLButtonElement => {
        const element = h(
          document,
          "button",
          {
            type: "button",
            className:
              variant === "primary"
                ? "settings-command-button"
                : "settings-command-button settings-command-button--secondary",
          },
          createRendererSettingsIcon(variant === "primary" ? "mobile-control" : "refresh", 16),
          label,
        );
        element.addEventListener("click", onClick);
        return element;
      };

      const renderInvite = (): void => {
        if (ended) return;
        const create = createButton(
          busy ? messages.creating : messages.create,
          () => void createInvite(),
          "primary",
        );
        create.disabled = busy;
        const head = h(
          document,
          "div",
          { className: "console-panel__header" },
          h(document, "h2", { className: "console-panel__title" }, messages.inviteTitle),
          create,
        );
        const current = invite;
        if (!current) {
          invitePanel.replaceChildren(
            head,
            h(document, "p", { className: "console-muted" }, messages.inviteMissing),
            h(document, "p", { className: "console-muted" }, messages.inviteNote),
          );
          return;
        }
        const expiresIn = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1_000));
        if (expiresIn === 0) {
          invitePanel.replaceChildren(
            head,
            h(document, "p", { className: "console-muted" }, messages.inviteExpired),
          );
          return;
        }
        const qr = document.createElement("div");
        qr.className = "console-mobile-qr";
        try {
          qr.innerHTML = qrSvg(encodeQr(current.url), 232);
        } catch {
          qr.append(h(document, "p", { className: "console-muted" }, messages.failure));
        }
        const link = h(
          document,
          "a",
          {
            className: "settings-command-button settings-command-button--secondary",
            href: current.url,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          messages.openLink,
        );
        const copy = createButton(messages.copyLink, () => {
          void navigator.clipboard?.writeText(invite?.url ?? "").then(
            () => setNotice(messages.copied, "ok"),
            () => undefined,
          );
        });
        invitePanel.replaceChildren(
          head,
          h(document, "p", { className: "console-muted" }, messages.inviteNote),
          h(
            document,
            "div",
            { className: "console-mobile-invite" },
            qr,
            h(
              document,
              "div",
              { className: "console-mobile-invite__copy" },
              h(
                document,
                "strong",
                { className: "console-mobile-countdown" },
                `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}`,
              ),
              h(document, "code", { className: "console-mobile-url" }, current.url),
              h(document, "div", { className: "console-actions" }, copy, link),
            ),
          ),
        );
      };

      const renderClients = (): void => {
        const clients = status?.clients ?? [];
        const list = h(document, "div", { className: "console-mobile-clients" });
        if (clients.length === 0) {
          list.append(h(document, "p", { className: "console-muted" }, messages.noClients));
        }
        for (const client of clients) {
          const revoke = createButton(messages.revoke, () => {
            if (!document.defaultView?.confirm(messages.revokeConfirm)) return;
            revoke.disabled = true;
            revoke.textContent = messages.revoking;
            void context.runLatest(
              () => request(MOBILE_PAIRING_REVOKE_METHOD, { clientId: client.clientId }),
              {
                success: () => void load(),
                failure: (failure) => {
                  revoke.disabled = false;
                  revoke.textContent = messages.revoke;
                  setNotice(`${messages.failure}: ${errorText(failure)}`, "bad");
                },
              },
            );
          });
          list.append(
            h(
              document,
              "div",
              { className: "console-mobile-client" },
              h(
                document,
                "div",
                { className: "console-mobile-client__identity" },
                h(document, "strong", {}, client.label),
                h(
                  document,
                  "span",
                  { className: `console-badge ${client.connected ? "is-ok" : ""}` },
                  client.connected ? messages.connected : messages.offline,
                ),
              ),
              h(
                document,
                "div",
                { className: "console-mobile-client__meta" },
                h(
                  document,
                  "span",
                  {},
                  messages.lastSeen.replace("{time}", formatTime(client.lastSeenAt, locale)),
                ),
                h(
                  document,
                  "span",
                  {},
                  messages.pairedAt.replace("{time}", formatTime(client.pairedAt, locale)),
                ),
              ),
              revoke,
            ),
          );
        }
        clientsPanel.replaceChildren(
          h(
            document,
            "div",
            { className: "console-panel__header" },
            h(document, "h2", { className: "console-panel__title" }, messages.clientsTitle),
            h(
              document,
              "span",
              { className: "console-muted" },
              `${clients.length}/${MOBILE_PAIRING_MAX_CLIENTS}`,
            ),
          ),
          h(
            document,
            "p",
            { className: "console-muted" },
            messages.clientsNote.replace("{max}", String(MOBILE_PAIRING_MAX_CLIENTS)),
          ),
          list,
        );
      };

      const render = (): void => {
        if (ended) return;
        if (unsupported) {
          body.replaceChildren(
            h(document, "p", { className: "console-muted" }, messages.unavailable),
            error
              ? h(document, "p", { className: "console-muted", "data-tone": "bad" }, error)
              : h(document, "span", {}),
          );
          return;
        }
        renderInvite();
        renderClients();
        body.replaceChildren(invitePanel, clientsPanel);
      };

      const createInvite = async (): Promise<void> => {
        if (busy || ended) return;
        busy = true;
        setNotice(messages.creating);
        render();
        try {
          const value = await request(MOBILE_PAIRING_INVITE_METHOD, {});
          if (ended) return;
          if (!value || typeof value !== "object") throw new Error(messages.failure);
          const record = value as Record<string, unknown>;
          if (typeof record.url !== "string" || typeof record.expiresAt !== "number") {
            throw new Error(messages.failure);
          }
          invite = { url: record.url, expiresAt: record.expiresAt };
          setNotice("");
        } catch (failure) {
          setNotice(`${messages.failure}: ${errorText(failure)}`, "bad");
        } finally {
          busy = false;
          render();
        }
      };

      const load = async (): Promise<void> => {
        if (ended) return;
        try {
          const value = await request(MOBILE_PAIRING_STATUS_METHOD, {});
          if (ended) return;
          const parsed = mobilePairingStatusSchema.safeParse(value);
          if (!parsed.success) throw new Error("Invalid phone pairing status");
          status = parsed.data;
          if (invite && invite.expiresAt <= Date.now()) invite = null;
          unsupported = false;
          error = null;
          render();
        } catch (failure) {
          if (unsupportedHost(failure)) {
            unsupported = true;
            error = null;
          } else {
            error = errorText(failure);
            showError(`${messages.failure}: ${error}`);
          }
          render();
        }
      };

      const schedule = (): void => {
        window.clearTimeout(poll);
        if (context.signal.aborted) return;
        poll = window.setTimeout(() => {
          void load();
          schedule();
        }, POLL_MS);
      };

      context.content.replaceChildren(
        h(document, "h1", { className: "settings-section-label" }, messages.label),
        h(document, "p", { className: "console-muted" }, messages.description),
        h(document, "p", { className: "console-muted console-mobile-trust" }, messages.trustNote),
        body,
        notice,
        statusBanner,
      );
      render();
      void load();
      schedule();
      const clock = window.setInterval(renderInvite, CLOCK_MS);
      return () => {
        ended = true;
        window.clearTimeout(poll);
        window.clearInterval(clock);
      };
    },
  });
}
