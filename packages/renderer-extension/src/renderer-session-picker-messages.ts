const zh = {
  title: "发送到其他会话",
  close: "关闭",
  transfer: "发送到",
  transferTitle: "发送到其他会话或项目",
  search: "搜索项目和可续接会话",
  stale: "会话、项目或 Host 已改变，请关闭后重新发送",
  failed: "发送失败：",
  loadFailed: "近期会话暂不可用；可直接使用主发送按钮",
  loading: "正在读取近期会话…",
  loadingSlow: "近期会话加载较慢，仍在读取；也可直接使用主发送按钮",
  empty: "没有匹配的发送目标",
  unnamed: "未命名会话",
  projects: "新建会话",
  completed: "继续可续接会话",
  newProject: (project: string) => `在 ${project} 新建会话`,
  local: "本机",
};
const en: typeof zh = {
  title: "Send to another conversation",
  close: "Close",
  transfer: "Transfer to",
  transferTitle: "Transfer this message to another conversation or project",
  search: "Search projects and resumable conversations",
  stale: "Conversation, project or Host changed. Close and send again.",
  failed: "Could not send: ",
  loadFailed: "Recent conversations unavailable. Use the main Send button instead.",
  loading: "Loading recent conversations…",
  loadingSlow:
    "Recent conversations are taking longer to load. You can use the main Send button instead.",
  empty: "No matching send targets",
  unnamed: "Untitled conversation",
  projects: "New conversation",
  completed: "Continue a resumable conversation",
  newProject: (project) => `New conversation in ${project}`,
  local: "Local",
};
export function sessionPickerMessages(locale: string): typeof zh {
  return locale === "zh-CN" ? zh : en;
}
