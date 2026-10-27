const en = {
  translating: "Translating…",
  translated: (model: string, ms: number) => `Translated by ${model} · ${ms}ms`,
  failed: "Translation failed",
  failureDetails: "View failure details",
  unknownError: "The translation service did not provide an error reason.",
  retry: "Retry",
  showOriginal: "Show original",
  showTranslation: "Show translation",
  modelSelect: "Select model",
  imageLabel: "Image text",
  noText: "No readable text in this image.",
};

const zh: typeof en = {
  translating: "翻译中…",
  translated: (model, ms) => `${model} 翻译 · ${ms}ms`,
  failed: "翻译失败",
  failureDetails: "查看失败原因",
  unknownError: "翻译服务未提供具体错误原因。",
  retry: "重试",
  showOriginal: "显示原文",
  showTranslation: "显示译文",
  modelSelect: "选择模型",
  imageLabel: "图片文字",
  noText: "这张图里没有可识别的文字。",
};

export function translateMessages(locale: string) {
  return locale.startsWith("zh") ? zh : en;
}
