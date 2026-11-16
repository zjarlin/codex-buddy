import { describe, expect, it } from "vitest";
import {
  groupProjectSources,
  hiddenProjectSourceIds,
  normalizeProjectOrigin,
  projectSourceKey,
  type ProjectSource,
} from "../src/renderer-project-sources.js";

function source(overrides: Partial<ProjectSource> = {}): ProjectSource {
  return {
    id: "okm252:/projects/iot",
    name: "remote_iot-platform",
    origin: "git@github.com:company/iot-platform.git",
    available: true,
    scope: "remote",
    ...overrides,
  };
}

describe("project source identity", () => {
  it("normalizes equivalent SSH and HTTPS remotes to the same identity", () => {
    expect(normalizeProjectOrigin("git@github.com:company/iot-platform.git")).toBe(
      "github.com/company/iot-platform",
    );
    expect(normalizeProjectOrigin("ssh://git@github.com/company/iot-platform.git")).toBe(
      "github.com/company/iot-platform",
    );
    expect(normalizeProjectOrigin("https://github.com/company/iot-platform.git")).toBe(
      "github.com/company/iot-platform",
    );
  });
  it("ignores protocol, port and username differences for the same repository", () => {
    expect(normalizeProjectOrigin("https://example.com:8443/team/app")).toBe(
      "example.com/team/app",
    );
    expect(normalizeProjectOrigin("ssh://git@example.com:8443/team/app.git")).toBe(
      "example.com/team/app",
    );
    expect(normalizeProjectOrigin("https://example.com/team/app")).toBe("example.com/team/app");
  });
  it("rejects credentials, whitespace and local absolute paths", () => {
    expect(normalizeProjectOrigin("https://user:token@example.com/repo.git")).toBeNull();
    expect(normalizeProjectOrigin("git@github.com:company/../secret")).toBeNull();
    expect(normalizeProjectOrigin("/Users/zjarlin/project")).toBeNull();
    expect(normalizeProjectOrigin("not a remote")).toBeNull();
  });
  it("falls back to a case-insensitive project name only without an origin", () => {
    expect(projectSourceKey({ name: "Remote_IoT", origin: null })).toEqual({
      key: "name:remote_iot",
      kind: "name",
    });
    expect(
      projectSourceKey({ name: "unrelated", origin: "git@github.com:company/iot.git" }),
    ).toEqual({ key: "git:github.com/company/iot", kind: "git" });
  });
});

