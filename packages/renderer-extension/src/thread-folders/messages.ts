const zh = {
  title: "会话文件夹",
  manage: "管理会话文件夹",
  move: "移动到文件夹…",
  moveTitle: "移动会话到文件夹",
  all: "全部",
  unassigned: "未分类",
  name: "文件夹名称",
  hint: "文件夹只归类当前项目的会话，不会移动或改写原生会话数据。",
  add: "新建文件夹",
  nativeActions: "原生会话操作…",
  remove: "删除",
  up: "上移",
  down: "下移",
  save: "保存",
  cancel: "取消",
  failed: "会话文件夹读写失败：",
  duplicate: "文件夹名称不能重复",
  empty: "还没有文件夹，可先添加一个。",
  selected: "当前",
};
const en: typeof zh = {
  title: "Conversation folders",
  manage: "Manage conversation folders",
  move: "Move to folder…",
  moveTitle: "Move conversation to folder",
  all: "All",
  unassigned: "Unfiled",
  name: "Folder name",
  hint: "Folders group conversations in this project only and do not move or rewrite native conversation data.",
  add: "New folder",
  nativeActions: "Native conversation actions…",
  remove: "Delete",
  up: "Move up",
  down: "Move down",
  save: "Save",
  cancel: "Cancel",
  failed: "Conversation folders could not be read or saved: ",
  duplicate: "Folder names must be unique",
  empty: "No folders yet. Add one to get started.",
  selected: "Current",
};

export function threadFolderMessages(locale: string): typeof zh {
  return locale === "zh-CN" ? zh : en;
}
export type ThreadFolderMessages = typeof zh;
