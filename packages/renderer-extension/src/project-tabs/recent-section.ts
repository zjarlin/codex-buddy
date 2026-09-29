const SECTION = "data-app-action-sidebar-section";
const HEADING = "data-app-action-sidebar-section-heading";
const COLLAPSED = "data-app-action-sidebar-section-collapsed";
const TOGGLE = "data-app-action-sidebar-section-toggle";

export function createRecentSectionCollapse(): (selected: string | null) => void {
  let selectedTab: string | null | undefined;
  let initialized = new WeakSet<HTMLElement>();

  return (selected) => {
    if (selectedTab !== selected) {
      selectedTab = selected;
      initialized = new WeakSet();
    }
    for (const section of document.querySelectorAll<HTMLElement>(
      `#app-shell-sidebar [${SECTION}][${HEADING}="Recents"]`,
    )) {
      if (initialized.has(section)) {
        continue;
      }
      const toggle = section.querySelector<HTMLButtonElement>(`button[${TOGGLE}]`);
      const collapsed = section.getAttribute(COLLAPSED);
      if (
        !toggle ||
        toggle.disabled ||
        toggle.closest(`[${SECTION}]`) !== section ||
        (collapsed !== "true" && collapsed !== "false") ||
        toggle.getAttribute("aria-expanded") !== String(collapsed === "false")
      ) {
        continue;
      }
      // 每次挂载或切换分类只处理一次；普通刷新保留用户手动展开的状态。
      initialized.add(section);
      if (collapsed === "false") {
        // 原生入口同步更新分区状态、持久化与内容挂载，不直接隐藏会话 DOM。
        toggle.click();
      }
    }
  };
}
