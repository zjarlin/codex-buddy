import type { ThreadTerminalDescriptor } from "@codexhost/shared-contracts";

import {
  getSharedThreadTerminalPreferenceStore,
  type ThreadTerminalPreferenceStore,
  watchThreadTerminalPreference,
} from "../thread-terminal-preference.js";
import type { RendererSettingsPageMountContext } from "./core.js";
import type { RendererSettingsMessages } from "./localization.js";
import { createPreferenceGroup, createPreferenceItem, preferenceId } from "./preference-ui.js";

export interface RendererThreadTerminalClient {
  listThreadTerminals(): Promise<{ terminals: readonly ThreadTerminalDescriptor[] }>;
}

function createSelect(document: Document, id: string, describedBy: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.id = id;
  select.setAttribute("aria-describedby", describedBy);
  select.className =
    "h-8 min-w-40 max-w-64 shrink-0 rounded-md border border-settings-border bg-settings-surface px-2 text-[13px] text-settings-text outline-none focus-visible:border-settings-focus";
  return select;
}

export function mountTerminalControls(
  context: RendererSettingsPageMountContext,
  messages: RendererSettingsMessages,
  getClient: () => RendererThreadTerminalClient | null = () => null,
  preference: ThreadTerminalPreferenceStore = getSharedThreadTerminalPreferenceStore(),
): () => void {
  const document = context.content.ownerDocument;
  const ownerWindow = document.defaultView;
  if (!ownerWindow) return () => undefined;
  const { group, card } = createPreferenceGroup(document, messages.terminalSection);
  const id = preferenceId("thread-terminal");
  const row = createPreferenceItem(document, {
    title: messages.terminalTitle,
    description: messages.terminalDescription,
    controlId: id,
  });
  const select = createSelect(document, id, row.description.id);
  row.item.append(select);
  card.append(row.item);
  context.content.append(group);

  let descriptors: ThreadTerminalDescriptor[] = [];
  const render = (): void => {
    select.replaceChildren();
    if (descriptors.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = messages.terminalUnavailable;
      select.append(option);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const selected = preference.get();
    const active = descriptors.some((terminal) => terminal.id === selected && terminal.installed)
      ? selected
      : null;
    const system = document.createElement("option");
    system.value = "";
    system.textContent = messages.terminalSystemDefault;
    select.append(system);
    for (const terminal of descriptors) {
      const option = document.createElement("option");
      option.value = terminal.id;
      option.disabled = !terminal.installed;
      option.textContent = terminal.installed
        ? terminal.name
        : `${terminal.name} (${messages.terminalNotInstalled})`;
      select.append(option);
    }
    select.value = active ?? "";
  };

  const changed = (): void => {
    preference.set(select.value ? (select.value as ThreadTerminalDescriptor["id"]) : null);
  };
  const unwatch = watchThreadTerminalPreference(ownerWindow, render);
  const unsubscribe = preference.subscribe(render);
  select.addEventListener("change", changed);
  render();

  const client = getClient();
  if (client) {
    void context.runLatest(() => client.listThreadTerminals(), {
      success(result) {
        descriptors = [...result.terminals];
        render();
      },
      failure(error) {
        select.replaceChildren();
        const option = document.createElement("option");
        option.value = "";
        option.textContent = `${messages.terminalLoadFailed} ${
          error instanceof Error ? error.message : String(error)
        }`;
        select.append(option);
        select.disabled = true;
      },
    });
  }

  return () => {
    unwatch();
    select.removeEventListener("change", changed);
    unsubscribe();
  };
}
