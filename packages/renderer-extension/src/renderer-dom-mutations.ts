// 只检查变更节点和所属区域；不因无关消息更新扫描整个文档。
export function mutationAffectsElements(
  mutation: MutationRecord,
  selector: string,
  observeContents = true,
): boolean {
  const target = mutation.target instanceof Element ? mutation.target : null;
  if (mutation.type === "attributes") {
    return Boolean(target && (target.closest(selector) || target.querySelector(selector)));
  }
  if (mutation.type !== "childList") return false;
  const inScope = Boolean(observeContents && target?.closest(selector));
  for (const nodes of [mutation.addedNodes, mutation.removedNodes]) {
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (inScope || node.matches(selector) || node.querySelector(selector)) return true;
    }
  }
  return false;
}
