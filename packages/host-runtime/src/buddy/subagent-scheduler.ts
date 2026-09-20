import type { BuddyPlanTask } from "@codexhost/shared-contracts";
import type { ExecutorCandidate } from "./models.js";
import type { ValidatedPlan } from "./plan-graph.js";

export interface SubagentRunInput {
  parentThreadId: string;
  cwd: string;
  task: string;
  model: string;
  requestId: string;
  signal: AbortSignal;
}

export interface SubagentRunResult {
  taskId: string;
  model: string;
  status: "completed" | "failed" | "cancelled";
  summary: string;
}

export type SubagentRunner = (input: SubagentRunInput) => Promise<SubagentRunResult>;

function taskPrompt(task: BuddyPlanTask): string {
  return [
    `你是受 Host 调度的独立子代理，只执行任务 ${task.id}：${task.title}`,
    `目标：${task.objective}`,
    `步骤：${task.steps.map((step, index) => `${index + 1}. ${step}`).join("；")}`,
    `文件范围：${task.files.length ? task.files.join(", ") : "由只读调查确定，但不得扩大范围"}`,
    `包范围：${task.packages.length ? task.packages.join(", ") : "无额外包范围"}`,
    `验收：${task.acceptance.join("；")}`,
    "不要重新规划、不要委派、不要修改范围外文件。工具类必须放在所属公共工具模块，不能放进 private 文件。完成后返回改动、验证命令、真实结果和剩余风险。",
  ].join("\n");
}

export async function executePlanWaves(input: {
  plan: ValidatedPlan;
  candidates: readonly ExecutorCandidate[];
  parentThreadId: string;
  cwd: string;
  signal: AbortSignal;
  run: SubagentRunner;
}): Promise<SubagentRunResult[]> {
  if (!input.plan.plan.execution.delegateIndependentTasks || input.candidates.length === 0) {
    return [];
  }
  const results: SubagentRunResult[] = [];
  let candidateIndex = 0;
  for (const wave of input.plan.waves) {
    input.signal.throwIfAborted();
    if (wave.tasks.length < 2) continue;
    const selected = wave.tasks.slice(0, input.plan.plan.execution.maxParallel);
    const waveResults = await Promise.all(
      selected.map(async (task) => {
        const candidate = input.candidates[candidateIndex++ % input.candidates.length];
        if (!candidate) throw new Error("没有可用的并行执行模型。");
        return input.run({
          parentThreadId: input.parentThreadId,
          cwd: input.cwd,
          task: taskPrompt(task),
          model: candidate.id,
          requestId: `buddy-plan:${input.parentThreadId}:${task.id}`,
          signal: input.signal,
        });
      }),
    );
    results.push(...waveResults);
    const failed = waveResults.find((result) => result.status !== "completed");
    if (failed) {
      throw new Error(`子任务 ${failed.taskId} ${failed.status}：${failed.summary}`);
    }
  }
  return results;
}

export function summarizeSubagentResults(results: readonly SubagentRunResult[]): string {
  if (results.length === 0) return "没有启动并行子代理；由当前执行模型完成任务。";
  return results
    .map((result) => `[${result.taskId}] model=${result.model} status=${result.status}\n${result.summary}`)
    .join("\n\n");
}
