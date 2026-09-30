import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rename, link, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { turnActionInvocationSchema, type TurnActionInvocation } from "@codexhost/shared-contracts";
import { actionDigest } from "./turn-action-registry.js";

interface StoredInvocation {
  invocation: TurnActionInvocation;
  inputDigest: string;
}
export class TurnActionStore {
  readonly #root: string;
  #writing: Promise<void> = Promise.resolve();
  constructor(environment: NodeJS.ProcessEnv) {
    this.#root = path.join(
      environment.CODEXHOST_DATA_DIR ?? path.join(os.homedir(), ".codexhost"),
      "turn-actions",
    );
  }
  #directory(threadId: string): string {
    return path.join(this.#root, actionDigest(threadId));
  }
  #file(threadId: string, invocationId: string): string {
    return path.join(this.#directory(threadId), `${actionDigest(invocationId)}.json`);
  }
  async read(threadId: string, invocationId: string): Promise<StoredInvocation | null> {
    try {
      const value = JSON.parse(
        await readFile(this.#file(threadId, invocationId), "utf8"),
      ) as StoredInvocation;
      const invocation = turnActionInvocationSchema.parse(value.invocation);
      if (
        invocation.threadId !== threadId ||
        invocation.invocationId !== invocationId ||
        typeof value.inputDigest !== "string"
      ) {
        throw new Error("动作执行记录归属不一致");
      }
      return { invocation, inputDigest: value.inputDigest };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async claim(value: StoredInvocation): Promise<boolean> {
    const { threadId, invocationId } = value.invocation;
    await mkdir(this.#directory(threadId), { recursive: true, mode: 0o700 });
    const file = this.#file(threadId, invocationId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    try {
      // 原子发布完整记录，重试不会读取到半写入 JSON。
      await link(temporary, file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    } finally {
      await unlink(temporary);
    }
  }
  save(value: StoredInvocation): Promise<StoredInvocation> {
    const work = this.#writing.then(async () => {
      const previous = await this.read(value.invocation.threadId, value.invocation.invocationId);
      if (previous && ["completed", "failed", "interrupted"].includes(previous.invocation.state))
        return previous;
      const file = this.#file(value.invocation.threadId, value.invocation.invocationId);
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, file);
      return value;
    });
    this.#writing = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }
  async list(threadId: string): Promise<StoredInvocation[]> {
    let names: string[];
    try {
      names = await readdir(this.#directory(threadId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const values = await Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
        .map(async (name) => {
          const value = JSON.parse(
            await readFile(path.join(this.#directory(threadId), name), "utf8"),
          ) as StoredInvocation;
          value.invocation = turnActionInvocationSchema.parse(value.invocation);
          if (value.invocation.threadId !== threadId) throw new Error("动作执行记录归属不一致");
          return value;
        }),
    );
    return values.sort((a, b) => b.invocation.updatedAt - a.invocation.updatedAt);
  }
}
