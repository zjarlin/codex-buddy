import { z } from "zod";

export const PROJECT_TOOLS_GET_METHOD = "codexhost/settings/project-tools/get";
export const PROJECT_TOOLS_SET_METHOD = "codexhost/settings/project-tools/set";
export const PROJECT_TOOLS_RUN_SCRIPT_METHOD = "codexhost/project/tools/run-script";

const projectIdSchema = z.string().min(1).max(128);
const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .superRefine((value, context) => {
    const URLConstructor = (
      globalThis as typeof globalThis & {
        URL: new (input: string) => {
          protocol: string;
          username: string;
          password: string;
        };
      }
    ).URL;
    let url: { protocol: string; username: string; password: string };
    try {
      url = new URLConstructor(value);
    } catch {
      context.addIssue({ code: "custom", message: "URL must be absolute" });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "URL must use HTTP or HTTPS" });
    }
    if (url.username || url.password) {
      context.addIssue({ code: "custom", message: "URL must not contain credentials" });
    }
  });

export const projectToolTargetSchema = z.discriminatedUnion("projectKind", [
  z
    .object({
      projectKind: z.literal("local"),
      projectId: projectIdSchema,
    })
    .strict(),
  z
    .object({
      projectKind: z.literal("remote"),
      hostId: projectIdSchema,
      projectId: projectIdSchema,
    })
    .strict(),
]);
export type ProjectToolTarget = z.infer<typeof projectToolTargetSchema>;

const absoluteScriptPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes("\0"), "Script path must not contain NUL")
  .refine(
    (value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\"),
    "Script path must be absolute",
  )
  .refine((value) => /\.(?:sh|py)$/iu.test(value), "Script must be a .sh or .py file");

export const projectScriptActionSchema = z.enum(["start", "restart", "stop"]);
export type ProjectScriptAction = z.infer<typeof projectScriptActionSchema>;

export const projectScriptsSchema = z
  .object({
    start: absoluteScriptPathSchema.optional(),
    restart: absoluteScriptPathSchema.optional(),
    stop: absoluteScriptPathSchema.optional(),
  })
  .strict()
  .superRefine((scripts, context) => {
    if (!scripts.start && !scripts.restart && !scripts.stop) {
      context.addIssue({ code: "custom", message: "At least one project script is required" });
    }
  });
export type ProjectScripts = z.infer<typeof projectScriptsSchema>;

export const projectToolBindingSchema = z
  .object({
    target: projectToolTargetSchema,
    label: z.string().trim().min(1).max(200),
    intranetUrl: httpUrlSchema.optional(),
    publicUrl: httpUrlSchema.optional(),
    scripts: projectScriptsSchema.optional(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (!binding.intranetUrl && !binding.publicUrl && !binding.scripts) {
      context.addIssue({
        code: "custom",
        path: ["intranetUrl"],
        message: "At least one project URL or script is required",
      });
    }
  });
export type ProjectToolBinding = z.infer<typeof projectToolBindingSchema>;

export function projectToolTargetKey(target: ProjectToolTarget): string {
  const parsed = projectToolTargetSchema.parse(target);
  return JSON.stringify([
    parsed.projectKind,
    parsed.projectKind === "remote" ? parsed.hostId : "local",
    parsed.projectId,
  ]);
}

export const projectToolsConfigSchema = z
  .object({
    version: z.literal(1),
    bindings: z.array(projectToolBindingSchema).max(500),
  })
  .strict()
  .superRefine((config, context) => {
    const keys = config.bindings.map((binding) => projectToolTargetKey(binding.target));
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["bindings"],
        message: "Project tool targets must be unique",
      });
    }
  });
export type ProjectToolsConfig = z.infer<typeof projectToolsConfigSchema>;

export const projectToolsGetParamsSchema = z.object({}).strict();
export const projectToolsStateSchema = z
  .object({
    config: projectToolsConfigSchema.nullable(),
  })
  .strict();
export type ProjectToolsState = z.infer<typeof projectToolsStateSchema>;

export const projectScriptRunParamsSchema = z
  .object({
    target: projectToolTargetSchema,
    action: projectScriptActionSchema,
  })
  .strict();
export type ProjectScriptRunParams = z.infer<typeof projectScriptRunParamsSchema>;

export const projectScriptRunResultSchema = z
  .object({
    action: projectScriptActionSchema,
    state: z.enum(["running", "completed", "failed"]),
    exitCode: z.number().int().nullable(),
    output: z.string().max(20_000),
    logPath: z.string().min(1).max(32_768),
  })
  .strict();
export type ProjectScriptRunResult = z.infer<typeof projectScriptRunResultSchema>;
