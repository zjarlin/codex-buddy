import { assess as assessTask } from "./vendor/routing/assessment.mjs";

/**
 * 离线兜底评级。System One 可达时不走这里；保留它是为了让 Host 在未配置
 * 决策服务时仍能给出保守下限，而不是把请求当成简单任务直接执行。
 */
export async function assess(input, cwd, project) {
  return assessTask(input, cwd, project);
}
