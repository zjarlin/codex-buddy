import { expect, it } from "vitest";
import type { RemoteProjectsSnapshot } from "@codexhost/shared-contracts";
import { remoteProjectCatalog } from "../src/renderer-remote-project-catalog.js";

const threadA = {
  id: "019ccb31-9520-7120-bc17-556e9a92d860",
  name: "A",
  updatedAt: 1,
};
const threadB = {
  id: "019ccb31-9520-7120-bc17-556e9a92d861",
  name: "B",
  updatedAt: 2,
};

it("shows projects shared by every identity and merges their Threads", () => {
  const snapshot: RemoteProjectsSnapshot = {
    account: {
      id: "0123456789abcdef",
      label: "Current",
      current: true,
      projects: [],
    },
    accounts: [
      {
        id: "0123456789abcdef",
        label: "Current",
        current: true,
        projects: [
          {
            key: "fedcba9876543210",
            name: "Shared",
            roots: ["/remote/shared"],
            origin: null,
            threads: [threadA],
          },
        ],
      },
      {
        id: "1111111111111111",
        label: "Teammate",
        current: false,
        projects: [
          {
            key: "fedcba9876543210",
            name: "Shared",
            roots: ["/remote/shared"],
            origin: null,
            threads: [threadA, threadB],
          },
        ],
      },
    ],
  };
  expect(remoteProjectCatalog(snapshot)).toEqual([
    {
      project: {
        key: "fedcba9876543210",
        name: "Shared",
        roots: ["/remote/shared"],
        origin: null,
        threads: [threadB, threadA],
      },
      accountLabels: ["Current", "Teammate"],
    },
  ]);
});

it("merges the same Git repository across identities and keeps a stable key", () => {
  const snapshot: RemoteProjectsSnapshot = {
    account: { id: "0123456789abcdef", label: "Current", current: true, projects: [] },
    accounts: [
      {
        id: "0123456789abcdef",
        label: "Current",
        current: true,
        projects: [
          {
            key: "bbbbbbbbbbbbbbbb",
            name: "iot",
            roots: ["/work/iot"],
            origin: "git@github.com:company/iot-platform.git",
            threads: [threadA],
          },
        ],
      },
      {
        id: "1111111111111111",
        label: "Teammate",
        current: false,
        projects: [
          {
            key: "aaaaaaaaaaaaaaaa",
            name: "iot-platform",
            roots: ["/srv/iot"],
            origin: "https://github.com/company/iot-platform.git",
            threads: [threadB],
          },
        ],
      },
    ],
  };
  expect(remoteProjectCatalog(snapshot)).toEqual([
    {
      project: {
        key: "aaaaaaaaaaaaaaaa",
        name: "iot",
        roots: ["/work/iot", "/srv/iot"],
        origin: "git@github.com:company/iot-platform.git",
        threads: [threadB, threadA],
      },
      accountLabels: ["Current", "Teammate"],
    },
  ]);
});

it("folds a legacy project without origin into the repository with the same root", () => {
  const snapshot: RemoteProjectsSnapshot = {
    account: { id: "0123456789abcdef", label: "Current", current: true, projects: [] },
    accounts: [
      {
        id: "0123456789abcdef",
        label: "Current",
        current: true,
        projects: [
          {
            key: "aaaaaaaaaaaaaaaa",
            name: "iot",
            roots: ["/work/iot"],
            origin: "git@github.com:company/iot-platform.git",
            threads: [threadA],
          },
          {
            key: "bbbbbbbbbbbbbbbb",
            name: "iot",
            roots: ["/work/iot"],
            origin: null,
            threads: [threadB],
          },
        ],
      },
    ],
  };
  const catalog = remoteProjectCatalog(snapshot);
  expect(catalog).toHaveLength(1);
  expect(catalog[0]?.project).toMatchObject({
    key: "aaaaaaaaaaaaaaaa",
    origin: "git@github.com:company/iot-platform.git",
  });
  expect(catalog[0]?.project.threads.map((thread) => thread.id)).toEqual([threadB.id, threadA.id]);
});
