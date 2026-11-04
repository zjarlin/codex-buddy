const QUESTION_TITLE_LENGTH = 24;

function textFromInput(input: unknown): string | null {
  if (!Array.isArray(input)) return null;
  const texts = input.flatMap((item) =>
    typeof item === "object" &&
    item !== null &&
    !Array.isArray(item) &&
    item.type === "text" &&
    typeof item.text === "string"
      ? [item.text]
      : [],
  );
  return texts.length > 0 ? texts.join("\n") : null;
}

function requestText(text: string): string {
  const marker = /^## My request:[ \t]*\r?$/mu.exec(text);
  if (!marker || !/^# Files mentioned by the user:[ \t]*\r?$/mu.test(text)) return text;
  const end = marker.index + marker[0].length;
  return text.slice(end).replace(/^\r?\n/u, "");
}

function takeCharacters(value: string, length: number): string {
  let result = "";
  let count = 0;
  for (const character of value) {
    if (count >= length) break;
    result += character;
    count++;
  }
  return result;
}

/** 以用户本次提问的前 24 个字符作为 Thread 名称，附件上下文不参与命名。 */
export function threadQuestionTitle(input: unknown): string | null {
  const text = textFromInput(input);
  if (text === null) return null;
  const normalized = requestText(text).replaceAll(/\s+/gu, " ").trim();
  if (!normalized) return null;
  return takeCharacters(normalized, QUESTION_TITLE_LENGTH).trimEnd();
}
