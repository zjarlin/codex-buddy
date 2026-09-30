import createElement from "lucide/dist/esm/createElement.mjs";
import Search from "lucide/dist/esm/icons/search.mjs";
import type { ProjectTabsMessages } from "./messages.js";
import {
  searchProjectTabs,
  type ProjectTabSearchResult,
  type ProjectTabSearchTarget,
} from "./search-model.js";

const ROOT = "data-codexhost-project-tab-search";
const PICKER = "data-codexhost-project-tab-search-picker";
const OPTION = "data-codexhost-project-tab-search-option";

export function createProjectTabSearch(options: {
  getCurrent(): string | null;
  select(id: string | null): void;
}): {
  button: HTMLButtonElement;
  update(targets: ProjectTabSearchTarget[], messages: ProjectTabsMessages): void;
  handleKeyDown(event: KeyboardEvent): boolean;
  dispose(): void;
} {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(ROOT, "");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-keyshortcuts", "/");
  button.append(createElement(Search, { width: 16, height: 16, "aria-hidden": "true" }));

  const picker = document.createElement("div");
  picker.setAttribute(PICKER, "");
  picker.setAttribute("role", "dialog");
  picker.hidden = true;

  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");

  const heading = document.createElement("div");
  heading.className = "project-tab-search-heading";
  const list = document.createElement("div");
  list.className = "project-tab-search-list";
  list.id = `${PICKER}-list`;
  list.setAttribute("role", "listbox");
  const empty = document.createElement("p");
  empty.className = "project-tab-search-empty";
  empty.hidden = true;
  const hint = document.createElement("div");
  hint.className = "project-tab-search-hint";
  picker.append(input, heading, list, empty, hint);
  document.body.append(picker);

  let targets: ProjectTabSearchTarget[] = [];
  let messages: ProjectTabsMessages | null = null;
  let results: ProjectTabSearchResult[] = [];
  let selected = 0;
  let open = false;
  let returnFocus: HTMLElement | null = null;

  const position = (): void => {
    const bounds = button.getBoundingClientRect();
    const width = Math.min(360, Math.max(240, window.innerWidth - 24));
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
    const below = bounds.bottom + 6;
    const availableBelow = window.innerHeight - below - 8;
    picker.style.width = `${width}px`;
    picker.style.left = `${left}px`;
    picker.style.top = `${Math.max(8, below)}px`;
    picker.style.maxHeight = `${Math.max(140, Math.min(420, availableBelow))}px`;
  };

  const optionElements = (): HTMLButtonElement[] => [
    ...list.querySelectorAll<HTMLButtonElement>(`[${OPTION}]`),
  ];

  const close = (restoreFocus = true): void => {
    if (!open) return;
    open = false;
    const hadPickerFocus = picker.contains(document.activeElement);
    picker.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus && returnFocus?.isConnected) {
      returnFocus.focus();
    } else if (hadPickerFocus && button.isConnected) {
      // Keep focus in the sidebar so the "/" shortcut stays available.
      button.focus();
    }
    returnFocus = null;
  };

  const choose = (index: number): void => {
    const target = results[index]?.target;
    if (!target) return;
    close(false);
    options.select(target.id);
  };

  const render = (): void => {
    if (!messages) return;
    const query = input.value.trim();
    results = query
      ? searchProjectTabs(targets, query)
      : targets.map((target) => ({ target, kind: "prefix" as const, score: 0 }));
    const currentId = options.getCurrent();
    const currentIndex = results.findIndex((result) => result.target.id === currentId);
    if (selected < 0 || selected >= results.length) {
      selected = currentIndex >= 0 ? currentIndex : 0;
    }
    list.replaceChildren();
    for (const [index, result] of results.entries()) {
      const item = document.createElement("button");
      item.type = "button";
      item.id = `${PICKER}-option-${index}`;
      item.setAttribute(OPTION, "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === selected));
      item.className = "project-tab-search-option";
      const name = document.createElement("span");
      name.className = "project-tab-search-name";
      name.textContent = result.target.name;
      item.append(name);
      if (result.target.id === currentId) {
        const current = document.createElement("span");
        current.className = "project-tab-search-current";
        current.textContent = messages.current;
        item.append(current);
      }
      item.addEventListener("click", () => choose(index));
      list.append(item);
    }
    empty.textContent = messages.searchEmpty;
    empty.hidden = results.length > 0;
    input.setAttribute(
      "aria-activedescendant",
      results.length ? `${PICKER}-option-${selected}` : "",
    );
    input.setAttribute("aria-controls", list.id);
  };

  const move = (offset: number): void => {
    if (!results.length) return;
    selected = (selected + offset + results.length) % results.length;
    render();
    optionElements()[selected]?.scrollIntoView({ block: "nearest" });
  };

  const openPicker = (): void => {
    if (open) return;
    open = true;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.value = "";
    selected = -1;
    position();
    render();
    picker.hidden = false;
    button.setAttribute("aria-expanded", "true");
    input.focus();
  };

  const onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      selected = 0;
      render();
      optionElements()[0]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      selected = Math.max(0, results.length - 1);
      render();
      optionElements().at(-1)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" && !event.repeat && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      choose(selected);
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!open) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (picker.contains(target) || button.contains(target))) return;
    close(false);
  };

  const onViewportChange = (): void => {
    if (open) position();
  };

  button.addEventListener("click", () => {
    if (open) close();
    else openPicker();
  });
  input.addEventListener("keydown", onInputKeyDown);
  input.addEventListener("input", () => {
    selected = 0;
    render();
  });
  picker.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);

  return {
    button,
    update(nextTargets, nextMessages) {
      targets = nextTargets.map((target) => ({ ...target }));
      messages = nextMessages;
      button.setAttribute("aria-label", nextMessages.searchTabs);
      button.title = nextMessages.searchTabs;
      picker.setAttribute("aria-label", nextMessages.searchTabs);
      input.placeholder = nextMessages.searchPlaceholder;
      input.setAttribute("aria-label", nextMessages.searchPlaceholder);
      heading.textContent = nextMessages.searchTabs;
      hint.textContent = nextMessages.searchHint;
      if (open) render();
    },
    handleKeyDown(event) {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return true;
      }
      if (
        event.key !== "/" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing
      ) {
        return false;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target?.closest("#app-shell-sidebar") ||
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      openPicker();
      return true;
    },
    dispose() {
      close(false);
      input.removeEventListener("keydown", onInputKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      picker.remove();
    },
  };
}
