/** 双栏偏好的持久化。默认开启，右栏默认模型为 ds。 */
export const DUAL_LANE_STORAGE_KEY = "codexhost.dual-lane.v1";
export const DUAL_LANE_CHANGE_EVENT = "codexhost:dual-lane-changed";

export interface DualLaneSettings {
  /** 默认开启：进入会话即自动展开右栏 side chat。 */
  enabled: boolean;
  /** 左栏（主栏）默认模型 ID；空字符串表示沿用原生选择。 */
  mainModel: string;
  /** 右栏（侧边聊天）默认模型 ID；空字符串表示沿用主栏模型。 */
  sideModel: string;
}

export const DEFAULT_DUAL_LANE_SETTINGS: DualLaneSettings = Object.freeze({
  enabled: true,
  mainModel: "free",
  sideModel: "ds",
});

function readModel(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/** 偏好值非法或缺失时回落到默认双栏，而不是静默关闭功能。 */
export function parseDualLaneSettings(value: unknown): DualLaneSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { ...DEFAULT_DUAL_LANE_SETTINGS };
  const record = value as Record<string, unknown>;
  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : DEFAULT_DUAL_LANE_SETTINGS.enabled,
    mainModel: readModel(record.mainModel, DEFAULT_DUAL_LANE_SETTINGS.mainModel),
    sideModel: readModel(record.sideModel, DEFAULT_DUAL_LANE_SETTINGS.sideModel),
  };
}

export function readDualLaneSettings(owner: Window): DualLaneSettings {
  try {
    const raw = owner.localStorage.getItem(DUAL_LANE_STORAGE_KEY);
    return raw ? parseDualLaneSettings(JSON.parse(raw)) : { ...DEFAULT_DUAL_LANE_SETTINGS };
  } catch {
    return { ...DEFAULT_DUAL_LANE_SETTINGS };
  }
}

export function writeDualLaneSettings(owner: Window, settings: DualLaneSettings): boolean {
  try {
    owner.localStorage.setItem(DUAL_LANE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    return false;
  }
  owner.dispatchEvent(new Event(DUAL_LANE_CHANGE_EVENT));
  return true;
}
