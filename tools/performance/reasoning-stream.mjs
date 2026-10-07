import { performance } from "node:perf_hooks";

import { CodexTurnProjector } from "@codexhost/protocol-core";

const chunks = 8_000;
const text = `${"x".repeat(63)}\n`;
const samples = [];

for (let run = 0; run < 5; run += 1) {
  const projector = new CodexTurnProjector({
    threadId: "thread-1",
    turnId: "turn-1",
    cwd: "/workspace",
    startedAtMs: 1_000,
  });
  projector.project({ type: "turn.started", turnId: "turn-1" });
  projector.project({
    type: "item.started",
    turnId: "turn-1",
    item: { type: "reasoning", itemId: "item-1", text: "" },
  });
  let messages = 0;
  const startedAt = performance.now();
  for (let index = 0; index < chunks; index += 1) {
    messages += projector.project({
      type: "item.updated",
      turnId: "turn-1",
      itemId: "item-1",
      update: { type: "text.append", text },
    }).messages.length;
  }
  samples.push({ ms: performance.now() - startedAt, messages });
}

const sorted = samples.map(({ ms }) => ms).sort((left, right) => left - right);
console.log(
  JSON.stringify({ chunks, bytes: chunks * Buffer.byteLength(text), medianMs: sorted[2], samples }),
);
