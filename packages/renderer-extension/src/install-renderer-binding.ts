import { type RendererAgent } from "./agent-selection-state.js";
import { installDualLane, type DualLaneController } from "./dual-lane/controller.js";
import {
  installRendererBindingProbe,
  type RendererBindingProbeApi,
} from "./renderer-binding-probe.js";
import { installCurrentRendererAdapter } from "./versioned-renderer-adapter.js";

/** 双栏挂在文档级：探针只会安装一次，重复安装时先收起上一份。 */
let dualLane: DualLaneController | null = null;

export function installRendererBinding(
  enabledAgents?: readonly RendererAgent[],
): RendererBindingProbeApi {
  window.__codexhostRendererBindingProbeV1?.dispose();
  const binding = installRendererBindingProbe({ ...(enabledAgents ? { enabledAgents } : {}) });
  dualLane?.dispose();
  dualLane = null;
  try {
    dualLane = installDualLane({ ownerDocument: document, ownerWindow: window });
  } catch (error) {
    // 双栏是附加视图；安装失败不能连带阻断原生宿主路由与 Adapter。
    console.error(
      "codexhost dual lane installation failed",
      error instanceof Error ? error.name : "UnknownError",
    );
  }
  try {
    const adapter = installCurrentRendererAdapter();
    binding.setAdapter(
      adapter.status,
      adapter.dispose,
      adapter.applyAgent,
      adapter.modelControl,
      adapter.localHostClient,
    );
  } catch (error) {
    console.error(
      "codexhost Renderer Adapter installation failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    binding.setAdapter({
      state: "unsupported",
      reason: "installation-failed",
      modelUpdates: 0,
      hook: null,
    });
  }
  return binding;
}
