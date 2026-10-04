export function injectTranslateStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.id = "codexhost-translate-style";
  style.textContent = `
.codexhost-translate {
  margin-top: 8px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-primary, #e0e0e0);
  font-size: 14px;
  line-height: 1.6;
}

.codexhost-translate[data-state="loading"] {
  opacity: 0.7;
}

.codexhost-translate-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-tertiary, #666);
}

.codexhost-translate-header svg {
  width: 14px;
  height: 14px;
}

.codexhost-translate-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.codexhost-translate-content code {
  background: var(--bg-tertiary, #e8e8e8);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
}

.codexhost-translate-error {
  color: var(--text-error, #d32f2f);
}

.codexhost-translate-retry {
  margin-left: 8px;
  padding: 2px 8px;
  border: 1px solid var(--border-primary, #ccc);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}

.codexhost-translate-retry:hover {
  background: var(--bg-tertiary, #e8e8e8);
}

.codexhost-translate-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #555);
  cursor: pointer;
  font-size: 12px;
}

.codexhost-translate-toggle:hover {
  color: var(--text-primary, #333);
}

.codexhost-translate-model-select {
  margin-left: auto;
  padding: 2px 6px;
  border: 1px solid var(--border-primary, #ccc);
  border-radius: 4px;
  background: transparent;
  font-size: 12px;
}
`;
  document.head.appendChild(style);
  return style;
}
