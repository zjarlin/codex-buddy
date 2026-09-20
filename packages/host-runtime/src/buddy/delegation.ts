import type { ModelInventory } from "./models.js";
import type { TaskPacket } from "./planner.js";
import { validatePlan } from "./plan-graph.js";

export function singleExecutorPacket(packet: TaskPacket): TaskPacket {
  // 显式执行模型优先于规划器建议，交接的任务包也必须保持单执行者语义。
  const serial = validatePlan({
    ...packet.plan,
    tasks: packet.plan.tasks.map((task) => ({ ...task, parallelizable: false })),
    execution: {
      delegateIndependentTasks: false,
      maxParallel: 1,
      delegationReason: "用户已指定单个执行模型。",
    },
  });
  return { ...packet, ...serial };
}

export function parallelExecutionGuidance(
  inventory: ModelInventory,
  fixedExecutor: string | null = null,
): string {
  if (fixedExecutor) {
    return `用户已指定执行模型 ${JSON.stringify(fixedExecutor)}。本任务由当前执行模型单独完成，所有步骤串行执行；不要启动、恢复或委派任何子代理，也不要换用其他执行模型。`;
  }
  if (inventory.parallelExecutors.length === 0) {
    return "当前没有新鲜原生子代理候选；本地完成任务，不猜测子代理模型 ID。";
  }
  const candidates = inventory.parallelExecutors.slice(0, 8);
  return [
    "执行任务可包含并行子任务，但不为并行而拆分。先由主线程确定关键路径；只在用户或适用 AGENTS 已授权且当前原生工具支持时，将互不依赖、写入范围不重叠的有界任务交给子代理，主线程同时推进其余工作并负责整体验收。",
    "按各子任务所需能力，在下列实时可用候选中优先选经济性高者，不固定所有任务使用同一个模型。capability/economy 是策略或模型估计分数，不是价格或能力保证；不为分散模型而选更贵候选。",
    "level=simple 仅用于足够简单、有界的工作；常规编码优先 level=standard，unknown 不是能力确认。先确认子任务能力需求，再比较经济性；不能把低价当成能够承担复杂设计的证据。",
    "候选已经与最近的原生子代理能力快照相交；调用时仍以当前工具 schema 为准，只传其支持的精确模型 ID 和推理强度，不支持时选同档其他候选或由主线程完成。没有可选推理强度时省略该参数。最多同时启动 3 个子代理，并遵守原生并发上限。",
    "每个子代理只接收目标、负责范围、短 TODO、必要上下文和验收要求，不继承整段对话；明确告知不要覆盖其他代理修改、不要再次委派。遇到未定设计或反复失败携证据交回主线程。以实际启动模型和验证结果为准，不把候选推荐当成已经执行。",
    `经济型并行候选（economy 越高越经济，null 表示未知）：${JSON.stringify(candidates)}`,
  ].join("\n");
}
