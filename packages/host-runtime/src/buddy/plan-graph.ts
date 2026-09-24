import { buddyPlanSchema, type BuddyPlan, type BuddyPlanTask } from "@codexhost/shared-contracts";

export interface PlanWave {
  index: number;
  tasks: BuddyPlanTask[];
}

export interface ValidatedPlan {
  plan: BuddyPlan;
  waves: PlanWave[];
}

function overlappingWrites(a: BuddyPlanTask, b: BuddyPlanTask): boolean {
  if (a.writeScope === "none" || b.writeScope === "none") return false;
  if (a.writeScope === "shared-coordination" || b.writeScope === "shared-coordination") return true;
  if (a.files.length > 0 && b.files.length > 0) {
    return a.files.some((file) => b.files.includes(file));
  }
  return a.packages.some((pkg) => b.packages.includes(pkg));
}

export function validatePlan(value: unknown): ValidatedPlan {
  const plan = buddyPlanSchema.parse(value);
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  if (byId.size !== plan.tasks.length) throw new Error("规划包含重复的任务 ID。");
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn) {
      if (!byId.has(dependency))
        throw new Error(`任务 ${task.id} 依赖不存在的任务 ${dependency}。`);
      if (dependency === task.id) throw new Error(`任务 ${task.id} 不能依赖自身。`);
    }
  }

  const remaining = new Set(plan.tasks.map((task) => task.id));
  const completed = new Set<string>();
  const waves: PlanWave[] = [];
  while (remaining.size > 0) {
    const ready = plan.tasks.filter(
      (task) => remaining.has(task.id) && task.dependsOn.every((id) => completed.has(id)),
    );
    if (ready.length === 0) throw new Error("规划存在循环依赖，无法生成拓扑执行顺序。");
    const parallel = ready.filter((task) => task.parallelizable);
    const selected =
      plan.execution.delegateIndependentTasks && parallel.length > 1
        ? parallel.slice(0, plan.execution.maxParallel)
        : ready.slice(0, 1);
    for (let i = 0; i < selected.length; i += 1) {
      const current = selected[i];
      if (!current) continue;
      for (const other of selected.slice(i + 1)) {
        if (other && overlappingWrites(current, other)) {
          throw new Error(`并行任务 ${current.id} 与 ${other.id} 的写入范围重叠。`);
        }
      }
    }
    waves.push({ index: waves.length, tasks: selected });
    for (const task of selected) {
      remaining.delete(task.id);
      completed.add(task.id);
    }
  }
  return { plan, waves };
}

export function formatExecutionTopology(validated: ValidatedPlan): string {
  return validated.waves
    .map(
      (wave) =>
        `wave-${wave.index + 1}: ${wave.tasks.map((task) => `${task.id} (${task.executorRole})`).join(", ")}`,
    )
    .join("\n");
}
