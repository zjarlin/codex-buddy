import type { LoadedSessionsClient } from "./settings/loaded-sessions-table.js";
import type { EmergencyProviderClient } from "./settings/emergency-provider-page.js";
import { readCodexLocaleSettings, type CodexLocaleSettings } from "./codex-locale-adapter.js";
import {
  rendererSettingsMessages,
  resolveRendererSettingsLocale,
  type RendererSettingsLocale,
} from "./settings/localization.js";
import {
  createDefaultRendererSettingsPages,
  type RendererConnectionDiagnostics,
  type RendererCodexAccountClient,
  type ProjectSyncClient,
  type RendererUpdateClient,
} from "./settings/pages.js";
import type {
  RendererSessionImportClient,
  RendererImportedThreadOpener,
} from "./settings/session-import-page.js";
import { installRendererSettingsShell, type RendererSettingsShell } from "./settings/shell.js";
import {
  installRendererSettingsRailTrigger,
  type RendererSettingsRailTriggerControl,
  installSystemOneModelHeaderControl,
  type SystemOneModelHeaderControl,
} from "./settings/trigger.js";
import type { RendererModelClient } from "./renderer-model-client.js";
import type { RendererThreadTerminalClient } from "./settings/terminal-controls.js";
import { createRendererUpdateController } from "./settings/update-controller.js";
import { installRendererUpdateNotification } from "./settings/update-notification.js";

export interface RendererSettingsLifecycleOptions {
  getUpdateClient?(): RendererUpdateClient | null;
  getConnectionDiagnostics?(): RendererConnectionDiagnostics | null;
  getAccountClient?(): RendererCodexAccountClient | null;
  getSessionImportClient?(): RendererSessionImportClient | null;
  getLoadedSessionsClient?(): LoadedSessionsClient | null;
  getProjectSyncClient?(): ProjectSyncClient | null;
  getEmergencyProviderClient?(): EmergencyProviderClient | null;
  getBuddyClient?(): RendererModelClient | null;
  getThreadTerminalClient?(): RendererThreadTerminalClient | null;
  openImportedThread?: RendererImportedThreadOpener;
  onLocaleChange?(locale: RendererSettingsLocale): void;
}

export interface RendererSettingsLifecycleControl {
  readonly locale: RendererSettingsLocale;
  refresh(): boolean;
  dispose(): void;
}

export function installRendererSettingsLifecycle(
  ownerWindow: Window = window,
  options: RendererSettingsLifecycleOptions = {},
): RendererSettingsLifecycleControl {
  const lifecycleController = new AbortController();
  let locale = resolveRendererSettingsLocale(ownerWindow.navigator.languages);
  let shell: RendererSettingsShell | null = null;
  let trigger: RendererSettingsRailTriggerControl | null = null;
  let systemOneModel: SystemOneModelHeaderControl | null = null;
  let updateNotification: ReturnType<typeof installRendererUpdateNotification> | null = null;
  const updates = createRendererUpdateController(
    options.getUpdateClient ?? (() => null),
    ownerWindow,
  );
  let localeRequest: Promise<void> | null = null;
  let openGeneration = 0;
  let disposed = false;

  const mount = (): {
    shell: RendererSettingsShell;
    trigger: RendererSettingsRailTriggerControl;
  } => {
    const messages = rendererSettingsMessages(locale);
    const definitions = createDefaultRendererSettingsPages(
      messages,
      () => (updates.available ? updates : null),
      options.getConnectionDiagnostics ?? (() => null),
      options.getAccountClient ?? (() => null),
      options.getSessionImportClient ?? (() => null),
      async (threadId, signal, hostId) => {
        if (!options.openImportedThread) {
          throw new Error("Imported Thread navigation is unavailable");
        }
        if (hostId) await options.openImportedThread(threadId, signal, hostId);
        else await options.openImportedThread(threadId, signal);
        if (!disposed && !signal.aborted) shell?.close();
      },
      options.getLoadedSessionsClient ?? (() => null),
      options.getProjectSyncClient ?? (() => null),
      options.getEmergencyProviderClient ?? (() => null),
      options.getThreadTerminalClient ?? (() => null),
    );
    const nextShell = installRendererSettingsShell(definitions, messages, ownerWindow.document);
    const nextTrigger = installRendererSettingsRailTrigger({
      available: nextShell.supported,
      messages,
      ownerDocument: ownerWindow.document,
      onOpen(opener, pageId) {
        const generation = ++openGeneration;
        void refreshLocale().then(() => {
          if (disposed || generation !== openGeneration) return;
          const currentOpener = opener.isConnected
            ? opener
            : (trigger?.root?.querySelector<HTMLButtonElement>("button") ?? undefined);
          shell?.openSettings(currentOpener, pageId);
        });
      },
    });
    updateNotification = installRendererUpdateNotification({
      controller: updates,
      messages,
      ownerWindow,
      openSettings(button) {
        nextShell.openSettings(button, "updates");
      },
    });
    systemOneModel = installSystemOneModelHeaderControl({
      getClient: options.getBuddyClient ?? (() => null),
      getLocale: () => (locale === "zh-CN" ? "zh-CN" : "en"),
      ownerDocument: ownerWindow.document,
    });
    shell = nextShell;
    trigger = nextTrigger;
    return { shell: nextShell, trigger: nextTrigger };
  };

  const applyLanguageState = (nextLocale: RendererSettingsLocale, preserveOpen: boolean): void => {
    if (disposed) return;
    if (locale === nextLocale) return;

    const reopen = preserveOpen && shell?.open === true;
    const activePageId = shell?.activePageId;
    locale = nextLocale;
    trigger?.dispose();
    shell?.dispose();
    systemOneModel?.dispose();
    updateNotification?.dispose();
    trigger = null;
    shell = null;
    const mounted = mount();
    options.onLocaleChange?.(locale);

    if (reopen) {
      const opener = mounted.trigger.root?.querySelector<HTMLButtonElement>("button") ?? undefined;
      mounted.shell.openSettings(opener, activePageId);
    }
  };

  const applyLocaleSettings = (settings: CodexLocaleSettings, preserveOpen: boolean): void => {
    applyLanguageState(resolveRendererSettingsLocale([settings.preferredLocale]), preserveOpen);
  };

  const refreshLocale = (): Promise<void> => {
    if (localeRequest) return localeRequest;
    const request = readCodexLocaleSettings({
      ownerWindow,
      signal: lifecycleController.signal,
    })
      .then((settings) => {
        applyLocaleSettings(settings, false);
      })
      .catch(() => {
        // The synchronously selected browser locale remains the safe fallback.
      })
      .finally(() => {
        if (localeRequest === request) localeRequest = null;
      });
    localeRequest = request;
    return request;
  };

  mount();
  void refreshLocale();
  updates.refreshBinding();

  return {
    get locale() {
      return locale;
    },
    refresh() {
      const refreshed = trigger?.refresh() ?? false;
      // scan 只负责重新定位控件。System One 的数据由挂载时和显式 refresh 拉取，
      // 避免 MutationObserver 驱动的 scan 反复触发 buddyStatus 请求。
      const systemOneRefreshed = systemOneModel?.reposition?.() ?? false;
      updates.refreshBinding();
      const updateRefreshed = updateNotification?.refresh() ?? false;
      return refreshed || systemOneRefreshed || updateRefreshed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      openGeneration += 1;
      lifecycleController.abort();
      updates.dispose();
      updateNotification?.dispose();
      systemOneModel?.dispose();
      trigger?.dispose();
      shell?.dispose();
      systemOneModel = null;
      trigger = null;
      shell = null;
      updateNotification = null;
    },
  };
}
