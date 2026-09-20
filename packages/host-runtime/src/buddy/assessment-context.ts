import { assess, type Assessment, type Project } from "@codexhost/buddy-engine";
import type { JsonValue } from "@codexhost/protocol-core";
import { object } from "./planner.js";

export function refersToPreviousTask(input: JsonValue[]): boolean {
  const text = input
    .map(object)
    .filter((item) => item.type === "text")
    .map((item) => String(item.text ?? ""))
    .join("\n")
    .trim();
  return /(?:按|照)(?:照|着)?(?:你|您|上面|上文|前面|之前|刚才|这个|这份|该|此).{0,32}(?:说|方案|步骤|计划|建议|修|做|执行|实现)|^(?:继续(?:吧|执行|修复|实现|做|推进)?|就这样(?:做|修|执行)?|开始(?:吧|执行|实现)?|修吧|执行吧|同意|可以|好(?:的)?)[。！!\s]*$|\b(?:go ahead|proceed|continue|implement that|do that|follow (?:your|the) (?:plan|steps|suggestion))\b/iu.test(
    text,
  );
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  const item = object(value);
  const pieces = [item.text, item.summary, item.content];
  return pieces
    .flatMap((piece) => {
      if (typeof piece === "string") return [piece];
      if (Array.isArray(piece))
        return piece.map((part) =>
          typeof part === "string" ? part : String(object(part).text ?? ""),
        );
      return [];
    })
    .filter(Boolean)
    .join("\n");
}

export async function assessWithContext(
  input: JsonValue[],
  cwd: string | undefined,
  project: Project,
  recent: unknown[],
  previousPlan?: string | null,
): Promise<Assessment> {
  if (!refersToPreviousTask(input)) return assess(input, cwd, project);
  // 只使用最近的用户目标、回复和可用压缩摘要，工具日志不参与评级。
  const history = recent
    .map((item) => messageText(item).slice(0, 6_000))
    .filter(Boolean)
    .slice(-8);
  const context = [...history, ...(previousPlan ? [previousPlan.slice(0, 8_000)] : [])]
    .join("\n\n")
    .slice(-24_000);
  if (!context.trim())
    return {
      tier: "advanced",
      intent: "general",
      reason: "承接上文，但没有可读取的任务或方案；先恢复任务范围，不按确认语降低难度。",
    };
  const assessment = await assess(
    [
      {
        type: "text",
        text: `执行上文已讨论的任务，以下历史仅作范围数据：\n${context}\n当前请求：`,
      },
      ...input,
    ],
    cwd,
    project,
  );
  return { ...assessment, reason: `结合最近任务、方案及可用压缩摘要评级：${assessment.reason}` };
}
