import { describe, expect, it, vi } from "vitest";
import { SESSION_ROUTE_METHOD } from "@codexhost/shared-contracts";
import { createRendererModelClient } from "../src/renderer-model-client.js";

const input = { message: "Continue", cwd: "/remote/project" };
const unsupported = (method: string, code = -32600) =>
  Object.assign(new Error("Invalid request: unknown variant `" + method + "`"), { code });

function clientFor(sendRequest: (method: string, params: unknown) => Promise<unknown>) {
  const client = createRendererModelClient([{ sendRequest }]);
  if (!client?.routeSession) throw new Error("Session routing client unavailable");
  return client.routeSession;
}

describe("session history on native SSH connections", () => {
  it("uses a supported Host route without reading history again", async () => {
    const response = { candidates: [], reason: "No completed conversations" };
    const sendRequest = vi.fn(async () => response);
    expect(await clientFor(sendRequest)(input)).toEqual(response);
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith(SESSION_ROUTE_METHOD, input);
  });

  it.each([-32600, -32601])(
    "reads the same connection's native history when the extension is absent (%s)",
    async (code) => {
      const sendRequest = vi.fn(async (method: string, params: unknown) => {
        if (method === SESSION_ROUTE_METHOD) throw unsupported(method, code);
        if (method === "thread/list") {
          return {
            data: [
              { id: "remote-completed", cwd: "/remote/project", name: "Remote history" },
              { id: "remote-running", cwd: "/remote/project", status: { type: "active" } },
            ],
          };
        }
        if (method === "thread/turns/list") {
          expect(params).toMatchObject({ threadId: "remote-completed", limit: 1 });
          return { data: [{ status: "completed" }] };
        }
        throw new Error(`Unexpected method: ${method}`);
      });
      const route = clientFor(sendRequest);
      for (let attempt = 0; attempt < 2; attempt++) {
        expect((await route(input)).candidates).toMatchObject([
          { threadId: "remote-completed", cwd: "/remote/project", title: "Remote history" },
        ]);
      }
      expect(
        sendRequest.mock.calls.filter(([method]) => method === SESSION_ROUTE_METHOD),
      ).toHaveLength(1);
      expect(sendRequest.mock.calls.filter(([method]) => method === "thread/list")).toHaveLength(2);
    },
  );

  it("supports older native history and skips unsaved drafts", async () => {
    const sendRequest = vi.fn(async (method: string, params: unknown) => {
      if (method === SESSION_ROUTE_METHOD || method === "thread/turns/list") {
        throw unsupported(method);
      }
      if (method === "thread/list") {
        return {
          data: [
            { id: "draft", cwd: input.cwd },
            { id: "completed", cwd: input.cwd },
          ],
        };
      }
      if (method === "thread/read") {
        if ((params as { threadId: string }).threadId === "draft") {
          throw new Error(
            "thread draft is not materialized yet; includeTurns is unavailable before first user message",
          );
        }
        return { thread: { id: "completed", turns: [{ status: "completed" }] } };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    expect(
      (await clientFor(sendRequest)(input)).candidates.map(({ threadId }) => threadId),
    ).toEqual(["completed"]);
  });

  it.each([-32090, -32600])(
    "preserves actual Host failures instead of bypassing them (%s)",
    async (code) => {
      const error = Object.assign(new Error("History request failed"), { code });
      const sendRequest = vi.fn(async () => {
        throw error;
      });
      await expect(clientFor(sendRequest)(input)).rejects.toBe(error);
      expect(sendRequest).toHaveBeenCalledExactlyOnceWith(SESSION_ROUTE_METHOD, input);
    },
  );

  it("reports a failed native history request", async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === SESSION_ROUTE_METHOD) throw unsupported(method);
      throw new Error("SSH connection closed");
    });
    await expect(clientFor(sendRequest)(input)).rejects.toThrow("SSH connection closed");
  });
});
