import { describe, expect, it, vi } from "vitest";
import { nativeModelBinding } from "../src/renderer-native-model-binding.js";

function fixture(overrides: Record<string, unknown> = {}) {
  const onSelectModel = vi.fn();
  const onSelectComplete = vi.fn();
  const props = {
    model: "known",
    reasoningEffort: "high",
    modelOptions: [
      {
        model: {
          model: "known",
          displayName: "Known",
          defaultReasoningEffort: "low",
          supportedReasoningEfforts: [{ reasoningEffort: "low" }],
        },
      },
    ],
    onSelectModel,
    onSelectComplete,
    ...overrides,
  };
  const trigger = { __reactFiber$fixture: { memoizedProps: props } } as unknown as HTMLElement;
  const binding = nativeModelBinding(trigger);
  if (!binding) {
    throw new Error("Native model fixture did not bind");
  }
  return { binding, props, onSelectModel, onSelectComplete };
}

describe("native manual model selection", () => {
  it("selects an exact custom ID without injecting it into the catalog or inheriting effort", () => {
    const { binding, props, onSelectModel, onSelectComplete } = fixture();
    expect(binding.view.supportsCustomModel).toBe(true);
    binding.select("Provider/Recovered-Model");
    expect(onSelectModel).toHaveBeenCalledExactlyOnceWith("Provider/Recovered-Model", null);
    expect(onSelectComplete).toHaveBeenCalledOnce();
    expect(props.modelOptions).toHaveLength(1);
    expect(binding.view.models.map(({ id }) => id)).toEqual(["known"]);
  });

  it("keeps the explicit selected ID when the entire directory disappears", () => {
    const { binding, onSelectModel } = fixture({
      model: "Provider/Recovered-Model",
      modelOptions: [],
    });
    expect(binding.view.selected).toBe("Provider/Recovered-Model");
    expect(binding.view.models).toEqual([]);
    binding.select("Provider/Recovered-Model");
    expect(onSelectModel).toHaveBeenCalledExactlyOnceWith("Provider/Recovered-Model", null);
  });

  it.each([
    ["high", "low"],
    ["low", "low"],
  ])("uses supported reasoning settings for a known model (%s)", (current, expected) => {
    const { binding, onSelectModel } = fixture({ reasoningEffort: current });
    binding.select("known");
    expect(onSelectModel).toHaveBeenCalledExactlyOnceWith("known", expected);
  });

  it.each([
    { disabled: true },
    { modelOptionsDisabled: true },
    { daybreak: { isSaving: true } },
    { menuFooter: {} },
    { lockedModelSlug: "custom" },
  ])("retains native availability guards for custom IDs: %j", (overrides) => {
    const { binding, onSelectModel } = fixture(overrides);
    expect(() => binding.select("custom")).toThrow("unavailable");
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("does not allow manually typed IDs to bypass a disabled model, including hidden entries", () => {
    const { binding, onSelectModel } = fixture({
      lockedModelSlug: "locked-outside-catalog",
      modelOptions: [
        { model: { model: "disabled", displayName: "Disabled" }, disabledReason: "restricted" },
        {
          model: { model: "hidden", displayName: "Hidden", hidden: true },
          disabledReason: "restricted",
        },
      ],
    });
    expect(binding.view.models).toEqual([{ id: "disabled", label: "Disabled", disabled: true }]);
    expect(binding.view.unavailableModelIds).toEqual([
      "disabled",
      "hidden",
      "locked-outside-catalog",
    ]);
    expect(() => binding.select("disabled")).toThrow("unavailable");
    expect(() => binding.select("hidden")).toThrow("unavailable");
    expect(() => binding.select("locked-outside-catalog")).toThrow("unavailable");
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("surfaces a native selection veto and rejects empty IDs", () => {
    const onBeforeSelectModel = vi.fn(() => false);
    const { binding, onSelectModel, onSelectComplete } = fixture({ onBeforeSelectModel });
    expect(() => binding.select("custom")).toThrow("declined");
    expect(onBeforeSelectModel).toHaveBeenCalledExactlyOnceWith("custom");
    expect(() => binding.select("   ")).toThrow("unavailable");
    expect(onSelectModel).not.toHaveBeenCalled();
    expect(onSelectComplete).not.toHaveBeenCalled();
  });
});
