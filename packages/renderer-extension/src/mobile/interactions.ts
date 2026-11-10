import {
  MOBILE_SERVER_REQUEST_METHODS,
  isMobileServerRequestMethod,
} from "@codexhost/shared-contracts";

import { h, object, text, type JsonObject } from "./dom.js";

export interface PendingInteraction {
  method: string;
  id: number | string;
  params: JsonObject;
}

export const MOBILE_INTERACTION_METHODS = MOBILE_SERVER_REQUEST_METHODS;
export { isMobileServerRequestMethod };

export function commandDecisionResult(
  decision: "accept" | "acceptForSession" | "decline",
): JsonObject {
  return { decision };
}

export function permissionDecisionResult(requested: JsonObject, allow: boolean): JsonObject {
  if (!allow) return { permissions: {}, scope: "turn" };
  const permissions: JsonObject = {};
  if (requested.network !== undefined) permissions.network = requested.network;
  if (requested.fileSystem !== undefined) permissions.fileSystem = requested.fileSystem;
  return { permissions, scope: "turn" };
}

export function questionAnswerResult(answers: Map<string, string[]>): JsonObject {
  const payload: JsonObject = {};
  for (const [id, values] of answers) payload[id] = { answers: values };
  return { answers: payload };
}

function panel(document: Document, title: string, body: HTMLElement, danger = false): HTMLElement {
  return h(
    document,
    "section",
    { class: danger ? "danger interaction" : "interaction" },
    h(document, "h2", {}, title),
    body,
  );
}

function decisionButtons(
  document: Document,
  onRespond: (result: JsonObject) => void,
  acceptForSession = false,
): HTMLElement {
  const accept = h(document, "button", { type: "button", class: "primary" }, "允许一次");
  accept.addEventListener("click", () => onRespond(commandDecisionResult("accept")));
  if (!acceptForSession) {
    const deny = h(document, "button", { type: "button" }, "拒绝");
    deny.addEventListener("click", () => onRespond(commandDecisionResult("decline")));
    return h(document, "div", { class: "row" }, accept, deny);
  }
  const session = h(document, "button", { type: "button" }, "本会话允许");
  session.addEventListener("click", () => onRespond(commandDecisionResult("acceptForSession")));
  const deny = h(document, "button", { type: "button" }, "拒绝");
  deny.addEventListener("click", () => onRespond(commandDecisionResult("decline")));
  return h(document, "div", { class: "row" }, accept, session, deny);
}

function approvalPanel(
  document: Document,
  title: string,
  value: PendingInteraction,
  onRespond: (result: JsonObject) => void,
): HTMLElement {
  const body = h(document, "div", {});
  if (value.params.command !== undefined) {
    const command = value.params.command;
    body.append(
      h(
        document,
        "pre",
        { class: "detail" },
        typeof command === "string" ? command : JSON.stringify(command, null, 2),
      ),
    );
  }
  const reason = text(value.params.reason);
  if (reason) body.append(h(document, "p", {}, reason));
  if (typeof value.params.grantRoot === "string" && value.params.grantRoot) {
    body.append(h(document, "p", { class: "status" }, `授予目录：${value.params.grantRoot}`));
  }
  body.append(decisionButtons(document, onRespond, true));
  return panel(document, title, body, true);
}

function permissionsPanel(
  document: Document,
  value: PendingInteraction,
  onRespond: (result: JsonObject) => void,
): HTMLElement {
  const body = h(document, "div", {});
  const reason = text(value.params.reason) || text(value.params.message);
  if (reason) body.append(h(document, "p", {}, reason));
  const requested = object(value.params.permissions) ? value.params.permissions : {};
  body.append(
    h(document, "p", { class: "status" }, "本次 Turn 请求以下权限："),
    h(document, "pre", { class: "detail" }, JSON.stringify(requested, null, 2)),
  );
  const allow = h(document, "button", { type: "button", class: "primary" }, "允许本次 Turn");
  allow.addEventListener("click", () => onRespond(permissionDecisionResult(requested, true)));
  const deny = h(document, "button", { type: "button" }, "拒绝");
  deny.addEventListener("click", () => onRespond(permissionDecisionResult(requested, false)));
  body.append(h(document, "div", { class: "row" }, allow, deny));
  return panel(document, "权限审批", body, true);
}

