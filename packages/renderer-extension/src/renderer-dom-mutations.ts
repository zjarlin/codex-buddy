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

/**
 * renderer 注入到原生树的根节点标记。观察者据此区分“自己的投影写入”和原生结构变化：
 * 自己写入后再次 refresh 会把写入当成新输入，形成微任务级的刷新风暴。
 */
export const RENDERER_INJECTED_ATTRIBUTE = "data-codexhost-injected";

const RENDERER_OWNED_PREFIX = "data-codexhost-";
const RENDERER_INJECTED_SELECTOR = `[${RENDERER_INJECTED_ATTRIBUTE}]`;

function insideRendererInjection(element: Element | null): boolean {
  return Boolean(element?.closest(RENDERER_INJECTED_SELECTOR));
}

/**
 * 整条变更都来自 renderer 自己的投影写入：注入节点、注入节点的内容，或
 * `data-codexhost-*` 属性。这类记录不参与订阅判断，否则投影会自己触发自己。
 */
export function mutationIsRendererOwnedWrite(mutation: MutationRecord): boolean {
  const target =
    mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (mutation.type === "attributes") {
    return (
      (mutation.attributeName ?? "").startsWith(RENDERER_OWNED_PREFIX) ||
      insideRendererInjection(target)
    );
  }
  if (insideRendererInjection(target)) return true;
  if (mutation.type === "characterData") return false;
  let changed = 0;
  for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
    if (!(node instanceof Element) || !insideRendererInjection(node)) return false;
    changed += 1;
  }
  return changed > 0;
}
