import { readSshTurnActionsOnHost } from "./ssh-turn-actions-worker.js";
import {
  sshTurnActionsParamsSchema,
  type AutoModelRoutesResult,
} from "@codexhost/shared-contracts";
import { readAutoModelRoutes } from "./auto-model-routes.js";
import { sshObservationContext } from "./ssh-observation-context.js";

export async function readSshAutoModelRoutesOnHost(
  params: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<AutoModelRoutesResult> {
  return readAutoModelRoutes(await sshObservationContext(params, environment));
}

// 独立 Worker 从标准输入接收构建产物，仅向标准输出写已清理的观察数据。
if (process.argv[1] === "-") {
  try {
    const params = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));
    const result =
      params && typeof params === "object" && "operation" in params
        ? await readSshTurnActionsOnHost(sshTurnActionsParamsSchema.parse(params))
        : await readSshAutoModelRoutesOnHost(params);
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stderr.write("Unable to read Auto route observations on SSH Host\n");
    process.exitCode = 1;
  }
}
