import { MOBILE_SERVER_REQUEST_METHODS } from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";

import {
  commandDecisionResult,
  permissionDecisionResult,
  questionAnswerResult,
} from "../src/mobile/interactions.js";

describe("mobile interactions", () => {
  it("covers the approval and question requests allowed by the LAN server", () => {
    expect([...MOBILE_SERVER_REQUEST_METHODS].sort()).toEqual(
      [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/permissions/requestApproval",
        "item/tool/requestUserInput",
        "mcpServer/elicitation/request",
      ].sort(),
    );
  });

  it("uses the native command and file approval decisions", () => {
    expect(commandDecisionResult("accept")).toEqual({ decision: "accept" });
    expect(commandDecisionResult("acceptForSession")).toEqual({
      decision: "acceptForSession",
    });
    expect(commandDecisionResult("decline")).toEqual({ decision: "decline" });
  });

  it("echoes only the requested permissions for this Turn", () => {
    expect(
      permissionDecisionResult(
        { network: { enabled: true }, fileSystem: { read: ["/workspace"] } },
        true,
      ),
    ).toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ["/workspace"] },
      },
      scope: "turn",
    });
    expect(permissionDecisionResult({ network: { enabled: true } }, false)).toEqual({
      permissions: {},
      scope: "turn",
    });
  });

  it("maps question labels to the native answer envelope", () => {
    expect(questionAnswerResult(new Map([["choice", ["yes"]]]))).toEqual({
      answers: { choice: { answers: ["yes"] } },
    });
  });
});
