import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { homePath } from "@codexhost/buddy-engine";
import { buddyCatalogSyncSchema, type BuddyCatalogSync } from "@codexhost/shared-contracts";

const execute = promisify(execFile);

// 使用现有同步器的锁、目录验证和原子写入，不在 Host 中重复生成 Codex 模型元数据。
export async function syncCodexCatalog(
  environment: NodeJS.ProcessEnv,
  run: typeof execute = execute,
): Promise<BuddyCatalogSync> {
  const home = homePath(environment.CODEX_HOME);
  const script = join(home, "model-sync", "runtime.mjs");
  try {
    await stat(script);
  } catch {
    throw new Error("模型同步器未安装；请先运行 codex-buddy setup。");
  }
  let output: string;
  try {
    const result = await run(process.execPath, [script, "sync", "--home", home, "--json"], {
      env: environment,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    output = result.stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    const detail = failure.stderr?.match(/^codex-buddy: ([^\r\n]+)/mu)?.[1];
    const safeDetail =
      detail &&
      /^(?:Model (?:endpoint|request|catalog)|Another model sync|Codex executable|Cannot parse Codex config)/u.test(
        detail,
      )
        ? detail
        : "命令失败或超时，请检查供应商连接并重试。";
    throw new Error(`供应商模型同步失败：${safeDetail}`);
  }
  let report: unknown;
  try {
    report = JSON.parse(output);
  } catch {
    throw new Error("模型同步器未返回有效结果。");
  }
  if (!report || typeof report !== "object" || (report as { ok?: unknown }).ok !== true) {
    throw new Error("模型同步器未确认成功。");
  }
  const result = report as { provider?: unknown; visibleCount?: unknown; catalogPath?: unknown };
  if (
    typeof result.catalogPath !== "string" ||
    result.catalogPath !== join(home, "model-sync", "catalog.json")
  ) {
    throw new Error("模型同步器写入了意外的目录。");
  }
  const catalog: unknown = JSON.parse(await readFile(result.catalogPath, "utf8"));
  const models =
    catalog && typeof catalog === "object" ? (catalog as { models?: unknown }).models : null;
  if (!Array.isArray(models)) throw new Error("同步后的模型目录无效。");
  const ids = models.map((model) =>
    model && typeof model === "object" ? (model as { slug?: unknown }).slug : undefined,
  );
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    throw new Error("同步后的模型 ID 无效。");
  }
  const parsed = buddyCatalogSyncSchema.parse({
    provider: result.provider,
    returned: result.visibleCount,
    ids,
  });
  if (parsed.returned !== parsed.ids.length)
    throw new Error("同步后的模型目录与供应商数量不一致。");
  return parsed;
}
