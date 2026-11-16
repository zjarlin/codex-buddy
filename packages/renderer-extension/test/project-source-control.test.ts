import { describe, expect, it, vi } from "vitest";

import { ProjectSourceControl } from "../src/project-tabs/source-control.js";
import {
  parseProjectSourceRetention,
  PROJECT_SOURCE_RETENTION_KEY,
  projectSourceId,
} from "../src/project-tabs/source-model.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const project = {
  projectKind: "remote" as const,
  hostId: "okm252",
  projectId: "one",
  label: "remote_iot",
  path: "/srv/iot",
};

describe("project source control", () => {
  it("reads each root origin once and groups clones of the same repository", async () => {
    const storage = memoryStorage();
    const inspectGitOrigin = vi.fn(async () => ({
      remote: "git@github.com:company/iot.git",
    }));
    const onUpdate = vi.fn();
    const control = new ProjectSourceControl({
      storage,
      getClient: () => ({ inspectGitOrigin }),
      onUpdate,
    });
    const local = {
      projectKind: "local" as const,
      projectId: "two",
      label: "iot",
      path: "/home/me/iot",
    };
    const first = control.update([
      {
        id: projectSourceId(project),
        name: project.label,
        hostId: "okm252",
        scope: "remote",
        paths: ["/srv/iot"],
        available: true,
      },
      {
        id: projectSourceId(local),
        name: local.label,
        hostId: "local",
        scope: "local",
        paths: ["/home/me/iot"],
        available: true,
      },
    ]);
    // 第一次读取时 origin 尚未返回，不能提前按名称把两个不同名称合并。
    expect(first.groups).toHaveLength(2);
    await vi.waitFor(() => expect(inspectGitOrigin).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const grouped = control.update([
      {
        id: projectSourceId(project),
        name: project.label,
        hostId: "okm252",
        scope: "remote",
        paths: ["/srv/iot"],
        available: true,
      },
      {
        id: projectSourceId(local),
        name: local.label,
        hostId: "local",
        scope: "local",
        paths: ["/home/me/iot"],
        available: true,
      },
    ]);
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]?.key).toBe("git:github.com/company/iot");
    expect(grouped.groups[0]?.selected?.id).toBe(projectSourceId(project));
    control.dispose();
  });

  it("does not group unresolved origins by project name", async () => {
    const storage = memoryStorage();
    const control = new ProjectSourceControl({
      storage,
      getClient: () => ({ inspectGitOrigin: async () => Promise.reject(new Error("offline")) }),
      onUpdate: () => undefined,
    });
    const grouped = control.update([
      { id: "a", name: "same", hostId: "one", scope: "remote", paths: ["/one"], available: true },
      { id: "b", name: "same", hostId: "two", scope: "remote", paths: ["/two"], available: true },
    ]);
    expect(grouped.groups).toHaveLength(2);
    control.dispose();
  });

  it("persists the kept source and forgets a deferred prompt after a choice", () => {
    const storage = memoryStorage();
    const control = new ProjectSourceControl({
      storage,
      getClient: () => null,
      onUpdate: () => undefined,
    });
    control.defer("git:github.com/company/iot", ["a", "b"]);
    expect(control.isDeferred("git:github.com/company/iot", ["b", "a"])).toBe(true);
    expect(control.isDeferred("git:github.com/company/iot", ["a", "c"])).toBe(false);
    control.choose("git:github.com/company/iot", "a");
    expect(parseProjectSourceRetention(storage.getItem(PROJECT_SOURCE_RETENTION_KEY))).toEqual({
      "git:github.com/company/iot": "a",
    });
    expect(control.isDeferred("git:github.com/company/iot", ["a", "b"])).toBe(false);
    control.dispose();
  });

  it("keeps cached origins available while a host is offline", () => {
    const storage = memoryStorage();
    storage.setItem(
      "codexhost.project-origins.v1",
      JSON.stringify({
        [JSON.stringify(["macmini-lan", "/srv/iot"])]: {
          origin: "git@github.com:company/iot.git",
        },
        [JSON.stringify(["okm252", "/srv/iot"])]: {
          origin: "git@github.com:company/iot.git",
        },
      }),
    );
    const control = new ProjectSourceControl({
      storage,
      getClient: () => null,
      onUpdate: () => undefined,
    });
    const grouped = control.update([
      {
        id: "macmini-lan:one",
        name: "iot",
        hostId: "macmini-lan",
        scope: "remote",
        paths: ["/srv/iot"],
        available: false,
      },
      {
        id: "okm252:two",
        name: "iot",
        hostId: "okm252",
        scope: "remote",
        paths: ["/srv/iot"],
        available: true,
      },
    ]);
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]?.selected?.id).toBe("okm252:two");
    control.dispose();
  });
});

