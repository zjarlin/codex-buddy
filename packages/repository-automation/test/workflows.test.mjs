import { readFile } from "node:fs/promises";
import path from "node:path";
import { format } from "prettier";
import { describe, expect, it } from "vitest";
import { CI_JOBS } from "../src/policy.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => readFile(path.join(root, file), "utf8");

describe("workflow and form contracts", () => {
  it.each([
    ".github/workflows/ci.yml",
    ".github/workflows/auto-release-on-main.yml",
    ".github/workflows/buddy-macos-dmg.yml",
    ".github/workflows/repository-maintenance.yml",
    ".github/workflows/release-packages.yml",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/question.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
  ])("parses %s as YAML", async (file) => {
    await expect(format(await read(file), { parser: "yaml" })).resolves.toBeTypeOf("string");
  });

  it("retains human-readable Issue forms with unique field IDs", async () => {
    for (const name of ["bug_report", "feature_request", "question"]) {
      const source = await read(`.github/ISSUE_TEMPLATE/${name}.yml`);
      const ids = [...source.matchAll(/^\s+id: (\S+)$/gmu)].map((match) => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps CI job names synchronized with the actual matrix", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    expect(workflow).toContain("name: Check ${{ matrix.os }}");
    for (const name of CI_JOBS) {
      expect(workflow).toContain(`- ${name.slice("Check ".length)}\n`);
    }
    expect(workflow).not.toContain("ubuntu-22.04");
    expect(workflow).not.toContain("ubuntu-22.04-arm");
  });

  it("cancels superseded PR runs without cancelling main release evidence", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    expect(workflow).toContain(
      "group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}",
    );
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it("runs write-capable maintenance only with trusted code and no dependency installation", async () => {
    const workflow = await read(".github/workflows/repository-maintenance.yml");
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain("types: [completed]");
    expect(workflow).not.toMatch(/^ {2}(?:issues|issue_comment|status|schedule):/mu);
    expect(workflow).not.toContain("CodeRabbit");
    expect(workflow).not.toContain("  pull_request:");
    expect(workflow).not.toContain("  pull_request_review:");
    expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toMatch(
      /npm (?:ci|install)|OPENAI_API_KEY|gh pr merge|convertPullRequestToDraft/u,
    );
    expect(workflow).not.toMatch(/github\.event\.(?:issue|pull_request)\.(?:body|title)/u);
  });

  it("allows explicit installer-only recovery without bypassing release prerequisites", async () => {
    const workflow = await read(".github/workflows/release-packages.yml");
    expect(workflow).toContain("skip_npm:");
    expect(workflow).toContain("github.repository == 'BytePioneer-AI/codex-host'");
    expect(workflow).toContain("github.event_name != 'workflow_dispatch' || !inputs.skip_npm");
    const publishRelease = workflow.slice(workflow.indexOf("  publish-release:"));
    expect(publishRelease).toContain("needs.prepare.result == 'success'");
    expect(publishRelease).toContain("needs.package.result == 'success'");
    expect(publishRelease).toContain("needs.publish-npm.result == 'success'");
    expect(publishRelease).toContain(
      "(github.event_name == 'workflow_dispatch' && inputs.skip_npm)) && needs.publish-npm.result == 'skipped'",
    );
    expect(publishRelease).toContain("await verifyRelease(");
  });

  it("publishes the update manifest alongside installers using trusted automation", async () => {
    const workflow = await read(".github/workflows/release-packages.yml");
    expect(workflow).toContain("./.release-automation/packages/repository-automation/index.mjs");
    expect(workflow).toContain("createInstallerUpdateManifest");
    expect(workflow).toContain('files+=("$RUNNER_TEMP/codex-buddy-update.json")');
  });

  it("dispatches release CI and installer publication without a PAT", async () => {
    const workflow = await read(".github/workflows/auto-release-on-main.yml");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("workflow_id: 'ci.yml', ref: process.env.RELEASE_TAG");
    expect(workflow).toContain("workflow_id: 'release-packages.yml', ref: 'main'");
    expect(workflow).toContain("skip_npm: true");
    expect(workflow).not.toContain("secrets.RELEASE_PAT");
    expect(await read(".github/workflows/ci.yml")).toContain("workflow_dispatch:");
  });

  it("keeps installer release CI to Apple Silicon macOS and Windows installers", async () => {
    const workflow = await read(".github/workflows/release-packages.yml");
    expect(workflow).toContain("- target: macos-arm64\n            runner: macos-14");
    expect(workflow).toContain("- target: windows-x64\n            runner: windows-latest");
    expect(workflow).toContain("- target: windows-arm64\n            runner: windows-latest");
    expect(workflow).not.toContain("macos-x64");
    expect(workflow).not.toContain("macos-15-intel");
    expect(workflow).not.toContain("x86_64-apple-darwin");
    const publishRelease = workflow.slice(workflow.indexOf("  publish-release:"));
    expect(publishRelease).toContain('"codex-buddy-${VERSION}-macos-arm64.dmg"');
    expect(publishRelease).toContain('"codex-buddy-${VERSION}-windows-x64.exe"');
    expect(publishRelease).toContain('"codex-buddy-${VERSION}-windows-arm64.exe"');
    expect(publishRelease).not.toContain("macos-x64");
  });

  it("keeps the Buddy macOS preview workflow Apple Silicon only", async () => {
    const workflow = await read(".github/workflows/buddy-macos-dmg.yml");
    expect(workflow).toContain('description: "Mac architecture (Apple Silicon: arm64)"');
    expect(workflow).toContain("          - macos-arm64\n");
    expect(workflow).not.toContain("macos-x64");
    expect(workflow).not.toContain("macos-15-intel");
    expect(workflow).not.toContain("x86_64-apple-darwin");
    expect(workflow).toContain("runs-on: macos-14");
    expect(workflow).toContain("targets: aarch64-apple-darwin");
  });

  it("pins external Actions and release build/publish checkouts to immutable SHAs", async () => {
    for (const file of [
      ".github/workflows/repository-maintenance.yml",
      ".github/workflows/release-packages.yml",
    ]) {
      const workflow = await read(file);
      for (const [, reference] of workflow.matchAll(/uses: (\S+)/gu))
        expect(reference).toMatch(/@[a-f0-9]{40}$/u);
    }
    const workflow = await read(".github/workflows/release-packages.yml");
    expect(workflow).not.toContain("ref: ${{ needs.prepare.outputs.tag }}");
    expect(workflow.match(/ref: \$\{\{ needs\.prepare\.outputs\.commit_sha \}\}/gu)).toHaveLength(
      3,
    );
    expect(
      workflow.match(/ref: \$\{\{ needs\.prepare\.outputs\.automation_sha \}\}/gu),
    ).toHaveLength(3);
    expect(workflow.match(/await verifyRelease\(/gu)).toHaveLength(2);
    expect(workflow).toContain("release-evidence.json");
    expect(workflow).toContain("timeout-minutes: 35");
    expect(workflow).toContain("waitForCi: true");
  });

  it("delivers only after a stable release succeeds using trusted code on the LAN runner", async () => {
    const workflow = await read(".github/workflows/release-packages.yml");
    const delivery = workflow.slice(workflow.indexOf("  deliver-macbook:"));
    expect(delivery).toContain("needs: [prepare, publish-release]");
    expect(delivery).toContain("needs.publish-release.result == 'success'");
    expect(delivery).toContain("needs.prepare.outputs.prerelease == 'false'");
    expect(delivery).toContain("runs-on: [self-hosted, macOS, ARM64, macmini-delivery]");
    expect(delivery).toContain("group: macbook-installer-downloads");
    expect(delivery).toContain("ref: ${{ needs.prepare.outputs.automation_sha }}");
    expect(delivery).toContain("deliverLatestMacbookInstaller({ github, repo: context.repo })");
    expect(delivery).not.toContain("contents: write");
  });
});
