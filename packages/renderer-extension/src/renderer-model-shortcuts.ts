import { createElement, RefreshCw } from "lucide";
import {
  MODEL_FAVORITES_CHANGED,
  readModelFavorites,
  writeModelFavorites,
} from "./renderer-model-favorites.js";
import {
  modelRefreshFallbackMessage,
  modelRefreshMessage,
  summarizeModelRefresh,
  type ModelRefreshOutcome,
} from "./renderer-model-refresh-summary.js";
import { createModelFavoriteIcon, ensureModelOptionStyle } from "./renderer-model-option-style.js";
import {
  ensureRendererTriggerChipStyle,
  TRIGGER_CHIP_CLASS,
} from "./renderer-trigger-chip-style.js";

export interface ModelShortcutView {
  models: { id: string; label: string; disabled?: boolean }[];
  selected?: string | undefined;
  disabled?: boolean;
  refreshing?: boolean;
  error?: string | undefined;
}

export function mountModelShortcuts(
  onSelect: (id: string) => void | Promise<void>,
  onRefresh?: () => ModelRefreshOutcome | Promise<ModelRefreshOutcome>,
) {
  ensureRendererTriggerChipStyle(document);
  ensureModelOptionStyle(document);
  if (!document.querySelector("[data-codexhost-shortcuts-style]")) {
    const style = document.createElement("style");
    style.dataset.codexhostShortcutsStyle = "true";
    style.textContent = `
      [data-codexhost-model-shortcuts] { display:flex; flex-wrap:wrap; align-items:center; gap:6px; box-sizing:border-box; width:100%; min-width:0; max-width:100%; align-self:stretch; padding:6px 0; color:var(--color-text-secondary, inherit); }
      [data-model-shortcut-list] { display:contents; }
      [data-codexhost-model-shortcuts] button { flex:none; height:28px; padding:0 9px; font:400 12px/18px system-ui,sans-serif; border:1px solid var(--color-border,rgba(127,127,127,.22)); }
      [data-codexhost-model-shortcuts] [data-model-shortcut] { min-width:0; max-width:100%; height:auto; min-height:28px; padding-block:4px; white-space:normal; overflow-wrap:anywhere; }
      [data-model-shortcut][aria-pressed=true] { background:var(--color-token-list-hover-background,rgba(127,127,127,.16)); color:var(--color-text-primary,inherit); border-color:var(--color-text-secondary,#85858f); }
      [data-codexhost-model-shortcuts] button:focus-visible { outline:2px solid var(--color-text-primary,#85858f); outline-offset:2px; }
      [data-model-favorites-menu] { box-sizing:border-box; margin:0; padding:10px; border:1px solid var(--color-border,rgba(127,127,127,.25)); border-radius:12px; background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#282828))); color:var(--color-text-primary,CanvasText); color-scheme:inherit; box-shadow:0 8px 24px #0003; font:13px system-ui,sans-serif; }
      [data-model-favorites-menu] input { box-sizing:border-box; width:100%; background:transparent; color:inherit; border:1px solid var(--color-border,#8886); border-radius:7px; padding:7px 9px; margin-bottom:6px; outline-offset:2px; }
      [data-model-favorites-options] { max-height:300px; overflow-y:auto; scrollbar-width:thin; }
      [data-model-favorites-options] button { display:flex; align-items:center; gap:8px; width:100%; padding:7px; background:transparent; color:inherit; border:0; border-radius:6px; text-align:left; cursor:pointer; font:inherit; }
      [data-model-favorites-options] button:hover { background:rgba(127,127,127,.12); }
      [data-model-favorites-options] button[aria-pressed=true] svg { color:#f59e0b; }
      [data-model-favorites-options] span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      [data-model-favorites-header] { display:flex; align-items:center; gap:6px; }
      [data-model-favorites-header] input { flex:1; min-width:0; }
      [data-model-shortcuts-refresh] { display:inline-flex; align-items:center; justify-content:center; flex:none; color:inherit; background:transparent; border:1px solid var(--color-border,rgba(127,127,127,.22)); border-radius:6px; width:28px; height:28px; cursor:pointer; }
      [data-model-shortcuts-refresh]:disabled { opacity:.5; cursor:default; }
      [data-model-shortcuts-refresh][hidden] { display:none; }
      [data-codexhost-model-shortcuts] [data-model-shortcuts-refresh] { padding:0; }
      [data-model-shortcuts-error] { color:var(--color-text-danger,#e47777); font:12px/18px system-ui,sans-serif; overflow-wrap:anywhere; }
      [data-model-shortcuts-status] { color:var(--color-text-secondary,inherit); font:12px/18px system-ui,sans-serif; overflow-wrap:anywhere; }
      [data-codexhost-model-shortcuts] [data-model-shortcuts-error] { min-width:0; }
      [data-codexhost-model-shortcuts] [data-model-shortcuts-status] { min-width:0; }
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
  error.dataset.modelShortcutsError = "true";
  error.hidden = true;
  const successStatus = document.createElement("span");
  successStatus.setAttribute("role", "status");
  successStatus.dataset.modelShortcutsStatus = "true";
  successStatus.hidden = true;
  const createRefreshButton = () => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.modelShortcutsRefresh = "true";
    button.hidden = !onRefresh;
    button.append(createElement(RefreshCw, { width: 14, height: 14, "aria-hidden": "true" }));
    return button;
  };
  const refresh = createRefreshButton();
  const menuRefresh = createRefreshButton();
  const refreshButtons = [refresh, menuRefresh];
  root.append(manage, refresh, list, error, successStatus);
  const menu = document.createElement("div");
  menu.dataset.modelFavoritesMenu = "true";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "dialog");
  const search = document.createElement("input");
  search.type = "search";
  const options = document.createElement("div");
  options.dataset.modelFavoritesOptions = "true";
  const header = document.createElement("div");
  header.dataset.modelFavoritesHeader = "true";
  header.append(search, menuRefresh);
  const menuError = error.cloneNode() as HTMLSpanElement;
  const menuStatus = successStatus.cloneNode() as HTMLSpanElement;
  menu.append(header, menuError, menuStatus, options);
  document.body.append(menu);
  let view: ModelShortcutView = { models: [] };
  let harness = "";
  let chinese = false;
  let signature = "";
  let menuSignature = "";
  let selecting = false;
  let refreshing = false;
  let failure: string | undefined;
  let success: string | undefined;
  let generation = 0;
  let context = "";

  const render = (): void => {
    const busy = refreshing || view.refreshing === true;
    const refreshLabel = chinese
      ? busy
        ? "正在刷新模型…"
        : "刷新模型"
      : busy
        ? "Refreshing models…"
        : "Refresh models";
    for (const button of refreshButtons) {
      button.title = refreshLabel;
      button.setAttribute("aria-label", refreshLabel);
      button.setAttribute("aria-busy", String(busy));
      button.disabled = busy || selecting || view.disabled === true;
    }
    for (const status of [error, menuError]) {
      status.textContent = failure ?? view.error ?? "";
      status.hidden = !status.textContent;
    }
    for (const statusElement of [successStatus, menuStatus]) {
      statusElement.textContent = success ?? "";
      statusElement.hidden = !statusElement.textContent;
    }
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
      busy,
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
          button.disabled = selecting || busy || view.disabled === true || model.disabled === true;
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
    const request = generation;
    try {
      selecting = true;
      failure = undefined;
      render();
      await onSelect(button.dataset.modelShortcut);
    } catch (cause) {
      if (request === generation) failure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (request === generation) {
        selecting = false;
        render();
      }
    }
  });
  for (const button of refreshButtons) {
    button.addEventListener("click", async () => {
      if (!onRefresh || button.disabled) return;
      const request = generation;
      refreshing = true;
      failure = undefined;
      success = undefined;
      render();
      try {
        const before = view.models;
        const outcome = await onRefresh();
        if (request === generation) {
          success = outcome
            ? modelRefreshMessage(summarizeModelRefresh(before, view.models, outcome), chinese)
            : modelRefreshFallbackMessage(chinese);
        }
      } catch (cause) {
        if (request === generation)
          failure = cause instanceof Error ? cause.message : String(cause);
      } finally {
        if (request === generation) {
          refreshing = false;
          render();
        }
      }
    });
  }
  window.addEventListener(MODEL_FAVORITES_CHANGED, render);
  window.addEventListener("storage", render);
  return {
    root,
    update(next: ModelShortcutView, harnessId: string, locale: string, contextId = harnessId) {
      if (harness !== harnessId || context !== contextId) {
        generation++;
        menu.hidePopover();
        failure = undefined;
        success = undefined;
        selecting = false;
        refreshing = false;
        harness = harnessId;
        context = contextId;
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
      generation++;
      window.removeEventListener(MODEL_FAVORITES_CHANGED, render);
      window.removeEventListener("storage", render);
      menu.remove();
      root.remove();
    },
  };
}
