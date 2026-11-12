import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentApprovalPermissions,
  AgentPromptQuestion,
  AgentPromptResolution,
  RespondToBrowserTakeoverInput,
} from "@openbot/contracts/ipc";
import {
  COMPUTER_USE_MCP_SERVER_NAME,
  MCP_ELICITATION_DECISION_QUESTION_ID,
  vaultExpiryText,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  normalizeUiBlockSpec,
  UI_API_KEY_SCOPE_FIELD_ID,
  UI_VAULT_REQUEST_FIELDS,
  UI_VAULT_SECRET_FIELDS,
  type UiBlockResponse,
  type UiBlockSpec,
  type UiFormField,
  type UiVaultRequestField,
} from "@openbot/contracts/ui-blocks";
import { sourceText } from "@openbot/i18n/source";
import type { SavedApiKey } from "../agent-api-keys";
import type { BrowserToolArguments } from "../browser-tools";
import { type DynamicToolResult, getArray, getRecord, getString, isRecord } from "../protocol";

const MCP_ELICITATION_ALLOW_ONCE = "Allow once";
const MCP_ELICITATION_ALLOW_ALWAYS = "Always allow";
const MCP_ELICITATION_DECLINE = "Don't allow";
/** Field names a plugin uses for a credential. A match keeps the answer out of stored history. */
const SECRET_FIELD_PATTERN = /api[_-]?key|secret|token|password|passphrase|credential/i;

export type ElicitationFieldValue = string | number | boolean | string[];

export function secretElicitationField(id: string, property: DynamicRecord | undefined): boolean {
  if (property?.writeOnly === true || getString(property, "format") === "password") return true;
  return SECRET_FIELD_PATTERN.test(`${id} ${getString(property, "title") ?? ""}`);
}

function elicitationOptions(property: DynamicRecord): Array<{ label: string; description: string }> | null {
  if (Array.isArray(property.oneOf)) {
    return property.oneOf.filter(isRecord).flatMap((option) => {
      const value = getString(option, "const");
      if (!value) return [];
      return [{ label: getString(option, "title") ?? value, description: getString(option, "description") ?? "" }];
    });
  }
  if (Array.isArray(property.enum)) {
    return property.enum.filter(isString).map((value) => ({ label: value, description: "" }));
  }
  if (property.type === "boolean") {
    return [
      { label: "Yes", description: "" },
      { label: "No", description: "" },
    ];
  }
  return null;
}

export function elicitationValue(property: DynamicRecord | undefined, answers: string[]): ElicitationFieldValue {
  if (!property) return answers[0] ?? "";
  if (property.type === "array") return answers;
  if (property.type === "boolean") return /^(yes|true|1)$/i.test(answers[0] ?? "");
  if (Array.isArray(property.oneOf)) {
    // The card submits the displayed label, which is the title when the schema names one: the
    // response must carry the const the schema asked for instead.
    const selected = property.oneOf
      .filter(isRecord)
      .find((option) => (getString(option, "title") ?? getString(option, "const")) === answers[0]);
    if (selected) return getString(selected, "const") ?? answers[0] ?? "";
  }
  if (property.type === "number" || property.type === "integer") {
    const parsed = Number(answers[0]);
    return Number.isFinite(parsed) ? parsed : (answers[0] ?? "");
  }
  return answers[0] ?? "";
}

export function commandText(params: unknown): string | null {
  if (!isRecord(params)) return null;
  const command = params.command;
  if (isString(command)) return command;
  if (Array.isArray(command) && command.every(isString)) return command.join(" ");
  return null;
}

/** The short line under a question, when the request has one. */
function promptQuestionDetail(question: DynamicRecord): { detail?: string } {
  const detail = getString(question, "detail")?.trim();
  return detail ? { detail: detail.slice(0, INPUT_LIMITS.promptQuestion) } : {};
}

