import { z } from "zod";

export const PROJECT_TABS_GET_METHOD = "codexhost/settings/project-tabs/get";
export const PROJECT_TABS_SET_METHOD = "codexhost/settings/project-tabs/set";

export const projectTabSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
    prefixes: z.array(z.string().min(1).max(512)).max(100),
  })
  .strict();
export type ProjectTab = z.infer<typeof projectTabSchema>;

export const projectTabsConfigSchema = z
  .object({
    version: z.literal(2),
    tabs: z.array(projectTabSchema).max(100),
    assignments: z.record(z.string(), z.string().min(1).max(128)),
    selected: z.string().min(1).max(128).nullable(),
  })
  .strict()
  .superRefine((config, context) => {
    const ids = new Set(config.tabs.map((tab) => tab.id));
    if (ids.size !== config.tabs.length) {
      context.addIssue({ code: "custom", path: ["tabs"], message: "Tab IDs must be unique" });
    }
    if (config.selected !== null && !ids.has(config.selected)) {
      context.addIssue({ code: "custom", path: ["selected"], message: "Selected tab is missing" });
    }
    for (const [project, tabId] of Object.entries(config.assignments)) {
      if (!ids.has(tabId)) {
        context.addIssue({
          code: "custom",
          path: ["assignments", project],
          message: "Assigned tab is missing",
        });
      }
    }
  });
export type ProjectTabsConfig = z.infer<typeof projectTabsConfigSchema>;

export const projectTabsGetParamsSchema = z.object({}).strict();
export const projectTabsStateSchema = z
  .object({
    config: projectTabsConfigSchema.nullable(),
  })
  .strict();
export type ProjectTabsState = z.infer<typeof projectTabsStateSchema>;
