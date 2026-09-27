import type { ModelAvailabilitySnapshot } from "@codexhost/shared-contracts";

export interface ModelAvailabilityCallbacks {
  read: () => Promise<ModelAvailabilitySnapshot>;
  probe: (modelIds: string[]) => Promise<ModelAvailabilitySnapshot>;
}

type AvailabilityTab = "available" | "unavailable" | "untested";
const tabNames: AvailabilityTab[] = ["available", "unavailable", "untested"];
let nextPanelId = 0;

export function mountModelAvailability(
  callbacks: ModelAvailabilityCallbacks | undefined,
  panel: HTMLElement,
  onChange: () => void,
  getModelIds: () => string[],
) {
  const root = document.createElement("div");
  root.dataset.modelAvailability = "true";
  const probe = document.createElement("button");
  probe.type = "button";
  probe.dataset.modelAvailabilityProbe = "true";
  const summary = document.createElement("div");
  summary.dataset.modelAvailabilitySummary = "true";
  summary.setAttribute("role", "status");
  const error = document.createElement("div");
  error.dataset.modelAvailabilityError = "true";
  error.setAttribute("role", "status");
  const tabList = document.createElement("div");
  tabList.setAttribute("role", "tablist");
  const panelId = `codexhost-model-availability-${++nextPanelId}`;
  const tabs = tabNames.map((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `${panelId}-${name}`;
    button.dataset.modelAvailabilityTab = name;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panelId);
    tabList.append(button);
    return button;
  });
  root.append(probe, summary, error, tabList);
  let enabled = false;
  let chinese = false;
  let disabled = false;
  let probing = false;
  let reading = false;
  let request = 0;
  let activeTab: AvailabilityTab = "untested";
  let tabSelected = false;
  let failure = "";
  let snapshot: ModelAvailabilitySnapshot | undefined;
  let results = new Map<string, ModelAvailabilitySnapshot["results"][number]>();

  const reset = (): void => {
    request++;
    probing = false;
    reading = false;
    snapshot = undefined;
    results = new Map();
    activeTab = "untested";
    tabSelected = false;
    failure = "";
  };
  const accept = (value: ModelAvailabilitySnapshot, manual: boolean): void => {
    if (manual || (!snapshot && !tabSelected && value.checkedAt)) {
      activeTab = "available";
    }
    snapshot = value;
    results = new Map(value.results.map((result) => [result.id, result]));
  };
  const read = async (): Promise<void> => {
    if (!enabled || !callbacks || probing) {
      return;
    }
    const current = ++request;
    reading = true;
    failure = "";
    onChange();
    try {
      const value = await callbacks.read();
      if (current === request) {
        accept(value, false);
      }
    } catch (cause) {
      if (current === request) {
        failure = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (current === request) {
        reading = false;
        onChange();
      }
    }
  };
  probe.addEventListener("click", async () => {
    if (!enabled || !callbacks || probing || disabled) {
      return;
    }
    const current = ++request;
    probing = true;
    reading = false;
    failure = "";
    onChange();
    try {
      const value = await callbacks.probe([...new Set(getModelIds())]);
      if (current === request) {
        accept(value, true);
      }
    } catch (cause) {
      if (current === request) {
        failure = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (current === request) {
        probing = false;
        onChange();
      }
    }
  });
  const selectTab = (index: number): void => {
    const name = tabNames[index];
    if (!name) {
      return;
    }
    activeTab = name;
    tabSelected = true;
    onChange();
    tabs[index]?.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(index));
    tab.addEventListener("keydown", (event) => {
      const target = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (target !== undefined) {
        event.preventDefault();
        selectTab(target);
      }
    });
  });

  return {
    root,
    reset,
    read,
    get probing() {
      return probing;
    },
    get enabled() {
      return enabled;
    },
    get snapshot() {
      return snapshot;
    },
    get activeTab() {
      return activeTab;
    },
    matches(id: string): boolean {
      return !enabled || (results.get(id)?.status ?? "untested") === activeTab;
    },
    failureReason(id: string): string | undefined {
      const result = enabled ? results.get(id) : undefined;
      return result?.status === "unavailable"
        ? result.error || (chinese ? "模型请求失败" : "Model request failed")
        : undefined;
    },
    update(next: { enabled: boolean; chinese: boolean; disabled: boolean; modelIds: string[] }) {
      const nextEnabled = next.enabled && !!callbacks;
      if (enabled !== nextEnabled) {
        reset();
      }
      enabled = nextEnabled;
      chinese = next.chinese;
      disabled = next.disabled;
      root.hidden = !enabled;
      if (!enabled) {
        panel.removeAttribute("role");
        panel.removeAttribute("aria-labelledby");
        panel.removeAttribute("tabindex");
        return;
      }
      panel.id = panelId;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `${panelId}-${activeTab}`);
      panel.tabIndex = 0;
      probe.textContent = probing
        ? chinese
          ? "正在探测模型…"
          : "Probing models…"
        : chinese
          ? "探测全部模型"
          : "Probe all models";
      probe.disabled = disabled || probing;
      probe.setAttribute("aria-busy", String(probing));
      const counts = { available: 0, unavailable: 0, untested: 0 };
      for (const id of new Set(next.modelIds)) {
        counts[results.get(id)?.status ?? "untested"]++;
      }
      const labels = chinese
        ? { available: "可用", unavailable: "不可用", untested: "未探测" }
        : { available: "Available", unavailable: "Unavailable", untested: "Untested" };
      tabList.setAttribute("aria-label", chinese ? "模型可用性" : "Model availability");
      tabs.forEach((tab, index) => {
        const name = tabNames[index];
        if (!name) {
          return;
        }
        tab.textContent = `${labels[name]} (${counts[name]})`;
        tab.setAttribute("aria-selected", String(name === activeTab));
        tab.tabIndex = name === activeTab ? 0 : -1;
      });
      const checkedAt = snapshot?.checkedAt;
      summary.textContent = checkedAt
        ? `${chinese ? "上次探测" : "Last checked"}: ${new Date(checkedAt).toLocaleString(chinese ? "zh-CN" : "en")}`
        : reading
          ? chinese
            ? "正在读取探测结果…"
            : "Loading probe results…"
          : chinese
            ? "尚未探测"
            : "Not probed yet";
      summary.title = checkedAt ?? "";
      error.textContent = failure;
      error.hidden = !failure;
    },
  };
}