export function promptQuestions(params: unknown): AgentPromptQuestion[] {
  return getArray(params, "questions")
    .filter(isRecord)
    .map((question) => ({
      id: getString(question, "id") ?? randomUUID(),
      header: getString(question, "header") ?? "Question",
      question: getString(question, "question") ?? "The agent needs more information.",
      ...promptQuestionDetail(question),
      isSecret: question.isSecret === true,
      options: Array.isArray(question.options)
        ? question.options.filter(isRecord).map((option) => ({
            label: getString(option, "label") ?? "Option",
            description: getString(option, "description") ?? "",
          }))
        : null,
      ...(question.multiSelect === true ? { multiSelect: true } : {}),
    }));
}

/** A schema that asks for nothing is a consent hand-off: the plugin wants a yes or no. */
function elicitationConsentQuestion(params: unknown, serverName: string | null): AgentPromptQuestion | null {
  const message = getString(params, "message")?.trim();
  if (!message) return null;
  const subject = serverName === COMPUTER_USE_MCP_SERVER_NAME ? "Computer Use" : (serverName ?? "this plugin");
  const persistence = getArray(getRecord(params, "_meta"), "persist").filter(isString);
  return {
    id: MCP_ELICITATION_DECISION_QUESTION_ID,
    header: subject.slice(0, INPUT_LIMITS.promptHeader),
    question: message.slice(0, INPUT_LIMITS.promptQuestion),
    isSecret: false,
    options: [
      { label: MCP_ELICITATION_ALLOW_ONCE, description: `Allow this ${subject} request.` },
      ...(persistence.includes("always")
        ? [{ label: MCP_ELICITATION_ALLOW_ALWAYS, description: `Remember this access for future ${subject} requests.` }]
        : []),
      { label: MCP_ELICITATION_DECLINE, description: "Keep access blocked." },
    ],
  };
}

/**
 * One question per requested field, so a plugin can collect an API key or any other value. When a
 * field has its own text, the request message goes under the first question, so it is not lost.
 */
export function elicitationFieldQuestions(params: unknown, subject: string): AgentPromptQuestion[] {
  const properties = getRecord(getRecord(params, "requestedSchema"), "properties") ?? {};
  const message = getString(params, "message")?.trim() || undefined;
  return Object.entries(properties).flatMap(([id, property], index) => {
    if (!isRecord(property)) return [];
    const description = getString(property, "description");
    const question = description ?? message ?? `${subject} needs more information.`;
    const detail = index === 0 && description && message && message !== description ? message : undefined;
    return [
      {
        id,
        header: (getString(property, "title") ?? id).slice(0, INPUT_LIMITS.promptHeader),
        question: question.slice(0, INPUT_LIMITS.promptQuestion),
        ...(detail ? { detail: detail.slice(0, INPUT_LIMITS.promptQuestion) } : {}),
        isSecret: secretElicitationField(id, property),
        options: elicitationOptions(property),
      },
    ];
  });
}

export function mcpElicitationQuestions(params: unknown): AgentPromptQuestion[] | null {
  const serverName = getString(params, "serverName");
  const mode = getString(params, "mode") ?? "form";
  const requestedSchema = getRecord(params, "requestedSchema");
  const properties = getRecord(requestedSchema, "properties");
  if ((mode !== "form" && mode !== "openai/form") || !requestedSchema || !properties) return null;

  const questions =
    Object.keys(properties).length === 0
      ? [elicitationConsentQuestion(params, serverName)].filter((question) => question !== null)
      : elicitationFieldQuestions(params, serverName ?? "This plugin");
  return validPromptQuestions(questions) ? questions : null;
}

/**
 * Codex asks this before it runs an MCP tool, and says so in `_meta`. The marker tells the ask from a
 * plugin's own yes or no, which can carry the same words and the same `persist` list.
 */
const CODEX_MCP_TOOL_CALL_APPROVAL_KIND = "mcp_tool_call";

/** The card answer "Allow once", which `mcpElicitationResult` turns into one accepted consent. */
export const MCP_TOOL_CONSENT_ALLOW_ONCE: Record<string, string[]> = {
  [MCP_ELICITATION_DECISION_QUESTION_ID]: [MCP_ELICITATION_ALLOW_ONCE],
};

