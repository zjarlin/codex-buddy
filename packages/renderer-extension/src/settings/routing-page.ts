import type { BuddySettings, BuddySnapshot } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";
import { RendererMethodUnavailableError } from "../renderer-request-sender.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";
import { createPreferenceSwitch, preferenceId } from "./preference-ui.js";

const copy = {
  "zh-CN": {
    enabled: "自动路由",
    privateMode: "隐私模式",
    bypass: "工具与 Git 旁路",
    jev: "System One 判断",
    model: "System One 模型",
    role: "执行角色",
    executor: "执行模型",
    automatic: "自动选择",
    git: "Git",
    io: "文件与命令",
    executorRole: "通用",
    url: "JEV 网关地址",
    key: "JEV API Key",
    save: "保存设置",
    saveKey: "保存连接",
    clear: "清除连接",
    refresh: "刷新模型",
    loading: "正在读取…",
    saved: "已保存",
    configured: "密钥已配置",
    notConfigured: "密钥未配置",
    unavailable: "当前连接不支持路由设置。",
    routerOff: "自动路由已关闭，发送前不会调用 System One。",
    judgeOff: "System One 判断已关闭，使用本地规则。",
    noKey: "System One 密钥未配置，使用本地规则。",
    ready: "发送前由 System One 判断意图、难度与动作。",
    lastDecision: "最近一次判断",
    localRules: "本地规则",
    noDecision: "未调用 System One",
  },
  en: {
    enabled: "Automatic routing",
    privateMode: "Private mode",
    bypass: "Tool and Git bypass",
    jev: "System One judgment",
    model: "System One model",
    role: "Execution role",
    executor: "Execution model",
    automatic: "Automatic",
    git: "Git",
    io: "Files and commands",
    executorRole: "General",
    url: "JEV gateway URL",
    key: "JEV API Key",
    save: "Save settings",
    saveKey: "Save connection",
    clear: "Clear connection",
    refresh: "Refresh models",
    loading: "Loading…",
    saved: "Saved",
    configured: "Key configured",
    notConfigured: "Key not configured",
    unavailable: "Routing settings are unavailable on this connection.",
    routerOff: "Automatic routing is off. System One will not run before sending.",
    judgeOff: "System One judgment is off. Local rules are used.",
    noKey: "No System One key is configured. Local rules are used.",
    ready: "System One judges intent, difficulty, and actions before sending.",
    lastDecision: "Latest judgment",
    localRules: "Local rules",
    noDecision: "System One was not called",
  },
} as const;

