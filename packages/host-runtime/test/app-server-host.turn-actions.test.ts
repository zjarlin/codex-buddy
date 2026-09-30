import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  hostItemIdSchema,
  harnessCommandDescriptorSchema,
  turnActionsSnapshotSchema,
  turnActionInvocationSchema,
  type HarnessActionDefinition,
} from "@codexhost/shared-contracts";
import type { HarnessCommandInvocation } from "@codexhost/harness-adapter";
import type { JsonObject } from "@codexhost/protocol-core";
import {
  createFixture,
  startExternalThread,
  completePiTurn,
  stopFixture,
  writeRequest,
  requestId,
  turnEvent,
} from "./app-server-host-fixture.js";

it("executes a plugin native action through Host RPC once and follows actual Harness completion", async () => {
  const fixture = createFixture();
  try {
    const command = harnessCommandDescriptorSchema.parse({
      id: "pi.compact",
      invocation: "/compact",
      label: "Compact",
      argumentMode: "none",
    });
    const action: HarnessActionDefinition = {
      actionId: "pi.compact",
      version: "1",
      label: "整理上下文",
      description: "使用原生 compact",
      argumentMode: "none",
      target: { kind: "command", commandId: command.id },
    };
    Object.assign(fixture.adapter, { actionCatalog: [action] });
    const threadId = await startExternalThread(fixture, "codexhost/pi-native", 1, {
      cwd: fixture.mappingStoreDirectory,
    });
    const session = fixture.adapter.sessions[0];
    if (!session) throw new Error("Missing session");
    const execute = vi.fn(async ({ turnId }: HarnessCommandInvocation) => {
      session.publishEphemeralCommand(turnId, {
        type: "contextCompaction",
        itemId: hostItemIdSchema.parse("compact-item"),
      });
      return { ok: true as const, value: { turnId } };
    });
    session.commands = {
      list: async () => ({ ok: true, value: { commands: [command] } }),
      execute,
    };
    const sourceTurnId = await completePiTurn(fixture, threadId, 2);
    const call = async (id: number, method: string, params: JsonObject) => {
      writeRequest(fixture.desktopInput, { id, method, params });
      const response = await fixture.collector.waitFor((message) => requestId(message, id));
      expect(response).not.toHaveProperty("error");
      return response.result;
    };
    const snapshot = turnActionsSnapshotSchema.parse(
      await call(3, "codexhost/thread/actions/inspect", { threadId }),
    );
    const descriptor = snapshot.actions.find(({ actionId }) => actionId === action.actionId);
    expect(descriptor?.enabled).toBe(true);
    if (!descriptor) throw new Error("Missing action");
    const params = {
      threadId,
      sourceTurnId,
      actionId: descriptor.actionId,
      version: descriptor.version,
      invocationId: randomUUID(),
    };
    const receipt = turnActionInvocationSchema.parse(
      await call(4, "codexhost/thread/action/execute", params),
    );
    expect(receipt.executionTurnId).toBeTruthy();
    await fixture.collector.waitFor((message) =>
      turnEvent(message, "turn/completed", String(receipt.executionTurnId)),
    );
    await completePiTurn(fixture, threadId, 7);
    const recovered = turnActionsSnapshotSchema.parse(
      await call(5, "codexhost/thread/actions/inspect", { threadId, sourceTurnId }),
    );
    expect(recovered.invocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          invocationId: params.invocationId,
          state: "completed",
          executionTurnId: receipt.executionTurnId,
        }),
      ]),
    );
    expect(recovered.actions.every(({ enabled }) => !enabled)).toBe(true);
    const duplicate = await call(6, "codexhost/thread/action/execute", params);
    expect(duplicate).toMatchObject({ invocationId: params.invocationId, state: "completed" });
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    await stopFixture(fixture);
  }
});
