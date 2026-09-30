import type { TurnActionContext } from "./turn-actions.js";
import type { GitWorkspaceStatus } from "@codexhost/shared-contracts";

export function actionThreadTurns(thread: Record<string, unknown>): TurnActionContext["turns"] {
  if (!Array.isArray(thread.turns)) return [];
  return thread.turns.flatMap((turn: unknown) => {
    if (
      !turn ||
      typeof turn !== "object" ||
      !("id" in turn) ||
      typeof turn.id !== "string" ||
      !("status" in turn) ||
      typeof turn.status !== "string"
    )
      return [];
    return [{ id: turn.id, status: turn.status }];
  });
}

export function actionGitFeatures(
  repositories: readonly GitWorkspaceStatus[],
): TurnActionContext["features"] {
  return repositories.reduce(
    (features, status) => ({
      git_changes: features.git_changes + status.changes.length,
      git_conflicts:
        features.git_conflicts + status.changes.filter(({ conflicted }) => conflicted).length,
      git_ahead: features.git_ahead + status.ahead,
      git_behind: features.git_behind + status.behind,
    }),
    { git_changes: 0, git_conflicts: 0, git_ahead: 0, git_behind: 0 },
  );
}
