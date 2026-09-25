import type { JsonValue } from "@codexhost/protocol-core";
import type { BuddyDecision } from "@codexhost/shared-contracts";
import { object, result, type NativeRequest } from "./planner.js";

type ModelBypass = NonNullable<BuddyDecision["modelBypass"]>;

/**
 * 离线兜底的推送预筛，只在 System One 不可用时决定是否进入 Git 旁路。
 * 正常路由的推送意图由 System One 的 push 判断负责，这里不再是第一判断层。
 */
export function isGitPushRequest(input: JsonValue[]): boolean {
  const text = input
    .map(object)
    .filter((item) => item.type === "text")
    .map((item) => String(item.text ?? ""))
    .join("\n")
    .normalize("NFKC")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, "")
    .replace(/^\s*>.*$/gmu, "")
    .replace(/“[^”]*”|"[^"\n]*"/gu, "")
    .trim();
  // 只识别当前用户的操作要求，引用、解释和开发路由功能不构成推送授权。
  if (
    /(?:不要|别|无需|禁止|暂不|不用)\s*(?:提交并)?推送|\b(?:do not|don't|never)\s+(?:git\s+)?push\b/iu.test(
      text,
    ) ||
    /(?:字眼|关键词)|(?:检测|识别).*(?:推送|push).*(?:旁路|路由)|(?:开发|实现|设计|新增|添加|修改|修复|重构).*(?:功能|模块|按钮|文案|路由|旁路)|^(?:解释|说明|介绍|什么是|如何|怎么|explain\b|what\b|how\b)/iu.test(
      text,
    )
  ) {
    return false;
  }
  return /(?:推送(?:一下)?(?:当前|现有|这些|所有|这份)?(?:的)?(?:代码|改动|更改)|提交(?:代码|改动|更改)?(?:并|后|然后)推送|\bgit\s+push\b|\bpush\s+(?:(?:the|my|our|current)\s+)*(?:code|changes|commits)\b)/iu.test(
    text,
  );
}

export const gitPushGuidance = [
  "本回合命中 Git 推送模型旁路，由当前垃模型独立处理，跳过夯规划，不委派子代理或切换到高级模型。",
  "先读取本回合附带的 Git、GitLab、GitHub CLI 和 PR skill，按实际远程仓库选择 glab 或 gh；技能中与当前任务无关的发布流程不自动执行。",
  "先确认实际仓库、分支、远程、暂存区与工作区；只提交和推送用户授权的改动，保留其他修改。遇到未定设计或冲突时报告证据，不扩大范围。",
  "保留原生权限、审批及 Plan Mode 约束；规划模式只检查和说明，不执行 Git 写操作。",
  "以真实命令退出码及远端分支或 PR/MR 状态验证结果；最终明确说明完成、失败或待确认，不能把模型正常结束当成推送成功。",
].join("\n");

export async function gitPushSkills(
  request: NativeRequest,
  cwd: string,
  input: JsonValue[],
): Promise<{ input: JsonValue[]; skills: string[]; warning: string | null }> {
  const existing = input.map(object).filter((item) => item.type === "skill");
  const selected = new Map<string, { type: "skill"; name: string; path: string }>();
  const warnings: string[] = [];
  try {
    const listing = result(await request("skills/list", { cwds: [cwd], forceReload: true }));
    if (!Array.isArray(listing.data)) {
      throw new Error("原生技能目录格式无效");
    }
    for (const entry of listing.data.map(object).filter((entry) => entry.cwd === cwd)) {
      if (Array.isArray(entry.errors) && entry.errors.length) {
        warnings.push("部分技能加载失败");
      }
      for (const skill of (Array.isArray(entry.skills) ? entry.skills : []).map(object)) {
        if (
          skill.enabled !== true ||
          typeof skill.name !== "string" ||
          typeof skill.path !== "string" ||
          !skill.path.trim() ||
          !/(?:^|[:/])(?:git|gitlab|glab|gh|github|github-cli|git-workflow|prskill|git-commit|git-push)(?:$|[-:])/iu.test(
            skill.name,
          )
        ) {
          continue;
        }
        selected.set(skill.path, { type: "skill", name: skill.name, path: skill.path });
      }
    }
  } catch (error) {
    warnings.push(`技能目录读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const skills = [
    ...new Set([
      ...existing.map((skill) => String(skill.name)),
      ...[...selected.values()].map((skill) => skill.name),
    ]),
  ];
  if (!skills.some((name) => /gitlab|glab/iu.test(name))) {
    warnings.push("未发现可用 GitLab skill");
  }
  if (!skills.some((name) => /(?:^|[:/-])gh(?:$|[-:])|github/iu.test(name))) {
    warnings.push("未发现可用 GitHub CLI（gh）skill");
  }
  const additions = [...selected.values()].filter(
    (skill) => !existing.some((item) => item.path === skill.path),
  );
  return {
    input: [...input, ...additions],
    skills,
    warning: warnings.length ? warnings.join("；") : null,
  };
}

// 统计当前 Host 运行期间每个模型的旁路回合终态，不把它冒充 Git 业务验收。
export class GitPushBypassScores {
  readonly #models = new Map<string, { succeeded: number; total: number }>();

  start(model: string | null, skills: string[], skillWarning: string | null): ModelBypass {
    const counts = (model ? this.#models.get(model) : undefined) ?? { succeeded: 0, total: 0 };
    return {
      kind: "git-push",
      skills,
      skillWarning,
      outcome: "pending",
      ...counts,
      successRate: this.#rate(counts),
    };
  }

  finish(decision: BuddyDecision, outcome: ModelBypass["outcome"]): ModelBypass | undefined {
    const bypass = decision.modelBypass;
    if (!bypass || bypass.outcome !== "pending" || outcome === "pending") {
      return undefined;
    }
    if (!decision.executorModel) {
      return { ...bypass, outcome };
    }
    const counts = this.#models.get(decision.executorModel) ?? { succeeded: 0, total: 0 };
    if (outcome !== "cancelled") {
      counts.total++;
      counts.succeeded += outcome === "completed" ? 1 : 0;
      this.#models.set(decision.executorModel, counts);
    }
    return { ...bypass, outcome, ...counts, successRate: this.#rate(counts) };
  }

  #rate(counts: { succeeded: number; total: number }): number | null {
    return counts.total ? Math.round((counts.succeeded / counts.total) * 100) : null;
  }
}
