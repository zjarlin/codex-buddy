import createElement from "lucide/dist/esm/createElement.mjs";
import Route from "lucide/dist/esm/icons/route.mjs";
import Check from "lucide/dist/esm/icons/check.mjs";
import CircleDashed from "lucide/dist/esm/icons/circle-dashed.mjs";
import CircleAlert from "lucide/dist/esm/icons/circle-alert.mjs";
import ChevronDown from "lucide/dist/esm/icons/chevron-down.mjs";
import type { AutoModelRoute } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";
import { autoRouteMessages } from "./messages.js";
import { autoRouteCardStyle } from "./style.js";

interface Context {
  threadId: string;
  hostId: string;
  root: HTMLElement;
  client: RendererModelClient;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderCard(routes: AutoModelRoute[], locale: string, expanded: boolean): HTMLElement {
  const messages = autoRouteMessages(locale);
  const latest = routes.at(-1);
  if (!latest) throw new Error("Cannot render an empty Auto route group");
  const card = element("aside", "");
  card.dataset.codexhostAutoRoute = latest.turn_id;
  card.dataset.state = latest.state;
  card.setAttribute("aria-label", messages.title);
  const top = element("div", "route-top");
  const heading = element("div", "route-heading");
  const symbol = element("span", "route-symbol");
  symbol.append(createElement(Route, { width: 17, height: 17, "aria-hidden": "true" }));
  heading.append(symbol, element("span", "", messages.title));
  const state = element("span", "route-state");
  const stateIcon =
    latest.state === "completed"
      ? Check
      : latest.state === "failed" || latest.state === "interrupted"
        ? CircleAlert
        : CircleDashed;
  state.append(
    createElement(stateIcon, { width: 14, height: 14, "aria-hidden": "true" }),
    messages[latest.state],
  );
  top.append(heading, state);
  const model = latest.resolved_model ?? latest.attempted_models.at(-1) ?? latest.selected_model;
  const footer = element("div", "route-footer");
  const fallbacks = routes.reduce((total, route) => total + route.attempted_models.length - 1, 0);
  const counts = [messages.requests(routes.length)];
  if (fallbacks > 0) counts.push(messages.fallbacks(fallbacks));
  if (latest.candidates)
    counts.push(
      messages.pool(
        latest.candidates.filter((entry) => entry.eligible).length,
        latest.candidates.length,
      ),
    );
  footer.append(element("span", "route-count", counts.join(" · ")));
  const toggle = element("button", "route-expand");
  toggle.type = "button";
  toggle.title = messages.details;
  toggle.setAttribute("aria-label", messages.details);
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.append(createElement(ChevronDown, { width: 16, height: 16, "aria-hidden": "true" }));
  footer.append(toggle);
  const details = element("div", "route-details");
  const attempts = element("ol", "route-attempts");
  details.hidden = !expanded;
  for (const route of routes) {
    const row = element("li", "");
    const path = [...route.attempted_models];
    if (route.resolved_model && route.resolved_model !== path.at(-1))
      path.push(route.resolved_model);
    const description = element("span", "route-path", path.join(" → "));
    description.append(
      element("div", "route-time", new Date(route.started_at).toLocaleTimeString(locale)),
    );
    row.append(description, element("span", "route-state", messages[route.state]));
    attempts.append(row);
  }
  details.append(attempts);
  if (latest.candidates) {
    const plan = element("section", "route-plan");
    plan.append(element("strong", "", messages.candidates));
    const search = element("input", "route-search");
    search.type = "search";
    search.placeholder = messages.search;
    search.setAttribute("aria-label", messages.search);
    const table = element("table", "route-candidates");
    table.setAttribute("aria-label", messages.candidates);
    const head = table.createTHead().insertRow();
    for (const label of ["#", messages.model, messages.status]) {
      const cell = element("th", "", label);
      cell.scope = "col";
      head.append(cell);
    }
    const body = table.createTBody();
    const empty = element("div", "route-time", messages.noMatches);
    const candidates = [...latest.candidates].sort(
      (a, b) => Number(b.eligible) - Number(a.eligible) || (a.order ?? 0) - (b.order ?? 0),
    );
    const rows = candidates.map((candidate) => {
      const row = body.insertRow();
      row.dataset.eligible = String(candidate.eligible);
      row.insertCell().textContent = candidate.order ? String(candidate.order) : "-";
      const name = row.insertCell();
      name.append(
        element("span", "", candidate.model),
        element("div", "route-time", candidate.platform),
      );
      if (candidate.aliases?.length) name.title = candidate.aliases.join(", ");
      const reason = candidate.reason;
      row.insertCell().textContent = candidate.eligible
        ? messages.eligible
        : (reason && messages.reasons[reason]) || reason || "-";
      return {
        row,
        query: [candidate.model, candidate.platform, ...(candidate.aliases ?? [])]
          .join(" ")
          .toLowerCase(),
      };
    });
    empty.hidden = rows.length > 0;
    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      for (const entry of rows) entry.row.hidden = !entry.query.includes(query);
      empty.hidden = rows.some((entry) => !entry.row.hidden);
    });
    plan.append(search, table, empty);
    details.append(plan);
  }
  toggle.addEventListener("click", () => {
    details.hidden = !details.hidden;
    toggle.setAttribute("aria-expanded", String(!details.hidden));
  });
  card.append(top, element("strong", "route-model", model), footer, details);
  if (!latest.resolved_model && latest.state !== "selected") {
    card.append(element("div", "route-notice", messages.unconfirmed));
  }
  return card;
}

