import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import type { AgentPromptQuestion, ConversationMessageSender } from "./ipc-conversation-messages";
import { VAULT_CARD_BRANDS, VAULT_TEXT_LIMIT, type VaultCardBrand } from "./ipc-vault";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const UI_BLOCK_VERSION = 1;

export const UI_BLOCK_LIMITS = {
  specJson: 64_000,
  responseJson: 16_000,
  id: 64,
  title: 200,
  label: 120,
  meta: 60,
  text: 2_000,
  preview: 8_000,
  fieldValue: 8_000,
  outcome: 300,
  actions: 4,
  quickReplies: 8,
  choiceOptions: 20,
  confirmFields: 8,
  formFields: 20,
  selectOptions: 50,
  segmentedOptions: 6,
  holdMinMs: 400,
  holdMaxMs: 3_000,
  timestamp: 160,
} as const;

export const UI_BLOCK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/u;

export const UI_BLOCK_SUBMIT_ACTION_ID = "submit";
export const UI_BLOCK_TEXT_ACTION_ID = "_text";
export const UI_CHOICE_VALUES_KEY = "selected";
export const UI_CONFIRM_ACTION_QUESTION_ID = "action";
export const UI_QUICK_REPLIES_QUESTION_ID = "reply";
export const UI_CHOICE_QUESTION_ID = "choice";
export const UI_CONFIRM_EDIT_ACTION_ID = "edit_preview";
export const UI_CONFIRM_PREVIEW_ANSWER_ID = "_preview";

const LEGACY_KEY_IDS: ReadonlySet<string> = new Set(["botId", "recipientBotId", "recipientBotIds", "senderBotId"]);

export type UiActionStyle = "primary" | "secondary" | "ghost" | "danger";
export const UI_ACTION_STYLES = ["primary", "secondary", "ghost", "danger"] as const satisfies readonly UiActionStyle[];

export interface UiAction {
  id: string;
  label: string;
  style?: UiActionStyle;
  confirm?: boolean;
}

export interface UiConfirmValueField {
  label: string;
  value: string;
}

export interface UiConfirmSelectField {
  label: string;
  select: string;
  options: string[];
}

export type UiConfirmField = UiConfirmValueField | UiConfirmSelectField;

export interface UiConfirmBlock {
  type: "confirm";
  title: string;
  danger?: boolean;
  confirmHold?: number;
  fields?: UiConfirmField[];
  preview?: string;
  actions: UiAction[];
}

export interface UiOption {
  id: string;
  label: string;
}

export interface UiQuickRepliesBlock {
  type: "quick_replies";
  title?: string;
  options: UiOption[];
  allowText?: boolean;
}

export interface UiChoiceOption extends UiOption {
  meta?: string;
  selected?: boolean;
}

export interface UiChoiceBlock {
  type: "choice";
  title: string;
  multiple?: boolean;
  options: UiChoiceOption[];
  submit?: string;
}

export interface UiFormTextField {
  id: string;
  kind: "text" | "textarea";
  label: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  secret?: boolean;
}

export interface UiFormOptionsField {
  id: string;
  kind: "select" | "segmented";
  label?: string;
  options: string[];
  required?: boolean;
  value?: string;
}

export interface UiFormDateField {
  id: string;
  kind: "date";
  label: string;
  required?: boolean;
  value?: string;
}

export type UiFormField = UiFormTextField | UiFormOptionsField | UiFormDateField;
export type UiFormFieldKind = UiFormField["kind"];

export interface UiFormBlock {
  type: "form";
  title: string;
  fields: UiFormField[];
  submit?: string;
}

export type UiBlockSpec = UiConfirmBlock | UiQuickRepliesBlock | UiChoiceBlock | UiFormBlock;
export type UiBlockType = UiBlockSpec["type"];

export const UI_BLOCK_TYPES = ["confirm", "quick_replies", "choice", "form"] as const satisfies readonly UiBlockType[];

export type UiBlockValue = string | string[];

export interface UiBlockResponse {
  actionId: string;
  values?: Record<string, UiBlockValue>;
  text?: string;
}

export type UiBlockStatus = "pending" | "answered" | "expired" | "closed";
export const UI_BLOCK_STATUSES = [
  "pending",
  "answered",
  "expired",
  "closed",
] as const satisfies readonly UiBlockStatus[];

export interface UiBlockAutoAnswer {
  actionId: string;
  at: string;
  done?: boolean;
}

export interface UiBlockState {
  status: UiBlockStatus;
  response?: UiBlockResponse;
  respondedBy?: ConversationMessageSender;
  respondedAt?: string;
  outcome?: string;
  autoAnswer?: UiBlockAutoAnswer;
}

