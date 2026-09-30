import { describe, expect, it } from "vitest";
import {
  defaultProjectTabs,
  parseProjectTabs,
  pendingProjectAssignment,
  projectAssignment,
  projectKey,
  projectTab,
  withProjectTabs,
  type SidebarProject,
} from "../src/project-tabs/model.js";

const project: SidebarProject = {
  projectKind: "remote",
  hostId: "office",
  projectId: "one",
  label: "remote_company_app",
};

describe("project tab classification", () => {
  it("matches case-sensitive prefixes and keeps unmatched projects unclassified", () => {
    const config = defaultProjectTabs();
    expect(projectTab(config, project)).toBe("company");
    expect(projectTab(config, { ...project, label: "remote_zjarlin_app" })).toBe("personal");
    expect(projectTab(config, { ...project, label: "Remote_company_app" })).toBeNull();
    expect(projectTab(config, { ...project, label: "another_remote_company" })).toBeNull();
  });
  it("uses the first matching tab and any prefix within it", () => {
    const config = defaultProjectTabs();
    config.tabs[1]?.prefixes.push("remote_company_app");
    expect(projectTab(config, project)).toBe("company");
    expect(projectTab(withProjectTabs(config, config.tabs.toReversed()), project)).toBe("personal");
  });
  it("keeps manual assignment through renames and isolates host and kind", () => {
    const config = defaultProjectTabs();
    config.assignments[projectKey(project)] = "personal";
    expect(projectTab(config, { ...project, label: "renamed" })).toBe("personal");
    expect(projectTab(config, { ...project, hostId: "home" })).toBe("company");
    expect(projectTab(config, { ...project, projectKind: "local" })).toBe("company");
    Reflect.deleteProperty(config.assignments, projectKey(project));
    expect(projectTab(config, project)).toBe("company");
  });
  it("cleans deleted assignments and resets deleted selection", () => {
    const config = defaultProjectTabs();
    config.assignments[projectKey(project)] = "personal";
    config.selected = "personal";
    const next = withProjectTabs(config, config.tabs.slice(0, 1));
    expect(next.assignments).toEqual({});
    expect(next.selected).toBeNull();
    expect(projectTab(next, project)).toBe("company");
    expect(config.tabs).toHaveLength(3);
  });
  it("consumes creation intent once and assigns the new project to its tab", () => {
    const config = defaultProjectTabs();
    const pending = pendingProjectAssignment();
    pending.ensure("personal", 1000);
    expect(pending.consume([project], 1001)).toEqual({ tab: "personal", project });
    expect(pending.current()).toBeNull();
    expect(pending.consume([project], 1002)).toBeNull();
    expect(projectAssignment(config, "personal", project)?.assignments[projectKey(project)]).toBe(
      "personal",
    );
    expect(projectAssignment(config, "missing", project)).toBeNull();
  });
  it("drops expired or explicitly cancelled creation intent", () => {
    const pending = pendingProjectAssignment(10);
    pending.ensure("personal", 1000);
    expect(pending.consume([project], 1011)).toBeNull();
    expect(pending.current()).toBeNull();
    pending.ensure("personal", 2000);
    pending.clear();
    expect(pending.consume([project], 2001)).toBeNull();
    pending.ensure(null, 3000);
    expect(pending.consume([project], 3001)).toBeNull();
  });
  it("roundtrips empty tabs without reinstalling defaults", () => {
    const config = withProjectTabs(defaultProjectTabs(), []);
    expect(parseProjectTabs(JSON.stringify(config))).toEqual(config);
    expect(parseProjectTabs(null).tabs).toHaveLength(3);
  });
  it("provides an infrequent tab for manual moves without matching other projects", () => {
    const config = defaultProjectTabs();
    expect(config.tabs.find((tab) => tab.id === "infrequent")).toEqual({
      id: "infrequent",
      name: "不常用",
      prefixes: [],
    });
    expect(projectTab(config, project)).toBe("company");
    config.assignments[projectKey(project)] = "infrequent";
    expect(projectTab(config, project)).toBe("infrequent");
  });
  it("migrates old settings without changing assignments or selection", () => {
    const current = defaultProjectTabs();
    const legacy = {
      ...current,
      version: 1,
      tabs: current.tabs.slice(0, 2),
      selected: "personal",
      assignments: { [projectKey(project)]: "personal" },
    };
    const migrated = parseProjectTabs(JSON.stringify(legacy));
    expect(migrated.version).toBe(2);
    expect(migrated.tabs.map((tab) => tab.name)).toEqual(["公司的项目", "个人的项目", "不常用"]);
    expect(migrated.assignments).toEqual(legacy.assignments);
    expect(migrated.selected).toBe("personal");
    const removed = withProjectTabs(migrated, migrated.tabs.slice(0, 2));
    expect(parseProjectTabs(JSON.stringify(removed))).toEqual(removed);
  });
  it("does not duplicate a custom infrequent tab or restore intentionally empty settings", () => {
    const legacy = {
      ...defaultProjectTabs(),
      version: 1,
      tabs: [{ id: "custom", name: "不常用", prefixes: ["old_"] }],
    };
    expect(parseProjectTabs(JSON.stringify(legacy)).tabs).toEqual(legacy.tabs);
    expect(parseProjectTabs(JSON.stringify({ ...legacy, tabs: [] })).tabs).toEqual([]);
  });
  it("rejects malformed settings instead of overwriting them silently", () => {
    for (const raw of [
      "broken",
      "null",
      "{}",
      JSON.stringify({ ...defaultProjectTabs(), assignments: [] }),
      JSON.stringify({ ...defaultProjectTabs(), tabs: [{ id: "a", name: "A", prefixes: [""] }] }),
    ]) {
      expect(() => parseProjectTabs(raw)).toThrow();
    }
  });
});