function sameContext(left: Context | null, right: Context | null): boolean {
  return (
    left?.threadId === right?.threadId &&
    left?.hostId === right?.hostId &&
    left?.client === right?.client &&
    left?.root === right?.root
  );
}

function turnAnchors(context: Context, turnIds: Set<string>): Map<string, HTMLElement> {
  const anchors = new Map<string, HTMLElement>();
  for (const turn of context.root.querySelectorAll<HTMLElement>(
    "[data-content-search-turn-key], [data-turn-key]",
  )) {
    const turnId =
      turn.getAttribute("data-content-search-turn-key") ??
      turn.getAttribute("data-turn-key")?.replace(/^history-content:turn:/, "");
    if (!turnId || !turnIds.has(turnId) || anchors.has(turnId)) continue;
    // 原生回合容器使用 display: contents；可见性必须由实际回复节点判断。
    const responses = [
      turn,
      ...turn.querySelectorAll<HTMLElement>("[data-response-annotation-conversation]"),
    ];
    const response = responses.find(
      (node) =>
        node.getAttribute("data-response-annotation-conversation") === context.threadId &&
        node.getClientRects().length > 0,
    );
    if (response) {
      anchors.set(turnId, response);
      continue;
    }
    const annotation = turn.closest<HTMLElement>("[data-response-annotation-conversation]");
    if (
      annotation?.getAttribute("data-response-annotation-conversation") === context.threadId &&
      annotation.getClientRects().length > 0
    ) {
      anchors.set(turnId, annotation);
    }
  }
  return anchors;
}

export function installAutoRouteCards(options: {
  getContext: () => Context | null;
  getLocale: () => string;
}): { dispose(): void } {
  const style = element("style", "");
  style.textContent = autoRouteCardStyle;
  document.head.append(style);
  let context: Context | null = null;
  let routes: AutoModelRoute[] = [];
  let nextRead = 0;
  let reading = false;
  let disposed = false;
  let unavailable = false;
  let generation = 0;
  const cards = new Map<string, { node: HTMLElement; signature: string }>();

  function clear() {
    for (const { node } of cards.values()) node.remove();
    cards.clear();
  }

  function render() {
    if (!context) return;
    const byTurn = new Map<string, AutoModelRoute[]>();
    const unique = new Map(routes.map((route) => [route.request_id, route]));
    for (const route of unique.values()) {
      if (route.session_id !== context.threadId) continue;
      const group = byTurn.get(route.turn_id) ?? [];
      group.push(route);
      byTurn.set(route.turn_id, group);
    }
    for (const [turnId, card] of cards) {
      if (!byTurn.has(turnId) || !card.node.isConnected) {
        card.node.remove();
        cards.delete(turnId);
      }
    }
    const anchors = turnAnchors(context, new Set(byTurn.keys()));
    for (const [turnId, group] of byTurn) {
      const anchor = anchors.get(turnId);
      if (!anchor) continue;
      group.sort((a, b) => a.started_at - b.started_at || a.request_id.localeCompare(b.request_id));
      const locale = options.getLocale();
      const signature = JSON.stringify([group, locale, unavailable]);
      const existing = cards.get(turnId);
      if (existing?.signature === signature && existing.node.parentElement === anchor) continue;
      const expanded =
        existing?.node.querySelector("button")?.getAttribute("aria-expanded") === "true";
      const node = renderCard(group, locale, expanded);
      if (unavailable)
        node.append(element("div", "route-notice", autoRouteMessages(locale).unavailable));
      existing?.node.remove();
      anchor.prepend(node);
      cards.set(turnId, { node, signature });
    }
  }

  async function tick() {
    if (disposed) return;
    const current = options.getContext();
    if (!sameContext(context, current)) {
      context = current;
      generation += 1;
      routes = [];
      nextRead = 0;
      unavailable = false;
      clear();
    }
    if (document.hidden || !context?.client.readAutoModelRoutes) return;
    render();
    if (reading || Date.now() < nextRead) return;
    const requestContext = context;
    const requestGeneration = generation;
    reading = true;
    try {
      const result = await context.client.readAutoModelRoutes(context.threadId);
      if (
        disposed ||
        requestGeneration !== generation ||
        !sameContext(requestContext, options.getContext())
      )
        return;
      routes = result.supported ? result.routes : [];
      unavailable = false;
      nextRead = Date.now() + (result.supported ? 2_000 : 60_000);
      render();
    } catch {
      if (
        disposed ||
        requestGeneration !== generation ||
        !sameContext(requestContext, options.getContext())
      )
        return;
      unavailable = true;
      nextRead = Date.now() + 10_000;
      render();
    } finally {
      reading = false;
    }
  }
  const timer = window.setInterval(() => void tick(), 500);
  return {
    dispose() {
      disposed = true;
      window.clearInterval(timer);
      clear();
      style.remove();
    },
  };
}
