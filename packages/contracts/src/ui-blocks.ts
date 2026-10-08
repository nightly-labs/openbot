import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import type { AgentPromptQuestion, ConversationMessageSender } from "./ipc-conversation-messages";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * Interactive blocks an agent puts in a conversation.
 *
 * An agent draws a block with the OpenBot tool `ask_ui` and waits for the answer. The block types are
 * `confirm`, `quick_replies`, `choice` and `form`. The block is stored as an ordinary `question_prompt`
 * message: `questionPrompt` holds the questions from `uiBlockFallbackQuestions`, and `uiBlock` sits
 * beside it. A client that does not know `uiBlock` answers the questions; the answer comes back
 * through the released `respondToPrompt` route and `uiBlockResponseFromAnswers` reads it.
 *
 * Every field is plain text. No field is HTML, and no renderer may read one as HTML or Markdown,
 * except that `confirm.preview` may go through the app's safe Markdown renderer.
 *
 * No key in a spec, a response or a state starts with `bot`: the legacy message read renames such
 * keys anywhere in the stored tree. For the same reason an id a response uses as a record key may
 * not be one of those legacy names (see `isUiBlockId`).
 */

/** The version of `ConversationUiBlock`. A reader rejects any other. */
export const UI_BLOCK_VERSION = 1;

