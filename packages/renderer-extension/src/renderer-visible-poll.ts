// 仅在有消费者且窗口可见时轮询；恢复可见后立即补一次读取。
export function createVisiblePoll(
  ownerDocument: Document,
  intervalMs: number,
  refresh: () => void,
): { setActive(active: boolean): void; dispose(): void } {
  let active = false;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const reconcile = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (active && !disposed && !ownerDocument.hidden) {
      timer = setInterval(refresh, intervalMs);
    }
  };
  const onVisibility = (): void => {
    reconcile();
    if (active && !disposed && !ownerDocument.hidden) refresh();
  };
  ownerDocument.addEventListener("visibilitychange", onVisibility);
  return {
    setActive(value) {
      if (active === value || disposed) return;
      active = value;
      reconcile();
    },
    dispose() {
      disposed = true;
      reconcile();
      ownerDocument.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
