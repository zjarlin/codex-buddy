import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DUAL_LANE_SETTINGS,
  DUAL_LANE_CHANGE_EVENT,
  DUAL_LANE_STORAGE_KEY,
  parseDualLaneSettings,
  readDualLaneSettings,
  writeDualLaneSettings,
} from "../src/dual-lane/preference.js";

function fakeWindow(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const target = new EventTarget();
  const owner = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  } as unknown as Window;
  return { owner, store };
}

describe("dual lane preference", () => {
  it("defaults to split view with free on the left and ds on the right", () => {
    expect(DEFAULT_DUAL_LANE_SETTINGS).toEqual({
      enabled: true,
      mainModel: "free",
      sideModel: "ds",
    });
    const { owner } = fakeWindow();
    expect(readDualLaneSettings(owner)).toEqual(DEFAULT_DUAL_LANE_SETTINGS);
  });

  it("keeps stored choices and trims whitespace around Model IDs", () => {
    const { owner } = fakeWindow({
      [DUAL_LANE_STORAGE_KEY]: JSON.stringify({
        enabled: false,
        mainModel: " auto ",
        sideModel: "ds",
      }),
    });
    expect(readDualLaneSettings(owner)).toEqual({
      enabled: false,
      mainModel: "auto",
      sideModel: "ds",
    });
  });

  it("falls back to split view rather than silently disabling it on a corrupt record", () => {
    const { owner } = fakeWindow({ [DUAL_LANE_STORAGE_KEY]: "{not json" });
    expect(readDualLaneSettings(owner)).toEqual(DEFAULT_DUAL_LANE_SETTINGS);
    expect(parseDualLaneSettings(null)).toEqual(DEFAULT_DUAL_LANE_SETTINGS);
    expect(parseDualLaneSettings([])).toEqual(DEFAULT_DUAL_LANE_SETTINGS);
    expect(parseDualLaneSettings({ enabled: "yes", mainModel: 7 })).toEqual(
      DEFAULT_DUAL_LANE_SETTINGS,
    );
  });

  it("allows an empty Model ID so a lane can inherit the native choice", () => {
    expect(parseDualLaneSettings({ enabled: true, mainModel: "", sideModel: "" })).toEqual({
      enabled: true,
      mainModel: "",
      sideModel: "",
    });
  });

  it("persists and notifies listeners in the same window", () => {
    const { owner, store } = fakeWindow();
    const listener = vi.fn();
    owner.addEventListener(DUAL_LANE_CHANGE_EVENT, listener);
    expect(
      writeDualLaneSettings(owner, { enabled: false, mainModel: "ds", sideModel: "free" }),
    ).toBe(true);
    expect(JSON.parse(store.get(DUAL_LANE_STORAGE_KEY) ?? "null")).toEqual({
      enabled: false,
      mainModel: "ds",
      sideModel: "free",
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(readDualLaneSettings(owner)).toEqual({
      enabled: false,
      mainModel: "ds",
      sideModel: "free",
    });
  });

  it("reports failure instead of throwing when the preference store is unavailable", () => {
    const owner = {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
      dispatchEvent: vi.fn(),
    } as unknown as Window;
    expect(readDualLaneSettings(owner)).toEqual(DEFAULT_DUAL_LANE_SETTINGS);
    expect(
      writeDualLaneSettings(owner, { enabled: true, mainModel: "free", sideModel: "ds" }),
    ).toBe(false);
  });
});
