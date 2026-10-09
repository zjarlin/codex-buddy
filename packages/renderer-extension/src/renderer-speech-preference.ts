/** 自动播报默认关闭；新版偏好不继承旧版默认开启的记录。 */
export const RENDERER_SPEECH_STORAGE_KEY = "codexhost.speech-announcement.v2";
export const RENDERER_SPEECH_CHANGE_EVENT = "codexhost:speech-announcement-changed";

export function readRendererSpeechEnabled(owner: Window): boolean {
  try {
    return owner.localStorage.getItem(RENDERER_SPEECH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeRendererSpeechEnabled(owner: Window, enabled: boolean): boolean {
  try {
    owner.localStorage.setItem(RENDERER_SPEECH_STORAGE_KEY, String(enabled));
  } catch {
    return false;
  }
  owner.dispatchEvent(new Event(RENDERER_SPEECH_CHANGE_EVENT));
  return true;
}