/**
 * Whether the request is Codex's consent to run one MCP tool: a form with no field and the marker. A
 * tool that the user set to ask every time offers no `persist`, but it is the same consent, so Full
 * access answers it too.
 */
export function mcpToolCallConsent(params: unknown): boolean {
  const mode = getString(params, "mode") ?? "form";
  const meta = getRecord(params, "_meta");
  const properties = getRecord(getRecord(params, "requestedSchema"), "properties");
  return (
    (mode === "form" || mode === "openai/form") &&
    properties !== null &&
    Object.keys(properties).length === 0 &&
    getString(meta, "codex_approval_kind") === CODEX_MCP_TOOL_CALL_APPROVAL_KIND
  );
}

export function mcpElicitationResult(
  params: unknown,
  answers: Record<string, string[]>,
): { action: "accept" | "cancel" | "decline"; content: DynamicRecord | null; _meta: DynamicRecord | null } {
  const properties = getRecord(getRecord(params, "requestedSchema"), "properties");
  if (properties && Object.keys(properties).length > 0) {
    return elicitationFieldResult(params, properties, answers);
  }
  const selected = answers[MCP_ELICITATION_DECISION_QUESTION_ID]?.[0];
  if (selected === MCP_ELICITATION_ALLOW_ONCE) {
    return { action: "accept", content: {}, _meta: null };
  }
  if (selected === MCP_ELICITATION_ALLOW_ALWAYS && getArray(getRecord(params, "_meta"), "persist").includes("always")) {
    return { action: "accept", content: {}, _meta: { persist: "always" } };
  }
  if (selected === MCP_ELICITATION_DECLINE) {
    return { action: "decline", content: null, _meta: null };
  }
  return { action: "cancel", content: null, _meta: null };
}

/** A skipped required field declines the request: a partial form is not an answer. */
function elicitationFieldResult(
  params: unknown,
  properties: DynamicRecord,
  answers: Record<string, string[]>,
): { action: "accept" | "decline"; content: DynamicRecord | null; _meta: DynamicRecord | null } {
  const content: Record<string, ElicitationFieldValue> = {};
  for (const [id, values] of Object.entries(answers)) {
    if (values.length === 0) continue;
    content[id] = elicitationValue(getRecord(properties, id) ?? undefined, values);
  }
  const required = getArray(getRecord(params, "requestedSchema"), "required").filter(isString);
  if (required.some((id) => !(id in content)) || Object.keys(content).length === 0) {
    return { action: "decline", content: null, _meta: null };
  }
  return { action: "accept", content, _meta: null };
}

/**
 * Why the questions make no card, or null when they make one. The text names the question and the
 * limit, so the agent can correct its call: the advertised schema has no limits (#6268).
 */
export function promptQuestionsProblem(questions: AgentPromptQuestion[]): string | null {
  if (questions.length === 0) return "questions must be a non-empty array of question objects, not text.";
  if (questions.length > INPUT_LIMITS.promptQuestions)
    return `questions has ${questions.length} items; the limit is ${INPUT_LIMITS.promptQuestions}.`;
  const ids = new Set<string>();
  for (const [index, question] of questions.entries()) {
    const at = `questions[${index}]`;
    if (question.id.length === 0 || question.id.length > INPUT_LIMITS.identifier)
      return `${at}.id must have 1 to ${INPUT_LIMITS.identifier} characters. Leave id out to get one.`;
    if (ids.has(question.id))
      return `${at}.id is the id of an earlier question. Give each question a different id, or leave id out.`;
    ids.add(question.id);
    if (question.header.length > INPUT_LIMITS.promptHeader)
      return `${at}.header has ${question.header.length} characters; the limit is ${INPUT_LIMITS.promptHeader}.`;
    if (question.question.length === 0 || question.question.length > INPUT_LIMITS.promptQuestion)
      return `${at}.question must have 1 to ${INPUT_LIMITS.promptQuestion} characters.`;
    if (question.options === null) continue;
    if (question.options.length > INPUT_LIMITS.promptOptions)
      return `${at}.options has ${question.options.length} options; the limit is ${INPUT_LIMITS.promptOptions}. Keep the most likely options: the user can also type an answer.`;
    for (const [position, option] of question.options.entries()) {
      if (option.label.length === 0 || option.label.length > INPUT_LIMITS.promptOptionLabel)
        return `${at}.options[${position}].label must have 1 to ${INPUT_LIMITS.promptOptionLabel} characters.`;
      if (option.description.length > INPUT_LIMITS.promptOptionDescription)
        return `${at}.options[${position}].description has ${option.description.length} characters; the limit is ${INPUT_LIMITS.promptOptionDescription}.`;
    }
  }
  return null;
}

