import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";

export interface EmergencyProviderClient {
  emergencyProvider?(config: {
    apiKey?: string | null | undefined;
    baseURL?: string | null | undefined;
    enabled?: boolean;
  }): Promise<{
    emergencyConfigured: boolean;
    emergencyEnabled: boolean;
    emergencyBaseUrl: string | null;
  }>;
}

const defaultResult = {
  emergencyConfigured: false,
  emergencyEnabled: false,
  emergencyBaseUrl: null,
};

export function createEmergencyProviderSettingsPage(
  messages: RendererSettingsMessages,
  getClient: () => EmergencyProviderClient | null,
): RendererSettingsPageDefinition {
  return Object.freeze({
    id: "emergency-provider",
    label: messages.pageLabels["emergency-provider"] ?? "Emergency Provider",
    icon: "alert",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const root = document.createElement("div");
      root.className = "settings-emergency-provider";

      const heading = document.createElement("h1");
      heading.className = "settings-section-label";
      heading.textContent = messages.pageLabels["emergency-provider"] ?? "Emergency Provider";
      root.append(heading);

      const description = document.createElement("p");
      description.className = "settings-description";
      description.textContent =
        messages.emergencyProvider?.description ??
        "When the primary upstream is unreachable, Codex automatically routes inference through this emergency provider.";
      root.append(description);

      const warning = document.createElement("p");
      warning.className = "settings-warning";
      warning.setAttribute("role", "note");
      warning.textContent =
        messages.emergencyProvider?.warning ??
        "⚠️ During failover, conversation content is sent to the emergency upstream.";
      root.append(warning);

      const status = document.createElement("p");
      status.className = "settings-status";
      status.setAttribute("aria-live", "polite");
      root.append(status);

      const form = document.createElement("div");
      form.className = "settings-form";

      const urlLabel = document.createElement("label");
      urlLabel.className = "settings-field";
      const urlCopy = document.createElement("span");
      const urlTitle = document.createElement("b");
      urlTitle.textContent = messages.emergencyProvider?.baseUrlLabel ?? "Base URL";
      const urlHint = document.createElement("small");
      urlHint.textContent =
        messages.emergencyProvider?.baseUrlHint ?? "e.g. https://sub2api.shrimpman.top";
      urlCopy.append(urlTitle, urlHint);
      const urlInput = document.createElement("input");
      urlInput.type = "url";
      urlInput.autocomplete = "off";
      urlInput.spellcheck = false;
      urlInput.placeholder = "https://sub2api.shrimpman.top";
      urlInput.setAttribute("aria-label", messages.emergencyProvider?.baseUrlLabel ?? "Base URL");
      urlLabel.append(urlCopy, urlInput);
      form.append(urlLabel);

      const keyLabel = document.createElement("label");
      keyLabel.className = "settings-field";
      const keyCopy = document.createElement("span");
      const keyTitle = document.createElement("b");
      keyTitle.textContent = messages.emergencyProvider?.apiKeyLabel ?? "API Key";
      const keyHint = document.createElement("small");
      keyHint.textContent =
        messages.emergencyProvider?.apiKeyHint ??
        "Stored on this Host only; never returned to the UI";
      keyCopy.append(keyTitle, keyHint);
      const keyInput = document.createElement("input");
      keyInput.type = "password";
      keyInput.autocomplete = "off";
      keyInput.spellcheck = false;
      keyInput.placeholder = messages.emergencyProvider?.apiKeyPlaceholder ?? "Paste API key";
      keyInput.setAttribute("aria-label", messages.emergencyProvider?.apiKeyLabel ?? "API Key");
      keyLabel.append(keyCopy, keyInput);
      form.append(keyLabel);

      const enabledLabel = document.createElement("label");
      enabledLabel.className = "settings-field settings-field--checkbox";
      const enabledInput = document.createElement("input");
      enabledInput.type = "checkbox";
      enabledInput.checked = true;
      const enabledText = document.createElement("span");
      enabledText.textContent =
        messages.emergencyProvider?.enabledLabel ?? "Enable automatic failover";
      enabledLabel.append(enabledInput, enabledText);
      form.append(enabledLabel);

      const actions = document.createElement("div");
      actions.className = "settings-actions";
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "settings-command-button";
      saveButton.append(
        createRendererSettingsIcon("check", 16),
        messages.emergencyProvider?.save ?? "Save",
      );
      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "settings-command-button settings-command-button--secondary";
      clearButton.append(
        createRendererSettingsIcon("trash", 16),
        messages.emergencyProvider?.clear ?? "Clear",
      );
      actions.append(saveButton, clearButton);
      form.append(actions);
      root.append(form);

      let disposed = false;
      context.signal.addEventListener("abort", () => {
        disposed = true;
      });

      const renderStatus = (configured: boolean, enabled: boolean, baseUrl: string | null) => {
        if (disposed) return;
        if (!configured) {
          status.textContent = messages.emergencyProvider?.statusNotConfigured ?? "Not configured";
          status.setAttribute("role", "status");
          return;
        }
        const parts = [messages.emergencyProvider?.statusConfigured ?? "Configured"];
        parts.push(
          enabled
            ? (messages.emergencyProvider?.statusEnabled ?? "failover active")
            : (messages.emergencyProvider?.statusDisabled ?? "failover disabled"),
        );
        if (baseUrl) parts.push(baseUrl);
        status.textContent = parts.join(" · ");
        status.setAttribute("role", "status");
      };

      const load = async () => {
        const client = getClient();
        if (!client) {
          status.textContent = messages.emergencyProvider?.unavailable ?? "Host is unavailable";
          return;
        }
        try {
          const result = await (client.emergencyProvider?.({}) ?? Promise.resolve(defaultResult));
          if (disposed) return;
          renderStatus(
            result.emergencyConfigured,
            result.emergencyEnabled,
            result.emergencyBaseUrl,
          );
          if (result.emergencyBaseUrl) urlInput.value = result.emergencyBaseUrl;
          enabledInput.checked = result.emergencyEnabled;
        } catch (error) {
          if (disposed) return;
          status.textContent = error instanceof Error ? error.message : String(error);
          status.setAttribute("role", "alert");
        }
      };

      saveButton.addEventListener("click", () => {
        void (async () => {
          const client = getClient();
          if (!client || disposed) return;
          const typedKey = keyInput.value.trim();
          const config: { apiKey?: string; baseURL: string | null; enabled: boolean } = {
            baseURL: urlInput.value.trim() || null,
            enabled: enabledInput.checked,
          };
          if (typedKey) config.apiKey = typedKey;
          try {
            const result = await (client.emergencyProvider?.(config) ??
              Promise.resolve(defaultResult));
            keyInput.value = "";
            if (!disposed)
              renderStatus(
                result.emergencyConfigured,
                result.emergencyEnabled,
                result.emergencyBaseUrl,
              );
          } catch (error) {
            if (!disposed) {
              status.textContent = error instanceof Error ? error.message : String(error);
              status.setAttribute("role", "alert");
            }
          }
        })();
      });

      clearButton.addEventListener("click", () => {
        void (async () => {
          const client = getClient();
          if (!client || disposed) return;
          try {
            const result = await (client.emergencyProvider?.({
              apiKey: null,
              baseURL: null,
              enabled: false,
            }) ?? Promise.resolve(defaultResult));
            keyInput.value = "";
            urlInput.value = "";
            enabledInput.checked = false;
            if (!disposed)
              renderStatus(
                result.emergencyConfigured,
                result.emergencyEnabled,
                result.emergencyBaseUrl,
              );
          } catch (error) {
            if (!disposed) {
              status.textContent = error instanceof Error ? error.message : String(error);
              status.setAttribute("role", "alert");
            }
          }
        })();
      });

      void load();
      return undefined;
    },
  });
}
