const SCROLLER = "[data-app-action-timeline-scroll]";
const BOTTOM_THRESHOLD = 48;

// 只操作原生消息区的滚动位置；不改对话、模型或原生滚动状态。
export function installTranscriptAutoScroll(ownerDocument: Document): () => void {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow || typeof ResizeObserver === "undefined") return () => {};
  const bindings = new Map<HTMLElement, { refresh(): void; resume(): void; dispose(): void }>();
  let frame = 0;
  let disposed = false;

  const bind = (scroller: HTMLElement) => {
    let content: Element | null = null;
    let follow = true;
    let pointerScrolling = false;
    let touchY: number | null = null;
    let scrollFrame = 0;
    const reversed = (): boolean =>
      ownerWindow.getComputedStyle(scroller).flexDirection === "column-reverse";
    const distance = (): number =>
      reversed()
        ? Math.abs(scroller.scrollTop)
        : Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
    follow = distance() <= BOTTOM_THRESHOLD;
    const schedule = (): void => {
      if (!follow || scrollFrame || disposed) return;
      scrollFrame = ownerWindow.requestAnimationFrame(() => {
        scrollFrame = 0;
        if (!follow || !scroller.isConnected || scroller.clientHeight === 0 || distance() <= 1)
          return;
        // 反向 flex 的底部是 0；每帧最多一次，流式输出时不累计平滑动画。
        scroller.scrollTo({ top: reversed() ? 0 : scroller.scrollHeight, behavior: "instant" });
      });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(scroller);
    const refresh = (): void => {
      const next = scroller.firstElementChild;
      if (content !== next) {
        if (content) resize.unobserve(content);
        content = next;
        if (content) resize.observe(content);
      }
      schedule();
    };
    const resume = (): void => {
      follow = true;
      schedule();
    };
    const onScroll = (): void => {
      if (distance() <= BOTTOM_THRESHOLD) follow = true;
      else if (pointerScrolling) follow = false;
    };
    const nestedScrollConsumes = (target: EventTarget | null, up: boolean): boolean => {
      for (
        let node = target instanceof Element ? target : null;
        node && node !== scroller;
        node = node.parentElement
      ) {
        if (!(node instanceof HTMLElement) || node.scrollHeight <= node.clientHeight) continue;
        if (!/^(auto|scroll)$/.test(ownerWindow.getComputedStyle(node).overflowY)) continue;
        if (up ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1)
          return true;
      }
      return false;
    };
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0 && !nestedScrollConsumes(event.target, true)) follow = false;
    };
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=textbox]")) return;
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      ) {
        if (!nestedScrollConsumes(event.target, true)) follow = false;
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      pointerScrolling = event.target === scroller;
    };
    const onPointerUp = (): void => {
      pointerScrolling = false;
    };
    const onTouchStart = (event: TouchEvent): void => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent): void => {
      const next = event.touches[0]?.clientY ?? null;
      if (
        touchY !== null &&
        next !== null &&
        next > touchY &&
        !nestedScrollConsumes(event.target, true)
      )
        follow = false;
      touchY = next;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: true });
    scroller.addEventListener("keydown", onKey);
    scroller.addEventListener("pointerdown", onPointerDown);
    ownerWindow.addEventListener("pointerup", onPointerUp);
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    refresh();
    return {
      refresh,
      resume,
      dispose() {
        resize.disconnect();
        if (scrollFrame) ownerWindow.cancelAnimationFrame(scrollFrame);
        scroller.removeEventListener("scroll", onScroll);
        scroller.removeEventListener("wheel", onWheel);
        scroller.removeEventListener("keydown", onKey);
        scroller.removeEventListener("pointerdown", onPointerDown);
        ownerWindow.removeEventListener("pointerup", onPointerUp);
        scroller.removeEventListener("touchstart", onTouchStart);
        scroller.removeEventListener("touchmove", onTouchMove);
      },
    };
  };
  const reconcile = (): void => {
    frame = 0;
    for (const [scroller, binding] of bindings) {
      if (!scroller.isConnected) {
        binding.dispose();
        bindings.delete(scroller);
      }
    }
    for (const scroller of ownerDocument.querySelectorAll<HTMLElement>(SCROLLER)) {
      if (!bindings.has(scroller)) bindings.set(scroller, bind(scroller));
      else bindings.get(scroller)?.refresh();
    }
  };
  const mutations = new MutationObserver(() => {
    if (!frame && !disposed) frame = ownerWindow.requestAnimationFrame(reconcile);
  });
  mutations.observe(ownerDocument.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const onSubmission = (event: Event): void => {
    const composerId = event instanceof CustomEvent ? event.detail?.composerId : null;
    if (typeof composerId !== "string") return;
    for (const [scroller, binding] of bindings) {
      if (
        [...scroller.querySelectorAll("[data-codexhost-agent-control]")].some(
          (control) => control.getAttribute("data-codexhost-agent-control") === composerId,
        )
      )
        binding.resume();
    }
  };
  ownerWindow.addEventListener("codexhost:renderer-submission", onSubmission);
  reconcile();
  return () => {
    disposed = true;
    mutations.disconnect();
    if (frame) ownerWindow.cancelAnimationFrame(frame);
    ownerWindow.removeEventListener("codexhost:renderer-submission", onSubmission);
    for (const binding of bindings.values()) binding.dispose();
    bindings.clear();
  };
}
