import {
  createPreferenceGroup,
  createPreferenceItem,
  createPreferenceSwitch,
  preferenceId,
} from "../settings/preference-ui.js";
import type { RendererSettingsMessages } from "../settings/localization.js";
import {
  DUAL_LANE_CHANGE_EVENT,
  type DualLaneSettings,
  readDualLaneSettings,
  writeDualLaneSettings,
} from "./preference.js";

function modelField(
  doc: Document,
  input: { id: string; describedBy: string; value: string; label: string },
): HTMLInputElement {
  const control = doc.createElement("input");
  control.type = "text";
  control.id = input.id;
  control.value = input.value;
  control.spellcheck = false;
  control.autocomplete = "off";
  control.setAttribute("aria-label", input.label);
  control.setAttribute("aria-describedby", input.describedBy);
  control.className =
    "h-8 w-40 shrink-0 rounded-md border border-settings-border bg-settings-surface px-2.5 text-[13px] leading-5 text-settings-text tabular-nums outline-none transition-colors focus:border-settings-focus";
  return control;
}

/**
 * 外观页里的双栏设置。模型写成原生模型 ID（例如 free、ds），留空表示
 * 右栏沿用主栏、主栏沿用原生选择。
 */
export function mountDualLaneControls(
  content: HTMLElement,
  messages: RendererSettingsMessages,
): () => void {
  const doc = content.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => undefined;

  const { group, card } = createPreferenceGroup(doc, messages.dualLaneGroup);

  const enabledId = preferenceId("dual-lane-enabled");
  const enabledRow = createPreferenceItem(doc, {
    title: messages.dualLaneEnabledTitle,
    description: messages.dualLaneEnabledDescription,
    controlId: enabledId,
    help: { label: messages.dualLaneHelpLabel, lines: messages.dualLaneHelp },
  });
  const enabledToggle = createPreferenceSwitch(doc, enabledId, enabledRow.description.id);
  enabledRow.item.append(enabledToggle);
  card.append(enabledRow.item);

  const mainId = preferenceId("dual-lane-main-model");
  const mainRow = createPreferenceItem(doc, {
    title: messages.dualLaneMainModelTitle,
    description: messages.dualLaneMainModelDescription,
    controlId: mainId,
  });
  const mainField = modelField(doc, {
    id: mainId,
    describedBy: mainRow.description.id,
    value: "",
    label: messages.dualLaneMainModelTitle,
  });
  mainRow.item.append(mainField);
  card.append(mainRow.item);

  const sideId = preferenceId("dual-lane-side-model");
  const sideRow = createPreferenceItem(doc, {
    title: messages.dualLaneSideModelTitle,
    description: messages.dualLaneSideModelDescription,
    controlId: sideId,
  });
  const sideField = modelField(doc, {
    id: sideId,
    describedBy: sideRow.description.id,
    value: "",
    label: messages.dualLaneSideModelTitle,
  });
  sideRow.item.append(sideField);
  card.append(sideRow.item);

  const sync = (): void => {
    const settings = readDualLaneSettings(win);
    enabledToggle.checked = settings.enabled;
    if (doc.activeElement !== mainField) mainField.value = settings.mainModel;
    if (doc.activeElement !== sideField) sideField.value = settings.sideModel;
    mainField.disabled = !settings.enabled;
    sideField.disabled = !settings.enabled;
  };

  const write = (patch: Partial<DualLaneSettings>): void => {
    const current = readDualLaneSettings(win);
    if (!writeDualLaneSettings(win, { ...current, ...patch })) sync();
  };

  enabledToggle.addEventListener("change", () => write({ enabled: enabledToggle.checked }));
  const commitModel = (field: HTMLInputElement, key: "mainModel" | "sideModel"): void => {
    const value = field.value.trim();
    if (value === readDualLaneSettings(win)[key]) return;
    write({ [key]: value } as Partial<DualLaneSettings>);
  };
  const onMainCommit = (): void => commitModel(mainField, "mainModel");
  const onSideCommit = (): void => commitModel(sideField, "sideModel");
  mainField.addEventListener("change", onMainCommit);
  mainField.addEventListener("blur", onMainCommit);
  sideField.addEventListener("change", onSideCommit);
  sideField.addEventListener("blur", onSideCommit);

  win.addEventListener(DUAL_LANE_CHANGE_EVENT, sync);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null) sync();
  };
  win.addEventListener("storage", onStorage);
  sync();

  content.append(group);
  return () => {
    win.removeEventListener(DUAL_LANE_CHANGE_EVENT, sync);
    win.removeEventListener("storage", onStorage);
    mainField.removeEventListener("change", onMainCommit);
    mainField.removeEventListener("blur", onMainCommit);
    sideField.removeEventListener("change", onSideCommit);
    sideField.removeEventListener("blur", onSideCommit);
  };
}
