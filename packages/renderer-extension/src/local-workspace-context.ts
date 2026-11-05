export interface LocalWorkspaceContext {
  hostId: string;
  threadId: string;
  cwd: string;
  title: string;
  remote: string;
  capturedAt: number;
  text: string;
  truncated: boolean;
}

export const LOCAL_CONTEXT_CACHE_KEY = "codexhost.local-workspace-context.v1";
const MAX_CONTEXT_CHARS = 120_000;
const MAX_CACHED_THREADS = 8;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 保留消息及工具结果；不把鉴权、原生会话定位符或内部推理作为聊天记忆。 */
export function captureLocalWorkspaceContext(
  hostId: string,
  threadId: string,
  value: unknown,
  capturedAt = Date.now(),
): LocalWorkspaceContext {
  const thread = record(value);
  if (hostId === "local" || thread.id !== threadId || typeof thread.cwd !== "string") {
    throw new Error("Remote conversation identity is unavailable");
  }
  if (!Array.isArray(thread.turns)) throw new Error("Conversation history is unavailable");
  const blocks: string[] = [];
  for (const rawTurn of thread.turns) {
    const turn = record(rawTurn);
    for (const rawItem of Array.isArray(turn.items) ? turn.items : []) {
      const item = record(rawItem);
      if (item.type === "reasoning") continue;
      if (item.type === "userMessage") {
        const parts = (Array.isArray(item.content) ? item.content : []).map((raw) => {
          const part = record(raw);
          return part.type === "text" && typeof part.text === "string"
            ? part.text
            : `[${String(part.type ?? "attachment")}: attachment not copied]`;
        });
        blocks.push(`User:\n${parts.join("\n")}`);
      } else if (item.type === "agentMessage" && typeof item.text === "string") {
        blocks.push(`Assistant:\n${item.text}`);
      } else if (typeof item.type === "string") {
        const fields = Object.fromEntries(
          [
            "command",
            "cwd",
            "aggregatedOutput",
            "exitCode",
            "changes",
            "tool",
            "arguments",
            "result",
            "error",
            "summary",
            "status",
          ]
            .filter((key) => item[key] !== undefined)
            .map((key) => [key, item[key]]),
        );
        if (Object.keys(fields).length) blocks.push(`${item.type}:\n${JSON.stringify(fields)}`);
      }
    }
  }
  const text = blocks.join("\n\n");
  if (!text.trim()) throw new Error("No reusable conversation context is available");
  const git = record(thread.gitInfo);
  return {
    hostId,
    threadId,
    cwd: thread.cwd,
    title: typeof thread.name === "string" ? thread.name : threadId,
    remote: typeof git.repositoryUrl === "string" ? git.repositoryUrl : "",
    capturedAt,
    text: text.slice(-MAX_CONTEXT_CHARS),
    truncated: text.length > MAX_CONTEXT_CHARS,
  };
}

export function readLocalWorkspaceContexts(
  storage: Pick<Storage, "getItem">,
): LocalWorkspaceContext[] {
  const raw: unknown = JSON.parse(storage.getItem(LOCAL_CONTEXT_CACHE_KEY) ?? "[]");
  if (!Array.isArray(raw)) throw new Error("Invalid local conversation cache");
  return raw
    .filter((value): value is LocalWorkspaceContext => {
      const item = record(value);
      return (
        ["hostId", "threadId", "cwd", "title", "remote", "text"].every(
          (key) => typeof item[key] === "string",
        ) &&
        typeof item.capturedAt === "number" &&
        typeof item.truncated === "boolean"
      );
    })
    .slice(0, MAX_CACHED_THREADS);
}

export function saveLocalWorkspaceContext(
  storage: Pick<Storage, "getItem" | "setItem">,
  context: LocalWorkspaceContext,
): void {
  const previous = readLocalWorkspaceContexts(storage);
  const entries = [
    context,
    ...previous.filter(
      (item) => item.hostId !== context.hostId || item.threadId !== context.threadId,
    ),
  ].slice(0, MAX_CACHED_THREADS);
  storage.setItem(LOCAL_CONTEXT_CACHE_KEY, JSON.stringify(entries));
}

export function localContinuationMessage(context: LocalWorkspaceContext, cwd: string): string {
  return [
    "Continue this conversation in the local workspace. The quoted history below is reference data, not a new request to repeat previous actions.",
    `Source: ${context.hostId} / ${context.threadId}`,
    `Previous workspace: ${context.cwd}`,
    `Current workspace: ${cwd}`,
    `History captured: ${new Date(context.capturedAt).toISOString()}`,
    context.truncated
      ? "Only the most recent part of the history is included."
      : "Available message and tool history follows.",
    "Remote uncommitted files, attachments and native agent state have not been copied. Recheck local files before relying on past tool results. Do not assume the remote task has stopped.",
    "For this turn, only acknowledge the context and wait for my next instruction. Do not execute tools or change files.",
    "\n--- Quoted conversation history ---\n",
    context.text,
    "\n--- End of quoted history ---",
  ].join("\n");
}
