import { isDynamicRecord } from "./runtime-values";

export interface BrowserFormRequest {
  requestId: string | number;
  agentId: string;
  threadId: string;
  tabId: string;
}
export interface BrowserFormField {
  id: string;
  label: string;
  type:
    | "text"
    | "email"
    | "password"
    | "tel"
    | "url"
    | "search"
    | "number"
    | "date"
    | "datetime-local"
    | "month"
    | "week"
    | "time"
    | "color"
    | "range"
    | "textarea"
    | "select"
    | "checkbox"
    | "radio";
  required: boolean;
  name: string;
  options: { id: string; label: string; selected: boolean; disabled: boolean }[];
  checked: boolean;
  multiple: boolean;
  min: string;
  max: string;
  step: string;
}
export interface BrowserFormState {
  revision: string;
  origin: string;
  forms: { id: string; label: string; fields: BrowserFormField[]; actions: { id: string; label: string }[] }[];
  status: "ready" | "manual" | "invalid" | "complete";
}
export interface BrowserFormSubmission extends BrowserFormRequest {
  revision: string;
  formId: string;
  actionId: string;
  values: { id: string; value: string | boolean | string[] }[];
}
function text(value: unknown, limit = 2000): value is string {
  return typeof value === "string" && value.length <= limit;
}
function id(value: unknown): value is string {
  return text(value, 256) && value.length > 0;
}
function isRequest(value: unknown): value is BrowserFormRequest {
  return (
    isDynamicRecord(value) &&
    (id(value.requestId) || (typeof value.requestId === "number" && Number.isSafeInteger(value.requestId))) &&
    id(value.agentId) &&
    id(value.threadId) &&
    id(value.tabId)
  );
}
function isValue(value: unknown): value is BrowserFormSubmission["values"][number] {
  return (
    isDynamicRecord(value) &&
    id(value.id) &&
    (text(value.value, 16000) ||
      typeof value.value === "boolean" ||
      (Array.isArray(value.value) && value.value.length <= 200 && value.value.every(id)))
  );
}
function isSubmission(value: unknown): value is BrowserFormSubmission {
  return (
    isDynamicRecord(value) &&
    isRequest(value) &&
    id(value.revision) &&
    id(value.formId) &&
    id(value.actionId) &&
    Array.isArray(value.values) &&
    value.values.length <= 100 &&
    value.values.every(isValue)
  );
}
export function parseBrowserFormRequest(value: unknown): BrowserFormRequest {
  if (!isRequest(value)) throw new Error("Invalid browser form request.");
  return { requestId: value.requestId, agentId: value.agentId, threadId: value.threadId, tabId: value.tabId };
}
export function parseBrowserFormSubmission(value: unknown): BrowserFormSubmission {
  if (!isSubmission(value)) throw new Error("Invalid browser form submission.");
  return {
    ...parseBrowserFormRequest(value),
    revision: value.revision,
    formId: value.formId,
    actionId: value.actionId,
    values: value.values.map((entry) => ({ id: entry.id, value: entry.value })),
  };
}
function isOption(value: unknown): value is BrowserFormField["options"][number] {
  return (
    isDynamicRecord(value) &&
    id(value.id) &&
    text(value.label) &&
    typeof value.selected === "boolean" &&
    typeof value.disabled === "boolean"
  );
}
function isFieldType(value: unknown): value is BrowserFormField["type"] {
  return (
    typeof value === "string" &&
    [
      "text",
      "email",
      "password",
      "tel",
      "url",
      "search",
      "number",
      "date",
      "datetime-local",
      "month",
      "week",
      "time",
      "color",
      "range",
      "textarea",
      "select",
      "checkbox",
      "radio",
    ].includes(value)
  );
}
function isField(value: unknown): value is BrowserFormField {
  return (
    isDynamicRecord(value) &&
    id(value.id) &&
    text(value.label) &&
    isFieldType(value.type) &&
    typeof value.required === "boolean" &&
    text(value.name) &&
    Array.isArray(value.options) &&
    value.options.length <= 200 &&
    value.options.every(isOption) &&
    typeof value.checked === "boolean" &&
    typeof value.multiple === "boolean" &&
    text(value.min, 100) &&
    text(value.max, 100) &&
    text(value.step, 100)
  );
}
function isAction(value: unknown): value is BrowserFormState["forms"][number]["actions"][number] {
  return isDynamicRecord(value) && id(value.id) && text(value.label);
}
function isForm(value: unknown): value is BrowserFormState["forms"][number] {
  return (
    isDynamicRecord(value) &&
    id(value.id) &&
    text(value.label) &&
    Array.isArray(value.fields) &&
    value.fields.length <= 100 &&
    value.fields.every(isField) &&
    Array.isArray(value.actions) &&
    value.actions.length <= 20 &&
    value.actions.every(isAction)
  );
}
function isState(value: unknown): value is BrowserFormState {
  return (
    isDynamicRecord(value) &&
    id(value.revision) &&
    text(value.origin) &&
    Array.isArray(value.forms) &&
    value.forms.length <= 20 &&
    value.forms.every(isForm) &&
    (value.status === "ready" || value.status === "manual" || value.status === "invalid" || value.status === "complete")
  );
}
export function decodeBrowserFormState(value: unknown): BrowserFormState {
  if (!isState(value)) throw new Error("Invalid browser form response.");
  return value;
}
