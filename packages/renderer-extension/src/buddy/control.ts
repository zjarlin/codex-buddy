import type { BuddyDecision, BuddySettings, BuddySnapshot } from "@codexhost/shared-contracts";
import type { BuddyInterrupted } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";
import { plannerInputControl } from "./planner-input.js";

const messages = {
  "zh-CN": {
    waiting: "夯规划 → 垃执行",
    disabled: "固定模型 · 不规划",
    disconnected: "未连接路由",
    enabled: "Auto Router",
    planningMode: "自动规划",
    privateMode: "隐私",
    privateActive: "隐私 · 自动选择离线模型",
    bypass: "旁路优先",
    modeGroup: "运行模式",
    privateGroup: "隐私模式",
    routerGroup: "Auto Router",
    planningGroup: "自动规划",
    routeGroup: "路由策略",
    modelGroup: "规划与执行模型",
    routingTab: "路由",
    interruptedTab: "中断会话",
    taskTab: "任务详情",
    enabledHint: "接管普通请求；关闭后使用当前选定模型直接执行",
    privateHint: "只使用离线 q3 模型，优先于普通路由",
    privateOwnerHint: "开启后接管普通 Auto Router，下面的路由策略不可配置。",
    routerOwnerHint: "System One、旁路和自动规划都隶属于 Auto Router。",
    planningOwnerHint: "复杂任务先由夯模型只读规划；常规任务直接执行。",
    planningDisabledHint: "Auto Router 已关闭，使用当前选定模型直接执行。",
    privateDisabledHint: "隐私模式已接管普通 Auto Router。",
    bypassHint: "推送请求直达垃模型；精确只读命令可零模型执行",
    jevHint: "用 JEV System One 判断路由、难度、推送意图和执行角色",
    jevKey: "JEV API Key",
    jevKeyHint: "保存在本机 Host，仅用于 JEV 判断；不会回传到界面",
    jevKeyPlaceholder: "粘贴 TYPESAFE_API_KEY",
    jevBaseUrl: "JEV 网关地址",
    jevBaseUrlHint: "可填自建 Sub2API 网关；留空使用官方地址，网关需转发 /v1/systemone",
    jevBaseUrlPlaceholder: "https://api.typesafe.ai 或自建网关",
    jevBaseUrlDefault: "官方默认",
    systemOneModel: "System One 模型",
    systemOneModelHint: "网关按模型选择平台：typesafe/jev 走 JEV，laya 走本地 Laya",
    systemOneModelJev: "JEV",
    systemOneModelLaya: "Laya",
    jevKeyConfigured: "已配置",
    jevKeyMissing: "未配置",
    jevKeySave: "保存密钥",
    jevKeyClear: "清除",
    jevKeySaved: "已保存",
    jevKeyCleared: "已清除",
    modelBypass: "旁路 · 垃",
    skipPlanner: "跳过夯规划",
    bypassScore: "旁路成功率",
    bypassScoreHint:
      "当前 Host 运行期间该模型原生旁路回合的完成率；取消不计入，重启清零。回合完成不等于 Git 推送业务成功。",
    noSamples: "待统计",
    skills: "附带技能",
    skillWarning: "技能提示",
    noSkills: "未发现可用技能",
    roleHint: "自动时按任务类型选择 Git、IO 或编码角色",
    plannerHint: "复杂任务只读规划",
    workerHint: "指定后由单个模型执行，不使用子代理或自动换模",
    auto: "自动选择角色",
    git: "Git 智能体",
    io: "IO 操作智能体",
    executor: "编码执行者",
    planner: "夯 · 规划模型",
    worker: "垃 · 执行模型",
    choose: "动态选择",
    cancel: "取消规划",
    cancelRecovery: "取消自动续接",
    retrying: "等待自动续接",
    interruptedGroup: "最近中断会话",
    interruptedHint: "点击会话可手动恢复最近中断的请求。",
    interruptedEmpty: "暂无最近中断会话。",
    interruptedLoading: "正在读取最近中断会话…",
    resume: "恢复",
    resuming: "正在恢复…",
    resumeFailed: "恢复失败",
    roleLabel: "执行角色",
    reason: "路由依据",
    jev: "JEV 判断",
    score: "规则难度分",
    simple: "简单",
    standard: "常规",
    advanced: "复杂",
    steps: "执行步骤",
    checks: "验收条件",
    accepted: "服务端已接受",
    involvedModels: "本次任务模型",
    plan: "执行任务包",
    command: "旁路命令",
    exit: "退出码",
    note: "GPT / Claude 归夯，其余归垃。隐私模式自动选择可用的离线 q3 模型，不走夯规划。",
    idle: "下一轮自动选择；隐私模式仅使用离线 q3 模型。",
    unknown: "未确认",
    noModel: "无模型 · 零推理请求",
    discovering: "读取实时候选",
    planning: "夯正在规划",
    "waiting-input": "等待你的确认",
    executing: "垃正在执行",
    bypassPhase: "命令旁路",
    completed: "已结束",
    failed: "失败",
    interrupted: "已中断",
    cancelled: "已取消",
  },
  en: {
    waiting: "夯 plans → 垃 executes",
    disabled: "Fixed model · No planning",
    disconnected: "Router disconnected",
    enabled: "Auto Router",
    planningMode: "Automatic planning",
    privateMode: "Private",
    privateActive: "Private · Automatic offline model",
    bypass: "Prefer bypass",
    modeGroup: "Mode",
    privateGroup: "Private mode",
    routerGroup: "Auto Router",
    planningGroup: "Automatic planning",
    routeGroup: "Routing",
    modelGroup: "Planning and execution models",
    routingTab: "Routing",
    interruptedTab: "Interrupted",
    taskTab: "Task details",
    enabledHint: "Take over ordinary requests; off uses the selected model directly",
    privateHint: "Use offline q3 models and take priority over normal routing",
    privateOwnerHint: "Takes over normal Auto Router; routing controls below cannot be configured.",
    routerOwnerHint: "System One, bypass, and automatic planning all belong to Auto Router.",
    planningOwnerHint:
      "Use the 夯 model for read-only planning on complex tasks; execute ordinary tasks directly.",
    planningDisabledHint: "Auto Router is off; use the selected model directly.",
    privateDisabledHint: "Private mode has taken over normal Auto Router.",
    bypassHint: "Route push requests to 垃; exact read-only commands can run without a model",
    jevHint: "Use JEV System One to judge route, difficulty, push intent, and execution role",
    jevKey: "JEV API key",
    jevKeyHint: "Stored on this Host for JEV only; never returned to the UI",
    jevKeyPlaceholder: "Paste TYPESAFE_API_KEY",
    jevBaseUrl: "JEV gateway URL",
    jevBaseUrlHint:
      "Point at a self-hosted Sub2API gateway; blank uses the official URL. The gateway must forward /v1/systemone",
    jevBaseUrlPlaceholder: "https://api.typesafe.ai or your gateway",
    jevBaseUrlDefault: "Official default",
    systemOneModel: "System One model",
    systemOneModelHint:
      "The gateway selects the platform by model: typesafe/jev for JEV, laya for local Laya",
    systemOneModelJev: "JEV",
    systemOneModelLaya: "Laya",
    jevKeyConfigured: "Configured",
    jevKeyMissing: "Not configured",
    jevKeySave: "Save key",
    jevKeyClear: "Clear",
    jevKeySaved: "Saved",
    jevKeyCleared: "Cleared",
    modelBypass: "Bypass · 垃",
    skipPlanner: "Skip 夯 planning",
    bypassScore: "Bypass success rate",
    bypassScoreHint:
      "Native bypass turn completion rate for this model during this Host run; cancellations excluded, reset on restart. Turn completion does not prove a Git push succeeded.",
    noSamples: "No samples yet",
    skills: "Attached skills",
    skillWarning: "Skill notice",
    noSkills: "No available skills found",
    roleHint: "Automatically pick Git, IO, or code execution by task type",
    plannerHint: "Read-only planning for complex tasks",
    workerHint: "A fixed executor works alone, without subagents or automatic model switching",
    auto: "Automatic role",
    git: "Git agent",
    io: "IO agent",
    executor: "Code executor",
    planner: "夯 · Planner",
    worker: "垃 · Executor",
    choose: "Dynamic selection",
    cancel: "Cancel planning",
    cancelRecovery: "Cancel recovery",
    retrying: "Waiting to continue",
    interruptedGroup: "Recent interrupted conversations",
    interruptedHint: "Click a conversation to resume its interrupted request.",
    interruptedEmpty: "No recently interrupted conversations.",
    interruptedLoading: "Loading recently interrupted conversations…",
    resume: "Resume",
    resuming: "Resuming…",
    resumeFailed: "Resume failed",
    roleLabel: "Execution role",
    reason: "Routing reason",
    jev: "JEV judgment",
    score: "Rule difficulty score",
    simple: "Simple",
    standard: "Standard",
    advanced: "Complex",
    steps: "Steps",
    checks: "Checks",
    accepted: "Accepted by server",
    involvedModels: "Models for this task",
    plan: "Task packet",
    command: "Bypass command",
    exit: "Exit code",
    note: "GPT / Claude = 夯; other models = 垃. Private mode automatically selects an available offline q3 model without 夯 planning.",
    idle: "The next turn is routed automatically; private mode only uses offline q3 models.",
    unknown: "Unconfirmed",
    noModel: "No model · Zero inference requests",
    discovering: "Discovering models",
    planning: "夯 planning",
    "waiting-input": "Waiting for your input",
    executing: "垃 executing",
    bypassPhase: "Command bypass",
    completed: "Finished",
    failed: "Failed",
    interrupted: "Interrupted",
    cancelled: "Cancelled",
  },
};

