import { describe, expect, it } from "vitest";

import type { TeamUsageSnapshot, UsageStatisticsTotals } from "@codexhost/shared-contracts";

import { teamUsageWorkbook } from "../../src/console/usage/team-workbook.js";
import { Workbook, integer, money, ratio } from "../../src/console/usage/xlsx.js";

function totals(costUsd: number): UsageStatisticsTotals {
  return {
    requests: 1,
    inputTokens: 1_000,
    cachedInputTokens: 800,
    cacheWriteInputTokens: 0,
    cacheKnownInputTokens: 800,
    cacheHitCachedInputTokens: 700,
    cacheHitInputTokens: 800,
    outputTokens: 100,
    reasoningOutputTokens: 0,
    costUsd,
    unpricedRequests: 0,
    unmeteredRequests: 0,
  };
}

const snapshot: TeamUsageSnapshot = {
  range: "30d",
  from: "2026-10-09",
  to: "2026-11-07",
  timeZone: "Asia/Shanghai",
  generatedAtMs: 1,
  costBasis: "public-model-price",
  members: [
    {
      id: "local",
      name: "乙",
      department: "销售",
      address: null,
      reachable: true,
      lastSeenAtMs: 1,
      usage: {
        totals: totals(3),
        byHarness: [],
        byModel: [],
        byProject: [{ project: "/work/a", ...totals(3) }],
      },
    },
    {
      id: "8f14e45f-ceea-467a-9f0e-1a2b3c4d5e6f",
      name: "甲",
      department: "研发",
      address: "192.168.1.20:45871",
      reachable: true,
      lastSeenAtMs: 1,
      usage: {
        totals: totals(5),
        byHarness: [],
        byModel: [],
        byProject: [
          { project: "/work/a", ...totals(2) },
          { project: "/work/b", ...totals(3) },
        ],
      },
    },
  ],
};

/**
 * Sheet XML of the `sheet`-th worksheet. The workbook stores its parts uncompressed, so the parts
 * stay in sheet order on the bytes and the XML itself is UTF-8.
 */
function sheetText(bytes: Uint8Array, sheet: number): string {
  return Buffer.from(bytes).toString("utf8").split("<sheetData>")[sheet] ?? "";
}

describe("Excel workbook writer", () => {
  it("keeps numbers numeric with their number formats instead of string cells", () => {
    const book = new Workbook().sheet("Summary", [
      ["metric", "value"],
      ["cost", money(3.5)],
    ]);
    const bytes = book.toBytes();
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("[Content_Types].xml");
    expect(text).toContain("xl/workbook.xml");
    // `t="inlineStr"` marks text; a styled number must not carry it.
    expect(sheetText(bytes, 1)).toContain('<c r="B2" s="3"><v>3.5</v></c>');
    expect(sheetText(bytes, 1)).not.toContain('r="B2" s="3" t="inlineStr"');
  });

  it("styles the headers and percentages the sheets rely on", () => {
    const bytes = new Workbook()
      .sheet("t", [
        ["count", "share"],
        [integer(12), ratio(0.5)],
      ])
      .toBytes();
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain('formatCode="#,##0"');
    expect(text).toContain('formatCode="&quot;$&quot;#,##0.00"');
    expect(sheetText(bytes, 1)).toContain('<c r="B2" s="4"><v>0.5</v></c>');
    expect(sheetText(new Workbook().sheet("t", [["h"]]).toBytes(), 1)).toContain(
      '<c r="A1" s="1" t="inlineStr">',
    );
  });
});

describe("team usage workbook", () => {
  const labels = {
    ranges: { today: "今天", "7d": "7 天", "30d": "30 天", "90d": "90 天", all: "全部" },
    costBasis: "按公开目录价估算",
    unassigned: "未分配",
  };
  const projectName = (key: string | null): string => (key === null ? "未知项目" : key.slice(-1));

  it("has one sheet per question plus the department × project cross-tab", () => {
    const book = teamUsageWorkbook(snapshot, labels, projectName);
    expect(book.size).toBe(7);
    const text = Buffer.from(book.toBytes()).toString("utf8");
    for (const name of [
      "Summary",
      "Members",
      "By Department",
      "Department x Project",
      "Dept x Project cost",
      "By Project",
      "Member x Project",
    ])
      expect(text).toContain(name);
    expect(text).toContain("按公开目录价估算");
  });

  it("cross-tabulates department cost by project with both axis totals", () => {
    const sheet = sheetText(teamUsageWorkbook(snapshot, labels, projectName).toBytes(), 5);
    // Rows are departments by cost; columns are projects by total cost. 研发 spends 2 on a
    // and 3 on b, 销售 spends 3 on a only, so the b cell stays blank instead of becoming zero.
    expect(sheet).toContain("研发");
    expect(sheet).toContain('<c r="B2" s="3"><v>2</v></c>');
    expect(sheet).toContain('<c r="C2" s="3"><v>3</v></c>');
    expect(sheet).toContain('<c r="D2" s="3"><v>5</v></c>');
    expect(sheet).toContain("销售");
    expect(sheet).toContain('<c r="B3" s="3"><v>3</v></c>');
    expect(sheet).toContain('<c r="C3"/>');
    expect(sheet).toContain('<c r="D3" s="3"><v>3</v></c>');
    expect(sheet).toContain("total");
    // The total row repeats each project's column total, then the grand total: a = 2 + 3, b = 3.
    expect(sheet).toContain('<c r="B4" s="3"><v>5</v></c>');
    expect(sheet).toContain('<c r="C4" s="3"><v>3</v></c>');
    expect(sheet).toContain('<c r="D4" s="3"><v>8</v></c>');
  });

  it("names members by their address so two people with one name stay distinguishable", () => {
    const text = Buffer.from(teamUsageWorkbook(snapshot, labels, projectName).toBytes()).toString(
      "utf8",
    );
    expect(text).toContain("甲 (192.168.1.20:45871)");
  });
});
