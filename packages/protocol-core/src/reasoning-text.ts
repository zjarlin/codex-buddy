export function reasoningDisplayText(text: string): string {
  let end = text.length;
  while (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code !== 0x0d && code !== 0x0a) {
      break;
    }
    end -= 1;
  }
  return end === text.length ? text : text.slice(0, end);
}

export function appendReasoningDisplayText(
  trailingLineBreaks: string,
  text: string,
): { delta: string; trailingLineBreaks: string } {
  const visible = reasoningDisplayText(text);
  if (visible.length === 0) {
    return { delta: "", trailingLineBreaks: trailingLineBreaks + text };
  }
  return {
    delta: trailingLineBreaks + visible,
    trailingLineBreaks: text.slice(visible.length),
  };
}
