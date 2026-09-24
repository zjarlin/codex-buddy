export interface GitDiffLine {
  kind: "meta" | "hunk" | "context" | "add" | "del";
  oldLine: string;
  newLine: string;
  marker: string;
  code: string;
}

const META_PREFIXES = [
  "diff --git",
  "index ",
  "--- ",
  "+++ ",
  "new file mode",
  "deleted file mode",
  "old mode",
  "new mode",
  "similarity index",
  "rename from",
  "rename to",
  "Binary files",
] as const;

function isMetaLine(line: string): boolean {
  return META_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/** Parses a unified diff into display rows. Line numbers stay empty for additions
 * and deletions on the opposite side, matching IDE gutter conventions. */
export function parseUnifiedDiff(diff: string): GitDiffLine[] {
  const lines: GitDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line === "" && lines.length > 0 && lines.at(-1)?.code === "") continue;
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      lines.push({ kind: "hunk", oldLine: "", newLine: "", marker: "", code: line });
      continue;
    }
    if (isMetaLine(line)) {
      lines.push({ kind: "meta", oldLine: "", newLine: "", marker: "", code: line });
      continue;
    }
    const marker = line[0] ?? " ";
    const code = line.slice(1);
    if (marker === "+") {
      lines.push({ kind: "add", oldLine: "", newLine: String(newLine), marker, code });
      newLine += 1;
      continue;
    }
    if (marker === "-") {
      lines.push({ kind: "del", oldLine: String(oldLine), newLine: "", marker, code });
      oldLine += 1;
      continue;
    }
    if (marker === "\\") {
      lines.push({ kind: "meta", oldLine: "", newLine: "", marker: "\\", code: line });
      continue;
    }
    lines.push({
      kind: "context",
      oldLine: String(oldLine),
      newLine: String(newLine),
      marker: " ",
      code,
    });
    oldLine += 1;
    newLine += 1;
  }
  return lines;
}