describe("project source retention", () => {
  it("merges local and SSH clones of the same repository into one group", () => {
    const result = groupProjectSources([
      source({ id: "local:/workspace/iot", name: "iot-platform", scope: "local" }),
      source({ id: "okm252:/projects/iot", name: "remote_iot-platform" }),
      source({
        id: "macmini-lan:/projects/iot",
        name: "remote_iot-platform",
        available: false,
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.sources.map((entry) => entry.id)).toEqual([
      "local:/workspace/iot",
      "okm252:/projects/iot",
      "macmini-lan:/projects/iot",
    ]);
    expect(result.groups[0]?.available.map((entry) => entry.id)).toEqual([
      "local:/workspace/iot",
      "okm252:/projects/iot",
    ]);
  });
  it("asks only when more than one source remains available", () => {
    const result = groupProjectSources([
      source({ id: "okm252:/projects/iot" }),
      source({ id: "macmini-lan:/projects/iot", available: false }),
    ]);
    expect(result.groups[0]?.selected?.id).toBe("okm252:/projects/iot");
    expect(result.pending).toEqual([]);
  });
  it("automatically retains the newly available host when the old host goes offline", () => {
    const result = groupProjectSources(
      [
        source({ id: "macmini-lan:/projects/iot", available: false }),
        source({ id: "okm252:/projects/iot" }),
        source({ id: "local:/workspace/iot", scope: "local" }),
      ],
      { "git:github.com/company/iot-platform": "macmini-lan:/projects/iot" },
    );
    expect(result.groups[0]?.retained).toBeNull();
    expect(result.groups[0]?.selected?.id).toBe("okm252:/projects/iot");
    expect(result.pending).toEqual([]);
  });
  it("keeps a saved choice while it remains available and hides the others", () => {
    const result = groupProjectSources(
      [source({ id: "local:/workspace/iot" }), source({ id: "okm252:/projects/iot" })],
      { "git:github.com/company/iot-platform": "local:/workspace/iot" },
    );
    const group = result.groups[0];
    expect(group?.retained?.id).toBe("local:/workspace/iot");
    expect(group?.selected?.id).toBe("local:/workspace/iot");
    expect(group?.needsChoice).toBe(false);
    expect(group && [...hiddenProjectSourceIds(group)]).toEqual(["okm252:/projects/iot"]);
  });
  it("requires a choice when every source is available and nothing was saved", () => {
    const result = groupProjectSources([
      source({ id: "local:/workspace/iot", scope: "local" }),
      source({ id: "okm252:/projects/iot" }),
      source({ id: "macmini-lan:/projects/iot" }),
    ]);
    expect(result.pending.map((group) => group.key)).toEqual([
      "git:github.com/company/iot-platform",
    ]);
    expect(result.groups[0]?.selected).toBeNull();
    expect(result.groups[0] && [...hiddenProjectSourceIds(result.groups[0])]).toEqual([]);
  });
  it("prefers the only available remote over a local clone without asking", () => {
    const result = groupProjectSources([
      source({ id: "local:/workspace/iot", scope: "local" }),
      source({ id: "okm252:/projects/iot" }),
      source({ id: "macmini-lan:/projects/iot", available: false }),
    ]);
    expect(result.groups[0]?.selected?.id).toBe("okm252:/projects/iot");
    expect(result.pending).toEqual([]);
  });
  it("falls back to the local clone when no remote source is available", () => {
    const result = groupProjectSources([
      source({ id: "local:/workspace/iot", scope: "local" }),
      source({ id: "okm252:/projects/iot", available: false }),
      source({ id: "macmini-lan:/projects/iot", available: false }),
    ]);
    expect(result.groups[0]?.selected?.id).toBe("local:/workspace/iot");
    expect(result.pending).toEqual([]);
  });
  it("does not merge same-named projects that have different Git origins", () => {
    const result = groupProjectSources([
      source({ id: "a", origin: "git@github.com:company/app.git" }),
      source({ id: "b", origin: "git@github.com:personal/app.git" }),
    ]);
    expect(result.groups).toHaveLength(2);
  });
  it("uses names only when neither side has a Git origin", () => {
    const result = groupProjectSources([
      source({ id: "a", name: "same", origin: null }),
      source({ id: "b", name: " SAME ", origin: null }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.kind).toBe("name");
  });
  it("never merges an unknown origin by name with an identified repository", () => {
    const result = groupProjectSources([
      source({ id: "a", name: "same", origin: "git@github.com:company/same.git" }),
      source({ id: "b", name: "same", origin: "not a remote" }),
    ]);
    expect(result.groups).toHaveLength(2);
  });
  it("joins a copy without Git to the single repository with the same name", () => {
    const result = groupProjectSources([
      source({ id: "remote:/srv/iot", name: "remote_iot-platform" }),
      source({
        id: "local:/backup/iot",
        name: "remote_iot-platform",
        origin: null,
        scope: "local",
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.kind).toBe("git");
    expect(result.groups[0]?.sources.map((entry) => entry.id)).toEqual([
      "remote:/srv/iot",
      "local:/backup/iot",
    ]);
    expect(result.groups[0]?.selected?.id).toBe("remote:/srv/iot");
  });
  it("keeps a Git-less copy when its name matches several repositories", () => {
    const result = groupProjectSources([
      source({ id: "one", name: "app", origin: "git@github.com:company/app.git" }),
      source({ id: "two", name: "app", origin: "git@github.com:personal/app.git" }),
      source({ id: "plain", name: "app", origin: null }),
    ]);
    expect(result.groups).toHaveLength(3);
  });
  it("keeps an online source with unreadable origin apart from the same name", () => {
    const result = groupProjectSources([
      source({ id: "remote:/srv/iot", name: "remote_iot-platform" }),
      source({
        id: "local:/work/iot",
        name: "remote_iot-platform",
        origin: null,
        originResolved: false,
      }),
    ]);
    expect(result.groups).toHaveLength(2);
  });
});
