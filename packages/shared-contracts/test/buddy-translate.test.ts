import { describe, expect, it } from "vitest";
import { detectBuddyTranslateSourceLanguage } from "../src/index.js";

describe("translation prose language", () => {
  it.each([
    "3D 是「Qt 宿主 + Web(Three.js) 应用」。拉 RWebThree.dll / ShapeWebThree.dll 与 webview-vs、样例 web3d 资源。",
    "决定性发现：RWebThree 是 QWebEngineView 子类，即 3D 组件 = Qt WebEngine 载入 HTML(Three.js) 页面，C++↔JS 走 QWebChannel：runScript(QString,bool) -> QVariant（执行 JS 取回值）、exeScript(QString)。",
    "资源：/qwebchannel.js、/3rdparty/marked.min.js，反编译 OnInit / runScript 看它载入哪个页面与 JS 接口名。",
    `请检查 ${"verylongidentifier".repeat(100)} 的加载状态。`,
    `请检查 /${"very-long-path/".repeat(100)}QWebEngineView.js 的加载状态。`,
    "检查 `QWebEngineView` 和 `runScript(QString,bool)` 的返回值。",
    "請檢查 RWebThree.dll 與 ShapeWebThree.dll 的載入狀態。",
  ])("recognizes Chinese technical prose: %s", (text) => {
    expect(detectBuddyTranslateSourceLanguage(text)).toBe("zh-CN");
  });

  it.each([
    "Check the QWebEngineView before calling runScript(QString,bool).",
    "Check the setting labelled 中文 before loading RWebThree.dll and ShapeWebThree.dll.",
    "Check the setting labelled `这是一个很长的中文选项` before loading the component.",
    "Read https://example.com/这是文档/QWebEngineView before changing the component.",
  ])("still recognizes English explanations: %s", (text) => {
    expect(detectBuddyTranslateSourceLanguage(text)).toBe("en");
  });

  it.each([
    "```powershell\nGet-NetTCPConnection -State Listen\n```",
    "~~~typescript\nconst value = '中文';\n~~~",
    "`runScript(QString,bool)` /qwebchannel.js /3rdparty/marked.min.js",
    "runScript(QString,bool) -> QVariant, exeScript(QString)",
    "QWebEngineView RWebThree.dll ShapeWebThree.dll",
    "https://example.com/这是文档/QWebEngineView",
  ])("skips code and technical references without prose: %s", (text) => {
    expect(detectBuddyTranslateSourceLanguage(text)).toBeNull();
  });

  it("keeps Japanese and Korean prose recognizable", () => {
    expect(detectBuddyTranslateSourceLanguage("QWebEngineView の設定を確認してください。")).toBe(
      "ja",
    );
    expect(detectBuddyTranslateSourceLanguage("QWebEngineView 설정을 확인하세요.")).toBe("ko");
  });
});

describe("batch translation contract", () => {
  it("accepts a well-formed batch and infers item fields", async () => {
    const { buddyTranslateBatchRequestSchema, buddyTranslateBatchResultSchema } =
      await import("../src/index.js");
    const request = buddyTranslateBatchRequestSchema.parse({
      targetLocale: "zh-CN",
      items: [
        { id: "thread:turn:1", text: "Check the server capacity before choosing a model." },
        { id: "thread:turn:2", text: "Now let me verify the adapter wiring." },
      ],
    });
    expect(request.items).toHaveLength(2);
    const result = buddyTranslateBatchResultSchema.parse({
      items: request.items.map((item) => ({
        id: item.id,
        translated: item.text,
        model: "noop",
        latencyMs: 0,
      })),
    });
    expect(result.items[0]?.id).toBe("thread:turn:1");
  });

  it("rejects empty batches, blank ids and unknown fields", async () => {
    const { buddyTranslateBatchRequestSchema, BUDDY_TRANSLATE_BATCH_MAX_ITEMS } =
      await import("../src/index.js");
    expect(
      buddyTranslateBatchRequestSchema.safeParse({ targetLocale: "zh-CN", items: [] }).success,
    ).toBe(false);
    expect(
      buddyTranslateBatchRequestSchema.safeParse({
        targetLocale: "zh-CN",
        items: [{ id: "", text: "Check the server capacity before choosing a model." }],
      }).success,
    ).toBe(false);
    expect(
      buddyTranslateBatchRequestSchema.safeParse({
        targetLocale: "zh-CN",
        items: [{ id: "a", text: "Check the server capacity.", extra: true }],
      }).success,
    ).toBe(false);
    expect(
      buddyTranslateBatchRequestSchema.safeParse({
        targetLocale: "zh-CN",
        items: Array.from({ length: BUDDY_TRANSLATE_BATCH_MAX_ITEMS + 1 }, (_value, index) => ({
          id: `item-${index}`,
          text: "Check the server capacity before choosing a model.",
        })),
      }).success,
    ).toBe(false);
  });
});