export type UiVaultRequestKind = "login" | "card" | "contact";
export const UI_VAULT_REQUEST_KINDS = ["login", "card", "contact"] as const satisfies readonly UiVaultRequestKind[];

export const UI_VAULT_REQUEST_FIELDS = {
  login: ["website", "username", "password"],
  card: ["label", "nameOnCard", "number", "expiry", "securityCode"],
  contact: ["label", "fullName", "address", "address2", "city", "region", "postalCode", "country", "phone", "email"],
} as const satisfies Record<UiVaultRequestKind, readonly string[]>;

export type UiVaultRequestField<Kind extends UiVaultRequestKind = UiVaultRequestKind> =
  (typeof UI_VAULT_REQUEST_FIELDS)[Kind][number];

export const UI_VAULT_SECRET_FIELDS: readonly UiVaultRequestField[] = ["password", "number", "securityCode"];

export interface UiVaultSavedItem {
  id: string;
  name: string;
  brand?: VaultCardBrand;
  last4?: string;
}

export interface UiBlockVaultRequest {
  kind: UiVaultRequestKind;
  saved?: UiVaultSavedItem;
}

export interface ConversationUiBlock {
  version: typeof UI_BLOCK_VERSION;
  blockId: string;
  spec: UiBlockSpec;
  state: UiBlockState;
  vault?: UiBlockVaultRequest;
  apiKey?: true;
}

export const UI_API_KEY_SCOPE_FIELD_ID = "scope";

export function isUiBlockType(value: unknown): value is UiBlockType {
  return isOneOf(UI_BLOCK_TYPES, value);
}

export function isUiBlockId(value: unknown): value is string {
  return isString(value) && UI_BLOCK_ID_PATTERN.test(value) && !value.startsWith("_") && !LEGACY_KEY_IDS.has(value);
}

class InvalidUiBlock extends Error {}

function fail(): never {
  throw new InvalidUiBlock();
}

function check(condition: boolean): asserts condition {
  if (!condition) fail();
}

function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof InvalidUiBlock) return null;
    throw error;
  }
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function readRecord(value: unknown): DynamicRecord {
  check(isDynamicRecord(value));
  return value;
}

function readString(value: unknown, max: number, nonBlank = true): string {
  check(isBoundedString(value, max) && (!nonBlank || value.trim().length > 0));
  return value;
}

function readOptionalString(value: unknown, max: number): string | undefined {
  return value === undefined ? undefined : readString(value, max);
}

function readId(value: unknown): string {
  check(isUiBlockId(value));
  return value;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  check(isBoolean(value));
  return value;
}

function readNumber(value: unknown, min: number, max: number, integer = false): number {
  check(isNumber(value) && Number.isFinite(value) && value >= min && value <= max);
  check(!integer || Number.isInteger(value));
  return value;
}

function readOptionalNumber(value: unknown, min: number, max: number, integer = false): number | undefined {
  return value === undefined ? undefined : readNumber(value, min, max, integer);
}

function readArray(value: unknown, max: number, min = 0): readonly unknown[] {
  check(Array.isArray(value) && value.length >= min && value.length <= max);
  return value;
}

function readOneOf<T extends string>(values: readonly T[], value: unknown): T {
  check(isOneOf(values, value));
  return value;
}

function readOptionalOneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return value === undefined ? undefined : readOneOf(values, value);
}

function checkUnique(values: readonly string[]): void {
  check(new Set(values).size === values.length);
}

function readAction(value: unknown): UiAction {
  const record = readRecord(value);
  const action: UiAction = { id: readId(record.id), label: readString(record.label, UI_BLOCK_LIMITS.label) };
  const style = readOptionalOneOf(UI_ACTION_STYLES, record.style);
  if (style !== undefined) action.style = style;
  const confirm = readOptionalBoolean(record.confirm);
  if (confirm !== undefined) action.confirm = confirm;
  return action;
}

function readActions(value: unknown, min: number): UiAction[] {
  const actions = readArray(value, UI_BLOCK_LIMITS.actions, min).map(readAction);
  checkUnique(actions.map((action) => action.id));
  return actions;
}

function readOption(value: unknown): UiOption {
  const record = readRecord(value);
  return { id: readId(record.id), label: readString(record.label, UI_BLOCK_LIMITS.label) };
}

function checkUniqueOptions(options: readonly UiOption[]): void {
  checkUnique(options.map((option) => option.id));
  checkUnique(options.map((option) => option.label.trim().toLowerCase()));
}

