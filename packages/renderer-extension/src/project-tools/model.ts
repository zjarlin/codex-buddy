import {
  projectToolsConfigSchema,
  projectToolTargetKey,
  type ProjectScriptAction,
  type ProjectScripts,
  type ProjectToolBinding,
  type ProjectToolsConfig,
  type ProjectToolTarget,
} from "@codexhost/shared-contracts";

import type { SidebarProject } from "../project-tabs/model.js";

export const PROJECT_TOOLS_STORAGE_KEY = "codexhost.project-tools.v1";

export interface ProjectToolsPersistenceClient {
  getProjectTools?(): Promise<{ config: ProjectToolsConfig | null }>;
  setProjectTools?(config: ProjectToolsConfig): Promise<{ config: ProjectToolsConfig | null }>;
  runProjectScript?(params: { target: ProjectToolTarget; action: ProjectScriptAction }): Promise<{
    action: ProjectScriptAction;
    state: "running" | "completed" | "failed";
    exitCode: number | null;
    output: string;
    logPath: string;
  }>;
}

export interface ProjectToolDraft {
  intranetUrl?: string;
  publicUrl?: string;
  scripts?: ProjectScripts;
  prompt?: string;
}

export function emptyProjectTools(): ProjectToolsConfig {
  return { version: 1, bindings: [] };
}

export function parseProjectTools(raw: string | null): ProjectToolsConfig {
  if (raw === null) return emptyProjectTools();
  return projectToolsConfigSchema.parse(JSON.parse(raw));
}

export function projectToolTarget(project: SidebarProject): ProjectToolTarget {
  return project.projectKind === "local"
    ? { projectKind: "local", projectId: project.projectId }
    : {
        projectKind: "remote",
        hostId: project.hostId ?? "",
        projectId: project.projectId,
      };
}

export function projectToolKey(project: SidebarProject): string {
  return projectToolTargetKey(projectToolTarget(project));
}

export function bindingForProject(
  config: ProjectToolsConfig,
  project: SidebarProject,
): ProjectToolBinding | null {
  const key = projectToolKey(project);
  return config.bindings.find((binding) => projectToolTargetKey(binding.target) === key) ?? null;
}

export function withProjectToolBinding(
  config: ProjectToolsConfig,
  project: SidebarProject,
  draft: ProjectToolDraft,
): ProjectToolsConfig {
  const target = projectToolTarget(project);
  const key = projectToolTargetKey(target);
  const bindings = config.bindings.filter(
    (binding) => projectToolTargetKey(binding.target) !== key,
  );
  const scripts = trimScripts(draft.scripts);
  const intranetUrl = draft.intranetUrl?.trim() || undefined;
  const publicUrl = draft.publicUrl?.trim() || undefined;
  const prompt = draft.prompt?.trim() || undefined;
  if (intranetUrl || publicUrl || scripts || prompt) {
    bindings.push({
      target,
      label: project.label,
      ...(intranetUrl ? { intranetUrl } : {}),
      ...(publicUrl ? { publicUrl } : {}),
      ...(scripts ? { scripts } : {}),
      ...(prompt ? { prompt } : {}),
    });
  }
  return projectToolsConfigSchema.parse({ version: 1, bindings });
}

export function removeProjectToolBinding(
  config: ProjectToolsConfig,
  project: SidebarProject,
): ProjectToolsConfig {
  return withProjectToolBinding(config, project, {});
}

function trimScripts(scripts: ProjectScripts | undefined): ProjectScripts | undefined {
  if (!scripts) return undefined;
  const trimmed = {
    ...(scripts.start?.trim() ? { start: scripts.start.trim() } : {}),
    ...(scripts.restart?.trim() ? { restart: scripts.restart.trim() } : {}),
    ...(scripts.stop?.trim() ? { stop: scripts.stop.trim() } : {}),
  };
  return Object.keys(trimmed).length > 0 ? trimmed : undefined;
}

export function projectToolLabels(locale: string): {
  configure: string;
  title: string;
  description: string;
  intranet: string;
  public: string;
  start: string;
  restart: string;
  stop: string;
  save: string;
  cancel: string;
  remove: string;
  scripts: string;
  scriptHint: string;
  prompt: string;
  promptField: string;
  promptSection: string;
  promptHint: string;
  promptFilled: string;
  promptUnavailable: string;
  more: string;
  saved: string;
  started: string;
  completed: string;
  failed: string;
  running: string;
} {
  if (locale !== "zh-CN") {
    return {
      configure: "Configure project actions",
      title: "Project actions",
      description: "Bind access URLs, a default prompt, and trusted local scripts to this project.",
      intranet: "Intranet URL",
      public: "Public URL",
      start: "Start",
      restart: "Restart",
      stop: "Stop",
      save: "Save",
      cancel: "Cancel",
      remove: "Remove binding",
      scripts: "Scripts",
      scriptHint:
        "Use an absolute path to a .sh or .py file. Scripts run from their own directory.",
      prompt: "Open prompt",
      promptField: "Default prompt",
      promptSection: "Prompt",
      promptHint: "Opens a new conversation. The prompt is filled in but not sent automatically.",
      promptFilled: "Prompt filled in. Review it before sending.",
      promptUnavailable: "The project new-conversation entry is unavailable.",
      more: "More actions",
      saved: "Project actions saved",
      started: "Script started",
      completed: "Script completed",
      failed: "Script failed",
      running: "Running",
    };
  }
  return {
    configure: "配置项目快捷操作",
    title: "项目快捷操作",
    description: "为项目绑定访问地址、默认 Prompt 和可信的本机脚本。",
    intranet: "内网地址",
    public: "公网地址",
    start: "启动",
    restart: "重启",
    stop: "停止",
    save: "保存",
    cancel: "取消",
    remove: "删除绑定",
    scripts: "脚本",
    scriptHint: "填写 .sh 或 .py 脚本的绝对路径；脚本会以自身目录作为工作目录运行。",
    prompt: "打开 Prompt",
    promptField: "默认 Prompt",
    promptSection: "Prompt",
    promptHint: "打开新的项目会话并填入 Prompt，不会自动发送。",
    promptFilled: "Prompt 已填入，请确认后发送。",
    promptUnavailable: "项目的新建会话入口不可用。",
    more: "更多操作",
    saved: "项目快捷操作已保存",
    started: "脚本已启动",
    completed: "脚本执行完成",
    failed: "脚本执行失败",
    running: "执行中",
  };
}
