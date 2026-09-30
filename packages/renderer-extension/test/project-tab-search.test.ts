import { describe, expect, it } from "vitest";
import { searchProjectTabs } from "../src/project-tabs/search-model.js";

const tabs = [
  { id: "company", name: "remote_company_okmy_scada" },
  { id: "personal", name: "remote_zjarlin_codex_host" },
  { id: "official", name: "remote_company_official_app" },
  { id: "local", name: "local_tools" },
];

describe("project tab search", () => {
  it("ranks exact and prefix matches ahead of fuzzy matches", () => {
    expect(searchProjectTabs(tabs, "local")[0]?.target.id).toBe("local");
    expect(searchProjectTabs(tabs, "remote_company")[0]?.target.id).toBe("company");
  });

  it("treats underscore and dash as strong segment boundaries", () => {
    expect(searchProjectTabs(tabs, "rc")[0]?.kind).toBe("segment-prefix");
    expect(searchProjectTabs(tabs, "rc")[0]?.target.id).toBe("company");
    expect(searchProjectTabs(tabs, "company_ok")[0]?.target.id).toBe("company");
  });

  it("matches case-insensitively and trims the query", () => {
    expect(searchProjectTabs(tabs, "  CODEX_HOST  ")[0]?.target.id).toBe("personal");
  });

  it("returns nothing for an empty query", () => {
    expect(searchProjectTabs(tabs, "   ")).toEqual([]);
  });
});
