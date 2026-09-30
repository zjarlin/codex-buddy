export function turnAnchors(
  context: { root: HTMLElement; threadId: string },
  turnIds?: Set<string>,
): Map<string, HTMLElement> {
  const anchors = new Map<string, HTMLElement>();
  for (const turn of context.root.querySelectorAll<HTMLElement>(
    "[data-content-search-turn-key], [data-turn-key]",
  )) {
    const turnId =
      turn.getAttribute("data-content-search-turn-key") ??
      turn.getAttribute("data-turn-key")?.replace(/^history-content:turn:/, "");
    if (
      !turnId ||
      turnId.startsWith("history-content:") ||
      (turnIds && !turnIds.has(turnId)) ||
      anchors.has(turnId)
    )
      continue;
    // 原生回合容器使用 display: contents；可见性必须由实际回复节点判断。
    const responses = [
      turn,
      ...turn.querySelectorAll<HTMLElement>("[data-response-annotation-conversation]"),
    ];
    const response = responses.find(
      (node) =>
        node.getAttribute("data-response-annotation-conversation") === context.threadId &&
        node.getClientRects().length > 0,
    );
    if (response) {
      anchors.set(turnId, response);
      continue;
    }
    const annotation = turn.closest<HTMLElement>("[data-response-annotation-conversation]");
    if (
      annotation?.getAttribute("data-response-annotation-conversation") === context.threadId &&
      annotation.getClientRects().length > 0
    ) {
      anchors.set(turnId, annotation);
    }
  }
  return anchors;
}
