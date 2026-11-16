import { describe, expect, it } from "vitest";

import { normalizeProjectOrigin } from "../src/project-origin.js";

describe("project origin identity", () => {
  it("maps every common transport of one repository to the same identity", () => {
    for (const origin of [
      "git@github.com:company/iot.git",
      "ssh://git@github.com/company/iot.git",
      "ssh://git@github.com:22/company/iot.git",
      "git+ssh://git@github.com/company/iot",
      "https://github.com/company/iot.git",
      "HTTPS://GitHub.com/Company/IoT.git/",
    ]) {
      expect(normalizeProjectOrigin(origin)).toBe("github.com/company/iot");
    }
  });
  it("keeps different repositories on one host apart", () => {
    expect(normalizeProjectOrigin("git@github.com:company/app.git")).not.toBe(
      normalizeProjectOrigin("git@github.com:personal/app.git"),
    );
    expect(normalizeProjectOrigin("git@example.com:a/b.git")).not.toBe(
      normalizeProjectOrigin("git@sub.example.com:a/b.git"),
    );
  });
  it("rejects credentials, local paths and malformed hosts", () => {
    for (const origin of [
      "https://user:token@example.com/repo.git",
      "https://user@example.com/repo.git",
      "ssh://root@example.com/repo.git",
      "git@example.com:company/../secret",
      "/Users/zjarlin/project",
      "C:\\work\\project",
      "not a remote",
      "file:///srv/repo.git",
      "https://example.com/repo.git?token=secret",
      "https://example..com/repo.git",
      "https://[::1/repo.git",
      "https://example.com:abc/repo.git",
    ]) {
      expect(normalizeProjectOrigin(origin)).toBeNull();
    }
  });
  it("supports IPv6 hosts, root repositories and rejects empty or oversized input", () => {
    expect(normalizeProjectOrigin("git@github.com:repo.git")).toBe("github.com/repo");
    expect(normalizeProjectOrigin("ssh://git@[2001:db8::1]:2222/team/app.git")).toBe(
      "[2001:db8::1]/team/app",
    );
    expect(normalizeProjectOrigin("")).toBeNull();
    expect(normalizeProjectOrigin(null)).toBeNull();
    expect(normalizeProjectOrigin(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
  });
});
