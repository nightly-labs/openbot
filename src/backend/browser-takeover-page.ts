import type { BrowserFormField, BrowserFormState, BrowserFormSubmission } from "@openbot/contracts/ipc";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Submitter = HTMLInputElement | HTMLButtonElement;
interface CapturedForm {
  form: HTMLFormElement;
  controls: Map<string, Control>;
  actions: Map<string, Submitter>;
  signature: string;
}
interface PageCapture {
  revision: string;
  url: string;
  forms: Map<string, CapturedForm>;
  code?: { node: HTMLInputElement; signature: string };
}
declare global {
  interface Window {
    __openbotTakeoverForm?: PageCapture;
  }
}
export type TakeoverPageCommand = { kind: "read"; revision: string } | { kind: "submit"; input: BrowserFormSubmission };

/** Runs only in Electron's isolated world. Keep this function self-contained for serialization. */
export function browserTakeoverPage(command: TakeoverPageCommand): BrowserFormState {
  const visible = (node: Element) => {
    const style = getComputedStyle(node);
    return node.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const label = (node: Control | Submitter) =>
    (
      node.getAttribute("aria-label") ||
      node
        .getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ") ||
      [...(node.labels ?? [])].map((entry) => entry.textContent).join(" ") ||
      (node instanceof HTMLButtonElement ? node.textContent : "") ||
      (node instanceof HTMLInputElement && node.type === "submit" ? node.value : "") ||
      node.getAttribute("placeholder") ||
      node.name ||
      "Field"
    )
      .trim()
      .slice(0, 2000);
  const forms: BrowserFormState["forms"] = [];
  const captured = new Map<string, CapturedForm>();
  let unsupported = [
    ...document.querySelectorAll(
      "iframe, [role=dialog], [role=alert], [role=progressbar], [aria-busy=true], [id*=captcha i], [aria-invalid=true], [contenteditable=true], [role=combobox]:not(select)",
    ),
  ].some(visible);
  unsupported ||= document.readyState === "loading" || !document.body?.textContent?.trim();
  unsupported ||= /captcha|passkey|security key|verification required|verify your identity|loading[.…]/i.test(
    document.body?.textContent ?? "",
  );
  unsupported ||= [...document.querySelectorAll("*")].some(
    (node) => node.shadowRoot !== null || node.localName.includes("-"),
  );
  // Inputs without a native form, including custom login widgets, require manual takeover.
  unsupported ||= [...document.querySelectorAll("input, textarea, select")].some(
    (node) =>
      (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) &&
      !node.form &&
      visible(node),
  );
  for (const [formIndex, form] of [...document.forms].entries()) {
    const fields: BrowserFormField[] = [];
    const controls = new Map<string, Control>();
    const actions = new Map<string, Submitter>();
    const actionDescriptions: BrowserFormState["forms"][number]["actions"] = [];
    let invalid = false;
    for (const [index, node] of [...form.elements].entries()) {
      if (
        !(
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement ||
          node instanceof HTMLSelectElement ||
          node instanceof HTMLButtonElement
        )
      )
        continue;
      if (!visible(node) || (node instanceof HTMLInputElement && node.type === "hidden")) continue;
      const id = `field-${index}`;
      if ((node instanceof HTMLInputElement || node instanceof HTMLButtonElement) && node.type === "submit") {
        actions.set(id, node);
        actionDescriptions.push({ id, label: label(node) === "Field" ? "Submit" : label(node) });
        continue;
      }
      if (node.matches(":disabled")) continue;
      if (node instanceof HTMLButtonElement) {
        // Auxiliary actions do not prevent filling and submitting the native form.
        unsupported = true;
        continue;
      }
      if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.readOnly) continue;
      let type: BrowserFormField["type"];
      if (node instanceof HTMLTextAreaElement) type = "textarea";
      else if (node instanceof HTMLSelectElement) type = "select";
      else {
        switch (node.type) {
          case "text":
          case "email":
          case "password":
          case "tel":
          case "url":
          case "search":
          case "number":
          case "date":
          case "datetime-local":
          case "month":
          case "week":
          case "time":
          case "color":
          case "range":
          case "checkbox":
          case "radio":
            type = node.type;
            break;
          default:
            invalid = true;
            continue;
        }
      }
      controls.set(id, node);
      fields.push({
        id,
        label: label(node),
        type,
        required: node.required,
        name: node.name.slice(0, 2000),
        options:
          node instanceof HTMLSelectElement
            ? [...node.options].map((option, optionIndex) => ({
                id: `option-${optionIndex}`,
                label: option.label.slice(0, 2000),
                selected: option.selected,
                disabled:
                  option.disabled ||
                  (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
              }))
            : [],
        checked: node instanceof HTMLInputElement && node.checked,
        multiple: node instanceof HTMLSelectElement && node.multiple,
        min: node instanceof HTMLInputElement ? node.min.slice(0, 100) : "",
        max: node instanceof HTMLInputElement ? node.max.slice(0, 100) : "",
        step: node instanceof HTMLInputElement ? node.step.slice(0, 100) : "",
      });
    }
    if (fields.length === 0 && actionDescriptions.length === 0) continue;
    if (
      invalid ||
      form.noValidate ||
      [...actions.values()].some((action) => action.formNoValidate) ||
      fields.length > 100 ||
      actionDescriptions.length === 0 ||
      actionDescriptions.length > 20 ||
      fields.some((field) => field.options.length > 200) ||
      forms.length >= 20
    ) {
      unsupported = true;
      continue;
    }
    const id = `form-${formIndex}`;
    const description = {
      id,
      label: (form.getAttribute("aria-label") || `Form ${formIndex + 1}`).slice(0, 2000),
      fields,
      actions: actionDescriptions,
    };
    forms.push(description);
    // Selection can change through the user's edits. Bind to structure and destinations, not values.
    const signature = JSON.stringify({
      description: {
        ...description,
        fields: fields.map((field) => ({
          ...field,
          checked: false,
          options: field.options.map((option) => ({ ...option, selected: false })),
        })),
      },
      action: form.action,
      method: form.method,
      optionValues: [...controls.values()].map((node) =>
        node instanceof HTMLSelectElement ? [...node.options].map((option) => option.value) : null,
      ),
      submitters: [...actions.values()].map((action) => [action.formAction, action.formMethod]),
    });
    captured.set(id, { form, controls, actions, signature });
  }
  const state: BrowserFormState = {
    revision: command.kind === "read" ? command.revision : command.input.revision,
    origin: location.origin,
    forms,
    status: unsupported ? "manual" : "ready",
  };
  // Some verification widgets submit on input and have no native form or button.
  const codeInputs = [...document.querySelectorAll('input[autocomplete="one-time-code"]')].filter(
    (node): node is HTMLInputElement =>
      node instanceof HTMLInputElement && !node.form && !node.disabled && !node.readOnly && visible(node),
  );
  const code = codeInputs.length === 1 ? codeInputs[0] : undefined;
  const codeSignature = code
    ? JSON.stringify([code.type, code.maxLength, code.pattern, code.inputMode, code.autocomplete])
    : "";
  if (code) {
    forms.push({
      id: "one-time-code",
      label: "Verification",
      fields: [
        {
          id: "code",
          label: "Verification code",
          type: "text",
          required: true,
          name: "code",
          options: [],
          checked: false,
          multiple: false,
          min: "",
          max: "",
          step: "",
        },
      ],
      actions: [{ id: "enter-code", label: "Continue" }],
    });
  }
  if (command.kind === "read") {
    window.__openbotTakeoverForm = {
      revision: command.revision,
      url: location.href,
      forms: captured,
      code: code ? { node: code, signature: codeSignature } : undefined,
    };
    return state;
  }
  const { input } = command;
  const previous = window.__openbotTakeoverForm;
  if (input.formId === "one-time-code") {
    if (
      !code ||
      previous?.revision !== input.revision ||
      previous.url !== location.href ||
      previous.code?.node !== code ||
      previous.code.signature !== codeSignature
    )
      throw new Error("The browser form changed. Refresh it before submitting.");
    if (
      input.actionId !== "enter-code" ||
      input.values.length !== 1 ||
      input.values[0].id !== "code" ||
      typeof input.values[0].value !== "string"
    )
      throw new Error("Invalid browser form submission.");
    const value = input.values[0].value;
    if (
      !value ||
      (code.maxLength > 0 && value.length > code.maxLength) ||
      (code.inputMode === "numeric" && !/^\d+$/.test(value))
    )
      return { ...state, status: "invalid" };
    delete window.__openbotTakeoverForm;
    code.value = value;
    if (!code.checkValidity()) return { ...state, status: "invalid" };
    code.dispatchEvent(new Event("input", { bubbles: true }));
    // The input handler can replace the widget immediately after a complete code.
    if (code.isConnected) code.dispatchEvent(new Event("change", { bubbles: true }));
    return state;
  }
  const prior = previous?.forms.get(input.formId);
  const current = captured.get(input.formId);
  if (
    previous?.revision !== input.revision ||
    previous.url !== location.href ||
    !prior ||
    !current ||
    prior.form !== current.form ||
    prior.signature !== current.signature ||
    [...current.controls].some(([id, node]) => prior.controls.get(id) !== node) ||
    [...current.actions].some(([id, node]) => prior.actions.get(id) !== node)
  )
    throw new Error("The browser form changed. Refresh it before submitting.");
  const action = current.actions.get(input.actionId);
  const values = new Map(input.values.map((entry) => [entry.id, entry.value]));
  if (!action || values.size !== input.values.length || values.size !== current.controls.size)
    throw new Error("Invalid browser form submission.");
  for (const [id, node] of current.controls) {
    const value = values.get(id);
    if (node instanceof HTMLSelectElement) {
      if (
        !Array.isArray(value) ||
        (!node.multiple && value.length !== 1) ||
        value.some((optionId) => {
          const option = [...node.options].find((_option, index) => `option-${index}` === optionId);
          return (
            !option ||
            option.disabled ||
            (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)
          );
        })
      )
        throw new Error("Invalid browser form selection.");
    } else if (node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio")) {
      if (typeof value !== "boolean") throw new Error("Invalid browser form selection.");
    } else if (typeof value !== "string") throw new Error("Invalid browser form value.");
  }
  const destination = JSON.stringify([current.form.action, current.form.method, action.formAction, action.formMethod]);
  const checkTargets = () => {
    if (
      previous.url !== location.href ||
      !current.form.isConnected ||
      !action.isConnected ||
      action.form !== current.form ||
      destination !==
        JSON.stringify([current.form.action, current.form.method, action.formAction, action.formMethod]) ||
      [...current.controls.values()].some((node) => !node.isConnected || node.form !== current.form)
    ) {
      throw new Error("The browser form changed. Refresh it before submitting.");
    }
  };
  // Consume before dispatch: a double click or retry cannot submit this revision twice.
  delete window.__openbotTakeoverForm;
  for (const [id, node] of current.controls) {
    checkTargets();
    const value = values.get(id);
    let clicked = false;
    if (node instanceof HTMLSelectElement && Array.isArray(value)) {
      [...node.options].forEach((option, index) => {
        option.selected = value.includes(`option-${index}`);
      });
    } else if (node instanceof HTMLInputElement && typeof value === "boolean") {
      if (node.checked !== value && (node.type === "checkbox" || value)) {
        node.click();
        clicked = true;
      } else node.checked = value;
    } else if (typeof value === "string") node.value = value;
    checkTargets();
    if (clicked) continue;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }
  checkTargets();
  if (!current.form.checkValidity() || action.matches(":disabled")) return { ...state, status: "invalid" };
  checkTargets();
  action.click();
  return state;
}