function questionPanel(
  document: Document,
  value: PendingInteraction,
  onRespond: (result: JsonObject) => void,
): HTMLElement {
  const body = h(document, "div", {});
  const answers = new Map<string, string[]>();
  const questions = Array.isArray(value.params.questions) ? value.params.questions : [];
  for (const raw of questions) {
    if (!object(raw)) continue;
    const id = text(raw.id);
    const prompt = text(raw.question);
    const header = text(raw.header);
    const choices = Array.isArray(raw.options) ? raw.options : [];
    body.append(h(document, "p", {}, header ? `${header}：${prompt}` : prompt));
    if (choices.length > 0) {
      const select = h(document, "select", { "aria-label": prompt });
      for (const choice of choices) {
        if (!object(choice)) continue;
        const label = text(choice.label);
        select.append(h(document, "option", { value: label }, label));
      }
      select.addEventListener("change", () => answers.set(id, [select.value]));
      answers.set(id, [select.value]);
      body.append(select);
    } else {
      const field = h(document, "input", {
        type: raw.isSecret === true ? "password" : "text",
        "aria-label": prompt,
      });
      field.addEventListener("input", () => answers.set(id, [field.value]));
      body.append(field);
    }
  }
  const submit = h(document, "button", { type: "button", class: "primary" }, "提交回答");
  submit.addEventListener("click", () => onRespond(questionAnswerResult(answers)));
  const cancel = h(document, "button", { type: "button" }, "取消");
  cancel.addEventListener("click", () => onRespond({ answers: {} }));
  body.append(h(document, "div", { class: "row" }, submit, cancel));
  return panel(document, "需要回答", body);
}

function elicitationPanel(
  document: Document,
  value: PendingInteraction,
  onRespond: (result: JsonObject) => void,
): HTMLElement {
  const body = h(document, "div", {});
  body.append(h(document, "p", {}, text(value.params.message) || "电脑请求你的确认"));
  const schema = object(value.params.requestedSchema) ? value.params.requestedSchema : null;
  const properties = schema && object(schema.properties) ? schema.properties : null;
  const action = properties && object(properties.actionId) ? properties.actionId : null;
  const choices =
    action && Array.isArray(action.oneOf)
      ? action.oneOf.flatMap((choice) =>
          object(choice) && typeof choice.const === "string"
            ? [{ id: choice.const, label: text(choice.title) || choice.const }]
            : [],
        )
      : [];
  if (choices.length > 0) {
    const select = h(document, "select", { "aria-label": "审批选项" });
    for (const choice of choices) {
      select.append(h(document, "option", { value: choice.id }, choice.label));
    }
    body.append(select);
    const accept = h(document, "button", { type: "button", class: "primary" }, "允许");
    accept.addEventListener("click", () =>
      onRespond({ action: "accept", content: { actionId: select.value } }),
    );
    const deny = h(document, "button", { type: "button" }, "拒绝");
    deny.addEventListener("click", () => onRespond({ action: "decline" }));
    body.append(h(document, "div", { class: "row" }, accept, deny));
    return panel(document, "需要确认", body, true);
  }
  const accept = h(document, "button", { type: "button", class: "primary" }, "允许一次");
  accept.addEventListener("click", () => onRespond({ action: "accept", content: {} }));
  const deny = h(document, "button", { type: "button" }, "拒绝");
  deny.addEventListener("click", () => onRespond({ action: "decline" }));
  body.append(h(document, "div", { class: "row" }, accept, deny));
  return panel(document, "需要确认", body, true);
}

export function renderInteraction(
  document: Document,
  value: PendingInteraction,
  position: { index: number; total: number },
  onRespond: (result: JsonObject) => void,
): HTMLElement {
  const rendered = (() => {
    if (value.method === "item/commandExecution/requestApproval") {
      return approvalPanel(document, "命令审批", value, onRespond);
    }
    if (value.method === "item/fileChange/requestApproval") {
      return approvalPanel(document, "文件审批", value, onRespond);
    }
    if (value.method === "item/permissions/requestApproval") {
      return permissionsPanel(document, value, onRespond);
    }
    if (value.method === "item/tool/requestUserInput") {
      return questionPanel(document, value, onRespond);
    }
    return elicitationPanel(document, value, onRespond);
  })();
  rendered.prepend(
    h(document, "p", { class: "status" }, `待处理 ${position.index} / ${position.total}`),
  );
  return rendered;
}