export function validPromptQuestions(questions: AgentPromptQuestion[]): boolean {
  return promptQuestionsProblem(questions) === null;
}

export function questionPromptText(questions: AgentPromptQuestion[], resolution: AgentPromptResolution | null): string {
  const responses = resolution?.status === "answered" ? resolution.responses : null;
  return questions
    .map((question) => {
      const lines = [`Question: ${question.question}`];
      if (!responses) return lines.join("\n");
      const response = responses[question.id];
      if (!response || response.status === "skipped") lines.push("Answer: Skipped");
      else if (question.isSecret || !response.answers) lines.push("Answer: Private answer");
      else lines.push(`Answer: ${response.answers.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function promptResolution(
  questions: AgentPromptQuestion[],
  answers: Record<string, string[]>,
): AgentPromptResolution {
  if (Object.keys(answers).length === 0) return { status: "cancelled" };
  return {
    status: "answered",
    responses: Object.fromEntries(
      questions.map((question) => {
        const values = answers[question.id] ?? [];
        if (values.length === 0) return [question.id, { status: "skipped" }];
        return [question.id, question.isSecret ? { status: "answered" } : { status: "answered", answers: [...values] }];
      }),
    ),
  };
}

export function dynamicPromptResult(answers: Record<string, string[]>): DynamicToolResult {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: JSON.stringify(answers) }],
  };
}

/** The answer for a question that expired before the user answered it. Only the model reads it. */
export function expiredPromptResult(
  responseKind: "dynamic-tool" | "mcp-elicitation" | "user-input" | "ui-block",
): DynamicToolResult | { answers: Record<string, never> } | { action: "cancel"; content: null; _meta: null } {
  if (responseKind === "mcp-elicitation") return { action: "cancel", content: null, _meta: null };
  if (responseKind === "user-input") return { answers: {} };
  return {
    success: false,
    contentItems: [{ type: "inputText", text: "The question expired before the user answered." }],
  };
}

/**
 * The answer for a question or block that the user did not answer because they wrote a new message
 * in the chat. Only the model reads it. The message reaches the agent as a steer or as the next turn.
 */
export function userMessagePromptResult(
  responseKind: "dynamic-tool" | "user-input" | "ui-block",
  blockId: string | undefined,
): DynamicToolResult | { answers: Record<string, never> } {
  // `request_user_input` has no field for a note: empty answers are what a skip gives.
  if (responseKind === "user-input") return { answers: {} };
  const value = {
    status: "skipped",
    ...(blockId ? { blockId } : {}),
    next: "The user wrote a new message in this chat instead of answering. Follow that message. If it is not in your input, end your turn: it starts next. Ask again only if you still need the answer.",
  };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

/** What a blocking UI block (`ask_ui`) ended with. */
export type UiBlockPromptOutcome =
  | { status: "answered"; blockId: string; response: UiBlockResponse }
  | { status: "skipped" | "expired"; blockId: string };

/**
 * The `ask_ui` result. Only the model reads it: the ids it gave, the values, and the user's words when
 * the user answered in text. An expired block is a failed call, as an expired question is.
 */
export function uiBlockPromptResult(outcome: UiBlockPromptOutcome): DynamicToolResult {
  const value =
    outcome.status === "answered"
      ? { status: outcome.status, blockId: outcome.blockId, ...outcome.response }
      : outcome.status === "expired"
        ? {
            status: outcome.status,
            blockId: outcome.blockId,
            next: "The block closed before the user answered. Ask again only if you still need the answer.",
          }
        : { status: outcome.status, blockId: outcome.blockId };
  return { success: outcome.status !== "expired", contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

/** The id of the one secret field in the form of `request_api_key`. */
export const API_KEY_FIELD_ID = "key";

/** The id of the field of the `request_api_key` form that selects who can use the key. */
export const API_KEY_SCOPE_FIELD_ID = UI_API_KEY_SCOPE_FIELD_ID;

/** The option of the scope field that keeps the key for the asking agent only. */
export const API_KEY_SCOPE_AGENT = sourceText("status.agent.apiKeyScope.agent");

/**
 * The form of `request_api_key`: one required secret field. Its label is the variable name, because
 * the user finds the key by that name at the service. With `vault`, a second field saves the key in the
 * Vault for every agent, which is the first option, or for the asking agent only. Null when the contract
 * refuses it.
 */
export function apiKeyFormSpec(input: {
  name: string;
  title: string;
  placeholder?: string | undefined;
  submit?: string | undefined;
  vault?: boolean | undefined;
}): UiBlockSpec | null {
  const allAgents = sourceText("status.agent.apiKeyScope.vault");
  return normalizeUiBlockSpec({
    type: "form",
    title: input.title,
    fields: [
      {
        id: API_KEY_FIELD_ID,
        kind: "text",
        label: input.name,
        required: true,
        secret: true,
        ...(input.placeholder ? { placeholder: input.placeholder } : {}),
      },
      ...(input.vault
        ? [
            {
              id: API_KEY_SCOPE_FIELD_ID,
              kind: "segmented",
              label: sourceText("status.agent.apiKeyScope.label"),
              options: [allAgents, API_KEY_SCOPE_AGENT],
              required: true,
              value: allAgents,
            },
          ]
        : []),
    ],
    ...(input.submit ? { submit: input.submit } : {}),
  });
}

/**
 * The `request_api_key` result: the file of the saved key, or a skip. It never holds a form value, so
 * the key stays out of the provider transcript.
 */
export function apiKeyPromptResult(blockId: string, saved: SavedApiKey | null): DynamicToolResult {
  const value = saved
    ? {
        status: "saved",
        blockId,
        name: saved.name,
        path: saved.path,
        ...(saved.source ? { source: saved.source } : {}),
      }
    : { status: "skipped", blockId };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

type VaultRequestArguments = BrowserToolArguments<"request_vault_item">;

/** The arguments that an agent may fill in, for each kind. A secret field is never one of them. */
const VAULT_REQUEST_PREFILL: Record<VaultRequestArguments["kind"], readonly string[]> = {
  login: ["website", "username"],
  card: ["label", "nameOnCard", "expMonth", "expYear"],
  contact: UI_VAULT_REQUEST_FIELDS.contact,
};

const VAULT_REQUEST_REQUIRED: readonly UiVaultRequestField[] = ["website", "password", "number", "expiry"];

const VAULT_REQUEST_LABEL = {
  website: sourceText("status.agent.vaultField.website"),
  username: sourceText("status.agent.vaultField.username"),
  password: sourceText("status.agent.vaultField.password"),
  label: sourceText("status.agent.vaultField.label"),
  nameOnCard: sourceText("status.agent.vaultField.nameOnCard"),
  number: sourceText("status.agent.vaultField.number"),
  expiry: sourceText("status.agent.vaultField.expiry"),
  securityCode: sourceText("status.agent.vaultField.securityCode"),
  fullName: sourceText("status.agent.vaultField.fullName"),
  address: sourceText("status.agent.vaultField.address"),
  address2: sourceText("status.agent.vaultField.address2"),
  city: sourceText("status.agent.vaultField.city"),
  region: sourceText("status.agent.vaultField.region"),
  postalCode: sourceText("status.agent.vaultField.postalCode"),
  country: sourceText("status.agent.vaultField.country"),
  phone: sourceText("status.agent.vaultField.phone"),
  email: sourceText("status.agent.vaultField.email"),
} as const satisfies Record<UiVaultRequestField, string>;

/** Two-digit month and year, as the Vault dialog shows an expiry. */
function vaultRequestValue(args: VaultRequestArguments, field: UiVaultRequestField): string | undefined {
  if (field === "expiry")
    return args.expMonth !== undefined && args.expYear !== undefined
      ? vaultExpiryText(args.expMonth, args.expYear)
      : undefined;
  if (UI_VAULT_SECRET_FIELDS.includes(field)) return undefined;
  const value = Object.entries(args).find(([key]) => key === field)?.[1];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The form of `request_vault_item`: the fields of the Vault dialog for the kind, with the values the
 * agent gave. A secret field has no value. A string tells the agent what is wrong with the arguments.
 */
export function vaultRequestFormSpec(args: VaultRequestArguments): UiBlockSpec | string {
  const allowed = VAULT_REQUEST_PREFILL[args.kind];
  const misplaced = Object.entries(args).find(
    ([key, value]) => value !== undefined && key !== "kind" && key !== "title" && !allowed.includes(key),
  );
  if (misplaced) return `${misplaced[0]} is not a field of a ${args.kind}. You can fill in: ${allowed.join(", ")}.`;
  if ((args.expMonth === undefined) !== (args.expYear === undefined)) return "Give expMonth and expYear together.";
  const fields = UI_VAULT_REQUEST_FIELDS[args.kind].map((id): UiFormField => {
    const value = vaultRequestValue(args, id);
    return {
      id,
      kind: "text",
      label: VAULT_REQUEST_LABEL[id],
      ...(VAULT_REQUEST_REQUIRED.includes(id) ? { required: true } : {}),
      ...(UI_VAULT_SECRET_FIELDS.includes(id) ? { secret: true } : {}),
      ...(id === "expiry" ? { placeholder: sourceText("status.agent.vaultExpiryHint") } : {}),
      ...(value === undefined ? {} : { value }),
    };
  });
  return (
    normalizeUiBlockSpec({ type: "form", title: args.title, fields, submit: sourceText("status.agent.vaultSave") }) ??
    "OpenBot could not show this form. Use a shorter title or shorter values and retry."
  );
}

/** The `request_vault_item` result: what the user saved, or a skip. It never holds a form value. */
export function vaultPromptResult(
  blockId: string,
  saved: { id: string; kind: string; name: string } | null,
): DynamicToolResult {
  const value = saved
    ? { status: "saved", blockId, id: saved.id, kind: saved.kind, name: saved.name }
    : { status: "skipped", blockId };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

/** `vault` says what happened to a password that the user asked to keep in the Vault. */
export function browserTakeoverResult(
  decision: RespondToBrowserTakeoverInput["decision"],
  vault?: string,
  vaultSkipped?: string,
): DynamicToolResult {
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          status: decision === "complete" ? "completed" : "cancelled",
          ...(vault ? { vault } : {}),
          ...(vaultSkipped ? { vaultSkipped } : {}),
          ...(decision === "complete" ? { next: "Take a fresh snapshot and continue the task." } : {}),
        }),
      },
    ],
  };
}

/** The answer for a browser tool call that waited while the user controlled its tab. Only the model reads it. */
export function browserUserControlResult(): DynamicToolResult {
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          status: "user-control-ended",
          note: "The user controlled this tab and may have changed the page. The tool call did not run.",
          next: "Take a fresh snapshot before you act on this tab again.",
        }),
      },
    ],
  };
}

export function browserTakeoverError(
  message = "OpenBot could not create a browser takeover request.",
): DynamicToolResult {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: message }],
  };
}

export function approvalPermissions(params: unknown): AgentApprovalPermissions {
  const permissions = getRecord(params, "permissions");
  const fileSystem = getRecord(permissions, "fileSystem");
  const network = getRecord(permissions, "network");
  const read = getArray(fileSystem, "read").filter(isString);
  const write = getArray(fileSystem, "write").filter(isString);
  return {
    fileSystem: { read, write },
    network: network?.enabled === true,
  };
}
