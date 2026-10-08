/** 会话完成语音播报：默认开启的本地偏好，不依赖 Host 存储。 */
export const RENDERER_SPEECH_STORAGE_KEY = "codexhost.speech-announcement.v1";
export const RENDERER_SPEECH_CHANGE_EVENT = "codexhost:speech-announcement-changed";

export function readRendererSpeechEnabled(owner: Window): boolean {
  try {
    // 只有显式存过 "false" 才算关闭，缺省与损坏值都视为默认开启。
    return owner.localStorage.getItem(RENDERER_SPEECH_STORAGE_KEY) !== "false";
  } catch {
    /* 偏好存储不可用时保持默认开启，播报失败由播报器自行降级。 */
    return true;
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