const style = `
[data-buddy-router]{position:relative;font:12px/1.5 system-ui;color:inherit;margin:6px 0;max-width:100%;z-index:20}
[data-buddy-router] summary{cursor:pointer;display:flex;align-items:baseline;gap:8px;padding:4px 8px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:9px;list-style:none;background:color-mix(in srgb,#4385ff 8%,transparent)}
[data-buddy-router] summary:focus-visible,[data-buddy-router] button:focus-visible,[data-buddy-router] select:focus-visible,[data-buddy-router] .buddy-switch:focus-visible{outline:2px solid #4385ff;outline-offset:2px}
[data-buddy-router] summary b{color:#508df2;white-space:nowrap}[data-buddy-router] summary span{min-width:0;overflow-wrap:anywhere;white-space:normal}
[data-buddy-router][data-model-bypass] summary{border:2px solid #508df2;background:color-mix(in srgb,#4385ff 16%,transparent)}
[data-buddy-router][data-model-bypass] summary b{background:#245ec4;color:#fff;border-radius:5px;padding:2px 6px}
[data-buddy-router] .buddy-panel{padding:8px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:9px;margin-top:5px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:inherit;max-height:300px;overflow:auto;color-scheme:inherit}
[data-buddy-router] .buddy-tabs{display:flex;gap:4px;margin:0 0 8px;padding:2px;border-radius:8px;background:color-mix(in srgb,currentColor 6%,transparent)}
[data-buddy-router] .buddy-tab{flex:1;min-width:0;padding:4px 7px;border:0;border-radius:6px;font-size:11px;color:inherit;opacity:.7}
[data-buddy-router] .buddy-tab[aria-selected=true]{background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));opacity:1;box-shadow:0 1px 3px rgb(0 0 0 / 14%)}
[data-buddy-router] .buddy-tab-panel[hidden]{display:none}
[data-buddy-router] .buddy-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin-bottom:6px}
[data-buddy-router] .buddy-section{display:contents}
[data-buddy-router] .buddy-section-title{display:none}
[data-buddy-router] .buddy-setting{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;min-height:28px}
[data-buddy-router] .buddy-setting[data-disabled=true]{opacity:.48}
[data-buddy-router] .buddy-setting-copy{min-width:0;flex-shrink:0}
[data-buddy-router] .buddy-setting-copy b{font-weight:500;font-size:11px;line-height:16px}
[data-buddy-router] .buddy-setting-copy small{display:none}
[data-buddy-router] .buddy-switch{appearance:none;position:relative;flex:0 0 auto;width:34px;height:20px;margin:0;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:999px;background:color-mix(in srgb,currentColor 12%,transparent);cursor:pointer;transition:background-color .16s,border-color .16s}
[data-buddy-router] .buddy-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / 28%);transition:transform .16s}
[data-buddy-router] .buddy-switch:checked{border-color:#508df2;background:#508df2}
[data-buddy-router] .buddy-switch:checked::after{transform:translateX(14px)}
[data-buddy-router] .buddy-select{width:100%;max-width:190px;min-width:0;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:7px;padding:3px 5px;font-size:11px;height:26px;background:color-mix(in srgb,currentColor 4%,transparent);color:inherit}
[data-buddy-router] .buddy-select:disabled,[data-buddy-router] .buddy-switch:disabled,[data-buddy-router] .buddy-key input:disabled,[data-buddy-router] .buddy-key button:disabled{cursor:default}
[data-buddy-router] .buddy-section>button{justify-self:start;margin-top:2px}
[data-buddy-router] .buddy-actions:not(:empty){display:flex;gap:6px;margin:0}
[data-buddy-router] .buddy-key{display:flex;flex-direction:column;gap:6px;grid-column:1/-1;margin:6px 0}
[data-buddy-router] .buddy-key input{width:100%;min-width:0;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:7px;padding:4px 6px;font-size:11px;height:28px;background:color-mix(in srgb,currentColor 4%,transparent);color:inherit}
[data-buddy-router] .buddy-key-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
[data-buddy-router] .buddy-key-state{font-size:11px;opacity:.75}
[data-buddy-router] .buddy-key-state[data-configured=true]{color:#3fa96a;opacity:1}
[data-buddy-router] .buddy-interrupted{grid-column:1/-1;display:flex;flex-direction:column;gap:5px;margin:5px 0}
[data-buddy-router] .buddy-interrupted-heading{font-size:11px;font-weight:500}
[data-buddy-router] .buddy-interrupted-note{font-size:11px;opacity:.65}
[data-buddy-router] .buddy-interrupted-list{display:flex;flex-direction:column;gap:4px;min-width:0}
[data-buddy-router] .buddy-interrupted-item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-width:0;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:7px;padding:6px 7px}
[data-buddy-router] .buddy-interrupted-copy{min-width:0}
[data-buddy-router] .buddy-interrupted-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
[data-buddy-router] .buddy-interrupted-status{display:block;margin-top:2px;font-size:10px;opacity:.65}
[data-buddy-router] .buddy-interrupted-item button{padding:3px 8px;font-size:10px}
[data-buddy-router] .buddy-interrupted-error{color:#d65f55}
[data-buddy-router] .buddy-footer{display:flex;align-items:center;justify-content:flex-end;gap:6px}
[data-buddy-router] :is(dl,p):empty{display:none}
[data-buddy-router] button{display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;font:inherit;background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:999px;padding:4px 10px}
[data-buddy-router] option{background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:inherit}[data-buddy-router] button{cursor:pointer}
[data-buddy-router] dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 8px;margin:6px 0}
[data-buddy-router] dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}[data-buddy-router] dt{opacity:.65}
[data-buddy-router] .buddy-note{opacity:.65;margin:6px 0 0}[data-buddy-router] [role=alert]{color:#d65f55;white-space:pre-wrap}
[data-buddy-router][data-planner-input] .buddy-panel{max-height:min(65vh,620px)}
[data-buddy-router] .buddy-planner-input{border:1px solid #6598ef;border-radius:10px;padding:12px;margin-bottom:12px;background:color-mix(in srgb,#6598ef 7%,transparent);overflow-wrap:anywhere}
[data-buddy-router] .buddy-planner-input p{margin:5px 0 10px}
[data-buddy-router] .buddy-planner-input fieldset{min-width:0;border:0;padding:0;margin:12px 0}
[data-buddy-router] .buddy-planner-input legend{font-weight:600;padding:0}
[data-buddy-router] .buddy-planner-input label{display:flex;gap:8px;padding:7px 0;align-items:flex-start;cursor:pointer}
[data-buddy-router] .buddy-planner-input small{display:block;opacity:.7}
[data-buddy-router] .buddy-planner-input textarea,[data-buddy-router] .buddy-planner-input input[type=password]{box-sizing:border-box;width:100%;min-height:60px;resize:vertical;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 28%,transparent);border-radius:6px;padding:8px;font:inherit}
[data-buddy-router] .buddy-planner-input button:disabled{opacity:.55;cursor:wait}
@media(max-width:420px){[data-buddy-router] .buddy-setting{flex-direction:column;align-items:stretch;gap:3px}[data-buddy-router] .buddy-select{max-width:none}[data-buddy-router] .buddy-switch{align-self:flex-start}[data-buddy-router] dl{grid-template-columns:minmax(0,1fr);gap:2px}[data-buddy-router] dd{margin-bottom:8px}}
`;