export const UI_BLOCK_LIMITS = {
  /** The spec as `JSON.stringify` writes it, in UTF-16 code units. */
  specJson: 64_000,
  /** A response as `JSON.stringify` writes it, in UTF-16 code units. */
  responseJson: 16_000,
  id: 64,
  title: 200,
  label: 120,
  meta: 60,
  text: 2_000,
  preview: 8_000,
  /** A text the person types: a form field, a free-text reply. */
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

/** Letters, digits, `_ . : -`; 1 to 64 characters. See `isUiBlockId` for the reserved ids. */
export const UI_BLOCK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/u;

/** `actionId` of the submit button of a `choice` or a `form`. */
export const UI_BLOCK_SUBMIT_ACTION_ID = "submit";
/**
 * `actionId` of an answer in words: a `quick_replies` free-text reply, or the
 * answer of a client that only saw the fallback questions and typed something the block cannot read.
 * The words are in `UiBlockResponse.text`.
 */
export const UI_BLOCK_TEXT_ACTION_ID = "_text";
/** The key of the selected option ids in a `choice` response's `values`. */
export const UI_CHOICE_VALUES_KEY = "selected";
/** The fallback question id that carries the chosen action of a `confirm`. */
export const UI_CONFIRM_ACTION_QUESTION_ID = "action";
/** The fallback question id of a `quick_replies`. */
export const UI_QUICK_REPLIES_QUESTION_ID = "reply";
/** The fallback question id of a `choice`. */
export const UI_CHOICE_QUESTION_ID = "choice";

// Keys the legacy message read renames (`legacy-conversation-message.ts`). An id that becomes a record
// key in a response must not be one of them.
const LEGACY_KEY_IDS: ReadonlySet<string> = new Set(["botId", "recipientBotId", "recipientBotIds", "senderBotId"]);

// ---------------------------------------------------------------------------------------------------
// Types

/** The look of a button. Only these; an agent cannot style a block any other way. */
export type UiActionStyle = "primary" | "secondary" | "ghost" | "danger";
export const UI_ACTION_STYLES = ["primary", "secondary", "ghost", "danger"] as const satisfies readonly UiActionStyle[];

/**
 * A button. `style: "danger"` or `confirm: true` makes it a privileged action: only the server owner or
 * an admin may press it (see `uiBlockActionIsPrivileged`), and `confirm` makes the app ask the person
 * again in the block before it sends the action.
 */
export interface UiAction {
  id: string;
  label: string;
  /** Absent means `secondary`. */
  style?: UiActionStyle;
  confirm?: boolean;
}

/** A read-only line of a `confirm`, such as "To: someone@example.com". */
export interface UiConfirmValueField {
  label: string;
  value: string;
}

/**
 * A choice inside a `confirm`, such as the sender address. The chosen option is the response value
 * under the key `select`; the first option is the default.
 */
export interface UiConfirmSelectField {
  label: string;
  select: string;
  options: string[];
}

export type UiConfirmField = UiConfirmValueField | UiConfirmSelectField;

/** Blocking. "Do this?" with the details and up to four buttons. */
export interface UiConfirmBlock {
  type: "confirm";
  title: string;
  /** Draws the block as dangerous. Its `primary` and `danger` buttons are held to press. */
  danger?: boolean;
  /** How long a held button is held, in ms, within `holdMinMs`..`holdMaxMs`. */
  confirmHold?: number;
  fields?: UiConfirmField[];
  /** A preview of what will happen, such as the body of a letter. Safe Markdown. */
  preview?: string;
  actions: UiAction[];
}

export interface UiOption {
  id: string;
  label: string;
}

/** Blocking. A row of reply chips. */
export interface UiQuickRepliesBlock {
  type: "quick_replies";
  title?: string;
  options: UiOption[];
  /** Shows a text box beside the chips. A typed reply is valid either way (`UI_BLOCK_TEXT_ACTION_ID`). */
  allowText?: boolean;
}

export interface UiChoiceOption extends UiOption {
  /** A short note on the right, such as a count. */
  meta?: string;
  /** Selected when the block opens. At most one unless `multiple`. */
  selected?: boolean;
}

/** Blocking. A list to pick one option from, or several with `multiple`. */
export interface UiChoiceBlock {
  type: "choice";
  title: string;
  multiple?: boolean;
  options: UiChoiceOption[];
  /** The submit button label. */
  submit?: string;
}

export interface UiFormTextField {
  id: string;
  kind: "text" | "textarea";
  label: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  /**
   * Only on a `text` field, and only without `value`. The app draws a password box. The agent gets the
   * value, but OpenBot does not store it: the stored response, the outcome and the fallback question
   * resolution leave it out.
   */
  secret?: boolean;
}

export interface UiFormOptionsField {
  id: string;
  kind: "select" | "segmented";
  label?: string;
  options: string[];
  required?: boolean;
  /** One of `options`. */
  value?: string;
}

export interface UiFormDateField {
  id: string;
  kind: "date";
  label: string;
  required?: boolean;
  /** `YYYY-MM-DD`. */
  value?: string;
}

export type UiFormField = UiFormTextField | UiFormOptionsField | UiFormDateField;
export type UiFormFieldKind = UiFormField["kind"];

/** Blocking. A small form; every value is a string (a date is `YYYY-MM-DD`). */
export interface UiFormBlock {
  type: "form";
  title: string;
  fields: UiFormField[];
  /** The submit button label. */
  submit?: string;
}

export type UiBlockSpec = UiConfirmBlock | UiQuickRepliesBlock | UiChoiceBlock | UiFormBlock;
export type UiBlockType = UiBlockSpec["type"];

export const UI_BLOCK_TYPES = ["confirm", "quick_replies", "choice", "form"] as const satisfies readonly UiBlockType[];

export type UiBlockValue = string | string[];

/**
 * What the person did with a block. `validateUiBlockResponse` checks it against the spec.
 *
 * | Block           | `actionId`                         | `values`                                  |
 * | --------------- | ---------------------------------- | ----------------------------------------- |
 * | `confirm`       | an action id                       | `select` id → one of its options          |
 * | `quick_replies` | an option id                       | none                                      |
 * | `choice`        | `submit`                           | `selected` → option ids                   |
 * | `form`          | `submit`                           | field id → string                         |
 *
 * Any block also takes `actionId: "_text"` with `text` (`UI_BLOCK_TEXT_ACTION_ID`).
 */
export interface UiBlockResponse {
  actionId: string;
  values?: Record<string, UiBlockValue>;
  /** An answer in words, with `UI_BLOCK_TEXT_ACTION_ID`. */
  text?: string;
}

/**
 * - `pending`: open. The block waits for its answer.
 * - `answered`: frozen with `response`.
 * - `expired`: the turn ended, the app restarted, or the agent's call was cancelled before an answer.
 * - `closed`: shut without an answer: the person skipped it or the agent closed it.
 */
export type UiBlockStatus = "pending" | "answered" | "expired" | "closed";
export const UI_BLOCK_STATUSES = [
  "pending",
  "answered",
  "expired",
  "closed",
] as const satisfies readonly UiBlockStatus[];

export interface UiBlockState {
  status: UiBlockStatus;
  /** Required when `answered`. */
  response?: UiBlockResponse;
  respondedBy?: ConversationMessageSender;
  /** ISO time. */
  respondedAt?: string;
  /** The line the frozen block shows, such as the chosen button. See `uiBlockOutcomeText`. */
  outcome?: string;
}

/** The `uiBlock` field of a `ConversationMessage`. */
export interface ConversationUiBlock {
  version: typeof UI_BLOCK_VERSION;
  /** Given by the agent or made by the host. */
  blockId: string;
  spec: UiBlockSpec;
  state: UiBlockState;
}

// ---------------------------------------------------------------------------------------------------
// Small predicates

export function isUiBlockType(value: unknown): value is UiBlockType {
  return isOneOf(UI_BLOCK_TYPES, value);
}

/**
 * An id an agent may give. Ids that start with `_` are OpenBot's own (`_text`, and `__proto__` can never
 * become a record key), and the legacy `bot*` key names are refused because the stored tree renames them.
 */
export function isUiBlockId(value: unknown): value is string {
  return isString(value) && UI_BLOCK_ID_PATTERN.test(value) && !value.startsWith("_") && !LEGACY_KEY_IDS.has(value);
}

// ---------------------------------------------------------------------------------------------------
// Spec reading. Readers throw `InvalidUiBlock`; the exported functions turn that into null.

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

/** A string within `max`; `nonBlank` also refuses an empty or all-space one. */
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

/** Option labels must be unique too: an answer from a client that only saw the fallback names the label. */
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

/** A form field whose value OpenBot does not store. See `UiFormTextField.secret`. */
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

/**
 * The spec with only the keys this module knows, or null when it breaks a rule: an unknown `type`, a
 * missing or malformed field, a limit, a duplicate id or option label, or a reserved id. The input may
 * carry other keys; they are left out. The backend stores what this returns.
 */
export function normalizeUiBlockSpec(value: unknown): UiBlockSpec | null {
  return attempt(() => readSpec(value));
}

export function isUiBlockSpec(value: unknown): value is UiBlockSpec {
  return normalizeUiBlockSpec(value) !== null;
}

// ---------------------------------------------------------------------------------------------------
// Responses

function actionsOf(spec: UiBlockSpec): readonly UiAction[] {
  return spec.type === "confirm" ? spec.actions : [];
}

/** The entries of a response's `values`, with every key a valid id. The values are checked by the caller. */
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
        // A stored response never holds a secret value; reading one drops it.
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

/** `stored` reads a response from a stored state, which leaves out the value of a secret field. */
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

/**
 * The response with only known keys, or null when it does not fit the spec: an action, option or
 * field id the spec does not have, a value of the wrong kind or outside its options, a required form
 * field left empty, or more than `responseJson` in all.
 */
export function validateUiBlockResponse(spec: UiBlockSpec, value: unknown): UiBlockResponse | null {
  return attempt(() => readResponse(spec, value));
}

export function isUiBlockResponseFor(spec: UiBlockSpec, value: unknown): value is UiBlockResponse {
  return validateUiBlockResponse(spec, value) !== null;
}

/**
 * Whether only the server owner or an admin may take this action: a `danger` button, a button with
 * `confirm`, or a `primary` button of a `danger` confirm. Anyone in the conversation may take any
 * other action, as anyone may answer a question.
 */
export function uiBlockActionIsPrivileged(spec: UiBlockSpec, actionId: string): boolean {
  const action = actionsOf(spec).find((candidate) => candidate.id === actionId);
  if (!action) return false;
  if (action.style === "danger" || action.confirm === true) return true;
  return spec.type === "confirm" && spec.danger === true && action.style === "primary";
}

/**
 * Whether the block has any action that `uiBlockActionIsPrivileged` keeps for the owner or an admin.
 * On such a block an answer in words (`UI_BLOCK_TEXT_ACTION_ID`) is privileged too, so a member cannot
 * write "yes" to an action they may not press.
 */
export function uiBlockHasPrivilegedAction(spec: UiBlockSpec): boolean {
  return actionsOf(spec).some((action) => uiBlockActionIsPrivileged(spec, action.id));
}

// ---------------------------------------------------------------------------------------------------
// State

function readSender(value: unknown): ConversationMessageSender {
  const record = readRecord(value);
  check(isIdentifier(record.id) && isBoundedString(record.name, INPUT_LIMITS.accountName));
  return { id: record.id, name: record.name };
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
  return state;
}

function readConversationUiBlock(value: unknown): ConversationUiBlock {
  const record = readRecord(value);
  check(record.version === UI_BLOCK_VERSION);
  const spec = readSpec(record.spec);
  return { version: UI_BLOCK_VERSION, blockId: readId(record.blockId), spec, state: readState(spec, record.state) };
}

/**
 * The block with only known keys, or null when any part of it is malformed. The response leaves out the
 * value of a secret form field. The backend stores what this returns, so a stored block always reads.
 */
export function normalizeConversationUiBlock(value: unknown): ConversationUiBlock | null {
  return attempt(() => readConversationUiBlock(value));
}

/** The guard `isConversationMessage` uses. A malformed block fails the whole message. */
export function isConversationUiBlock(value: unknown): value is ConversationUiBlock {
  return normalizeConversationUiBlock(value) !== null;
}

// ---------------------------------------------------------------------------------------------------
// Fallbacks for clients that do not know `uiBlock`

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

/** The options as question options when they fit `INPUT_LIMITS.promptOptions`; else null. */
function fittingOptions(labels: readonly string[]): Array<{ label: string }> | null {
  return labels.length <= INPUT_LIMITS.promptOptions ? labels.map((label) => ({ label })) : null;
}

function listText(labels: readonly string[]): string {
  return labels.map((label) => `- ${label}`).join("\n");
}

function confirmFieldLine(field: UiConfirmField): string {
  return "select" in field ? `${field.label}: ${field.options[0] ?? ""}` : `${field.label}: ${field.value}`;
}

/**
 * The questions a blocking block stores in `questionPrompt`. A client that does not know `uiBlock`
 * shows them and can answer; `uiBlockResponseFromAnswers` reads the answer. A question has at most
 * `INPUT_LIMITS.promptOptions` options; a longer list goes into the question text and the question
 * takes a typed answer instead.
 *
 * - `confirm`: `action` with the action labels, then one question per `select` field (id = `select`).
 * - `quick_replies`: `reply`.
 * - `choice`: `choice`. A `multiple` choice always takes a typed answer: one or more labels, one per
 *   line or comma-separated.
 * - `form`: one question per field, id = field id. A secret field is a secret question.
 */
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
      const title = spec.title ?? "Choose a reply";
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
      const hint = spec.multiple ? "Reply with one or more of these, one per line:" : "Reply with one of these:";
      return [question(UI_CHOICE_QUESTION_ID, spec.title, `${spec.title}\n\n${hint}\n${listText(labels)}`, null)];
    }
    case "form":
      return spec.fields.map((field) => {
        const label = field.label ?? field.id;
        const header = field.required ? label : `${label} (optional)`;
        if (field.kind === "select" || field.kind === "segmented") {
          const options = fittingOptions(field.options);
          return question(field.id, header, options ? label : `${label}\n\n${listText(field.options)}`, options);
        }
        if (field.kind === "date") return question(field.id, header, `${label} (YYYY-MM-DD)`, null);
        return question(field.id, header, label, null, isSecretFormField(field));
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

/**
 * The options one typed choice answer names, or null when a part names none. A label may hold a comma
 * or a semicolon ("Yes, send it"), so the whole answer and then each line are matched first, and only a
 * line that is no label is split at commas and semicolons.
 */
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

/** The answers as `header: answer` lines. A secret answer is left out, so it is never stored as text. */
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

/**
 * The response read back from the answers to `uiBlockFallbackQuestions`, as `respondToPrompt` carries
 * them. An answer may name an option by its label (what a client that only saw the questions sends)
 * or by its id. When the answers cannot be read as the block's response, they become one answer in
 * words (`UI_BLOCK_TEXT_ACTION_ID`) with every answer as a `header: answer` line, except a secret one.
 * Null when nothing was answered.
 */
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

/**
 * The answers to send through `respondToPrompt` for a response to a blocking block, keyed by the
 * fallback question ids. Options are named by label, so the stored `questionPrompt.resolution` reads
 * well on a client that only shows the questions. `uiBlockResponseFromAnswers` reads them back.
 */
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

/**
 * The line a frozen block shows for a response, such as the chosen button or the selected options.
 * Plain text within `outcome`. A secret form value is left out. `list` joins the parts of a list in
 * the reader's language; the backend stores the line with commas, and an app may draw it again with
 * its own `list`.
 */
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
