import type { ThreadGoal } from "@codexhost/shared-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RendererModelClient } from "../src/renderer-model-client.js";
import {
  installRendererSidebarGoalBadges,
  type SidebarGoalDom,
  type SidebarGoalRow,
} from "../src/renderer-sidebar-goal-badges.js";

class FakeRow implements SidebarGoalRow {
  connected = true;
  goal: ThreadGoal | null = null;
  locale: "zh-CN" | "en" | null = null;
  clears = 0;

  constructor(
    public id: string | null,
    public host: string | null = "local",
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  hostId(): string | null {
    return this.host;
  }

  threadId(): string | null {
    return this.id;
  }

  render(goal: ThreadGoal, locale: "zh-CN" | "en"): void {
    this.goal = goal;
    this.locale = locale;
  }

  clear(): void {
    this.goal = null;
    this.clears += 1;
  }
}

class FakeDom implements SidebarGoalDom {
  readonly listeners = new Set<(rows: readonly SidebarGoalRow[]) => void>();

  constructor(public mountedRows: FakeRow[]) {}

  rows(): readonly SidebarGoalRow[] {
    return this.mountedRows;
  }

  observe(onChange: (rows: readonly SidebarGoalRow[]) => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  clear(): void {
    for (const row of this.mountedRows) row.clear();
  }

  change(rows: readonly SidebarGoalRow[] = this.mountedRows): void {
    for (const listener of this.listeners) listener(rows);
  }
}

function goal(threadId: string, status: ThreadGoal["status"] = "active"): ThreadGoal {
  return {
    threadId,
    objective: "Finish the sidebar goal marker",
    status,
    tokenBudget: null,
    tokensUsed: 12,
    timeUsedSeconds: 4,
    createdAt: 1,
    updatedAt: 2,
  };
}

function clientWith(
  getThreadGoal: (threadId: string) => Promise<ThreadGoal | null>,
): RendererModelClient {
  return { getThreadGoal: vi.fn(getThreadGoal) } as unknown as RendererModelClient;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("Renderer sidebar goal badges", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks a Thread that has an active goal", async () => {
    const row = new FakeRow("thread-1");
    const dom = new FakeDom([row]);
    const client = clientWith(async () => goal("thread-1"));
    const badges = installRendererSidebarGoalBadges({
      getClient: () => client,
      getLocale: () => "zh-CN",
      dom,
    });
    await settle();
    expect(row.goal?.status).toBe("active");
    expect(row.locale).toBe("zh-CN");
    expect(client.getThreadGoal).toHaveBeenCalledTimes(1);
    badges.dispose();
  });

  it("clears the marker when the Thread has no goal", async () => {
    const row = new FakeRow("thread-1");
    row.goal = goal("thread-1");
    const dom = new FakeDom([row]);
    const client = clientWith(async () => null);
    const badges = installRendererSidebarGoalBadges({
      getClient: () => client,
      getLocale: () => "en",
      dom,
    });
    await settle();
    expect(row.goal).toBeNull();
    expect(row.clears).toBeGreaterThan(0);
    badges.dispose();
  });

  it("reuses the cached goal while the row is rediscovered", async () => {
    const row = new FakeRow("thread-1");
    const dom = new FakeDom([row]);
    const client = clientWith(async () => goal("thread-1", "paused"));
    const badges = installRendererSidebarGoalBadges({
      getClient: () => client,
      getLocale: () => "en",
      dom,
    });
    await settle();
    dom.change([row]);
    badges.refresh();
    await settle();
    expect(client.getThreadGoal).toHaveBeenCalledTimes(1);
    expect(row.goal?.status).toBe("paused");
    badges.dispose();
  });
});
