import { describe, expect, it } from "vitest";
import { assess } from "../index.mjs";

const emptyProject = { root: null, stacks: [], keywords: [], commands: [] };
const projectWithCommands = {
  root: "/tmp/project",
  stacks: ["node"],
  keywords: ["test"],
  commands: [{ action: "test", command: "npm test", cwd: "/tmp/project", source: "package.json" }],
};

// System One 可达时这些判断由其完成；此处的离线兜底只保证保守下限。
describe("offline fallback assessment", () => {
  it("requires planning when no System One service is available", async () => {
    await expect(
      assess([{ type: "text", text: "hi" }], undefined, emptyProject),
    ).resolves.toMatchObject({
      tier: "advanced",
      intent: "general",
      assessmentSource: "local-fallback",
    });
  });

  it("does not present a discovered project as a confident simple task", async () => {
    const result = await assess(
      [{ type: "text", text: "跑起来看看" }],
      "/tmp/project",
      projectWithCommands,
    );
    expect(result).toMatchObject({ tier: "standard", intent: "project" });
    expect(result.reason).toContain("System One");
  });

  it("treats attachments and empty text as needing planning", async () => {
    await expect(
      assess(
        [
          { type: "text", text: "hi" },
          { type: "image", url: "fixture.png" },
        ],
        undefined,
        emptyProject,
      ),
    ).resolves.toMatchObject({ tier: "advanced" });
    await expect(assess([{ type: "text", text: "   " }], undefined, emptyProject)).resolves.toMatchObject({
      tier: "advanced",
    });
  });
});
