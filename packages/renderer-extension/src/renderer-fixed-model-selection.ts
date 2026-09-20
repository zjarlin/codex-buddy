import type { RendererModelClient } from "./renderer-model-client.js";
import { RendererMethodUnavailableError } from "./renderer-request-sender.js";

// 先确认 Host 已停止自动策略，再让原生菜单切换；配置失败时保留原模型。
export async function selectFixedModel(
  client: RendererModelClient | null,
  isCurrent: () => boolean,
  select: () => void,
): Promise<void> {
  if (!isCurrent()) throw new Error("The active conversation changed; select the Model again");
  if (client?.buddyStatus) {
    let snapshot;
    try {
      snapshot = await client.buddyStatus();
    } catch (error) {
      // 官方客户端没有 Host 路由方法，本来就直接使用原生模型选择。
      if (!(error instanceof RendererMethodUnavailableError)) throw error;
    }
    if (snapshot) {
      if (!isCurrent()) throw new Error("The active conversation changed; select the Model again");
      if (!client.buddyConfigure) throw new Error("Automatic routing could not be disabled");
      const updated = await client.buddyConfigure({
        ...snapshot.settings,
        enabled: false,
        privateMode: false,
      });
      if (updated.settings.enabled || updated.settings.privateMode)
        throw new Error("Automatic routing could not be disabled");
    }
  }
  if (!isCurrent()) throw new Error("The active conversation changed; select the Model again");
  select();
}