function readStringOptions(value: unknown, max: number): string[] {
  const options = readArray(value, max, 1).map((option) => readString(option, UI_BLOCK_LIMITS.label));
  checkUnique(options.map((option) => option.trim().toLowerCase()));
  return options;
}

function readConfirmField(value: unknown): UiConfirmField {
  const record = readRecord(value);
  const label = readString(record.label, UI_BLOCK_LIMITS.label);
  if (record.select !== undefined) {
    const select = readId(record.select);
    check(select !== UI_CONFIRM_ACTION_QUESTION_ID);
    return { label, select, options: readStringOptions(record.options, UI_BLOCK_LIMITS.selectOptions) };
  }
  return { label, value: readString(record.value, UI_BLOCK_LIMITS.text, false) };
}

function readConfirm(record: DynamicRecord): UiConfirmBlock {
  const block: UiConfirmBlock = {
    type: "confirm",
    title: readString(record.title, UI_BLOCK_LIMITS.title),
    actions: readActions(record.actions, 1),
  };
  const danger = readOptionalBoolean(record.danger);
  if (danger !== undefined) block.danger = danger;
  const hold = readOptionalNumber(record.confirmHold, UI_BLOCK_LIMITS.holdMinMs, UI_BLOCK_LIMITS.holdMaxMs, true);
  if (hold !== undefined) block.confirmHold = hold;
  if (record.fields !== undefined) {
    const fields = readArray(record.fields, UI_BLOCK_LIMITS.confirmFields).map(readConfirmField);
    checkUnique(fields.flatMap((field) => ("select" in field ? [field.select] : [])));
    block.fields = fields;
  }
  const preview = readOptionalString(record.preview, UI_BLOCK_LIMITS.preview);
  if (preview !== undefined) block.preview = preview;
  checkUnique(block.actions.map((action) => action.label.trim().toLowerCase()));
  return block;
}

function readQuickReplies(record: DynamicRecord): UiQuickRepliesBlock {
  const options = readArray(record.options, UI_BLOCK_LIMITS.quickReplies, 1).map(readOption);
  checkUniqueOptions(options);
  const block: UiQuickRepliesBlock = { type: "quick_replies", options };
  const title = readOptionalString(record.title, UI_BLOCK_LIMITS.title);
  if (title !== undefined) block.title = title;
  const allowText = readOptionalBoolean(record.allowText);
  if (allowText !== undefined) block.allowText = allowText;
  return block;
}

function readChoiceOption(value: unknown): UiChoiceOption {
  const record = readRecord(value);
  const option: UiChoiceOption = readOption(record);
  const meta = readOptionalString(record.meta, UI_BLOCK_LIMITS.meta);
  if (meta !== undefined) option.meta = meta;
  const selected = readOptionalBoolean(record.selected);
  if (selected !== undefined) option.selected = selected;
  return option;
}

function readChoice(record: DynamicRecord): UiChoiceBlock {
  const options = readArray(record.options, UI_BLOCK_LIMITS.choiceOptions, 1).map(readChoiceOption);
  checkUniqueOptions(options);
  const block: UiChoiceBlock = { type: "choice", title: readString(record.title, UI_BLOCK_LIMITS.title), options };
  const multiple = readOptionalBoolean(record.multiple);
  if (multiple !== undefined) block.multiple = multiple;
  check(multiple === true || options.filter((option) => option.selected).length <= 1);
  const submit = readOptionalString(record.submit, UI_BLOCK_LIMITS.label);
  if (submit !== undefined) block.submit = submit;
  return block;
}

