const zh = {
  title: "选择发送会话",
  search: "搜索项目或已完成会话",
  stale: "会话、项目或 Host 已改变，请关闭后重新发送",
  failed: "发送失败：",
  loadFailed: "近期会话暂不可用，仍可选择当前会话或新建会话",
  loading: "正在读取近期会话…",
  empty: "没有匹配的已完成会话",
  unnamed: "未命名会话",
  current: "当前会话",
  workspaceUnavailable: "项目路径暂不可用",
  default: "默认 · 再按 Enter 发送",
  projects: "近期项目 · 新开会话",
  completed: "项目中的已完成会话 · 续接上下文",
  newProject: (project: string) => `在 ${project} 新建会话`,
  local: "本机",
};
const en: typeof zh = {
  title: "Choose a conversation",
  search: "Search projects or completed conversations",
  stale: "Conversation, project or Host changed. Close and send again.",
  failed: "Could not send: ",
  loadFailed: "Recent conversations unavailable. You can still send here or start a new chat.",
  loading: "Loading recent conversations…",
  empty: "No matching completed conversations",
  unnamed: "Untitled conversation",
  current: "Current conversation",
  workspaceUnavailable: "Project path unavailable",
  default: "Default · Enter to send",
  projects: "Recent projects · New conversation",
  completed: "Completed conversations by project · Continue",
  newProject: (project) => `New conversation in ${project}`,
  local: "Local",
};
export function sessionPickerMessages(locale: string): typeof zh {
  return locale === "zh-CN" ? zh : en;
}
