import { describe, expect, it } from "vitest";
import { isGatewayRoutedModel } from "../src/auto-route-card/index.js";

describe("gateway-routed virtual models", () => {
  it.each(["auto", "ask", "free", "FREE", " Free "])("treats %s as gateway-routed", (model) => {
    expect(isGatewayRoutedModel(model)).toBe(true);
  });

  it.each([undefined, "", "gpt-6-astra", "deepseek-v4.1-flash", "autofree"])(
    "leaves %s on the native model path",
    (model) => {
      expect(isGatewayRoutedModel(model)).toBe(false);
    },
  );
});