export function isSecretFormField(field: UiFormField): boolean {
  return field.kind === "text" && field.secret === true;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isUiDate(value: unknown): value is string {
  if (!isString(value) || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readFormField(value: unknown): UiFormField {
  const record = readRecord(value);
  const id = readId(record.id);
  const kind = readOneOf(["text", "textarea", "select", "segmented", "date"] as const, record.kind);
  const required = readOptionalBoolean(record.required);
  let field: UiFormField;
  if (kind === "select" || kind === "segmented") {
    const options = readStringOptions(
      record.options,
      kind === "select" ? UI_BLOCK_LIMITS.selectOptions : UI_BLOCK_LIMITS.segmentedOptions,
    );
    const optionsField: UiFormOptionsField = { id, kind, options };
    const label = readOptionalString(record.label, UI_BLOCK_LIMITS.label);
    if (label !== undefined) optionsField.label = label;
    if (record.value !== undefined) {
      check(isOneOf(options, record.value));
      optionsField.value = record.value;
    }
    field = optionsField;
  } else if (kind === "date") {
    const dateField: UiFormDateField = { id, kind, label: readString(record.label, UI_BLOCK_LIMITS.label) };
    if (record.value !== undefined) {
      check(isUiDate(record.value));
      dateField.value = record.value;
    }
    field = dateField;
  } else {
    const textField: UiFormTextField = { id, kind, label: readString(record.label, UI_BLOCK_LIMITS.label) };
    const placeholder = readOptionalString(record.placeholder, UI_BLOCK_LIMITS.label);
    if (placeholder !== undefined) textField.placeholder = placeholder;
    if (record.value !== undefined) textField.value = readString(record.value, UI_BLOCK_LIMITS.fieldValue, false);
    const secret = readOptionalBoolean(record.secret);
    if (secret === true) check(kind === "text" && textField.value === undefined);
    if (secret !== undefined) textField.secret = secret;
    field = textField;
  }
  if (required !== undefined) field.required = required;
  return field;
}

function readForm(record: DynamicRecord): UiFormBlock {
  const fields = readArray(record.fields, UI_BLOCK_LIMITS.formFields, 1).map(readFormField);
  checkUnique(fields.map((field) => field.id));
  const block: UiFormBlock = { type: "form", title: readString(record.title, UI_BLOCK_LIMITS.title), fields };
  const submit = readOptionalString(record.submit, UI_BLOCK_LIMITS.label);
  if (submit !== undefined) block.submit = submit;
  return block;
}

function readSpec(value: unknown): UiBlockSpec {
  check(jsonLength(value) <= UI_BLOCK_LIMITS.specJson);
  const record = readRecord(value);
  const type = readOneOf(UI_BLOCK_TYPES, record.type);
  switch (type) {
    case "confirm":
      return readConfirm(record);
    case "quick_replies":
      return readQuickReplies(record);
    case "choice":
      return readChoice(record);
    case "form":
      return readForm(record);
  }
}

export function normalizeUiBlockSpec(value: unknown): UiBlockSpec | null {
  return attempt(() => readSpec(value));
}

export function isUiBlockSpec(value: unknown): value is UiBlockSpec {
  return normalizeUiBlockSpec(value) !== null;
}

function actionsOf(spec: UiBlockSpec): readonly UiAction[] {
  return spec.type === "confirm" ? spec.actions : [];
}

function readValues(value: unknown, max: number): Map<string, unknown> {
  const entries = Object.entries(readRecord(value));
  check(entries.length <= max);
  return new Map(entries.map(([key, entry]) => [readId(key), entry] as const));
}

function readResponseValues(
  spec: UiBlockSpec,
  record: DynamicRecord,
  actionId: string,
  stored: boolean,
): Record<string, UiBlockValue> | undefined {
  if (actionId === UI_BLOCK_TEXT_ACTION_ID) {
    check(record.values === undefined);
    return undefined;
  }
  switch (spec.type) {
    case "confirm": {
      if (record.values === undefined) return undefined;
      const selects = new Map(
        (spec.fields ?? []).flatMap((field) => ("select" in field ? [[field.select, field.options] as const] : [])),
      );
      const raw = readValues(record.values, selects.size);
      const values: Record<string, UiBlockValue> = {};
      for (const [key, entry] of raw) {
        const options = selects.get(key);
        check(options !== undefined && isOneOf(options, entry));
        values[key] = entry;
      }
      return values;
    }
    case "choice": {
      const raw = readValues(record.values, 1);
      const selected = raw.get(UI_CHOICE_VALUES_KEY);
      const ids = spec.options.map((option) => option.id);
      const chosen = readArray(selected, spec.multiple ? ids.length : 1, 1).map((id) => {
        check(isOneOf(ids, id));
        return id;
      });
      checkUnique(chosen);
      return { [UI_CHOICE_VALUES_KEY]: chosen };
    }
    case "form": {
      const raw =
        record.values === undefined ? new Map<string, unknown>() : readValues(record.values, spec.fields.length);
      const values: Record<string, UiBlockValue> = {};
      const fields = new Map(spec.fields.map((field) => [field.id, field] as const));
      for (const key of raw.keys()) check(fields.has(key));
      for (const field of spec.fields) {
        const secret = isSecretFormField(field);
        const entry = stored && secret ? undefined : raw.get(field.id);
        if (entry === undefined || entry === "") {
          check(field.required !== true || (stored && secret));
          if (entry === "") values[field.id] = "";
          continue;
        }
        if (field.kind === "select" || field.kind === "segmented") {
          check(isOneOf(field.options, entry));
          values[field.id] = entry;
        } else if (field.kind === "date") {
          check(isUiDate(entry));
          values[field.id] = entry;
        } else values[field.id] = readString(entry, UI_BLOCK_LIMITS.fieldValue, false);
      }
      return values;
    }
    default:
      check(record.values === undefined);
      return undefined;
  }
}

function checkActionId(spec: UiBlockSpec, actionId: string): void {
  if (actionId === UI_BLOCK_TEXT_ACTION_ID) return;
  switch (spec.type) {
    case "quick_replies":
      check(spec.options.some((option) => option.id === actionId));
      break;
    case "choice":
    case "form":
      check(actionId === UI_BLOCK_SUBMIT_ACTION_ID);
      break;
    case "confirm":
      check(spec.actions.some((action) => action.id === actionId));
  }
}

function readResponse(spec: UiBlockSpec, value: unknown, stored = false): UiBlockResponse {
  check(jsonLength(value) <= UI_BLOCK_LIMITS.responseJson);
  const record = readRecord(value);
  check(isString(record.actionId));
  const actionId = record.actionId;
  checkActionId(spec, actionId);
  const response: UiBlockResponse = { actionId };
  const values = readResponseValues(spec, record, actionId, stored);
  if (values !== undefined) response.values = values;
  if (actionId === UI_BLOCK_TEXT_ACTION_ID) response.text = readString(record.text, UI_BLOCK_LIMITS.fieldValue);
  else check(record.text === undefined);
  return response;
}

export function validateUiBlockResponse(spec: UiBlockSpec, value: unknown): UiBlockResponse | null {
  return attempt(() => readResponse(spec, value));
}

export function isUiBlockResponseFor(spec: UiBlockSpec, value: unknown): value is UiBlockResponse {
  return validateUiBlockResponse(spec, value) !== null;
}

export function uiBlockActionIsPrivileged(spec: UiBlockSpec, actionId: string): boolean {
  const action = actionsOf(spec).find((candidate) => candidate.id === actionId);
  if (!action) return false;
  if (action.style === "danger" || action.confirm === true) return true;
  return spec.type === "confirm" && spec.danger === true && action.style === "primary";
}

export function uiBlockHasPrivilegedAction(spec: UiBlockSpec): boolean {
  return actionsOf(spec).some((action) => uiBlockActionIsPrivileged(spec, action.id));
}

function readSender(value: unknown): ConversationMessageSender {
  const record = readRecord(value);
  check(isIdentifier(record.id) && isBoundedString(record.name, INPUT_LIMITS.accountName));
  return { id: record.id, name: record.name };
}

function readAutoAnswer(spec: UiBlockSpec, value: unknown): UiBlockAutoAnswer {
  const record = readRecord(value);
  const actionId = readId(record.actionId);
  check(actionsOf(spec).some((action) => action.id === actionId));
  const at = readString(record.at, UI_BLOCK_LIMITS.timestamp);
  check(Number.isFinite(Date.parse(at)));
  const autoAnswer: UiBlockAutoAnswer = { actionId, at };
  const done = readOptionalBoolean(record.done);
  if (done !== undefined) autoAnswer.done = done;
  return autoAnswer;
}

function readState(spec: UiBlockSpec, value: unknown): UiBlockState {
  const record = readRecord(value);
  const state: UiBlockState = { status: readOneOf(UI_BLOCK_STATUSES, record.status) };
  if (record.response !== undefined) state.response = readResponse(spec, record.response, true);
  check(state.status !== "answered" || state.response !== undefined);
  if (record.respondedBy !== undefined) state.respondedBy = readSender(record.respondedBy);
  const respondedAt = readOptionalString(record.respondedAt, UI_BLOCK_LIMITS.timestamp);
  if (respondedAt !== undefined) state.respondedAt = respondedAt;
  const outcome = readOptionalString(record.outcome, UI_BLOCK_LIMITS.outcome);
  if (outcome !== undefined) state.outcome = outcome;
  if (record.autoAnswer !== undefined) state.autoAnswer = readAutoAnswer(spec, record.autoAnswer);
  return state;
}

function readVaultRequest(spec: UiBlockSpec, value: unknown): UiBlockVaultRequest {
  const record = readRecord(value);
  check(spec.type === "form");
  const request: UiBlockVaultRequest = { kind: readOneOf(UI_VAULT_REQUEST_KINDS, record.kind) };
  if (record.saved === undefined) return request;
  const saved = readRecord(record.saved);
  check(isIdentifier(saved.id));
  const item: UiVaultSavedItem = { id: saved.id, name: readString(saved.name, VAULT_TEXT_LIMIT, false) };
  if (saved.brand !== undefined) item.brand = readOneOf(VAULT_CARD_BRANDS, saved.brand);
  if (saved.last4 !== undefined) {
    check(isString(saved.last4) && /^\d{4}$/u.test(saved.last4));
    item.last4 = saved.last4;
  }
  request.saved = item;
  return request;
}

function readConversationUiBlock(value: unknown): ConversationUiBlock {
  const record = readRecord(value);
  check(record.version === UI_BLOCK_VERSION);
  const spec = readSpec(record.spec);
  const block: ConversationUiBlock = {
    version: UI_BLOCK_VERSION,
    blockId: readId(record.blockId),
    spec,
    state: readState(spec, record.state),
  };
  if (record.vault !== undefined) block.vault = readVaultRequest(spec, record.vault);
  if (record.apiKey === true && spec.type === "form") block.apiKey = true;
  return block;
}

export function normalizeConversationUiBlock(value: unknown): ConversationUiBlock | null {
  return attempt(() => readConversationUiBlock(value));
}

export function isConversationUiBlock(value: unknown): value is ConversationUiBlock {
  return normalizeConversationUiBlock(value) !== null;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function question(
  id: string,
  header: string,
  body: string,
  options: readonly { label: string; description?: string }[] | null,
  isSecret = false,
): AgentPromptQuestion {
  return {
    id,
    header: clip(header, INPUT_LIMITS.promptHeader),
    question: clip(body, INPUT_LIMITS.promptQuestion),
    isSecret,
    options:
      options === null
        ? null
        : options.map((option) => ({
            label: clip(option.label, INPUT_LIMITS.promptOptionLabel),
            description: clip(option.description ?? "", INPUT_LIMITS.promptOptionDescription),
          })),
  };
}

function fittingOptions(labels: readonly string[]): Array<{ label: string }> | null {
  return labels.length <= INPUT_LIMITS.promptOptions ? labels.map((label) => ({ label })) : null;
}

function listText(labels: readonly string[]): string {
  return labels.map((label) => `- ${label}`).join("\n");
}

function confirmFieldLine(field: UiConfirmField): string {
  return "select" in field ? `${field.label}: ${field.options[0] ?? ""}` : `${field.label}: ${field.value}`;
}

export function uiBlockFallbackQuestions(spec: UiBlockSpec): AgentPromptQuestion[] {
  switch (spec.type) {
    case "confirm": {
      const details = (spec.fields ?? []).map(confirmFieldLine);
      const body = [spec.title, details.join("\n"), spec.preview ?? ""].filter(Boolean).join("\n\n");
      const questions = [
        question(
          UI_CONFIRM_ACTION_QUESTION_ID,
          spec.title,
          body,
          spec.actions.map((action) => ({ label: action.label })),
        ),
      ];
      for (const field of spec.fields ?? []) {
        if (!("select" in field)) continue;
        const options = fittingOptions(field.options);
        questions.push(
          question(
            field.select,
            field.label,
            options ? field.label : `${field.label}\n\n${listText(field.options)}`,
            options,
          ),
        );
      }
      return questions;
    }
    case "quick_replies": {
      const labels = spec.options.map((option) => option.label);
      const options = fittingOptions(labels);
      const title = spec.title ?? labels.join(" / ");
      return [
        question(UI_QUICK_REPLIES_QUESTION_ID, title, options ? title : `${title}\n\n${listText(labels)}`, options),
      ];
    }
    case "choice": {
      const labels = spec.options.map((option) =>
        option.meta === undefined ? option.label : `${option.label} (${option.meta})`,
      );
      const options = spec.multiple ? null : fittingOptions(spec.options.map((option) => option.label));
      if (options) {
        return [
          question(
            UI_CHOICE_QUESTION_ID,
            spec.title,
            spec.title,
            spec.options.map((option) => ({ label: option.label, description: option.meta ?? "" })),
          ),
        ];
      }
      return [question(UI_CHOICE_QUESTION_ID, spec.title, `${spec.title}\n\n${listText(labels)}`, null)];
    }
    case "form":
      return spec.fields.map((field) => {
        const label = field.label ?? field.id;
        if (field.kind === "select" || field.kind === "segmented") {
          const options = fittingOptions(field.options);
          return question(field.id, label, options ? label : `${label}\n\n${listText(field.options)}`, options);
        }
        if (field.kind === "date") return question(field.id, label, `${label} (YYYY-MM-DD)`, null);
        return question(field.id, label, label, null, isSecretFormField(field));
      });
  }
}

function matchLabel<T extends { id: string; label: string }>(items: readonly T[], answer: string): T | undefined {
  const text = answer.trim();
  const lower = text.toLowerCase();
  return (
    items.find((item) => item.label === text) ??
    items.find((item) => item.label.trim().toLowerCase() === lower) ??
    items.find((item) => item.id === text)
  );
}

function matchOption(options: readonly string[], answer: string): string | undefined {
  const text = answer.trim().toLowerCase();
  return options.find((option) => option.trim().toLowerCase() === text);
}

function choiceOptionsIn<T extends { id: string; label: string }>(options: readonly T[], answer: string): T[] | null {
  if (!answer.trim()) return [];
  const whole = matchLabel(options, answer);
  if (whole) return [whole];
  const found: T[] = [];
  for (const line of answer.split("\n")) {
    if (!line.trim()) continue;
    const option = matchLabel(options, line);
    if (option) {
      found.push(option);
      continue;
    }
    for (const token of line.split(/[,;]/u)) {
      if (!token.trim()) continue;
      const part = matchLabel(options, token);
      if (!part) return null;
      found.push(part);
    }
  }
  return found;
}

function answersText(questions: readonly AgentPromptQuestion[], answers: Readonly<Record<string, readonly string[]>>) {
  return questions
    .flatMap((item) => {
      if (item.isSecret) return [];
      const given = (answers[item.id] ?? []).filter((answer) => answer.trim());
      return given.length ? [`${item.header}: ${given.join(", ")}`] : [];
    })
    .join("\n");
}

function structuredResponse(
  spec: UiBlockSpec,
  answers: Readonly<Record<string, readonly string[]>>,
): UiBlockResponse | null {
  const first = (id: string): string | undefined => answers[id]?.find((answer) => answer.trim());
  switch (spec.type) {
    case "confirm": {
      const answer = first(UI_CONFIRM_ACTION_QUESTION_ID);
      const action = answer === undefined ? undefined : matchLabel(spec.actions, answer);
      if (!action) return null;
      const values: Record<string, UiBlockValue> = {};
      for (const field of spec.fields ?? []) {
        if (!("select" in field)) continue;
        const given = first(field.select);
        if (given === undefined) continue;
        const option = matchOption(field.options, given);
        if (option === undefined) return null;
        values[field.select] = option;
      }
      return Object.keys(values).length ? { actionId: action.id, values } : { actionId: action.id };
    }
    case "quick_replies": {
      const answer = first(UI_QUICK_REPLIES_QUESTION_ID);
      const option = answer === undefined ? undefined : matchLabel(spec.options, answer);
      return option ? { actionId: option.id } : null;
    }
    case "choice": {
      const ids: string[] = [];
      for (const answer of answers[UI_CHOICE_QUESTION_ID] ?? []) {
        const options = choiceOptionsIn(spec.options, answer);
        if (!options) return null;
        for (const option of options) if (!ids.includes(option.id)) ids.push(option.id);
      }
      return { actionId: UI_BLOCK_SUBMIT_ACTION_ID, values: { [UI_CHOICE_VALUES_KEY]: ids } };
    }
    case "form": {
      const values: Record<string, UiBlockValue> = {};
      for (const field of spec.fields) {
        const given = first(field.id);
        if (given === undefined) continue;
        if (field.kind === "select" || field.kind === "segmented") {
          const option = matchOption(field.options, given);
          if (option === undefined) return null;
          values[field.id] = option;
        } else values[field.id] = field.kind === "date" ? given.trim() : given;
      }
      return { actionId: UI_BLOCK_SUBMIT_ACTION_ID, values };
    }
  }
}

export function uiBlockResponseFromAnswers(
  spec: UiBlockSpec,
  answers: Readonly<Record<string, readonly string[]>>,
): UiBlockResponse | null {
  const questions = uiBlockFallbackQuestions(spec);
  const text = answersText(questions, answers);
  if (!text && !questions.some((item) => item.isSecret && answers[item.id]?.some((answer) => answer.trim()))) {
    return null;
  }
  const structured = structuredResponse(spec, answers);
  const valid = structured === null ? null : validateUiBlockResponse(spec, structured);
  if (valid) return valid;
  const only = questions.length === 1 ? questions[0] : undefined;
  const single = only && !only.isSecret ? (answers[only.id] ?? []).join("\n").trim() : "";
  return { actionId: UI_BLOCK_TEXT_ACTION_ID, text: clip(single || text, UI_BLOCK_LIMITS.fieldValue) };
}

export function uiConfirmPreviewEditable(spec: UiBlockSpec): boolean {
  return (
    spec.type === "confirm" &&
    spec.preview !== undefined &&
    spec.actions.some((action) => action.id === UI_CONFIRM_EDIT_ACTION_ID)
  );
}

export function uiConfirmPreviewEdit<Answer extends readonly string[]>(
  spec: UiBlockSpec,
  answers: Readonly<Record<string, Answer>>,
): { answers: Record<string, Answer>; preview?: string } | null {
  const { [UI_CONFIRM_PREVIEW_ANSWER_ID]: edit, ...rest } = answers;
  if (edit === undefined) return { answers: rest };
  const [text, ...more] = edit;
  if (spec.type !== "confirm" || !uiConfirmPreviewEditable(spec) || more.length > 0) return null;
  if (!isBoundedString(text, UI_BLOCK_LIMITS.preview) || !text.trim()) return null;
  return text === spec.preview ? { answers: rest } : { answers: rest, preview: text };
}

export function uiConfirmAnswersWithPreview(
  spec: UiBlockSpec,
  response: UiBlockResponse,
  preview: string | undefined,
): Record<string, string[]> {
  const answers = uiBlockAnswersFromResponse(spec, response);
  const changed = preview !== undefined && spec.type === "confirm" && preview !== spec.preview;
  return changed ? { ...answers, [UI_CONFIRM_PREVIEW_ANSWER_ID]: [preview] } : answers;
}

export function uiBlockAnswersFromResponse(spec: UiBlockSpec, response: UiBlockResponse): Record<string, string[]> {
  if (response.actionId === UI_BLOCK_TEXT_ACTION_ID) {
    const firstQuestion = uiBlockFallbackQuestions(spec)[0];
    return firstQuestion ? { [firstQuestion.id]: [response.text ?? ""] } : {};
  }
  const values = response.values ?? {};
  switch (spec.type) {
    case "confirm": {
      const action = spec.actions.find((candidate) => candidate.id === response.actionId);
      const answers: Record<string, string[]> = {
        [UI_CONFIRM_ACTION_QUESTION_ID]: [action?.label ?? response.actionId],
      };
      for (const [key, value] of Object.entries(values)) answers[key] = [String(value)];
      return answers;
    }
    case "quick_replies": {
      const option = spec.options.find((candidate) => candidate.id === response.actionId);
      return { [UI_QUICK_REPLIES_QUESTION_ID]: [option?.label ?? response.actionId] };
    }
    case "choice": {
      const selected = values[UI_CHOICE_VALUES_KEY];
      const ids = Array.isArray(selected) ? selected : [];
      const labels = ids.map((id) => spec.options.find((option) => option.id === id)?.label ?? id);
      return { [UI_CHOICE_QUESTION_ID]: spec.multiple ? [labels.join("\n")] : labels };
    }
    case "form": {
      const answers: Record<string, string[]> = {};
      for (const field of spec.fields) {
        const value = values[field.id];
        if (value !== undefined && value !== "") answers[field.id] = [String(value)];
      }
      return answers;
    }
  }
}

export function uiBlockOutcomeText(
  spec: UiBlockSpec,
  response: UiBlockResponse,
  list: (items: readonly string[]) => string = (items) => items.join(", "),
): string {
  if (response.actionId === UI_BLOCK_TEXT_ACTION_ID) return clip(response.text ?? "", UI_BLOCK_LIMITS.outcome);
  const values = response.values ?? {};
  let text: string;
  switch (spec.type) {
    case "quick_replies":
      text = spec.options.find((option) => option.id === response.actionId)?.label ?? response.actionId;
      break;
    case "choice": {
      const selected = values[UI_CHOICE_VALUES_KEY];
      const ids = Array.isArray(selected) ? selected : [];
      text = list(ids.map((id) => spec.options.find((option) => option.id === id)?.label ?? id));
      break;
    }
    case "form":
      text = list(
        spec.fields.flatMap((field) => {
          const value = values[field.id];
          if (isSecretFormField(field) || value === undefined || value === "") return [];
          return [`${field.label ?? field.id}: ${String(value)}`];
        }),
      );
      break;
    case "confirm": {
      const label = spec.actions.find((action) => action.id === response.actionId)?.label ?? response.actionId;
      const details = list(Object.values(values).map((value) => (Array.isArray(value) ? list(value) : value)));
      text = details ? `${label} · ${details}` : label;
    }
  }
  return clip(text, UI_BLOCK_LIMITS.outcome);
}
