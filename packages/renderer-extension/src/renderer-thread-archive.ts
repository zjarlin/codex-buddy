const MISSING_CLEANUP_ACCOUNT = "Could not determine the account for worktree cleanup.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function installRendererThreadArchive(target: unknown): (() => void) | null {
  if (
    !isRecord(target) ||
    typeof target.getHostId !== "function" ||
    target.getHostId() !== "local"
  ) {
    return null;
  }
  const pending = target.pendingThreadArchives;
  if (!isRecord(pending) || typeof pending.add !== "function") {
    return null;
  }
  const descriptor = Object.getOwnPropertyDescriptor(pending, "add");
  if (!descriptor?.writable) {
    return null;
  }
  const original = pending.add;
  const add = async (...args: unknown[]): Promise<unknown> => {
    try {
      return await original.apply(pending, args);
    } catch (error) {
      const options = args[1];
      if (
        !isRecord(error) ||
        error.message !== MISSING_CLEANUP_ACCOUNT ||
        !isRecord(options) ||
        options.cleanupWorktree !== true ||
        typeof options.cwd !== "string"
      ) {
        throw error;
      }
      // API Key 没有工作区清理所需的账号身份，保留目录并继续原生归档。
      return original.apply(pending, [
        args[0],
        { ...options, cleanupWorktree: false },
        ...args.slice(2),
      ]);
    }
  };
  pending.add = add;
  return () => {
    if (pending.add === add) {
      Object.defineProperty(pending, "add", descriptor);
    }
  };
}
