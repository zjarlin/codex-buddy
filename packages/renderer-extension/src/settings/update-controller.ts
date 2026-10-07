import type {
  UpdateCheckResult,
  UpdateStartResult,
  UpdateStatus,
  UpdateStatusResult,
} from "@codexhost/shared-contracts";
import type { RendererUpdateClient } from "./pages.js";
import {
  RendererUpdateRequestTimeoutError,
  runBoundedRendererUpdateRequest,
} from "./update-request.js";

const CHECK_RETRY_DELAYS = [1_000, 3_000, 10_000, 30_000] as const;
const STATUS_POLL_LIMIT = 1_200;

export interface RendererUpdateSnapshot {
  check: UpdateCheckResult | null;
  status: UpdateStatus | null;
  busy: "start" | "restart" | null;
  error: unknown;
}

export interface RendererUpdateController extends RendererUpdateClient {
  restartUpdate(): Promise<UpdateStartResult>;
  subscribeUpdateStatus(listener: (result: UpdateStatusResult) => void): () => void;
  readonly available: boolean;
  readonly snapshot: RendererUpdateSnapshot;
  refreshBinding(): void;
  subscribe(listener: (snapshot: RendererUpdateSnapshot) => void): () => void;
  dispose(): void;
}

export function isPollingUpdateStatus(status: UpdateStatus | null): boolean {
  return status !== null && !["ready-to-restart", "failed", "succeeded"].includes(status.phase);
}

