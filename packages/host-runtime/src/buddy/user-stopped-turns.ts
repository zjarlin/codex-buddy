import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** 只保留最近的手动停止记录；更早的回合不会再被中断队列看到。 */
const MAX_REMEMBERED = 512;

function dataDirectory(environment: NodeJS.ProcessEnv): string {
  const configured = environment.CODEXHOST_DATA_DIR;
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".codexhost");
}

const FILE_NAME = "buddy-user-stopped-turns.json";

function stoppedTurnsFile(environment: NodeJS.ProcessEnv): string {
  return path.join(dataDirectory(environment), FILE_NAME);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface StoppedTurn {
  threadId: string;
  turnId: string;
}

function readTurns(value: unknown, field: string): StoppedTurn[] {
  const entries = record(value)?.[field];
  if (!Array.isArray(entries)) return [];
  const turns: StoppedTurn[] = [];
  for (const entry of entries) {
    const stop = record(entry);
    const threadId = typeof stop?.threadId === "string" ? stop.threadId : "";
    const turnId = typeof stop?.turnId === "string" ? stop.turnId : "";
    if (threadId && turnId) turns.push({ threadId, turnId });
  }
  return turns.slice(-MAX_REMEMBERED);
}

/**
 * 用户手动停止的官方回合。
 *
 * 原生终态只有 `interrupted`，与进程崩溃、客户端退出留下的半途回合完全同形；
 * 协议里没有“用户停止”的状态，rollout 的 `turn_aborted` 也不能作证——app-server
 * 正常关闭时同样会写这个事件。只有 Host 见过对应的 `turn/interrupt` 请求才知道
 * 这是用户的决定，所以在这里按 (Thread, Turn) 记录。
 *
 * 收到停止请求就立即生效：用户按下停止之后，无论终态是 interrupted、failed 还是
 * completed，这个回合都不该被自动续接。停止本身就是用户作出的终态决定，不需要
 * 等终态再来确认，也不因为终态另有结局就撤销——那正是“停止后又被续跑”的来源。
 *
 * 记录保存在本机数据目录，Host 在终态到达前后重启都不会忘记这次停止。
 */
export class UserStoppedTurns {
  readonly #file: string;
  readonly #stopped = new Map<string, true>();
  /** 旧版本按“待定”写入的停止请求；只用于升级已落盘的历史记录。 */
  readonly #pending = new Map<string, true>();
  /**
   * 读取历史期间先到达的终态。此时还不知道文件里有没有对应的待定停止，
   * 只能等读取完成后再判定；否则会把崩溃留下的中断误当成用户的停止。
   */
  readonly #earlyTerminals = new Map<string, string>();
  /** 读取历史期间已经开始的回合；旧文件里的其它待定停止对这条会话已经失效。 */
  readonly #earlyStarts = new Map<string, string>();
  #loaded: Promise<void> | null = null;
  #settled = false;
  /** 写入串行化：并发的停止请求不能互相覆盖临时文件。 */
  #writing: Promise<void> = Promise.resolve();

  constructor(
    environment: NodeJS.ProcessEnv = process.env,
    private readonly limit = MAX_REMEMBERED,
  ) {
    this.#file = stoppedTurnsFile(environment);
    // 尽早读完历史，缩短“终态通知先到、历史还没读”的窗口；失败只意味着没有历史。
    void this.#load();
  }

  #key(threadId: string, turnId: string): string {
    return `${threadId}\u0000${turnId}`;
  }

  #load(): Promise<void> {
    this.#loaded ??= (async () => {
      try {
        const saved: unknown = JSON.parse(await readFile(this.#file, "utf8"));
        for (const turn of readTurns(saved, "stoppedTurns"))
          this.#stopped.set(this.#key(turn.threadId, turn.turnId), true);
        for (const turn of readTurns(saved, "pendingTurns")) {
          const started = this.#earlyStarts.get(turn.threadId);
          if (started !== undefined && started !== turn.turnId) continue;
          this.#pending.set(this.#key(turn.threadId, turn.turnId), true);
        }
      } catch {
        // 文件不存在或不可读都只意味着没有历史记录，不能阻断当前停止。
      }
      for (const [key, status] of this.#earlyTerminals) {
        if (!this.#pending.delete(key)) continue;
        if (status === "interrupted") this.#stopped.set(key, true);
      }
      this.#earlyTerminals.clear();
      this.#earlyStarts.clear();
      this.#settled = true;
      this.#trim();
    })();
    return this.#loaded;
  }

  /**
   * 用户在桌面或手机上请求停止该回合。
   *
   * 收到请求立即生效：用户按下停止之后，这个回合不论以 interrupted、failed 还是
   * completed 收尾，都不该再被自动续接——续跑用户刚停下的工作是最糟糕的结果。
   * 因此这里只作“用户已停止”的终态记录，不再等待终态来升级或撤销。
   */
  requested(threadId: string, turnId: string): void {
    const key = this.#key(threadId, turnId);
    this.#stopped.delete(key);
    this.#stopped.set(key, true);
    this.#pending.delete(key);
    this.#trim();
    this.#schedulePersist();
  }

  /**
   * 新回合开始：更早的停止请求不再适用。同一回合的 `turn/started` 可能晚于用户的
   * 停止点击到达，不能顺手清掉刚刚记下的请求。
   */
  started(threadId: string, turnId: string): void {
    const current = this.#key(threadId, turnId);
    if (!this.#settled) this.#earlyStarts.set(threadId, turnId);
    let changed = false;
    for (const key of [...this.#pending.keys()]) {
      if (key === current || !key.startsWith(`${threadId}\u0000`)) continue;
      this.#pending.delete(key);
      changed = true;
    }
    if (!changed) return;
    this.#schedulePersist();
  }

  /**
   * 回合终态到达。停止请求在收到时就已经是终态结论，这里只结算两件事：
   * 历史还没读完时的早期终态，以及旧版本写入的 `pendingTurns` 待定记录——
   * 那些记录要等到 interrupted 终态才能确认为用户的停止。
   */
  completed(threadId: string, turnId: string, status: string): void {
    const key = this.#key(threadId, turnId);
    // 历史还没读完时无法判断这个回合是否被请求过停止；等读取完成再判定。
    if (!this.#settled) {
      this.#earlyTerminals.set(key, status);
      this.#schedulePersist();
      return;
    }
    if (!this.#pending.delete(key)) return;
    if (status === "interrupted") {
      this.#stopped.delete(key);
      this.#stopped.set(key, true);
      this.#trim();
    }
    this.#schedulePersist();
  }

  #trim(): void {
    for (const turns of [this.#stopped, this.#pending]) {
      while (turns.size > this.limit) {
        const oldest = turns.keys().next().value;
        if (oldest === undefined) break;
        turns.delete(oldest);
      }
    }
  }

  #schedulePersist(): void {
    this.#writing = this.#writing.then(() => this.#persist()).catch(() => undefined);
  }

  async #persist(): Promise<void> {
    const entries = (turns: Map<string, true>) =>
      [...turns.keys()].map((value) => {
        const separator = value.indexOf("\u0000");
        return { threadId: value.slice(0, separator), turnId: value.slice(separator + 1) };
      });
    // 先等历史读完：早期终态在读取末尾结算，落盘的才是最终结论。
    await this.#load();
    const temporary = `${this.#file}.${process.pid}.tmp`;
    try {
      await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
      await writeFile(
        temporary,
        `${JSON.stringify({
          stoppedTurns: entries(this.#stopped),
          pendingTurns: entries(this.#pending),
        })}\n`,
        { mode: 0o600 },
      );
      await rename(temporary, this.#file);
    } catch {
      // 写盘失败只影响重启后的记忆，不改变当前进程的结论。
    }
  }

  /** 中断扫描在每个并发分支里查询，先保证历史记录已加载。 */
  async stopped(threadId: string, turnId: string): Promise<boolean> {
    await this.#load();
    const key = this.#key(threadId, turnId);
    return this.#stopped.has(key) || this.#pending.has(key);
  }
}

const shared = new Map<string, UserStoppedTurns>();

/**
 * 同一个数据目录只保留一份记录。手机控制、控制台与桌面会各自创建 AppServerHost，
 * 但共用本机数据目录：用户在手机里停止的回合，桌面的中断扫描也必须认出来。
 */
export function sharedUserStoppedTurns(
  environment: NodeJS.ProcessEnv = process.env,
): UserStoppedTurns {
  const file = stoppedTurnsFile(environment);
  let turns = shared.get(file);
  if (!turns) {
    turns = new UserStoppedTurns(environment);
    shared.set(file, turns);
  }
  return turns;
}
