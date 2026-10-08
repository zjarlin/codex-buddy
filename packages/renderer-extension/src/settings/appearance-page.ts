import {
  REASONING_SOFT_WRAP_CHANGE_EVENT,
  readReasoningTranscriptSoftWrap,
  setReasoningTranscriptSoftWrap,
} from "../renderer-transcript-dom.js";
import {
  RENDERER_SPEECH_CHANGE_EVENT,
  readRendererSpeechEnabled,
  writeRendererSpeechEnabled,
} from "../renderer-speech-preference.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import type { RendererSettingsMessages } from "./localization.js";
import { mountIdleReleaseControls } from "./idle-release-controls.js";
import type { LoadedSessionsClient } from "./loaded-sessions-table.js";
import { mountTerminalControls, type RendererThreadTerminalClient } from "./terminal-controls.js";
import {
  createPreferenceGroup,
  createPreferenceItem,
  createPreferenceSwitch,
  preferenceId,
} from "./preference-ui.js";

export function createAppearanceSettingsPage(
  messages: RendererSettingsMessages,
  getLoadedSessionsClient: () => LoadedSessionsClient | null = () => null,
  getThreadTerminalClient: () => RendererThreadTerminalClient | null = () => null,
): RendererSettingsPageDefinition {
  return Object.freeze({
    id: "appearance",
    label: messages.pageLabels.appearance,
    icon: "settings",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const ownerWindow = document.defaultView;
      if (!ownerWindow) return;
      const heading = document.createElement("div");
      heading.className = "settings-section-label";
      heading.textContent = messages.pageLabels.appearance;

      const description = document.createElement("p");
      description.className = "settings-page-description";
      description.textContent = messages.appearanceDescription;

      const { group, card } = createPreferenceGroup(document, messages.appearanceGroup);
      const speechId = preferenceId("speech-announcement");
      const speechRow = createPreferenceItem(document, {
        title: messages.speechAnnouncementTitle,
        description: messages.speechAnnouncementDescription,
        controlId: speechId,
      });
      const speechToggle = createPreferenceSwitch(document, speechId, speechRow.description.id);
      speechToggle.checked = readRendererSpeechEnabled(ownerWindow);
      speechToggle.addEventListener("change", () => {
        if (!writeRendererSpeechEnabled(ownerWindow, speechToggle.checked)) {
          speechToggle.checked = readRendererSpeechEnabled(ownerWindow);
        }
      });
      // 播报开关默认开启，其他窗口或存储事件的修改要立即反映到界面。
      const syncSpeech = (): void => {
        speechToggle.checked = readRendererSpeechEnabled(ownerWindow);
      };
      ownerWindow.addEventListener(RENDERER_SPEECH_CHANGE_EVENT, syncSpeech);
      speechRow.item.append(speechToggle);
      card.append(speechRow.item);

      const softWrapId = preferenceId("reasoning-soft-wrap");
      const row = createPreferenceItem(document, {
        title: messages.reasoningSoftWrapTitle,
        description: messages.reasoningSoftWrapDescription,
        controlId: softWrapId,
      });
      const toggle = createPreferenceSwitch(document, softWrapId, row.description.id);
      toggle.checked = readReasoningTranscriptSoftWrap(ownerWindow);
      toggle.addEventListener("change", () => {
        setReasoningTranscriptSoftWrap(ownerWindow, toggle.checked);
      });
      const sync = (): void => {
        toggle.checked = readReasoningTranscriptSoftWrap(ownerWindow);
      };
      ownerWindow.addEventListener(REASONING_SOFT_WRAP_CHANGE_EVENT, sync);
      row.item.append(toggle);
      card.append(row.item);

      context.content.append(heading, description, group);
      const disposeTerminal = mountTerminalControls(context, messages, getThreadTerminalClient);
      const disposeIdleRelease = mountIdleReleaseControls(
        context,
        messages,
        getLoadedSessionsClient,
      );
      return () => {
        disposeTerminal();
        ownerWindow.removeEventListener(REASONING_SOFT_WRAP_CHANGE_EVENT, sync);
        ownerWindow.removeEventListener(RENDERER_SPEECH_CHANGE_EVENT, syncSpeech);
        disposeIdleRelease();
      };
    },
  });
}