// 主界面提示与设置页共享请求、下载轮询和重复点击保护。
export function createRendererUpdateController(
  getClient: () => RendererUpdateClient | null,
  ownerWindow: Window,
): RendererUpdateController {
  let client: RendererUpdateClient | null = null;
  let scope = new AbortController();
  let disposed = false;
  let snapshot: RendererUpdateSnapshot = { check: null, status: null, busy: null, error: null };
  let checkRequest: Promise<UpdateCheckResult> | null = null;
  let statusRequest: Promise<UpdateStatusResult> | null = null;
  let command: Promise<UpdateStartResult> | null = null;
  let pollTimer: number | undefined;
  let retryTimer: number | undefined;
  let retryAttempt = 0;
  let pollAttempts = 0;
  const listeners = new Set<(snapshot: RendererUpdateSnapshot) => void>();
  const statusListeners = new Set<(result: UpdateStatusResult) => void>();

  const publish = (patch: Partial<RendererUpdateSnapshot>): void => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  };
  const clearPoll = (): void => {
    ownerWindow.clearTimeout(pollTimer);
    pollTimer = undefined;
  };
  const requireClient = (): RendererUpdateClient => {
    if (!client || disposed) throw new Error("Application updates are unavailable");
    return client;
  };

  const acceptStatus = (result: UpdateStatusResult): void => {
    publish({ status: result.status, error: null });
    for (const listener of statusListeners) listener(result);
    if (isPollingUpdateStatus(result.status)) schedulePoll();
    else clearPoll();
  };

  const readUpdateStatus = (): Promise<UpdateStatusResult> => {
    if (statusRequest) return statusRequest;
    const current = requireClient();
    const signal = scope.signal;
    const request = runBoundedRendererUpdateRequest(() => current.readUpdateStatus(), signal)
      .then((result) => {
        if (!signal.aborted) acceptStatus(result);
        return result;
      })
      .finally(() => {
        if (statusRequest === request) statusRequest = null;
      });
    statusRequest = request;
    return request;
  };

  const schedulePoll = (): void => {
    if (disposed || pollTimer !== undefined) return;
    if (pollAttempts >= STATUS_POLL_LIMIT) {
      publish({ error: new RendererUpdateRequestTimeoutError() });
      return;
    }
    pollAttempts += 1;
    const signal = scope.signal;
    pollTimer = ownerWindow.setTimeout(() => {
      pollTimer = undefined;
      void readUpdateStatus().then(
        (result) => {
          if (!signal.aborted && result.status === null) schedulePoll();
        },
        (error: unknown) => {
          if (signal.aborted) return;
          publish({ error });
          schedulePoll();
        },
      );
    }, 750);
  };

  const checkUpdate = (): Promise<UpdateCheckResult> => {
    if (checkRequest) return checkRequest;
    const current = requireClient();
    const signal = scope.signal;
    const request = runBoundedRendererUpdateRequest(() => current.checkUpdate(), signal, 5_000)
      .then((result) => {
        if (signal.aborted) return result;
        // 在线检查不能用旧快照覆盖正在下载或已就绪的本地操作。
        let status =
          command ||
          isPollingUpdateStatus(snapshot.status) ||
          snapshot.status?.phase === "ready-to-restart"
            ? snapshot.status
            : result.status;
        if (
          status?.phase === "succeeded" ||
          (status?.phase === "failed" && status.version !== result.latestVersion)
        )
          status = null;
        const next = { ...result, status };
        publish({ check: next, status, error: result.error });
        if (isPollingUpdateStatus(status)) schedulePoll();
        return next;
      })
      .finally(() => {
        if (checkRequest === request) checkRequest = null;
      });
    checkRequest = request;
    return request;
  };

  const checkWithRetry = (): void => {
    const signal = scope.signal;
    const retry = (error: unknown): void => {
      if (signal.aborted) return;
      publish({ error });
      const delay = CHECK_RETRY_DELAYS[retryAttempt++];
      if (delay === undefined) return;
      retryTimer = ownerWindow.setTimeout(() => {
        retryTimer = undefined;
        checkWithRetry();
      }, delay);
    };
    void checkUpdate().then((result) => {
      if (result.error) retry(result.error);
    }, retry);
  };

  const runCommand = (kind: "start" | "restart"): Promise<UpdateStartResult> => {
    if (command) return command;
    const current = requireClient();
    if (
      kind === "start" &&
      snapshot.status &&
      (isPollingUpdateStatus(snapshot.status) || snapshot.status.phase === "ready-to-restart")
    ) {
      return Promise.resolve({ status: snapshot.status });
    }
    if (kind === "restart" && snapshot.status?.phase !== "ready-to-restart") {
      return Promise.reject(new Error("No downloaded update is ready to restart"));
    }
    const signal = scope.signal;
    const operation =
      kind === "start" ? current.startUpdate.bind(current) : current.restartUpdate?.bind(current);
    if (!operation) return Promise.reject(new Error("Restart update is unavailable"));
    pollAttempts = 0;
    publish({ busy: kind, error: null });
    const request = runBoundedRendererUpdateRequest(operation, signal)
      .then(
        (result) => {
          if (!signal.aborted) acceptStatus(result);
          return result;
        },
        (error: unknown) => {
          if (!signal.aborted) {
            publish({ error });
            // 超时不等于 Host 取消了下载或重启，先读取状态而非重复提交。
            if (error instanceof RendererUpdateRequestTimeoutError) schedulePoll();
          }
          throw error;
        },
      )
      .finally(() => {
        if (command !== request) return;
        command = null;
        if (!signal.aborted) publish({ busy: null });
      });
    command = request;
    return request;
  };

  return {
    get available() {
      return client !== null;
    },
    get snapshot() {
      return snapshot;
    },
    checkUpdate,
    readUpdateStatus,
    startUpdate: () => runCommand("start"),
    restartUpdate: () => runCommand("restart"),
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeUpdateStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    refreshBinding() {
      if (disposed) return;
      const next = getClient();
      if (next === client) return;
      scope.abort();
      scope = new AbortController();
      clearPoll();
      ownerWindow.clearTimeout(retryTimer);
      retryTimer = undefined;
      retryAttempt = 0;
      pollAttempts = 0;
      checkRequest = null;
      statusRequest = null;
      command = null;
      client = next;
      publish({ check: null, status: null, busy: null, error: null });
      if (client) checkWithRetry();
    },
    dispose() {
      disposed = true;
      scope.abort();
      clearPoll();
      ownerWindow.clearTimeout(retryTimer);
      listeners.clear();
      statusListeners.clear();
    },
  };
}
