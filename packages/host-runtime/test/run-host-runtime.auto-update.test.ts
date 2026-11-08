import { PassThrough } from "node:stream";

import type { AppServerHostOptions } from "../src/app-server-host.js";
import type { HostUpdateCoordinator } from "../src/update-coordinator.js";
import type * as RemoteAppServer from "../src/remote-app-server.js";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hosts: [] as AppServerHostOptions[],
  instances: [] as { start: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
  remotePlan: null as null | { environment: NodeJS.ProcessEnv; officialArguments: string[] },
}));

vi.mock("../src/app-server-host.js", () => ({
  AppServerHost: class {
    constructor(options: AppServerHostOptions) {
      state.hosts.push(options);
    }
    async run() {
      return 0;
    }
  },
  officialEnvironment: (environment: NodeJS.ProcessEnv) => environment,
}));
vi.mock("../src/host-auto-update.js", () => ({
  HostAutoUpdate: class {
    readonly start = vi.fn();
    readonly dispose = vi.fn();
    constructor() {
      state.instances.push(this);
    }
  },
}));
vi.mock("../src/native-account-host.js", () => ({
  prepareLocalCodex: async () => ({
    officialRuntimeScope: {},
    accountControl: {},
    close: async () => {},
  }),
}));
vi.mock("../src/delegation-control-server.js", () => ({
  startDelegationControlServer: async () => ({
    endpoint: "http://127.0.0.1:1",
    close: async () => {},
  }),
}));
vi.mock("../src/delegation-skill.js", () => ({ installDelegationSkills: async () => [] }));
vi.mock("../src/installed-harness-plugins.js", () => ({
  installedHarnessPluginOptions: () => ({}),
}));
vi.mock("../src/external-thread-repository.js", () => ({
  createProductionExternalThreadStore: () => ({
    initialize: async () => {},
    close: async () => {},
  }),
}));
vi.mock("../src/model-prices.js", () => ({
  ModelPriceCatalog: class {
    async start() {}
  },
  defaultModelPriceDirectory: () => "/synthetic/prices",
}));
vi.mock("../src/usage-statistics.js", () => ({ UsageStatistics: vi.fn() }));
vi.mock("../src/remote-control-app-server.js", () => ({
  createRemoteControlAppServerPlan: () => state.remotePlan,
  publishRemoteControlAppServerDescriptor: async () => {},
}));
vi.mock("../src/remote-app-server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof RemoteAppServer>()),
  createRemoteAppServerWebSocketListener: (options: {
    createSession(streams: {
      input: PassThrough;
      output: PassThrough;
      diagnosticOutput: PassThrough;
    }): unknown;
  }) => ({
    async listen() {
      options.createSession({
        input: new PassThrough(),
        output: new PassThrough(),
        diagnosticOutput: new PassThrough(),
      });
    },
    async close() {},
  }),
}));

const coordinator = {
  check: async () => null,
  start: async () => {
    throw new Error("unused");
  },
  restart: async () => {
    throw new Error("unused");
  },
  status: async () => ({ status: null }),
} as unknown as HostUpdateCoordinator;

async function run(environment: NodeJS.ProcessEnv) {
  state.hosts.length = 0;
  state.instances.length = 0;
  const { runHostRuntime } = await import("../src/run-host-runtime.js");
  expect(
    await runHostRuntime({
      arguments: [],
      environment: { CODEXHOST_STOCK_CODEX_PATH: "/synthetic/codex", ...environment },
      updateCoordinator: coordinator,
    }),
  ).toBe(0);
}

it("starts and disposes one automatic updater for the local Desktop Host", async () => {
  state.remotePlan = null;
  await run({});
  expect(state.hosts).toHaveLength(1);
  expect(state.instances).toHaveLength(1);
  expect(state.hosts[0]?.autoUpdate).toBe(state.instances[0]);
  expect(state.instances[0]?.start).toHaveBeenCalledOnce();
  expect(state.instances[0]?.dispose).toHaveBeenCalledOnce();
});

it("gives every Remote Control session Host the same automatic updater", async () => {
  state.remotePlan = { environment: {}, officialArguments: [] };
  await run({});
  expect(state.hosts).toHaveLength(2);
  expect(state.instances).toHaveLength(1);
  for (const host of state.hosts) expect(host.autoUpdate).toBe(state.instances[0]);
  // The listener owns the timers, not each short-lived Desktop session.
  expect(state.instances[0]?.start).toHaveBeenCalledOnce();
  expect(state.instances[0]?.dispose).toHaveBeenCalledOnce();
});

it("never restarts a Desktop for an update on a managed SSH Host", async () => {
  state.remotePlan = null;
  await run({ CODEXHOST_REMOTE_SSH_MANAGED: "1" });
  expect(state.hosts).toHaveLength(1);
  expect(state.instances).toHaveLength(0);
  expect(state.hosts[0]?.autoUpdate).toBeUndefined();
});
