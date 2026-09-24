import type { BuddyAnswer, BuddyPlannerInput } from "@codexhost/shared-contracts";

const messages = {
  "zh-CN": {
    title: "规划需要你的确认",
    hint: "回答后继续当前规划；确认前不会启动执行。",
    custom: "补充或自定义回答",
    submit: "确认并继续",
    submitting: "正在提交…",
    cancel: "取消规划",
    required: "请回答所有问题后再继续。",
  },
  en: {
    title: "The planner needs your input",
    hint: "Your answers will resume this plan. Execution has not started.",
    custom: "Additional or custom answer",
    submit: "Confirm and continue",
    submitting: "Submitting…",
    cancel: "Cancel planning",
    required: "Please answer every question before continuing.",
  },
};

export function plannerInputControl(
  input: BuddyPlannerInput,
  locale: "zh-CN" | "en",
  answer: (answers: BuddyAnswer["answers"]) => Promise<void>,
  cancel: () => Promise<void>,
): HTMLFormElement {
  const m = messages[locale];
  const form = document.createElement("form");
  form.className = "buddy-planner-input";
  form.setAttribute("aria-label", m.title);
  const title = document.createElement("strong");
  title.textContent = m.title;
  const hint = document.createElement("p");
  hint.textContent = m.hint;
  form.append(title, hint);
  const fields = input.questions.map((question, index) => {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = question.header || question.question;
    const prompt = document.createElement("p");
    prompt.textContent = question.question;
    fieldset.append(legend, prompt);
    for (const option of question.options ?? []) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `question-${index}`;
      radio.value = option.label;
      const copy = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = option.label;
      copy.append(name);
      if (option.description) {
        const description = document.createElement("small");
        description.textContent = option.description;
        copy.append(description);
      }
      label.append(radio, copy);
      fieldset.append(label);
    }
    const text = document.createElement(question.isSecret ? "input" : "textarea");
    if (text instanceof HTMLInputElement) text.type = "password";
    text.autocomplete = "off";
    text.setAttribute("aria-label", `${question.question} — ${m.custom}`);
    text.placeholder = m.custom;
    fieldset.append(text);
    form.append(fieldset);
    return { id: question.id, fieldset, text };
  });
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  form.addEventListener("input", () => {
    error.textContent = "";
  });
  const actions = document.createElement("div");
  actions.className = "buddy-actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = m.submit;
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = m.cancel;
  actions.append(submit, stop);
  form.append(error, actions);
  let busy = false;
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    stop.disabled = true;
    submit.textContent = m.submitting;
    error.textContent = "";
    try {
      await action();
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
      submit.disabled = false;
      stop.disabled = false;
      submit.textContent = m.submit;
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const answers: BuddyAnswer["answers"] = {};
    for (const field of fields) {
      const choice = field.fieldset.querySelector<HTMLInputElement>("input[type=radio]:checked");
      const values = [choice?.value, field.text.value.trim()].filter((value): value is string =>
        Boolean(value),
      );
      if (!values.length) {
        error.textContent = m.required;
        field.text.focus();
        return;
      }
      answers[field.id] = { answers: values };
    }
    void run(() => answer(answers));
  });
  stop.addEventListener("click", () => {
    void run(cancel);
  });
  return form;
}
