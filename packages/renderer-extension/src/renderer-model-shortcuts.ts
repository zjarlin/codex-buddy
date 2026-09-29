import { createElement, RefreshCw, X } from "lucide";
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
  mountModelAvailability,
  type ModelAvailabilityCallbacks,
} from "./renderer-model-availability.js";
import {
  ensureRendererTriggerChipStyle,
  TRIGGER_CHIP_CLASS,
} from "./renderer-trigger-chip-style.js";

export interface ModelShortcutView {
  models: { id: string; label: string; disabled?: boolean }[];
  selected?: string | undefined;
  disabled?: boolean;
  supportsCustomModel?: boolean;
  supportsAvailabilityProbe?: boolean;
  unavailableModelIds?: readonly string[];
  refreshing?: boolean;
  error?: string | undefined;
}

export function mountModelShortcuts(
  onSelect: (id: string) => void | Promise<void>,
  onRefresh?: () => ModelRefreshOutcome | Promise<ModelRefreshOutcome>,
  availability?: ModelAvailabilityCallbacks,
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
      [data-model-shortcut-item] { display:inline-flex; align-items:stretch; box-sizing:border-box; min-width:0; max-width:100%; border:1px solid var(--color-border,rgba(127,127,127,.22)); border-radius:9999px; overflow:hidden; }
      [data-model-shortcut-item][data-selected=true] { background:var(--color-token-list-hover-background,rgba(127,127,127,.16)); color:var(--color-text-primary,inherit); border-color:var(--color-text-secondary,#85858f); }
      [data-model-shortcut-item]:focus-within { outline:2px solid var(--color-text-primary,#85858f); outline-offset:2px; }
      [data-codexhost-model-shortcuts] [data-model-shortcut-item] button { border:0; border-radius:0; background:transparent; }
      [data-codexhost-model-shortcuts] [data-model-shortcut] { flex:0 1 auto; min-width:0; max-width:100%; height:auto; min-height:26px; padding-block:4px; white-space:normal; overflow-wrap:anywhere; }
      [data-codexhost-model-shortcuts] [data-model-shortcut-remove] { display:inline-flex; align-items:center; justify-content:center; flex:none; width:26px; height:auto; padding:0 6px 0 2px; cursor:pointer; }
      [data-codexhost-model-shortcuts] [data-model-shortcut-remove]:hover:not(:disabled) { background:rgba(127,127,127,.12); }
      [data-model-shortcut-remove] svg { pointer-events:none; }
      [data-model-shortcut-remove]:disabled { opacity:.5; cursor:default; }
      [data-codexhost-model-shortcuts] button:focus-visible { outline:2px solid var(--color-text-primary,#85858f); outline-offset:2px; }
      [data-model-favorites-menu] { box-sizing:border-box; margin:0; padding:10px; border:1px solid var(--color-border,rgba(127,127,127,.25)); border-radius:12px; background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#282828))); color:var(--color-text-primary,CanvasText); color-scheme:inherit; box-shadow:0 8px 24px #0003; font:13px system-ui,sans-serif; }
      [data-model-favorites-menu]:popover-open { display:flex; flex-direction:column; overflow-y:auto; }
      [data-model-favorites-menu] > :not([data-model-favorites-options]) { flex-shrink:0; }
      [data-model-favorites-menu] input { box-sizing:border-box; width:100%; background:transparent; color:inherit; border:1px solid var(--color-border,#8886); border-radius:7px; padding:7px 9px; margin-bottom:6px; outline-offset:2px; }
      [data-model-favorites-options] { flex:1 1 auto; min-height:0; max-height:300px; overflow-y:auto; scrollbar-width:thin; }
      [data-model-favorites-options] button { display:flex; align-items:center; gap:8px; width:100%; padding:7px; background:transparent; color:inherit; border:0; border-radius:6px; text-align:left; cursor:pointer; font:inherit; }
      [data-model-favorites-options] button:hover { background:rgba(127,127,127,.12); }
      [data-model-favorites-options] button[aria-pressed=true] svg { color:#f59e0b; }
      [data-model-favorites-options] span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      [data-model-missing-hint] { margin-left:6px; font:11px/16px system-ui,sans-serif; color:var(--color-text-secondary,inherit); }
      [data-model-custom-actions] { display:flex; gap:6px; margin-bottom:6px; }
      [data-model-custom-actions][hidden] { display:none; }
      [data-model-custom-actions] button { padding:5px 9px; border:1px solid var(--color-border,#8886); border-radius:6px; background:transparent; color:inherit; cursor:pointer; font:inherit; }
      [data-model-favorites-menu] button:disabled { opacity:.5; cursor:default; }
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
      [data-model-availability] { display:grid; gap:6px; margin-bottom:8px; }
      [data-model-availability][hidden] { display:none; }
      [data-model-availability] button { padding:5px 8px; border:1px solid var(--color-border,#8886); border-radius:6px; background:transparent; color:inherit; font:inherit; cursor:pointer; }
      [data-model-availability] [role=tablist] { display:flex; gap:4px; }
      [data-model-availability] [role=tab] { flex:1; padding-inline:3px; font-size:12px; }
      [data-model-availability] [aria-selected=true] { background:var(--color-token-list-hover-background,rgba(127,127,127,.16)); }
      [data-model-availability-summary] { color:var(--color-text-secondary,inherit); font-size:11px; }
      [data-model-availability-error], [data-model-availability-reason] { color:var(--color-text-danger,#e47777); font-size:11px; overflow-wrap:anywhere; }
      [data-model-favorites-options] [data-model-availability-reason] { display:block; margin-top:3px; white-space:normal; }
      [data-model-favorites-options] [data-model-option-label] { flex:1; min-width:0; }
      [data-model-favorites-menu] button:focus-visible, [data-model-favorites-options]:focus-visible { outline:2px solid var(--color-text-primary,#85858f); outline-offset:2px; }
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
  const customActions = document.createElement("div");
  customActions.dataset.modelCustomActions = "true";
  const useId = document.createElement("button");
  useId.type = "button";
  const pinId = document.createElement("button");
  pinId.type = "button";
  customActions.append(useId, pinId);
  menu.append(header, customActions, menuError, menuStatus, options);
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
  const probeState = mountModelAvailability(
    availability,
    options,
    () => render(),
    () => [...view.models.map((model) => model.id), ...readModelFavorites(harness)],
  );
  customActions.after(probeState.root);

  const isDisabled = (): boolean =>
    selecting || refreshing || view.refreshing === true || view.disabled === true;
  const canSelect = (id: string): boolean => {
    const model = view.models.find((entry) => entry.id === id);
    return (
      !!id &&
      !isDisabled() &&
      !view.unavailableModelIds?.includes(id) &&
      (model ? !model.disabled : view.supportsCustomModel === true)
    );
  };
  const missingHint = (): HTMLElement => {
    const hint = document.createElement("small");
    hint.dataset.modelMissingHint = "true";
    hint.textContent = chinese ? "目录未列出" : "Not in catalog";
    return hint;
  };

  const render = (): void => {
    const busy = refreshing || view.refreshing === true;
    const favorites = readModelFavorites(harness);
    probeState.update({
      enabled: view.supportsAvailabilityProbe === true,
      chinese,
      disabled: isDisabled(),
      modelIds: [
        ...view.models.map((model) => model.id),
        ...favorites,
        ...(probeState.snapshot?.results.map((result) => result.id) ?? []),
      ],
    });
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
      button.disabled = busy || probeState.probing || selecting || view.disabled === true;
    }
    for (const status of [error, menuError]) {
      status.textContent = failure ?? view.error ?? "";
      status.hidden = !status.textContent;
    }
    for (const statusElement of [successStatus, menuStatus]) {
      statusElement.textContent = success ?? "";
      statusElement.hidden = !statusElement.textContent;
    }
    const catalog = new Map(view.models.map((model) => [model.id, model]));
    const visibleModels = [...favorites]
      .map((id) => catalog.get(id) ?? { id, label: id })
      .sort((a, b) =>
        a.label.localeCompare(b.label, chinese ? "zh-CN" : "en", {
          numeric: true,
          sensitivity: "base",
        }),
      );
    const nextSignature = JSON.stringify([
      visibleModels.map((model) => [model, catalog.has(model.id)]),
      view.selected,
      view.disabled,
      view.supportsCustomModel,
      view.unavailableModelIds,
      chinese,
      selecting,
      busy,
    ]);
    if (nextSignature !== signature) {
      signature = nextSignature;
      list.replaceChildren(
        ...visibleModels.map((model) => {
          const item = document.createElement("span");
          item.dataset.modelShortcutItem = model.id;
          item.dataset.selected = String(view.selected === model.id);
          const button = document.createElement("button");
          button.type = "button";
          button.className = TRIGGER_CHIP_CLASS;
          button.dataset.modelShortcut = model.id;
          button.textContent = model.label;
          button.title = model.id;
          button.setAttribute("aria-label", model.label);
          if (!catalog.has(model.id)) {
            button.append(missingHint());
          }
          button.setAttribute("aria-pressed", String(view.selected === model.id));
          button.disabled = !canSelect(model.id);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.dataset.modelShortcutRemove = model.id;
          remove.setAttribute(
            "aria-label",
            `${chinese ? "取消收藏" : "Unfavorite"} ${model.label}`,
          );
          remove.title = remove.getAttribute("aria-label") ?? "";
          remove.disabled = isDisabled();
          remove.append(createElement(X, { width: 13, height: 13, "aria-hidden": "true" }));
          item.append(button, remove);
          return item;
        }),
      );
    }
    const disabled = isDisabled();
    manage.disabled =
      disabled ||
      (!view.models.length && !favorites.size && !view.supportsCustomModel && !probeState.enabled);
    search.disabled = disabled;
    customActions.hidden = view.supportsCustomModel !== true;
    const id = search.value.trim();
    useId.textContent = chinese ? "使用此 ID" : "Use this ID";
    pinId.textContent = chinese ? "Pin 此 ID" : "Pin this ID";
    useId.disabled = !canSelect(id);
    pinId.disabled = disabled || !id || favorites.has(id);
    if (!menu.matches(":popover-open")) {
      return;
    }
    const query = id.toLowerCase();
    const nextMenuSignature = JSON.stringify([
      view.models,
      [...favorites],
      query,
      chinese,
      disabled,
      probeState.enabled,
      probeState.snapshot,
      probeState.activeTab,
    ]);
    if (nextMenuSignature === menuSignature) {
      return;
    }
    menuSignature = nextMenuSignature;
    const focusId =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.favoriteModelId
        : undefined;
    const menuModels = new Map([
      ...view.models.map((model) => [model.id, model] as const),
      ...visibleModels
        .filter((model) => !catalog.has(model.id))
        .map((model) => [model.id, model] as const),
    ]);
    if (probeState.enabled) {
      for (const result of probeState.snapshot?.results ?? []) {
        if (!menuModels.has(result.id)) {
          menuModels.set(result.id, { id: result.id, label: result.id });
        }
      }
    }
    options.replaceChildren(
      ...[...menuModels.values()]
        .filter((model) => probeState.matches(model.id))
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
          button.disabled = disabled;
          const label = document.createElement("span");
          label.dataset.modelOptionLabel = "true";
          label.textContent = model.label;
          button.append(createModelFavoriteIcon(document), label);
          const reason = probeState.failureReason(model.id);
          if (reason) {
            const hint = document.createElement("small");
            hint.dataset.modelAvailabilityReason = "true";
            hint.textContent = reason;
            label.append(hint);
            button.title = `${model.id}\n${reason}`;
          }
          if (!catalog.has(model.id)) {
            button.append(missingHint());
          }
          return button;
        }),
    );
    if (focusId)
      [...options.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.dataset.favoriteModelId === focusId)
        ?.focus({ preventScroll: true });
  };
  manage.addEventListener("click", () => {
    if (manage.disabled) {
      return;
    }
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
    void probeState.read();
  });
  menu.addEventListener("toggle", () =>
    manage.setAttribute("aria-expanded", String(menu.matches(":popover-open"))),
  );
  search.addEventListener("input", render);
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input"]) {
    menu.addEventListener(type, (event) => event.stopPropagation());
  }
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
    }
  });
  options.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-favorite-model-id]")
        : null;
    const id = button?.dataset.favoriteModelId;
    if (!id || button.disabled || isDisabled()) {
      return;
    }
    const favorites = readModelFavorites(harness);
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    writeModelFavorites(harness, favorites);
    render();
  });
  const select = async (id: string): Promise<void> => {
    if (!canSelect(id)) {
      return;
    }
    const request = generation;
    try {
      selecting = true;
      failure = undefined;
      success = undefined;
      render();
      await onSelect(id);
      if (request === generation && view.selected === id && !view.error) {
        success = chinese ? `已选择 ${id}，下次发送生效` : `Selected ${id} for the next message`;
      }
    } catch (cause) {
      if (request === generation) failure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (request === generation) {
        selecting = false;
        render();
      }
    }
  };
  list.addEventListener("click", (event) => {
    const remove =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-model-shortcut-remove]")
        : null;
    const removeId = remove?.dataset.modelShortcutRemove;
    if (removeId) {
      if (!remove.disabled && !isDisabled()) {
        const favorites = readModelFavorites(harness);
        favorites.delete(removeId);
        writeModelFavorites(harness, favorites);
        render();
      }
      return;
    }
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-model-shortcut]")
        : null;
    if (button?.dataset.modelShortcut && !button.disabled) {
      void select(button.dataset.modelShortcut);
    }
  });
  useId.addEventListener("click", () => {
    if (view.supportsCustomModel && !useId.disabled) {
      void select(search.value.trim());
    }
  });
  pinId.addEventListener("click", () => {
    const id = search.value.trim();
    if (!view.supportsCustomModel || !id || isDisabled() || pinId.disabled) {
      return;
    }
    const favorites = readModelFavorites(harness);
    favorites.add(id);
    writeModelFavorites(harness, favorites);
    render();
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
        probeState.reset();
        menu.hidePopover();
        failure = undefined;
        success = undefined;
        selecting = false;
        refreshing = false;
        harness = harnessId;
        context = contextId;
        signature = "";
        menuSignature = "";
        search.value = "";
      }
      view = next;
      chinese = locale === "zh-CN";
      const label = chinese ? "收藏模型" : "Favorite models";
      if (manage.textContent !== label) manage.textContent = label;
      menu.setAttribute("aria-label", label);
      search.placeholder = next.supportsCustomModel
        ? chinese
          ? "搜索或输入模型 ID…"
          : "Search or enter a model ID…"
        : chinese
          ? "搜索模型…"
          : "Search models…";
      search.setAttribute("aria-label", search.placeholder);
      render();
    },
    dispose() {
      generation++;
      probeState.reset();
      window.removeEventListener(MODEL_FAVORITES_CHANGED, render);
      window.removeEventListener("storage", render);
      menu.remove();
      root.remove();
    },
  };
}
