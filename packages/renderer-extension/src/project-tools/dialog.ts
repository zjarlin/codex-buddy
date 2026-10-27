import createElement from "lucide/dist/esm/createElement.mjs";
import Copy from "lucide/dist/esm/icons/copy.mjs";
import Plus from "lucide/dist/esm/icons/plus.mjs";
import Trash2 from "lucide/dist/esm/icons/trash-2.mjs";
import type { ProjectToolBinding } from "@codexhost/shared-contracts";

import type { SidebarProject } from "../project-tabs/model.js";
import type { ProjectCustomScriptDraft, ProjectToolDraft } from "./model.js";
import type { projectToolLabels } from "./model.js";

type Labels = ReturnType<typeof projectToolLabels>;

function actionButton(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

function field(
  labelText: string,
  value: string,
  placeholder: string,
): {
  label: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const label = document.createElement("label");
  const text = document.createElement("span");
  text.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.value = value;
  input.placeholder = placeholder;
  label.append(text, input);
  return { label, input };
}

function urlField(
  labelText: string,
  value: string,
): {
  label: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const result = field(labelText, value, "http://192.168.31.252:48201/");
  result.input.type = "url";
  result.input.inputMode = "url";
  return result;
}

export function configureProjectTools(options: {
  project: SidebarProject;
  binding: ProjectToolBinding | null;
  metadataPath: string | null;
  projectPath: string | null;
  labels: Labels;
  save(draft: ProjectToolDraft): Promise<void>;
  remove(): Promise<void>;
  onClose(): void;
}): HTMLDialogElement {
  const { labels } = options;
  const dialog = document.createElement("dialog");
  dialog.setAttribute("data-codexhost-project-tools-dialog", "");
  dialog.setAttribute("aria-label", labels.title);
  const heading = document.createElement("h2");
  heading.textContent = labels.title;
  const description = document.createElement("p");
  description.textContent = `${options.project.label} · ${labels.description}`;
  const form = document.createElement("form");
  const urlGroup = document.createElement("fieldset");
  const urlLegend = document.createElement("legend");
  urlLegend.textContent = "URL";
  const intranet = urlField(labels.intranet, options.binding?.intranetUrl ?? "");
  const publicUrl = urlField(labels.public, options.binding?.publicUrl ?? "");
  urlGroup.append(urlLegend, intranet.label, publicUrl.label);

  const scriptGroup = document.createElement("fieldset");
  const scriptLegend = document.createElement("legend");
  scriptLegend.textContent = labels.scripts;
  const start = field(labels.start, options.binding?.scripts?.start ?? "", "/repo/start.sh");
  const restart = field(
    labels.restart,
    options.binding?.scripts?.restart ?? "",
    "/repo/restart.sh",
  );
  const stop = field(labels.stop, options.binding?.scripts?.stop ?? "", "/repo/stop.sh");
  const hint = document.createElement("p");
  hint.className = "codexhost-project-tool-hint";
  hint.textContent = labels.scriptHint;

  // 自定义脚本：名称 + 绝对路径，可增删；id 只在编辑已有绑定时保留，新增行由保存时分配。
  const customDrafts: Array<{ id?: string; name: HTMLInputElement; path: HTMLInputElement }> = [];
  const customList = document.createElement("div");
  customList.className = "codexhost-project-tool-custom-list";
  customList.setAttribute("data-codexhost-project-tool-custom-scripts", "");
  const customLegend = document.createElement("legend");
  customLegend.textContent = labels.customScripts;
  const syncCustomVisibility = (): void => {
    const empty = customDrafts.length === 0;
    customLegend.hidden = empty;
    customList.hidden = empty;
  };
  const addCustom = document.createElement("button");
  addCustom.type = "button";
  addCustom.className = "codexhost-project-tool-add-script";
  addCustom.setAttribute("data-codexhost-project-tool-add-script", "");
  addCustom.append(
    createElement(Plus, { width: 13, height: 13, "aria-hidden": "true" }),
    labels.customScriptAdd,
  );
  const appendCustom = (draft: ProjectCustomScriptDraft = { name: "", path: "" }): void => {
    const row = document.createElement("div");
    row.className = "codexhost-project-tool-custom-row";
    const name = field(labels.customScriptName, draft.name, labels.customScriptNamePlaceholder);
    name.label.classList.add("codexhost-project-tool-custom-name");
    const scriptPath = field(labels.customScriptPath, draft.path, labels.customScriptPlaceholder);
    scriptPath.label.classList.add("codexhost-project-tool-custom-path");
    const entry = {
      ...(draft.id ? { id: draft.id } : {}),
      name: name.input,
      path: scriptPath.input,
    };
    customDrafts.push(entry);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "codexhost-project-tool-custom-remove";
    remove.title = labels.customScriptRemove;
    remove.setAttribute("aria-label", `${labels.customScriptRemove}: ${draft.name || ""}`);
    remove.append(createElement(Trash2, { width: 14, height: 14, "aria-hidden": "true" }));
    remove.addEventListener("click", () => {
      const index = customDrafts.indexOf(entry);
      if (index >= 0) customDrafts.splice(index, 1);
      row.remove();
      syncCustomVisibility();
    });
    row.append(name.label, scriptPath.label, remove);
    customList.append(row);
    syncCustomVisibility();
    name.input.focus();
  };
  addCustom.addEventListener("click", () => appendCustom());
  for (const script of options.binding?.customScripts ?? []) {
    appendCustom({ id: script.id, name: script.name, path: script.path });
  }

  // 列表始终挂在表单里：新增行要立刻可见，空列表时只收起标题与容器。
  scriptGroup.append(
    scriptLegend,
    start.label,
    restart.label,
    stop.label,
    customLegend,
    customList,
    hint,
  );
  hint.after(addCustom);
  syncCustomVisibility();

  const metadata = document.createElement("fieldset");
  const metadataLegend = document.createElement("legend");
  metadataLegend.textContent = labels.metadataPath;
  const metadataLabel = field(labels.metadataPath, options.metadataPath ?? "", "");
  metadataLabel.input.readOnly = true;
  metadataLabel.input.setAttribute("data-codexhost-project-tool-metadata-path", "");
  const copy = actionButton(labels.copyPath, () => {
    const path = metadataLabel.input.value;
    if (!path) return;
    void navigator.clipboard.writeText(path).then(
      () => {
        copy.textContent = labels.copyPath;
      },
      () => undefined,
    );
  });
  copy.prepend(createElement(Copy, { width: 14, height: 14, "aria-hidden": "true" }));
  copy.setAttribute("data-codexhost-project-tool-copy-metadata", "");
  copy.disabled = !options.metadataPath;
  copy.title = labels.copyPath;
  metadataLabel.label.classList.add("codexhost-project-tool-copy-row");
  metadataLabel.label.append(copy);
  const targetHint = document.createElement("p");
  targetHint.className = "codexhost-project-tool-hint";
  targetHint.textContent = `${labels.metadataHint}\n${labels.targetHint}${
    options.projectPath ? `\n${options.projectPath}` : ""
  }`;
  metadata.append(metadataLegend, metadataLabel.label, targetHint);

  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const actions = document.createElement("div");
  actions.className = "codexhost-project-tool-actions";
  const remove = actionButton(labels.remove, () => {
    remove.disabled = true;
    error.hidden = true;
    void options.remove().then(
      () => dialog.close(),
      (failure) => {
        remove.disabled = false;
        error.textContent = String(failure);
        error.hidden = false;
      },
    );
  });
  remove.hidden = options.binding === null;
  const cancel = actionButton(labels.cancel, () => dialog.close());
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = labels.save;
  actions.append(remove, cancel, save);
  form.append(urlGroup, scriptGroup, metadata, error, actions);
  dialog.append(heading, description, form);
  dialog.addEventListener("close", () => {
    dialog.remove();
    options.onClose();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    error.hidden = true;
    void options
      .save({
        intranetUrl: intranet.input.value,
        publicUrl: publicUrl.input.value,
        scripts: {
          start: start.input.value,
          restart: restart.input.value,
          stop: stop.input.value,
        },
        customScripts: customDrafts.map((draft) => ({
          ...(draft.id ? { id: draft.id } : {}),
          name: draft.name.value,
          path: draft.path.value,
        })),
        // 表单不再编辑 Prompt；已保存的文本原样带回，保存其他字段时不会被清空。
        ...(options.binding?.prompt ? { prompt: options.binding.prompt } : {}),
      })
      .then(
        () => dialog.close(),
        (failure) => {
          save.disabled = false;
          error.textContent = failure instanceof Error ? failure.message : String(failure);
          error.hidden = false;
        },
      );
  });
  const previousFocus = document.activeElement;
  document.body.append(dialog);
  dialog.showModal();
  intranet.input.focus();
  dialog.addEventListener(
    "close",
    () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    },
    { once: true },
  );
  return dialog;
}
