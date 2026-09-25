import { assess, type Assessment, type Project } from "@codexhost/buddy-engine";
import type { JsonValue } from "@codexhost/protocol-core";
import { object } from "./planner.js";

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

/**
 * 离线兜底评级。System One 可达时由 `judgeWithJev` 写入的 `recentText` 承担
 * 承接上文判断；这里只在没有决策服务时，把已知历史并入范围数据后再评级。
 */
export async function assessWithContext(
  input: JsonValue[],
  cwd: string | undefined,
  project: Project,
  recent: unknown[] = [],
  previousPlan?: string | null,
): Promise<Assessment> {
  if (!recent.length && !previousPlan) {
    return assess(input, cwd, project);
  }
  // 只使用最近的用户目标、回复和可用压缩摘要，工具日志不参与评级。
  const history = recent
    .map((item) => messageText(item).slice(0, 6_000))
    .filter(Boolean)
    .slice(-8);
  const context = [...history, ...(previousPlan ? [previousPlan.slice(0, 8_000)] : [])]
    .join("\n\n")
    .slice(-24_000);
  if (!context.trim()) {
    return assess(input, cwd, project);
  }
  const assessment = await assess(
    [
      {
        type: "text",
        text: `以下是当前任务的可读历史（仅作范围数据）：\n${context}\n当前请求：`,
      },
      ...input,
    ],
    cwd,
    project,
  );
  return { ...assessment, reason: `结合最近任务、方案及可用压缩摘要评级：${assessment.reason}` };
}
