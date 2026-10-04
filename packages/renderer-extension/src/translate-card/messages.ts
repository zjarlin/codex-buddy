const en = {
  translating: "Translating…",
  translated: (model: string, ms: number) => `Translated by ${model} · ${ms}ms`,
  failed: "Translation failed",
  retry: "Retry",
  showOriginal: "Show original",
  showTranslation: "Show translation",
  modelSelect: "Select model",
};

const zh: typeof en = {
  translating: "翻译中…",
  translated: (model, ms) => `${model} 翻译 · ${ms}ms`,
  failed: "翻译失败",
  retry: "重试",
  showOriginal: "显示原文",
  showTranslation: "显示译文",
  modelSelect: "选择模型",
};

export function translateMessages(locale: string) {
  return locale.startsWith("zh") ? zh : en;
}
