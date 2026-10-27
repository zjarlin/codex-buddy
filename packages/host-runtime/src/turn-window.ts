import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const MAX_SCAN_BYTES = 256 * 1024 * 1024;
const MAX_SCAN_MS = 5_000;

export interface TurnWindow {
  since?: number;
  until?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// 只接受 CODEX_HOME 下 sessions/archived_sessions 里的 rollout，避免读取任意路径。
async function ownedRollout(codexHome: string, threadPath: string, threadId: string) {
  const rollout = await realpath(threadPath);
  let allowed = false;
  for (const directory of ["sessions", "archived_sessions"]) {
    const root = await realpath(path.join(codexHome, directory)).catch(() => null);
    if (root === null) continue;
    const relative = path.relative(root, rollout);
    if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) throw new Error("Turn window rollout ownership is unavailable");
  if (!path.basename(rollout).endsWith(`-${threadId}.jsonl`)) {
    throw new Error("Turn window rollout ownership is unavailable");
  }
  return rollout;
}

const marker = /"type"\s*:\s*"task_(started|complete)"/;
const turnIdPattern = /"turn_id"\s*:\s*"([^"]{1,128})"/;

/** 从 rollout 里取出该回合的起止时间，供网关按时间窗回查调度账号。 */
export async function readTurnWindow(input: {
  codexHome: string;
  threadPath: string;
  threadId: string;
  runId: string;
}): Promise<TurnWindow> {
  const rollout = await ownedRollout(input.codexHome, input.threadPath, input.threadId);
  const starts = new Map<string, number>();
  const completes = new Map<string, number>();
  const order: string[] = [];
  const deadline = Date.now() + MAX_SCAN_MS;
  let scanned = 0;
  const reader = createInterface({
    input: createReadStream(rollout, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of reader) {
      scanned += line.length;
      if (scanned > MAX_SCAN_BYTES || Date.now() > deadline) break;
      if (!marker.test(line)) continue;
      const turnId = turnIdPattern.exec(line)?.[1];
      if (!turnId) continue;
      let event: Record<string, unknown> | null = null;
      try {
        const parsed = record(JSON.parse(line));
        event = record(parsed?.payload);
      } catch {
        continue;
      }
      if (!event) continue;
      if (event.type === "task_started") {
        const startedAt = event.started_at;
        if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) continue;
        if (!starts.has(turnId)) order.push(turnId);
        starts.set(turnId, Math.floor(startedAt));
      } else if (event.type === "task_complete") {
        const completedAt = event.completed_at;
        if (typeof completedAt === "number" && Number.isFinite(completedAt)) {
          completes.set(turnId, Math.ceil(completedAt));
        }
      }
    }
  } finally {
    reader.close();
  }
  const since = starts.get(input.runId);
  if (since === undefined) return {};
  const position = order.indexOf(input.runId);
  const next = position >= 0 ? order[position + 1] : undefined;
  const completed = completes.get(input.runId);
  const until =
    completed ??
    (next !== undefined ? Math.max(since, (starts.get(next) ?? since) - 1) : undefined);
  return { since, ...(until !== undefined ? { until } : {}) };
}
