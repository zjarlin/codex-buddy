import type { ProviderRoutingParams, ProviderRoutingSnapshot } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../../renderer-model-client.js";
import { RendererMethodUnavailableError } from "../../renderer-request-sender.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "../core.js";
import type { RendererSettingsMessages } from "../localization.js";
import { createHelpTooltip, createPreferenceGroup } from "../preference-ui.js";
import { providerMessages } from "./messages.js";

export function createProvidersSettingsPage(
  messages: RendererSettingsMessages,
  getClient: () => RendererModelClient | null,
): RendererSettingsPageDefinition {
  const m = providerMessages[messages.locale];
  return Object.freeze({
    id: "providers",
    label: m.title,
    icon: "routes",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      // 捕获 Host 客户端，后台 Composer 切换不能把正在编辑的密钥写到另一台机器。
      const source = getClient();
      const root = document.createElement("div");
      const heading = document.createElement("h1");
      heading.className = "settings-section-label flex items-center gap-2";
      heading.textContent = m.title;
      heading.append(createHelpTooltip(document, m.help, m.details));
      const host = document.createElement("select");
      host.setAttribute("aria-label", m.host);
      host.className =
        "rounded-md border border-settings-border bg-settings-panel px-3 py-2 text-settings-text";
      const current = source?.currentHostId?.() ?? "local";
      for (const id of new Set([current, "local", ...(source?.knownHostIds?.() ?? [])])) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id;
        host.append(option);
      }
      host.value = current;
      const hostLabel = document.createElement("label");
      hostLabel.className = "flex items-center gap-3 py-3 text-sm text-settings-text";
      hostLabel.append(m.host, host);
      const status = document.createElement("p");
      status.className = "text-sm text-settings-muted";
      status.setAttribute("role", "status");
      const controls = document.createElement("fieldset");
      controls.className = "m-0 min-w-0 border-0 p-0";
      controls.disabled = true;
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.setAttribute("aria-label", m.enabled);
      const toggle = document.createElement("label");
      toggle.className =
        "flex items-center gap-2 rounded-lg border border-settings-border bg-settings-panel p-4 text-sm font-semibold text-settings-text";
      toggle.append(enabled, m.enabled);
      const primaries = createPreferenceGroup(document, m.primary);
      const backups = createPreferenceGroup(document, m.backups);
      const latest = document.createElement("p");
      latest.className = "text-xs text-settings-muted";
      const form = document.createElement("form");
      form.className =
        "mt-4 grid gap-3 rounded-lg border border-settings-border bg-settings-panel p-4";
      form.hidden = true;
      const fields = new Map<string, HTMLInputElement>();
      for (const [key, title, type] of [
        ["name", m.name, "text"],
        ["baseUrl", m.url, "url"],
        ["apiKey", m.key, "password"],
        ["model", m.model, "text"],
      ]) {
        if (!key || !title || !type) {
          continue;
        }
        const label = document.createElement("label");
        label.className = "grid gap-1 text-xs text-settings-muted";
        const input = document.createElement("input");
        input.type = type;
        input.name = key;
        input.autocomplete = "off";
        input.spellcheck = false;
        input.required = key === "name" || key === "baseUrl";
        input.setAttribute("aria-label", title);
        input.className =
          "rounded-md border border-settings-border bg-settings-surface px-3 py-2 text-sm text-settings-text outline-settings-focus";
        label.append(title, input);
        form.append(label);
        fields.set(key, input);
      }
      const clearKey = () => {
        const input = fields.get("apiKey");
        if (input) {
          input.value = "";
        }
      };
      const keyHelp = document.createElement("p");
      keyHelp.id = "codexhost-provider-key-help";
      keyHelp.className = "text-xs text-settings-muted";
      fields.get("apiKey")?.setAttribute("aria-describedby", keyHelp.id);
      form.append(keyHelp);
      const participation = document.createElement("input");
      participation.type = "checkbox";
      participation.setAttribute("aria-label", m.active);
      const participationLabel = document.createElement("label");
      participationLabel.className = "flex items-center gap-2 text-sm text-settings-text";
      participationLabel.append(participation, m.active);
      form.append(participationLabel);
      let snapshot: ProviderRoutingSnapshot | null = null;
      let editing: string | null = null;
      let original: ProviderRoutingSnapshot["providers"][number] | undefined;
      let busy = false;
      let available = false;
      let selectedHost = current;
      const resolveClient = (hostId: string) => {
        const exact = source?.clientForHost?.(hostId) ?? null;
        if (exact?.providerRouting) return exact;
        if (hostId === source?.currentHostId?.() && source?.providerRouting) return source;
        return null;
      };
      let client = resolveClient(current);
      const button = (label: string, click: () => void) => {
        const control = document.createElement("button");
        control.type = "button";
        control.textContent = label;
        control.className =
          "rounded-md border border-settings-border bg-settings-surface px-3 py-1.5 text-xs text-settings-text hover:bg-settings-surface-hover focus-visible:outline-2 focus-visible:outline-settings-focus disabled:opacity-40";
        control.addEventListener("click", click);
        return control;
      };
      const canDiscard = () => {
        const dirty =
          !form.hidden &&
          ([...fields].some(
            ([name, input]) =>
              input.value !==
              (name === "apiKey"
                ? ""
                : String(original?.[name as "name" | "baseUrl" | "model"] ?? "")),
          ) ||
            participation.checked !== (original?.enabled ?? true));
        return !dirty || Boolean(document.defaultView?.confirm(m.confirmDiscard));
      };
      const closeEditor = () => {
        form.hidden = true;
        editing = null;
        original = undefined;
        for (const input of fields.values()) input.value = "";
      };
      const updateKeyRequirement = () => {
        const key = fields.get("apiKey");
        if (!key) return;
        const changed = original && fields.get("baseUrl")?.value.trim() !== original.baseUrl;
        key.required = !original?.keyConfigured || Boolean(changed);
        key.placeholder = key.required ? m.keyRequired : m.keyKeep;
        keyHelp.textContent = changed ? m.keyChanged : key.placeholder;
      };
      fields.get("baseUrl")?.addEventListener("input", updateKeyRequirement);
      const edit = (provider?: ProviderRoutingSnapshot["providers"][number]) => {
        if (busy || !available) return;
        if (provider?.id === editing) {
          fields.get("name")?.focus();
          return;
        }
        if (!canDiscard()) return;
        editing = provider?.id ?? crypto.randomUUID();
        original = provider;
        for (const [key, input] of fields) {
          input.value =
            key === "apiKey" ? "" : String(provider?.[key as "name" | "baseUrl" | "model"] ?? "");
        }
        updateKeyRequirement();
        participation.checked = provider?.enabled ?? true;
        form.hidden = false;
        fields.get("name")?.focus();
      };
      const formatTime = (at: number) => new Date(at).toLocaleString(messages.locale);
      const appendFailure = (row: HTMLElement, value: ProviderRoutingSnapshot, id: string) => {
        const failure = value.failures?.find((item) => item.provider === id);
        if (!failure) return;
        const detail = document.createElement("p");
        detail.className = "text-xs text-settings-muted";
        const cooldown =
          failure.retryAt > 0
            ? ` · ${failure.retryAt > Date.now() ? m.cooldown : m.cooldownEnded} ${formatTime(failure.retryAt)}`
            : "";
        detail.textContent = `${m.failure}: ${m.failureKinds[failure.kind]}${failure.status === undefined ? "" : ` (${failure.status})`} · ${formatTime(failure.at)}${cooldown}`;
        row.append(detail);
      };
      const render = (value: ProviderRoutingSnapshot) => {
        snapshot = value;
        available = true;
        enabled.checked = value.enabled;
        const pending = [
          ...(!value.ready ? [m.runtimePending] : []),
          ...(!value.primaryProviders.some((provider) => provider.covered)
            ? [m.primaryPending]
            : []),
          ...(!value.providers.some((provider) => provider.enabled && provider.keyConfigured)
            ? [m.needsFallback]
            : []),
        ];
        status.textContent = !value.enabled
          ? m.off
          : pending.length
            ? `${m.notReady}: ${pending.join("; ")}`
            : m.on;
        status.setAttribute("role", "status");
        primaries.card.replaceChildren();
        for (const provider of value.primaryProviders) {
          const row = document.createElement("div");
          row.className =
            "grid gap-1 border-b border-settings-divider px-4 py-3 text-sm text-settings-text last:border-b-0";
          const title = document.createElement("strong");
          title.textContent = `${provider.name} · ${provider.covered ? m.covered : m.pending}`;
          const endpoint = document.createElement("span");
          endpoint.className = "break-all text-xs text-settings-muted";
          endpoint.textContent = provider.baseUrl;
          row.append(title, endpoint);
          appendFailure(row, value, `primary:${provider.id}`);
          primaries.card.append(row);
        }
        if (!value.primaryProviders.length) {
          primaries.card.textContent = m.noPrimary;
        }
        backups.card.replaceChildren();
        for (const [index, provider] of value.providers.entries()) {
          const row = document.createElement("div");
          row.className =
            "flex flex-wrap items-center gap-2 border-b border-settings-divider px-4 py-3 last:border-b-0";
          const copy = document.createElement("div");
          copy.className = "min-w-0 basis-full text-sm text-settings-text sm:basis-0 sm:flex-1";
          const title = document.createElement("strong");
          title.textContent = `${index + 1}. ${provider.name}${provider.enabled ? "" : ` · ${m.inactive}`}`;
          const detail = document.createElement("div");
          detail.className = "break-all text-xs text-settings-muted";
          detail.textContent = `${provider.baseUrl} · ${provider.model || m.originalModel} · ${provider.keyConfigured ? m.keySaved : m.keyMissing}`;
          copy.append(title, detail);
          appendFailure(copy, value, provider.id);
          const up = button(m.up, () => {
            void run({ action: "move", id: provider.id, direction: "up" });
          });
          const down = button(m.down, () => {
            void run({ action: "move", id: provider.id, direction: "down" });
          });
          up.disabled = index === 0;
          down.disabled = index === value.providers.length - 1;
          const editButton = button(m.edit, () => edit(provider));
          const remove = button(m.remove, () => {
            if (busy || !available) return;
            if (document.defaultView?.confirm(`${m.confirmRemove} (${provider.name})`)) {
              void run({ action: "remove", id: provider.id });
            }
          });
          for (const control of [up, down, editButton, remove]) {
            control.setAttribute("aria-label", `${control.textContent}: ${provider.name}`);
          }
          row.append(copy, up, down, editButton, remove);
          backups.card.append(row);
        }
        if (!value.providers.length) {
          backups.card.textContent = m.empty;
        }
        const last = value.lastRoute;
        const target = last
          ? ((last.fallback
              ? value.providers.find((provider) => provider.id === last.provider)?.name
              : value.primaryProviders.find(
                  (provider) => `primary:${provider.id}` === last.provider,
                )?.name) ?? last.provider)
          : m.none;
        latest.textContent = `${m.latest}: ${target}${last ? ` · ${formatTime(last.at)}` : ""}`;
      };
      const run = async (params: ProviderRoutingParams) => {
        if (busy || context.signal.aborted || (params.action !== "read" && !available)) {
          return;
        }
        // Host 更新不要求重开设置页；刷新时重新解析，拿到刚发布的 provider RPC。
        client = resolveClient(selectedHost);
        if (!client?.providerRouting) {
          available = false;
          controls.disabled = true;
          status.textContent = m.unavailable;
          status.setAttribute("role", "alert");
          return;
        }
        busy = true;
        controls.disabled = true;
        host.disabled = true;
        refresh.disabled = true;
        root.setAttribute("aria-busy", "true");
        status.textContent = params.action === "read" ? m.loading : m.saving;
        status.setAttribute("role", "status");
        let editorClosed = false;
        try {
          const value = await client.providerRouting(params);
          if (context.signal.aborted) {
            return;
          }
          render(value);
          if (params.action === "save" || (params.action === "remove" && params.id === editing)) {
            closeEditor();
            editorClosed = true;
          }
        } catch (error) {
          if (!context.signal.aborted) {
            if (params.action === "read" || error instanceof RendererMethodUnavailableError) {
              available = false;
            }
            status.textContent =
              error instanceof RendererMethodUnavailableError
                ? m.unavailable
                : error instanceof Error
                  ? error.message
                  : m.error;
            status.setAttribute("role", "alert");
            if (snapshot) {
              enabled.checked = snapshot.enabled;
            }
          }
        } finally {
          busy = false;
          controls.disabled = !available;
          host.disabled = false;
          refresh.disabled = false;
          root.setAttribute("aria-busy", "false");
          if (editorClosed && !context.signal.aborted) add.focus();
        }
      };
      const save = button(m.save, () => {});
      save.type = "submit";
      form.append(
        save,
        button(m.cancel, () => {
          closeEditor();
          add.focus();
        }),
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!editing) {
          return;
        }
        const apiKey = fields.get("apiKey")?.value.trim();
        updateKeyRequirement();
        if (fields.get("apiKey")?.required && !apiKey) {
          status.textContent = m.keyRequired;
          status.setAttribute("role", "alert");
          fields.get("apiKey")?.focus();
          return;
        }
        void run({
          action: "save",
          provider: {
            id: editing,
            name: fields.get("name")?.value ?? "",
            baseUrl: fields.get("baseUrl")?.value ?? "",
            model: fields.get("model")?.value ?? "",
            enabled: participation.checked,
          },
          ...(apiKey ? { apiKey } : {}),
        });
      });
      enabled.addEventListener("change", () => {
        void run({ action: "configure", enabled: enabled.checked });
      });
      host.addEventListener("change", () => {
        if (busy || !canDiscard()) {
          host.value = selectedHost;
          return;
        }
        selectedHost = host.value;
        client = resolveClient(selectedHost);
        snapshot = null;
        available = false;
        controls.disabled = true;
        enabled.checked = false;
        closeEditor();
        primaries.card.replaceChildren();
        backups.card.replaceChildren();
        latest.textContent = "";
        void run({ action: "read" });
      });
      const add = button(m.add, () => edit());
      const refresh = button(m.refresh, () => {
        void run({ action: "read" });
      });
      controls.append(toggle, primaries.group, backups.group, add, form, latest);
      root.append(heading, hostLabel, status, controls, refresh);
      context.content.append(root);
      void run({ action: "read" });
      return () => {
        clearKey();
      };
    },
  });
}