it("keeps an online source visible when its origin cannot be read", () => {
  const storage = memoryStorage();
  const control = new ProjectSourceControl({
    storage,
    getClient: () => ({ inspectGitOrigin: async () => Promise.reject(new Error("unavailable")) }),
    onUpdate: () => undefined,
  });
  const grouped = control.update([
    {
      id: "okm252:iot",
      name: "iot-platform",
      hostId: "okm252",
      scope: "remote",
      paths: ["/srv/iot"],
      available: true,
    },
    {
      id: "local:iot",
      name: "iot-platform",
      hostId: "local",
      scope: "local",
      paths: ["/home/me/iot"],
      available: true,
    },
  ]);
  // 读不到 origin 且来源在线时不能用名称猜测：两个项目行都必须保留。
  expect(grouped.groups).toHaveLength(2);
  control.dispose();
});

it("merges a project that has no Git at all into the repository with its name", async () => {
  const storage = memoryStorage();
  storage.setItem(
    "codexhost.project-origins.v1",
    JSON.stringify({
      [JSON.stringify(["okm252", "/srv/iot"])]: { origin: "git@github.com:company/iot.git" },
      [JSON.stringify(["local", "/backup/iot"])]: { origin: null },
    }),
  );
  const control = new ProjectSourceControl({
    storage,
    getClient: () => null,
    onUpdate: () => undefined,
  });
  const grouped = control.update([
    {
      id: "okm252:iot",
      name: "remote_iot",
      hostId: "okm252",
      scope: "remote",
      paths: ["/srv/iot"],
      available: true,
    },
    {
      id: "local:backup",
      name: "remote_iot",
      hostId: "local",
      scope: "local",
      paths: ["/backup/iot"],
      available: true,
    },
  ]);
  expect(grouped.groups).toHaveLength(1);
  expect(grouped.groups[0]?.selected?.id).toBe("okm252:iot");
  control.dispose();
});

it("keeps a project whose configured origin cannot be used apart from the same name", async () => {
  const storage = memoryStorage();
  storage.setItem(
    "codexhost.project-origins.v1",
    JSON.stringify({
      [JSON.stringify(["okm252", "/srv/iot"])]: { origin: "git@github.com:company/iot.git" },
      [JSON.stringify(["local", "/work/iot"])]: {
        origin: "https://user:token@github.com/company/iot.git",
      },
    }),
  );
  const control = new ProjectSourceControl({
    storage,
    getClient: () => null,
    onUpdate: () => undefined,
  });
  const grouped = control.update([
    {
      id: "okm252:iot",
      name: "remote_iot",
      hostId: "okm252",
      scope: "remote",
      paths: ["/srv/iot"],
      available: true,
    },
    {
      id: "local:work",
      name: "remote_iot",
      hostId: "local",
      scope: "local",
      paths: ["/work/iot"],
      available: true,
    },
  ]);
  expect(grouped.groups).toHaveLength(2);
  control.dispose();
});

it("reports pending origin reads so a choice waits for the full source set", async () => {
  const storage = memoryStorage();
  const deferred: { release?: () => void } = {};
  const gate = new Promise<void>((resolve) => {
    deferred.release = resolve;
  });
  const control = new ProjectSourceControl({
    storage,
    getClient: () => ({
      inspectGitOrigin: async ({ cwd }) => {
        await gate;
        return { remote: cwd === "/srv/iot" ? "git@github.com:company/iot.git" : null };
      },
    }),
    onUpdate: () => undefined,
  });
  const candidates = [
    {
      id: "okm252:iot",
      name: "remote_iot",
      hostId: "okm252",
      scope: "remote" as const,
      paths: ["/srv/iot"],
      available: true,
    },
    {
      id: "local:backup",
      name: "remote_iot",
      hostId: "local",
      scope: "local" as const,
      paths: ["/backup/iot"],
      available: true,
    },
  ];
  const early = control.update(candidates);
  // 只读到部分来源时按名称临时分组；此时调用方必须能看出「还在读」，
  // 否则会过早弹窗、少列来源。
  expect(early.groups).toHaveLength(2);
  expect(control.pendingOrigins()).toBe(true);

  deferred.release?.();
  await vi.waitFor(() => expect(control.pendingOrigins()).toBe(false));
  const settled = control.update(candidates);
  // 补齐后无 Git 的本地副本并入同名仓库，只剩一个来源，无需询问。
  expect(settled.groups).toHaveLength(1);
  expect(settled.pending).toEqual([]);
  control.dispose();
});
