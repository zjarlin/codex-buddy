import {
  MODEL_FAVORITES_CHANGED,
  readModelFavorites,
  writeModelFavorites,
} from "./renderer-model-favorites.js";
import { createModelFavoriteIcon, ensureModelOptionStyle } from "./renderer-model-option-style.js";
import {
  ensureRendererTriggerChipStyle,
  TRIGGER_CHIP_CLASS,
} from "./renderer-trigger-chip-style.js";

export interface ModelShortcutView {
  models: { id: string; label: string; disabled?: boolean }[];
  selected?: string | undefined;
  disabled?: boolean;
}

export function mountModelShortcuts(onSelect: (id: string) => void | Promise<void>) {
  ensureRendererTriggerChipStyle(document);
  ensureModelOptionStyle(document);
  if (!document.querySelector("[data-codexhost-shortcuts-style]")) {
    const style = document.createElement("style");
    style.dataset.codexhostShortcutsStyle = "true";
    style.textContent = `
      [data-codexhost-model-shortcuts] { display:flex; align-items:center; gap:6px; min-width:0; max-width:100%; padding:6px 0; color:var(--color-text-secondary, inherit); }
      [data-model-shortcut-list] { display:flex; gap:6px; min-width:0; overflow-x:auto; scrollbar-width:thin; }
      [data-codexhost-model-shortcuts] button { flex:none; height:28px; padding:0 9px; font:400 12px/18px system-ui,sans-serif; border:1px solid var(--color-border,rgba(127,127,127,.22)); }
      [data-model-shortcut][aria-pressed=true] { background:var(--color-token-list-hover-background,rgba(127,127,127,.16)); color:var(--color-text-primary,inherit); border-color:var(--color-text-secondary,#85858f); }
      [data-codexhost-model-shortcuts] button:focus-visible { outline:2px solid var(--color-text-primary,#85858f); outline-offset:2px; }
      [data-model-favorites-menu] { box-sizing:border-box; margin:0; padding:10px; border:1px solid var(--color-border,rgba(127,127,127,.25)); border-radius:12px; background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#282828))); color:var(--color-text-primary,CanvasText); color-scheme:inherit; box-shadow:0 8px 24px #0003; font:13px system-ui,sans-serif; }
      [data-model-favorites-menu] input { box-sizing:border-box; width:100%; background:transparent; color:inherit; border:1px solid var(--color-border,#8886); border-radius:7px; padding:7px 9px; margin-bottom:6px; outline-offset:2px; }
      [data-model-favorites-options] { max-height:300px; overflow-y:auto; scrollbar-width:thin; }
      [data-model-favorites-options] button { display:flex; align-items:center; gap:8px; width:100%; padding:7px; background:transparent; color:inherit; border:0; border-radius:6px; text-align:left; cursor:pointer; font:inherit; }
      [data-model-favorites-options] button:hover { background:rgba(127,127,127,.12); }
      [data-model-favorites-options] button[aria-pressed=true] svg { color:#f59e0b; }
      [data-model-favorites-options] span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    `;
    document.head.append(style);
  }
  const root = document.createElement("div");
  root.dataset.codexhostModelShortcuts = "true";
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = TRIGGER_CHIP_CLASS;
  manage.setAttribute("aria-haspopup", "dialog");
  manage.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.dataset.modelShortcutList = "true";
  const error = document.createElement("span");
  error.setAttribute("role", "status");
  error.hidden = true;
  root.append(manage, list, error);
  const menu = document.createElement("div");
  menu.dataset.modelFavoritesMenu = "true";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "dialog");
  const search = document.createElement("input");
  search.type = "search";
  const options = document.createElement("div");
  options.dataset.modelFavoritesOptions = "true";
  menu.append(search, options);
  document.body.append(menu);
  let view: ModelShortcutView = { models: [] };
  let harness = "";
  let chinese = false;
  let signature = "";
  let menuSignature = "";
  let selecting = false;

  const render = (): void => {
    const favorites = readModelFavorites(harness);
    const visibleModels = [...favorites]
      .map((id) => view.models.find((model) => model.id === id))
      .filter((model) => model !== undefined);
    const nextSignature = JSON.stringify([
      visibleModels,
      view.selected,
      view.disabled,
      chinese,
      selecting,
    ]);
    if (nextSignature !== signature) {
      signature = nextSignature;
      list.replaceChildren(
        ...visibleModels.map((model) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = TRIGGER_CHIP_CLASS;
          button.dataset.modelShortcut = model.id;
          button.textContent = model.label;
          button.title = model.id;
          button.setAttribute("aria-pressed", String(view.selected === model.id));
          button.disabled = selecting || view.disabled === true || model.disabled === true;
          return button;
        }),
      );
    }
    if (!menu.matches(":popover-open")) return;
    const query = search.value.trim().toLowerCase();
    const nextMenuSignature = JSON.stringify([view.models, [...favorites], query, chinese]);
    if (nextMenuSignature === menuSignature) return;
    menuSignature = nextMenuSignature;
    const focusId =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.favoriteModelId
        : undefined;
    options.replaceChildren(
      ...view.models
        .filter((model) => `${model.id} ${model.label}`.toLowerCase().includes(query))
        .map((model) => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.favoriteModelId = model.id;
          button.setAttribute("aria-pressed", String(favorites.has(model.id)));
          button.setAttribute(
            "aria-label",
            `${chinese ? (favorites.has(model.id) ? "取消收藏" : "收藏") : favorites.has(model.id) ? "Unfavorite" : "Favorite"} ${model.label}`,
          );
          button.title = model.id;
          const label = document.createElement("span");
          label.textContent = model.label;
          button.append(createModelFavoriteIcon(document), label);
          return button;
        }),
    );
    if (focusId)
      [...options.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.dataset.favoriteModelId === focusId)
        ?.focus({ preventScroll: true });
  };
  manage.addEventListener("click", () => {
    if (menu.matches(":popover-open")) {
      menu.hidePopover();
      return;
    }
    search.value = "";
    menuSignature = "";
    const rect = manage.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    menu.style.top = "auto";
    menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
    menu.style.maxHeight = `${Math.max(120, rect.top - 16)}px`;
    menu.showPopover();
    render();
    search.focus();
  });
  menu.addEventListener("toggle", () =>
    manage.setAttribute("aria-expanded", String(menu.matches(":popover-open"))),
  );
  search.addEventListener("input", render);
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input"]) {
    search.addEventListener(type, (event) => event.stopPropagation());
  }
  options.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-favorite-model-id]")
        : null;
    const id = button?.dataset.favoriteModelId;
    if (!id) return;
    const favorites = readModelFavorites(harness);
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    writeModelFavorites(harness, favorites);
    render();
  });
  list.addEventListener("click", async (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-model-shortcut]")
        : null;
    if (!button?.dataset.modelShortcut || button.disabled) return;
    try {
      selecting = true;
      render();
      error.hidden = true;
      await onSelect(button.dataset.modelShortcut);
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
      error.hidden = false;
    } finally {
      selecting = false;
      render();
    }
  });
  window.addEventListener(MODEL_FAVORITES_CHANGED, render);
  window.addEventListener("storage", render);
  return {
    root,
    update(next: ModelShortcutView, harnessId: string, locale: string) {
      if (harness !== harnessId) {
        menu.hidePopover();
        error.hidden = true;
        harness = harnessId;
        signature = "";
      }
      view = next;
      chinese = locale === "zh-CN";
      const label = chinese ? "收藏模型" : "Favorite models";
      if (manage.textContent !== label) manage.textContent = label;
      menu.setAttribute("aria-label", label);
      search.placeholder = chinese ? "搜索模型…" : "Search models…";
      search.setAttribute("aria-label", search.placeholder);
      manage.disabled = next.models.length === 0;
      render();
    },
    dispose() {
      window.removeEventListener(MODEL_FAVORITES_CHANGED, render);
      window.removeEventListener("storage", render);
      menu.remove();
      root.remove();
    },
  };
}
