import type { ProjectToolBinding } from "@codexhost/shared-contracts";
import { projectToolTargetKey } from "@codexhost/shared-contracts";

import type { SidebarProject } from "../project-tabs/model.js";
import { projectToolTarget } from "./model.js";

export interface ProjectScriptPromptInput {
  project: SidebarProject & { path: string };
  metadataPath: string;
  currentBinding: ProjectToolBinding | null;
}

export function buildProjectScriptPrompt(input: ProjectScriptPromptInput): string {
  const target = projectToolTarget(input.project);
  const targetKey = projectToolTargetKey(target);
  const binding = {
    target,
    label: input.project.label,
    scripts: {
      start: `${input.project.path}/scripts/start.sh`,
      restart: `${input.project.path}/scripts/restart.sh`,
      stop: `${input.project.path}/scripts/stop.sh`,
    },
  };
  const custom = input.currentBinding?.customScripts ?? [];
  const customIdHint =
    custom.length > 0
      ? custom.map((script) => `- ${script.id}：${script.name}（${script.path}）`).join("\n")
      : "- 暂无；需要时自行新增";
  const current = input.currentBinding ? JSON.stringify(input.currentBinding, null, 2) : "null";

  return `请直接为当前 Codex 项目制作可用的启动、重启、停止脚本，并把脚本路径写回 Codex Buddy 的项目快捷操作元数据。不要只给建议或示例，要完成实现与验证。

项目身份（必须保持精确一致）：
- 项目名称：${input.project.label}
- 项目绝对路径：${input.project.path}
- projectKind：${target.projectKind}
- projectId：${target.projectId}${target.projectKind === "remote" ? `\n- hostId：${target.hostId}` : ""}
- target 唯一键：${targetKey}

元数据文件（Host 实际读取的权威文件）：
${input.metadataPath}

当前项目已有的自定义脚本（customScripts，更新时必须沿用这些 id，不要改名或复用内置动作名 start/restart/stop）：
${customIdHint}

当前项目已有 binding（如果存在，必须保留其中未要求修改的 intranetUrl、publicUrl、prompt、customScripts 和其他字段）：
\`\`\`json
${current}
\`\`\`

执行要求：
1. 先阅读项目自身的 README、package/构建配置、现有脚本及运行入口，确认真实启动方式和依赖；不要把猜测写成命令。
2. 在项目内创建或完善 start、restart、stop 三个脚本，优先复用现有脚本和仓库约定。脚本必须使用绝对可靠的项目目录计算方式，不依赖调用者 cwd；支持从任意目录调用。
3. start 必须幂等：已运行时检查 PID/端口/进程身份后直接成功，不得重复启动。使用项目内 PID、日志或锁文件时明确路径。
4. stop 必须安全、幂等：只停止由该项目 PID 文件或可核验的项目进程标识确认的进程；禁止无范围 pkill、killall、按模糊名称杀进程或影响其他项目。进程不存在时返回成功。
5. restart 应该是安全的 stop 后 start，并在 stop 失败或旧进程仍未退出时明确失败，不要盲目并行。
6. 脚本要处理信号退出、错误码、日志目录和必要的清理；使用 bash 时启用 set -euo pipefail（或给出同等严格错误处理）。Python 脚本使用绝对 shebang，失败返回非零。
7. 对脚本执行 chmod +x 和 bash -n（或 Python 语法检查）。条件允许时实际执行 start、检查 PID/日志/健康入口，再执行 restart 和 stop，确认服务状态与进程清理；不适合实际启动时说明原因，但至少完成静态检查。
8. 除 start/restart/stop 外，项目需要额外的构建、部署、迁移、打开等操作时，把脚本写入 binding.customScripts：每项包含稳定且 URL 安全的 id（字母、数字、- 或 _，不能是 start/restart/stop）、界面显示名称 name 和脚本绝对路径 path。已有 customScripts 项只更新 path，不擅自改名或删除。
9. 完成后以原子方式合并写回上面的元数据文件，保留 version 和所有其他项目 binding，只新增或更新 target 唯一键为 ${targetKey} 的这一项。脚本路径必须是绝对路径。回复前重新读取文件并做 JSON 校验。

目标 binding 的写入结构参考（路径以实际生成文件为准，不要凭空使用示例路径）：
\`\`\`json
${JSON.stringify({ version: 1, binding }, null, 2)}
\`\`\`

最终回复请列出：
- 实际创建/修改的脚本绝对路径
- start/restart/stop 的关键行为与 PID/日志位置
- 已执行的验证命令及结果
- 元数据文件路径、target 唯一键和写回结果
- 未能执行的验证及原因`;
}
