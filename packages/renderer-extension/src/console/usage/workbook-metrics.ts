import { inputWithoutCache, type Totals } from "./format.js";
import { integer, money, ratio, type Cell } from "./xlsx.js";

/** Metric columns shared by every workbook sheet, so Excel can sum each column natively. */
export const METRIC_HEADER = [
  "requests",
  "input_without_cache",
  "cache_read",
  "cache_write",
  "output",
  "reasoning",
  "cache_hit_rate",
  "cost_usd",
  "unpriced_requests",
  "unmetered_requests",
] as const;

/** One row of `METRIC_HEADER`, in the same order, keeping numbers numeric. */
export function metricCells(row: Totals): Cell[] {
  const metered = row.requests - row.unmeteredRequests;
  const priced = metered - row.unpricedRequests;
  return [
    integer(row.requests),
    integer(inputWithoutCache(row)),
    integer(row.cachedInputTokens),
    integer(row.cacheWriteInputTokens),
    integer(row.outputTokens),
    integer(row.reasoningOutputTokens),
    row.cacheHitInputTokens > 0
      ? ratio(row.cacheHitCachedInputTokens / row.cacheHitInputTokens)
      : null,
    priced > 0 ? money(row.costUsd) : null,
    integer(row.unpricedRequests),
    integer(row.unmeteredRequests),
  ];
}