export interface BuddyControlContext {
  anchor: Element;
  threadId: string | null;
  client: RendererModelClient;
}

export function installBuddyControl(
  getContext: () => BuddyControlContext | null,
  getLocale: () => "zh-CN" | "en",
): { dispose(): void; refresh(): Promise<void>; refreshContext(): void } {
  const root = document.createElement("details");
  root.dataset.buddyRouter = "";
  const styles = document.createElement("style");
  styles.textContent = style;
  const summary = document.createElement("summary");
  const title = document.createElement("b");
  title.textContent = "Auto Router";
  const status = document.createElement("span");
  status.setAttribute("aria-live", "polite");
  summary.append(title, status);
  const panel = document.createElement("div");
  panel.className = "buddy-panel";
  const tabs = document.createElement("div");
  tabs.className = "buddy-tabs";
  tabs.setAttribute("role", "tablist");
  const routingPanel = document.createElement("div");
  routingPanel.className = "buddy-tab-panel";
  routingPanel.dataset.buddyTabPanel = "routing";
  const interruptedPanel = document.createElement("div");
  interruptedPanel.className = "buddy-tab-panel";
  interruptedPanel.dataset.buddyTabPanel = "interrupted";
  const taskPanel = document.createElement("div");
  taskPanel.className = "buddy-tab-panel";
  taskPanel.dataset.buddyTabPanel = "task";
  const taskEmpty = document.createElement("p");
  taskEmpty.className = "buddy-note";
  const controls = document.createElement("div");
  controls.className = "buddy-settings";
  const routingFields = document.createElement("dl");
  const actions = document.createElement("div");
  actions.className = "buddy-actions";
  const fields = document.createElement("dl");
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  const note = document.createElement("p");
  note.className = "buddy-note";
  const footer = document.createElement("div");
  footer.className = "buddy-footer";
  footer.append(actions);
  const inputArea = document.createElement("div");
  let inputKey = "";
  let inputClient: RendererModelClient | null = null;
  routingPanel.append(controls, routingFields);
  taskPanel.append(inputArea, taskEmpty, fields, error, note, footer);
  panel.append(tabs, routingPanel, interruptedPanel, taskPanel);
  root.append(styles, summary, panel);
  let disposed = false;
  let busy = false;
  let snapshot: BuddySnapshot | null = null;
  let interrupted: BuddyInterrupted["threads"] = [];
  let interruptedClient: RendererModelClient | null = null;
  let interruptedLoading = false;
  let interruptedError = "";
  let interruptedUpdatedAt = 0;
  const resumePending = new Set<string>();
  let context: BuddyControlContext | null = null;
  let fingerprint = "";
  let activeTab: "routing" | "interrupted" | "task" = "routing";
  const t = () => messages[getLocale()];
  const report = (failure: unknown): void => {
    error.textContent = failure instanceof Error ? failure.message : String(failure);
  };
  const setting = async (patch: Partial<BuddySettings>): Promise<void> => {
    const client = context?.client;
    if (!snapshot || !client?.buddyConfigure) {
      return;
    }
    try {
      snapshot = await client.buddyConfigure({ ...snapshot.settings, ...patch });
      render();
    } catch (failure) {
      report(failure);
    }
  };
  const interruptedKey = (thread: BuddyInterrupted["threads"][number]): string =>
    JSON.stringify([thread.threadId, thread.turnId]);
  const refreshInterrupted = async (client: RendererModelClient, force = false): Promise<void> => {
    if (
      !client.buddyInterrupted ||
      (interruptedClient === client && !force && Date.now() - interruptedUpdatedAt < 15_000)
    ) {
      return;
    }
    interruptedClient = client;
    interruptedLoading = true;
    interruptedError = "";
    try {
      const result = await client.buddyInterrupted();
      if (disposed || context?.client !== client) return;
      interrupted = result.threads;
      interruptedUpdatedAt = Date.now();
    } catch (failure) {
      if (disposed || context?.client !== client) return;
      interrupted = [];
      interruptedError = failure instanceof Error ? failure.message : String(failure);
    } finally {
      if (context?.client === client) {
        interruptedLoading = false;
        render();
      }
    }
  };
  const resumeInterrupted = async (
    client: RendererModelClient,
    thread: BuddyInterrupted["threads"][number],
  ): Promise<void> => {
    const key = interruptedKey(thread);
    if (!client.buddyContinue || resumePending.has(key)) return;
    resumePending.add(key);
    interruptedError = "";
    render();
    try {
      await client.buddyContinue(thread.threadId, thread.turnId);
      if (disposed || context?.client !== client) return;
      interrupted = interrupted.filter((candidate) => interruptedKey(candidate) !== key);
      snapshot = (await client.buddyStatus?.()) ?? snapshot;
      render();
    } catch (failure) {
      if (disposed || context?.client !== client) return;
      interruptedError = `${t().resumeFailed}: ${failure instanceof Error ? failure.message : String(failure)}`;
    } finally {
      resumePending.delete(key);
      if (context?.client === client) render();
    }
  };
  const row = (label: string, value: string, parent: HTMLElement = fields): void => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    parent.append(dt, dd);
  };
  const section = (title: string): HTMLElement => {
    const section = document.createElement("section");
    section.className = "buddy-section";
    const heading = document.createElement("div");
    heading.className = "buddy-section-title";
    heading.textContent = title;
    section.append(heading);
    controls.append(section);
    return section;
  };
  const renderTabs = (): void => {
    const m = t();
    const tabsConfig = [
      ["routing", m.routingTab],
      ["interrupted", m.interruptedTab],
      ["task", m.taskTab],
    ] as const;
    if (tabs.childElementCount !== tabsConfig.length) {
      tabs.replaceChildren();
      for (const [id, label] of tabsConfig) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "buddy-tab";
        tab.dataset.buddyTab = id;
        tab.setAttribute("role", "tab");
        tab.textContent = label;
        tab.addEventListener("click", () => {
          activeTab = id;
          renderTabs();
        });
        tabs.append(tab);
      }
    } else {
      for (const [index, [id, label]] of tabsConfig.entries()) {
        const tab = tabs.children[index] as HTMLButtonElement;
        tab.textContent = label;
        tab.dataset.buddyTab = id;
      }
    }
    for (const tab of tabs.querySelectorAll<HTMLButtonElement>("[data-buddy-tab]")) {
      const selected = tab.dataset.buddyTab === activeTab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    routingPanel.hidden = activeTab !== "routing";
    interruptedPanel.hidden = activeTab !== "interrupted";
    taskPanel.hidden = activeTab !== "task";
  };
  const switchRow = (
    parent: HTMLElement,
    label: string,
    key: "enabled" | "planning" | "bypass" | "privateMode" | "jev",
    hint: string,
    disabled = false,
  ): void => {
    const wrapper = document.createElement("label");
    wrapper.className = "buddy-setting";
    wrapper.dataset.disabled = String(disabled);
    wrapper.title = hint;
    const copy = document.createElement("span");
    copy.className = "buddy-setting-copy";
    const title = document.createElement("b");
    title.textContent = label;
    const detail = document.createElement("small");
    detail.textContent = hint;
    copy.append(title, detail);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "buddy-switch";
    input.setAttribute("role", "switch");
    input.checked = snapshot?.settings[key] ?? false;
    input.setAttribute("aria-checked", String(input.checked));
    input.disabled = disabled;
    input.addEventListener("change", () => {
      input.setAttribute("aria-checked", String(input.checked));
      void setting({ [key]: input.checked });
    });
    wrapper.append(copy, input);
    parent.append(wrapper);
  };
  const select = (
    parent: HTMLElement,
    label: string,
    hint: string,
    entries: [string, string][],
    selected: string,
    change: (id: string) => void,
    disabled = false,
  ): void => {
    const wrapper = document.createElement("label");
    wrapper.className = "buddy-setting";
    wrapper.dataset.disabled = String(disabled);
    wrapper.title = hint;
    const copy = document.createElement("span");
    copy.className = "buddy-setting-copy";
    const title = document.createElement("b");
    title.textContent = label;
    const detail = document.createElement("small");
    detail.textContent = hint;
    copy.append(title, detail);
    const input = document.createElement("select");
    input.className = "buddy-select";
    input.setAttribute("aria-label", label || t().roleLabel);
    for (const [id, text] of entries) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = text;
      input.append(option);
    }
    input.value = selected;
    input.disabled = disabled;
    input.addEventListener("change", () => change(input.value));
    wrapper.append(copy, input);
    parent.append(wrapper);
  };
  const button = (parent: HTMLElement, label: string, action: () => Promise<void>): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      void action().catch(report);
    });
    parent.append(button);
  };
  // JEV 连接配置：密钥只提交给 Host 且不回填，网关地址可回填显示。
  const keyRow = (parent: HTMLElement, disabled = false): void => {
    const client = context?.client;
    if (!client?.buddyJevKey) {
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "buddy-key";
    wrapper.title = t().jevKeyHint;
    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.autocomplete = "off";
    keyInput.spellcheck = false;
    keyInput.disabled = disabled;
    keyInput.placeholder = t().jevKeyPlaceholder;
    keyInput.setAttribute("aria-label", t().jevKey);
    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.autocomplete = "off";
    urlInput.spellcheck = false;
    urlInput.disabled = disabled;
    urlInput.placeholder = t().jevBaseUrlPlaceholder;
    urlInput.setAttribute("aria-label", t().jevBaseUrl);
    urlInput.title = t().jevBaseUrlHint;
    // 网关地址不是密钥，回填当前值；空值代表使用官方默认地址。
    urlInput.value = snapshot?.jevBaseUrl ?? "";
    const status = document.createElement("div");
    status.className = "buddy-key-status";
    const state = document.createElement("span");
    state.className = "buddy-key-state";
    const configured = Boolean(snapshot?.jevKeyConfigured);
    state.dataset.configured = String(configured);
    state.textContent = configured ? t().jevKeyConfigured : t().jevKeyMissing;
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = t().jevKeySave;
    save.disabled = disabled;
    save.addEventListener("click", () => {
      const typedKey = keyInput.value.trim();
      // 未重新输入密钥时省略 apiKey，保留已存密钥；网关地址总是按输入框同步。
      const patch: { apiKey?: string; baseURL: string | null } = {
        baseURL: urlInput.value.trim() || null,
      };
      if (typedKey) {
        patch.apiKey = typedKey;
      }
      void (async () => {
        snapshot = (await client.buddyJevKey?.(patch)) ?? snapshot;
        keyInput.value = "";
        render();
      })().catch(report);
    });
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = t().jevKeyClear;
    clear.disabled = disabled;
    clear.addEventListener("click", () => {
      void (async () => {
        snapshot = (await client.buddyJevKey?.({ apiKey: null, baseURL: null })) ?? snapshot;
        keyInput.value = "";
        render();
      })().catch(report);
    });
    status.append(state, save, clear);
    wrapper.append(keyInput, urlInput, status);
    parent.append(wrapper);
  };
  const interruptedRow = (parent: HTMLElement): void => {
    const client = context?.client;
    if (!client?.buddyInterrupted || !client.buddyContinue) {
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "buddy-interrupted";
    const heading = document.createElement("b");
    heading.className = "buddy-interrupted-heading";
    heading.textContent = t().interruptedGroup;
    const note = document.createElement("div");
    note.className = "buddy-interrupted-note";
    note.textContent = interruptedLoading ? t().interruptedLoading : t().interruptedHint;
    wrapper.append(heading, note);
    if (interruptedError) {
      const failure = document.createElement("div");
      failure.className = "buddy-interrupted-note buddy-interrupted-error";
      failure.setAttribute("role", "status");
      failure.textContent = interruptedError;
      wrapper.append(failure);
    }
    if (!interruptedLoading && interrupted.length === 0 && !interruptedError) {
      const empty = document.createElement("div");
      empty.className = "buddy-interrupted-note";
      empty.textContent = t().interruptedEmpty;
      wrapper.append(empty);
    }
    if (interrupted.length > 0) {
      const list = document.createElement("div");
      list.className = "buddy-interrupted-list";
      for (const thread of interrupted) {
        const item = document.createElement("div");
        item.className = "buddy-interrupted-item";
        const copy = document.createElement("span");
        copy.className = "buddy-interrupted-copy";
        const title = document.createElement("b");
        title.className = "buddy-interrupted-title";
        title.title = thread.title;
        title.textContent = thread.title;
        const state = document.createElement("small");
        state.className = "buddy-interrupted-status";
        state.textContent = t()[thread.status];
        copy.append(title, state);
        const resume = document.createElement("button");
        resume.type = "button";
        resume.textContent = resumePending.has(interruptedKey(thread)) ? t().resuming : t().resume;
        resume.disabled = resumePending.has(interruptedKey(thread));
        resume.addEventListener("click", () => {
          void resumeInterrupted(client, thread);
        });
        item.append(copy, resume);
        list.append(item);
      }
      wrapper.append(list);
    }
    wrapper.title = t().interruptedHint;
    parent.append(wrapper);
  };
  const render = (): void => {
    const m = t();
    if (!snapshot) {
      status.textContent = m.disconnected;
      return;
    }
    const decision = snapshot.decisions.find((d) => d.threadId === context?.threadId);
    const pending =
      snapshot.settings.enabled && !snapshot.settings.privateMode ? decision?.pendingInput : null;
    if (
      pending ||
      (decision &&
        snapshot.settings.enabled &&
        !snapshot.settings.privateMode &&
        ["planning", "discovering", "retrying"].includes(decision.phase))
    ) {
      activeTab = "task";
    }
    root.toggleAttribute("data-planner-input", Boolean(pending));
    const nextInputKey = pending ? JSON.stringify([decision?.threadId, pending, getLocale()]) : "";
    if (nextInputKey !== inputKey || inputClient !== context?.client) {
      inputKey = nextInputKey;
      inputClient = context?.client ?? null;
      inputArea.replaceChildren();
      const target = context;
      if (pending && decision && target) {
        root.open = true;
        panel.scrollTop = 0;
        inputArea.append(
          plannerInputControl(
            pending,
            getLocale(),
            async (answers) => {
              if (context?.client !== target.client || context.threadId !== target.threadId) return;
              if (!target.client.buddyAnswer) throw new Error(t().disconnected);
              await target.client.buddyAnswer({
                threadId: decision.threadId,
                requestId: pending.requestId,
                answers,
              });
              await refresh();
            },
            async () => {
              if (context?.client !== target.client || context.threadId !== target.threadId) return;
              await target.client.buddyCancel?.(decision.threadId);
              await refresh();
            },
          ),
        );
      }
    }
    const involvedModels = decision
      ? [
          ...new Set(
            [
              decision.plannerModel,
              ...(decision.involvedModels ?? []),
              decision.executorModel,
              decision.acceptedModel,
            ].filter((model): model is string => typeof model === "string" && model.length > 0),
          ),
        ]
      : [];
    const phase = (d: BuddyDecision): string => (d.phase === "bypass" ? m.bypassPhase : m[d.phase]);
    const bypass =
      !snapshot.settings.privateMode && snapshot.settings.enabled
        ? decision?.modelBypass
        : undefined;
    root.toggleAttribute("data-model-bypass", Boolean(bypass));
    title.textContent = bypass ? m.modelBypass : "Auto Router";
    const bypassScore =
      bypass?.successRate == null
        ? m.noSamples
        : `${bypass.successRate}/100 (${bypass.succeeded}/${bypass.total})`;
    status.textContent = snapshot.settings.privateMode
      ? m.privateActive
      : !snapshot.settings.enabled
        ? m.disabled
        : decision
          ? `${phase(decision)} · ${decision.command ? m.noModel : involvedModels.join(" · ") || m.waiting}`
          : m.waiting;
    if (bypass) {
      status.textContent += ` · ${m.skipPlanner} · ${m.bypassScore} ${bypassScore}`;
    }
    const signature = JSON.stringify([
      snapshot,
      context?.threadId,
      getLocale(),
      interrupted,
      interruptedLoading,
      interruptedError,
      [...resumePending],
    ]);
    if (signature === fingerprint) {
      return;
    }
    fingerprint = signature;
    controls.replaceChildren();
    routingFields.replaceChildren();
    actions.replaceChildren();
    fields.replaceChildren();
    error.textContent = "";
    const privacy = section(m.privateGroup);
    switchRow(privacy, m.privateMode, "privateMode", m.privateHint);
    row(m.privateMode, m.privateOwnerHint, routingFields);
    const router = section(m.routerGroup);
    switchRow(router, m.enabled, "enabled", m.enabledHint);
    row(m.enabled, m.routerOwnerHint, routingFields);
    if (!snapshot.settings.enabled || snapshot.settings.privateMode) {
      row(
        m.routeGroup,
        snapshot.settings.privateMode ? m.privateDisabledHint : m.planningDisabledHint,
        routingFields,
      );
    }
    const routingDisabled = !snapshot.settings.enabled || snapshot.settings.privateMode;
    const route = section(m.routeGroup);
    switchRow(route, m.bypass, "bypass", m.bypassHint, routingDisabled);
    switchRow(route, m.jev, "jev", m.jevHint, routingDisabled);
    if (snapshot.settings.jev) {
      keyRow(route, routingDisabled);
    }
    select(
      route,
      m.roleLabel,
      m.roleHint,
      ["auto", "git", "io", "executor"].map((role) => [
        role,
        m[role as "auto" | "git" | "io" | "executor"],
      ]),
      snapshot.settings.role,
      (role) => {
        void setting({ role: role as BuddySettings["role"] });
      },
      routingDisabled,
    );
    const planning = section(m.planningGroup);
    switchRow(planning, m.planningMode, "planning", m.planningOwnerHint, routingDisabled);
    const models = section(m.modelGroup);
    for (const [key, tier, label, hint] of [
      ["plannerModel", "夯", m.planner, m.plannerHint],
      ["executorModel", "垃", m.worker, m.workerHint],
    ] as const) {
      const options: [string, string][] = [
        ["", m.choose],
        ...snapshot.models
          .filter((model) => model.eligible && model.tier === tier)
          .map((model): [string, string] => [model.id, model.id]),
      ];
      const configured = snapshot.settings[key];
      if (configured && !options.some(([id]) => id === configured)) {
        options.push([configured, `${configured} (${m.unknown})`]);
      }
      select(
        models,
        label,
        hint,
        options,
        configured ?? "",
        (id) => {
          void setting({ [key]: id || null });
        },
        routingDisabled || (key === "plannerModel" && !snapshot.settings.planning),
      );
    }
    interruptedPanel.replaceChildren();
    if (snapshot.settings.enabled && !snapshot.settings.privateMode) {
      interruptedRow(interruptedPanel);
    }
    if (decision && snapshot.settings.enabled && !snapshot.settings.privateMode) {
      if (bypass) {
        row(m.bypassScore, bypassScore);
        fields.lastElementChild?.setAttribute("title", m.bypassScoreHint);
        row(m.skills, bypass.skills.join(" · ") || m.noSkills);
        if (bypass.skillWarning) {
          row(m.skillWarning, bypass.skillWarning);
        }
      }
      row(m.score, `${decision.score}/100 · ${m[decision.difficulty]}`);
      row(m.reason, decision.reason);
      if (decision.judgment) {
        const { model, decisions } = decision.judgment;
        const detail = Object.entries(decisions)
          .map(([id, value]) => `${id}:${value.status}`)
          .join(" · ");
        row(m.jev, `${model}${detail ? ` · ${detail}` : ""}`);
      }
      row(m.planner, decision.plannerModel ?? "—");
      row(m.involvedModels, decision.command ? m.noModel : involvedModels.join("\n") || m.unknown);
      row(m.worker, decision.command ? m.noModel : (decision.executorModel ?? "—"));
      row(m.accepted, decision.acceptedModel ?? (decision.command ? m.noModel : m.unknown));
      if (decision.command) {
        row(m.command, decision.command);
        row(m.exit, decision.exitCode === null ? m.unknown : String(decision.exitCode));
      }
      if (decision.plan) {
        let packet: string = decision.plan;
        try {
          const parsed: unknown = JSON.parse(packet);
          if (
            parsed &&
            typeof parsed === "object" &&
            "goal" in parsed &&
            "steps" in parsed &&
            "checks" in parsed &&
            Array.isArray(parsed.steps) &&
            Array.isArray(parsed.checks)
          ) {
            packet = `${String(parsed.goal)}\n\n${m.steps}\n${parsed.steps.map((step, index) => `${index + 1}. ${String(step)}`).join("\n")}\n\n${m.checks}\n${parsed.checks.map((check) => `• ${String(check)}`).join("\n")}`;
          }
        } catch {
          // 旧版本保存的文本任务包直接展示。
        }
        row(m.plan, packet);
      }
      if (["planning", "discovering", "retrying"].includes(decision.phase)) {
        button(actions, decision.phase === "retrying" ? m.cancelRecovery : m.cancel, async () => {
          await context?.client.buddyCancel?.(decision.threadId);
          await refresh();
        });
      }
    }
    taskEmpty.textContent = fields.childElementCount === 0 ? m.idle : "";
    note.textContent = bypass ? m.bypassScoreHint : "";
    summary.title = snapshot.settings.enabled
      ? m.note
      : getLocale() === "zh-CN"
        ? "使用当前选定模型直接执行；开启 Auto Router 可恢复系统判断与路由策略。"
        : "Use the selected model directly. Enable Auto Router to restore System One and routing.";
    renderTabs();
  };
  const refreshContext = (): void => {
    const next = disposed ? null : getContext();
    if (context?.client !== next?.client || context?.threadId !== next?.threadId) {
      inputArea.replaceChildren();
      inputKey = "";
      inputClient = null;
      if (context?.client !== next?.client) {
        interrupted = [];
        interruptedClient = null;
        interruptedLoading = false;
        interruptedError = "";
        interruptedUpdatedAt = 0;
        resumePending.clear();
      }
    }
    context = next;
    if (!next) {
      root.remove();
      return;
    }
    if (root.parentElement !== next.anchor.parentElement) {
      next.anchor.before(root);
    }
  };
  const refresh = async (): Promise<void> => {
    refreshContext();
    const next = context;
    if (!next || busy) {
      return;
    }
    if (!next.client.buddyStatus) {
      status.textContent = t().disconnected;
      return;
    }
    busy = true;
    try {
      const value = await next.client.buddyStatus();
      if (disposed || context?.client !== next.client || context.threadId !== next.threadId) {
        return;
      }
      snapshot = value;
      if (
        value.settings.enabled &&
        !value.settings.privateMode &&
        next.client.buddyInterrupted &&
        next.client.buddyContinue
      ) {
        void refreshInterrupted(next.client);
      }
      render();
    } catch (failure) {
      status.textContent = t().disconnected;
      report(failure);
    } finally {
      busy = false;
    }
  };
  const timer = window.setInterval(() => {
    void refresh();
  }, 1200);
  void refresh();
  return {
    refresh,
    refreshContext,
    dispose() {
      disposed = true;
      window.clearInterval(timer);
      root.remove();
    },
  };
}