export function createRoutingSettingsPage(
  messages: RendererSettingsMessages,
  getClient: () => RendererModelClient | null,
): RendererSettingsPageDefinition {
  return Object.freeze({
    id: "routing",
    label: messages.pageLabels.routing,
    icon: "routes",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const m = copy[messages.locale];
      const heading = document.createElement("h1");
      heading.className = "settings-section-label";
      heading.textContent = messages.pageLabels.routing;
      const routingStatus = document.createElement("p");
      routingStatus.className = "settings-routing-judgment";
      const lastDecision = document.createElement("p");
      lastDecision.className = "settings-routing-decision";
      const status = document.createElement("p");
      status.setAttribute("role", "status");
      status.className = "settings-routing-status";
      const form = document.createElement("form");
      form.className = "settings-routing-form";
      const fields = document.createElement("fieldset");
      const controls = new Map<keyof BuddySettings, HTMLInputElement | HTMLSelectElement>();
      let snapshot: BuddySnapshot | null = null;
      let client = getClient();
      let busy = false;
      const row = (label: string, control: HTMLInputElement | HTMLSelectElement): void => {
        const wrapper = document.createElement("label");
        const title = document.createElement("span");
        title.textContent = label;
        control.setAttribute("aria-label", label);
        wrapper.append(title, control);
        fields.append(wrapper);
      };
      const toggle = (key: "enabled" | "privateMode" | "bypass" | "jev") => {
        const control = createPreferenceSwitch(document, preferenceId(key), "");
        controls.set(key, control);
        row(m[key], control);
        return control;
      };
      const enabledControl = toggle("enabled");
      const privateModeControl = toggle("privateMode");
      toggle("bypass");
      const jevControl = toggle("jev");
      const select = (
        key: keyof BuddySettings,
        label: string,
        entries: readonly (readonly [string, string])[],
      ) => {
        const control = document.createElement("select");
        for (const [value, text] of entries) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          control.append(option);
        }
        controls.set(key, control);
        row(label, control);
        return control;
      };
      const systemOneModel = select("systemOneModel", m.model, [
        ["typesafe/jev", "JEV"],
        ["laya", "Laya"],
      ]);
      select("role", m.role, [
        ["auto", m.automatic],
        ["git", m.git],
        ["io", m.io],
        ["executor", m.executorRole],
      ]);
      const executor = select("executorModel", m.executor, [["", m.automatic]]);
      const url = document.createElement("input");
      url.type = "url";
      url.autocomplete = "off";
      row(m.url, url);
      const key = document.createElement("input");
      key.type = "password";
      key.autocomplete = "off";
      row(m.key, key);
      const keyStatus = document.createElement("p");
      keyStatus.className = "settings-routing-key-status";
      fields.append(keyStatus);
      const actions = document.createElement("div");
      actions.className = "settings-routing-actions";
      const recoveries = document.createElement("div");
      recoveries.className = "settings-routing-recoveries";
      const button = (text: string, icon: "check" | "refresh" | "trash", action: () => void) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "settings-command-button settings-command-button--secondary";
        element.append(createRendererSettingsIcon(icon, 16), text);
        element.addEventListener("click", action);
        actions.append(element);
        return element;
      };
      const synchronize = (): void => {
        const privateMode = privateModeControl.checked;
        const enabled = enabledControl.checked;
        const jev = jevControl.checked;
        fields.disabled = busy || !snapshot;
        for (const [name, control] of controls) {
          control.disabled =
            name === "privateMode" ? false : privateMode || (name !== "enabled" && !enabled);
        }
        systemOneModel.disabled ||= !jev;
        url.disabled = key.disabled = privateMode || !enabled || !jev || !client?.buddyJevKey;
        for (const element of actions.querySelectorAll("button"))
          element.disabled = busy || !snapshot;
        save.disabled ||= !client?.buddyConfigure;
        refresh.disabled ||= privateMode || !client?.buddyModels;
        saveKey.disabled ||= url.disabled;
        clearKey.disabled ||= url.disabled;
        recoveries.hidden = privateMode;
        for (const element of recoveries.querySelectorAll("button"))
          element.disabled = busy || !snapshot || !client?.buddyCancel;
      };
      const populate = (value: BuddySnapshot): void => {
        snapshot = value;
        routingStatus.textContent =
          value.settings.privateMode || !value.settings.enabled
            ? m.routerOff
            : !value.settings.jev
              ? m.judgeOff
              : !value.jevKeyConfigured
                ? m.noKey
                : m.ready;
        const latest = value.decisions.toSorted((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        )[0];
        lastDecision.hidden = !latest;
        const source = latest?.judgment;
        const label =
          source?.source === "system-one"
            ? `System One · ${source.model}`
            : source?.source === "local-rules"
              ? m.localRules
              : m.noDecision;
        lastDecision.textContent = latest ? `${m.lastDecision}：${label} · ${latest.reason}` : "";
        for (const [name, control] of controls) {
          if (control instanceof HTMLInputElement) control.checked = Boolean(value.settings[name]);
          else if (name !== "executorModel") {
            const selected = String(value.settings[name]);
            if (!Array.from(control.options).some((option) => option.value === selected)) {
              const option = document.createElement("option");
              option.value = option.textContent = selected;
              control.append(option);
            }
            control.value = selected;
          }
        }
        const selected = value.settings.executorModel ?? "";
        executor.replaceChildren();
        for (const id of [
          "",
          ...new Set([
            ...value.models.filter((model) => model.eligible).map((model) => model.id),
            ...(selected ? [selected] : []),
          ]),
        ]) {
          const option = document.createElement("option");
          option.value = id;
          option.textContent = id || m.automatic;
          executor.append(option);
        }
        executor.value = selected;
        url.value = value.jevBaseUrl ?? "";
        keyStatus.textContent = value.jevKeyConfigured ? m.configured : m.notConfigured;
        recoveries.replaceChildren();
        for (const decision of value.decisions.filter((item) => item.phase === "retrying")) {
          const item = document.createElement("div");
          const label = document.createElement("span");
          label.textContent = decision.reason;
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "settings-command-button settings-command-button--secondary";
          cancel.append(
            createRendererSettingsIcon("close", 16),
            messages.locale === "zh-CN" ? "取消自动续接" : "Cancel recovery",
          );
          cancel.addEventListener("click", () => {
            run(async (target) => {
              if (!target.buddyCancel) throw new Error(m.unavailable);
              return target.buddyCancel(decision.threadId);
            });
          });
          item.append(label, cancel);
          recoveries.append(item);
        }
      };
      const run = (
        operation: (target: RendererModelClient) => Promise<BuddySnapshot>,
        saved = true,
      ): void => {
        if (busy || context.signal.aborted) return;
        const target = getClient();
        if (!target || (client && client !== target)) {
          status.textContent = m.unavailable;
          snapshot = null;
          synchronize();
          return;
        }
        client = target;
        busy = true;
        synchronize();
        status.textContent = m.loading;
        status.setAttribute("role", "status");
        void context.runLatest(async () => operation(target), {
          success(value) {
            if (getClient() !== target) {
              snapshot = null;
              status.textContent = m.unavailable;
            } else {
              populate(value);
              key.value = "";
              status.textContent = saved ? m.saved : "";
            }
            busy = false;
            synchronize();
          },
          failure(error) {
            busy = false;
            status.textContent =
              error instanceof RendererMethodUnavailableError
                ? m.unavailable
                : error instanceof Error
                  ? error.message
                  : String(error);
            status.setAttribute("role", "alert");
            synchronize();
          },
        });
      };
      const save = button(m.save, "check", () => {
        if (!snapshot || !client?.buddyConfigure || !form.reportValidity()) return;
        const settings = { ...snapshot.settings };
        for (const [name, control] of controls) {
          Object.assign(settings, {
            [name]:
              control instanceof HTMLInputElement
                ? control.checked
                : name === "executorModel"
                  ? control.value || null
                  : control.value,
          });
        }
        run(async (target) => {
          if (!target.buddyConfigure) throw new Error(m.unavailable);
          return target.buddyConfigure(settings);
        });
      });
      const refresh = button(m.refresh, "refresh", () =>
        run(async (target) => {
          if (!target.buddyModels) throw new Error(m.unavailable);
          return target.buddyModels();
        }, false),
      );
      const saveKey = button(m.saveKey, "check", () => {
        if (!form.reportValidity()) return;
        const patch = {
          baseURL: url.value.trim() || null,
          ...(key.value.trim() ? { apiKey: key.value.trim() } : {}),
        };
        run(async (target) => {
          if (!target.buddyJevKey) throw new Error(m.unavailable);
          return target.buddyJevKey(patch);
        });
      });
      const clearKey = button(m.clear, "trash", () =>
        run(async (target) => {
          if (!target.buddyJevKey) throw new Error(m.unavailable);
          return target.buddyJevKey({ apiKey: null, baseURL: null });
        }),
      );
      fields.addEventListener("change", synchronize);
      form.addEventListener("submit", (event) => event.preventDefault());
      form.append(fields, actions, recoveries);
      context.content.append(heading, routingStatus, lastDecision, status, form);
      run(async (target) => {
        if (!target.buddyStatus) throw new Error(m.unavailable);
        return target.buddyStatus();
      }, false);
      return undefined;
    },
  });
}
