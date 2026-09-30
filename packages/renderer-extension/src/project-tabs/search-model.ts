export interface ProjectTabSearchTarget {
  id: string | null;
  name: string;
}

export type ProjectTabSearchMatchKind =
  "exact" | "prefix" | "segment-prefix" | "substring" | "subsequence";

export interface ProjectTabSearchResult {
  kind: ProjectTabSearchMatchKind;
  score: number;
  target: ProjectTabSearchTarget;
}

const SEPARATOR = /[_\-\/.\s]+/u;

function normalized(value: string): string {
  return value.toLocaleLowerCase();
}

function segments(value: string): string[] {
  return value.split(SEPARATOR).filter(Boolean);
}

function querySegments(value: string): string[] {
  return segments(value);
}

function segmentPrefixMatch(name: string, query: string): boolean {
  const nameSegments = segments(name);
  const queryParts = querySegments(query);
  if (queryParts.length === 0) {
    return false;
  }

  if (queryParts.length > 1) {
    let nameIndex = 0;
    for (const part of queryParts) {
      let matched = false;
      while (nameIndex < nameSegments.length) {
        if (nameSegments[nameIndex]?.startsWith(part)) {
          matched = true;
          nameIndex += 1;
          break;
        }
        nameIndex += 1;
      }
      if (!matched) {
        return false;
      }
    }
    return true;
  }

  const part = queryParts[0] ?? "";
  if (part.length > 1 && nameSegments.some((segment) => segment.startsWith(part))) {
    return true;
  }
  if (part.length < 2 || part.length > nameSegments.length) {
    return false;
  }

  let nameIndex = 0;
  for (const character of part) {
    while (nameIndex < nameSegments.length && !nameSegments[nameIndex]?.startsWith(character)) {
      nameIndex += 1;
    }
    if (nameIndex >= nameSegments.length) {
      return false;
    }
    nameIndex += 1;
  }
  return true;
}

function subsequenceScore(name: string, query: string): number | null {
  let nameIndex = 0;
  let previous = -1;
  let score = 0;
  for (const character of query) {
    const found = name.indexOf(character, nameIndex);
    if (found < 0) {
      return null;
    }
    if (found === previous + 1) {
      score += 4;
    } else {
      score += 1;
    }
    if (found === 0 || name[found - 1]?.match(SEPARATOR)) {
      score += 3;
    }
    score -= Math.max(0, found - nameIndex);
    previous = found;
    nameIndex = found + 1;
  }
  return score;
}

export function searchProjectTabs(
  targets: ProjectTabSearchTarget[],
  rawQuery: string,
): ProjectTabSearchResult[] {
  const query = normalized(rawQuery.trim());
  if (!query || !querySegments(query).length) {
    return [];
  }

  const results: ProjectTabSearchResult[] = [];
  for (const [index, target] of targets.entries()) {
    const name = normalized(target.name);
    let kind: ProjectTabSearchMatchKind | null = null;
    let score = 0;

    if (name === query) {
      kind = "exact";
      score = 1_000_000;
    } else if (name.startsWith(query)) {
      kind = "prefix";
      score = 900_000 - name.length;
    } else if (segmentPrefixMatch(name, query)) {
      kind = "segment-prefix";
      score = 800_000 - name.length;
    } else {
      const substringIndex = name.indexOf(query);
      if (substringIndex >= 0) {
        kind = "substring";
        score = 600_000 - substringIndex * 100 - name.length;
      } else {
        const sequence = subsequenceScore(name, query);
        if (sequence !== null) {
          kind = "subsequence";
          score = 400_000 + sequence;
        }
      }
    }

    if (kind) {
      // Preserve the configured order when two names have the same score.
      results.push({ kind, score: score - index / 10_000, target });
    }
  }

  return results.toSorted((left, right) => right.score - left.score);
}
