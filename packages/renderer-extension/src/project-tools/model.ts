import {
  projectToolsConfigSchema,
  type ProjectToolsState,
  projectToolTargetKey,
  type ProjectCustomScript,
  type ProjectScriptAction,
  type ProjectScriptId,
  type ProjectScripts,
  type ProjectToolBinding,
  type ProjectToolsConfig,
  type ProjectToolTarget,
} from "@codexhost/shared-contracts";

import type { SidebarProject } from "../project-tabs/model.js";

export const PROJECT_TOOLS_STORAGE_KEY = "codexhost.project-tools.v1";

export interface ProjectToolsPersistenceClient {
  getProjectTools?(): Promise<
    Pick<ProjectToolsState, "config"> & Partial<Pick<ProjectToolsState, "metadataPath">>
  >;
  setProjectTools?(
    config: ProjectToolsConfig,
  ): Promise<Pick<ProjectToolsState, "config"> & Partial<Pick<ProjectToolsState, "metadataPath">>>;
  runProjectScript?(params: { target: ProjectToolTarget; action: ProjectScriptId }): Promise<{
    action: ProjectScriptId;
    state: "running" | "completed" | "failed";
    exitCode: number | null;
    output: string;
    logPath: string;
  }>;
}

/** 表单里的自定义脚本行；id 为空表示尚未分配稳定标识。 */
export interface ProjectCustomScriptDraft {
  id?: string;
  name: string;
  path: string;
}

export interface ProjectToolDraft {
  intranetUrl?: string;
  publicUrl?: string;
  scripts?: ProjectScripts;
  customScripts?: ProjectCustomScriptDraft[];
  /** 表单不再编辑 Prompt；仅用于把已保存的文本原样带回，避免保存其他字段时被清空。 */
  prompt?: string;
}

export interface ProjectScriptEntry {
  id: ProjectScriptId;
  name: string;
  path: string;
}

/** 内置 start/restart/stop 在前，其余按保存顺序，供标题栏菜单和执行复用。 */
export function projectScriptEntries(
  binding: ProjectToolBinding | null,
  labels: { start: string; restart: string; stop: string },
): ProjectScriptEntry[] {
  const entries: ProjectScriptEntry[] = [];
  for (const [id, name] of [
    ["start", labels.start],
    ["restart", labels.restart],
    ["stop", labels.stop],
  ] as const) {
    const path = binding?.scripts?.[id];
    if (path) entries.push({ id, name, path });
  }
  for (const script of binding?.customScripts ?? []) {
    entries.push({ id: script.id, name: script.name, path: script.path });
  }
  return entries;
}

export function isBuiltInScript(id: string): id is ProjectScriptAction {
  return id === "start" || id === "restart" || id === "stop";
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

export function bindingForProjectName(
  config: ProjectToolsConfig,
  label: string,
): ProjectToolBinding | null {
  const matches = config.bindings.filter(
    (binding) => binding.label === label || binding.label === label.replace(/^remote_/u, ""),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
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
  const customScripts = normalizeCustomScripts(draft.customScripts);
  const intranetUrl = draft.intranetUrl?.trim() || undefined;
  const publicUrl = draft.publicUrl?.trim() || undefined;
  const prompt = draft.prompt?.trim() || undefined;
  if (intranetUrl || publicUrl || scripts || customScripts || prompt) {
    bindings.push({
      target,
      label: project.label,
      ...(intranetUrl ? { intranetUrl } : {}),
      ...(publicUrl ? { publicUrl } : {}),
      ...(scripts ? { scripts } : {}),
      ...(customScripts ? { customScripts } : {}),
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

function normalizeCustomScripts(
  drafts: ProjectCustomScriptDraft[] | undefined,
): ProjectCustomScript[] | undefined {
  // 内置动作名始终保留，避免未绑定的 start 以后被自定义脚本占用。
  const used = new Set<string>(["start", "restart", "stop"]);
  const result: ProjectCustomScript[] = [];
  const claimed = new Set<string>();
  for (const draft of drafts ?? []) {
    const name = draft.name.trim();
    const path = draft.path.trim();
    if (!name && !path) continue;
    if (!name) throw new Error("自定义脚本需要填写名称。");
    if (!path) throw new Error(`自定义脚本“${name}”需要填写绝对路径。`);
    const requested = draft.id?.trim() || "";
    if (requested && isBuiltInScript(requested)) {
      throw new Error(`自定义脚本不能使用内置动作名“${requested}”。`);
    }
    if (requested && claimed.has(requested)) {
      throw new Error(`自定义脚本标识“${requested}”重复。`);
    }
    let id = requested;
    if (!id) {
      const base =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 48) || "script";
      id = base;
      for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
    }
    used.add(id);
    claimed.add(id);
    result.push({ id, name, path });
  }
  return result.length > 0 ? result : undefined;
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
  customScripts: string;
  customScriptName: string;
  customScriptPath: string;
  customScriptPlaceholder: string;
  customScriptAdd: string;
  customScriptRemove: string;
  customScriptNamePlaceholder: string;
  prompt: string;
  promptHint: string;
  promptFilled: string;
  promptSent: string;
  promptUnavailable: string;
  metadataPath: string;
  metadataHint: string;
  copyPath: string;
  targetHint: string;
  scriptPromptPreview: string;
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
      description: "Bind access URLs and trusted scripts.",
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
      customScripts: "Custom scripts",
      customScriptName: "Name",
      customScriptPath: "Path",
      customScriptPlaceholder: "/repo/scripts/deploy.sh",
      customScriptAdd: "Add script",
      customScriptRemove: "Remove script",
      customScriptNamePlaceholder: "Deploy",
      prompt: "Open prompt",
      promptHint:
        "If empty, generates a task from this project's path and metadata location. Opens a new conversation and sends it automatically.",
      promptFilled: "Prompt filled in but not sent. Review the draft before sending.",
      promptSent: "Script generation task sent.",
      promptUnavailable: "The project new-conversation entry is unavailable.",
      metadataPath: "Codex Buddy metadata",
      metadataHint:
        "Authoritative project-tools.json read by the local Host. Ask the AI to merge only this project's binding.",
      copyPath: "Copy path",
      targetHint: "The task includes this exact project identity and target key.",
      scriptPromptPreview:
        "Create start/restart/stop scripts and bind their paths in project-tools.json.",
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
    description: "为项目绑定访问地址与可信脚本。",
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
    customScripts: "自定义脚本",
    customScriptName: "名称",
    customScriptPath: "路径",
    customScriptPlaceholder: "/repo/scripts/deploy.sh",
    customScriptAdd: "添加脚本",
    customScriptRemove: "删除脚本",
    customScriptNamePlaceholder: "部署",
    prompt: "打开 Prompt",
    promptHint: "留空时按项目路径和元数据位置动态生成任务；打开新会话后自动发送。",
    promptFilled: "Prompt 已填入但未能发送，请核对草稿后手动发送。",
    promptSent: "脚本制作任务已发送。",
    promptUnavailable: "项目的新建会话入口不可用。",
    metadataPath: "Codex Buddy 元数据",
    metadataHint: "本机 Host 实际读取的 project-tools.json；AI 只合并当前项目 binding。",
    copyPath: "复制路径",
    targetHint: "任务会携带当前项目的精确身份和 target 唯一键。",
    scriptPromptPreview: "制作 start/restart/stop 脚本，并把绝对路径绑定到 project-tools.json。",
    more: "更多操作",
    saved: "项目快捷操作已保存",
    started: "脚本已启动",
    completed: "脚本执行完成",
    failed: "脚本执行失败",
    running: "执行中",
  };
}
