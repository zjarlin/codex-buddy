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
        threads: [threadB, threadA],
      },
      accountLabels: ["Current", "Teammate"],
    },
  ]);
});
