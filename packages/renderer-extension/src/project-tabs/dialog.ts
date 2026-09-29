import type { ProjectTab, ProjectTabsConfig } from "./model.js";
import type { ProjectTabsMessages } from "./messages.js";

export function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

export function openProjectDialog(title: string, onClose: () => void): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("data-codexhost-project-tabs-dialog", "");
  dialog.setAttribute("aria-label", title);
  const heading = document.createElement("h2");
  heading.textContent = title;
  dialog.append(heading);
  const previousFocus = document.activeElement;
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus();
    }
  });
  document.body.append(dialog);
  return dialog;
}

export function configureProjectTabs(options: {
  config: ProjectTabsConfig;
  messages: ProjectTabsMessages;
  save(tabs: ProjectTab[]): Promise<void>;
  onClose(): void;
}): HTMLDialogElement {
  const { messages: m } = options;
  const draft = options.config.tabs.map((tab) => ({ ...tab, prefixes: [...tab.prefixes] }));
  const dialog = openProjectDialog(m.title, options.onClose);
  const form = document.createElement("form");
  const hint = document.createElement("p");
  hint.textContent = `${m.hint} ${m.savedHere}`;
  const rows = document.createElement("div");
  rows.className = "project-tab-rows";
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const renderRows = (): void => {
    rows.replaceChildren();
    for (const [index, tab] of draft.entries()) {
      const row = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = `Tab ${index + 1}`;
      const nameLabel = document.createElement("label");
      nameLabel.textContent = m.name;
      const name = document.createElement("input");
      name.required = true;
      name.maxLength = 80;
      name.value = tab.name;
      name.addEventListener("input", () => {
        tab.name = name.value;
        name.setCustomValidity("");
      });
      nameLabel.append(name);
      const prefixesLabel = document.createElement("label");
      prefixesLabel.textContent = m.prefixes;
      const prefixes = document.createElement("textarea");
      prefixes.rows = 2;
      prefixes.value = tab.prefixes.join("\n");
      prefixes.addEventListener("input", () => {
        tab.prefixes = [
          ...new Set(
            prefixes.value
              .split(/\r?\n/u)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ];
      });
      prefixesLabel.append(prefixes);
      const actions = document.createElement("div");
      actions.className = "project-tab-actions";
      const reorder = (offset: number): void => {
        draft.splice(index, 1);
        draft.splice(index + offset, 0, tab);
        renderRows();
        rows.children[index + offset]?.querySelector("input")?.focus();
      };
      const up = button(m.up, () => reorder(-1));
      up.disabled = index === 0;
      const down = button(m.down, () => reorder(1));
      down.disabled = index === draft.length - 1;
      actions.append(
        up,
        down,
        button(m.remove, () => {
          draft.splice(index, 1);
          renderRows();
          (rows.children[Math.min(index, draft.length - 1)]?.querySelector("input") ?? add).focus();
        }),
      );
      row.append(legend, nameLabel, prefixesLabel, actions);
      rows.append(row);
    }
  };
  const add = button(m.add, () => {
    draft.push({ id: crypto.randomUUID(), name: "", prefixes: [] });
    renderRows();
    rows.lastElementChild?.querySelector("input")?.focus();
  });
  const footer = document.createElement("div");
  footer.className = "project-tab-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = m.save;
  footer.append(
    button(m.cancel, () => dialog.close()),
    save,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const tabs = draft.map((tab) => ({ ...tab, name: tab.name.trim() }));
    const names = new Set<string>();
    for (const [index, tab] of tabs.entries()) {
      const input = rows.children[index]?.querySelector("input");
      if (!tab.name || names.has(tab.name)) {
        if (input) {
          input.setCustomValidity(tab.name ? m.duplicate : m.name);
          input.reportValidity();
        }
        return;
      }
      names.add(tab.name);
    }
    save.disabled = true;
    error.hidden = true;
    void options.save(tabs).then(
      () => dialog.close(),
      (failure: unknown) => {
        save.disabled = false;
        error.textContent = m.failed + String(failure);
        error.hidden = false;
      },
    );
  });
  renderRows();
  form.append(hint, rows, add, error, footer);
  dialog.append(form);
  dialog.showModal();
  return dialog;
}
