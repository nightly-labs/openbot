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
  isReservedMcpServerName,
  MCP_ELICITATION_DECISION_QUESTION_ID,
  vaultExpiryText,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { decodeSharedLocationAnswer } from "@openbot/contracts/team-protocol/ui-block-location-v1";
import {
  normalizeUiBlockSpec,
  UI_API_KEY_SCOPE_FIELD_ID,
  UI_CONFIRM_ACTION_QUESTION_ID,
  UI_CONFIRM_EDIT_ACTION_ID,
  UI_LOCATION_FIELD_ID,
  UI_VAULT_REQUEST_FIELDS,
  UI_VAULT_SECRET_FIELDS,
  type UiBlockResponse,
  type UiBlockSpec,
  type UiFormField,
  type UiVaultRequestField,
  uiBlockFallbackQuestions,
} from "@openbot/contracts/ui-blocks";
import { sourceText } from "@openbot/i18n/source";
import type { SavedApiKey } from "../agent-api-keys";
import type { BrowserToolArguments } from "../browser-tools";
import { type DynamicToolResult, getArray, getRecord, getString, isRecord } from "../protocol";

const MCP_ELICITATION_ALLOW_ONCE = "Allow once";
const MCP_ELICITATION_ALLOW_ALWAYS = "Always allow";
const MCP_ELICITATION_DECLINE = "Don't allow";
const MCP_SIGN_IN_PAGE_DONE = sourceText("status.provider.confirmContinue");
const MCP_SIGN_IN_PAGE_DECLINE = sourceText("status.agent.mcpSignInPageDecline");
const SECRET_FIELD_PATTERN = /api[_-]?key|secret|token|password|passphrase|credential/i;

export type ElicitationFieldValue = string | number | boolean | string[];

export function secretElicitationField(id: string, property: DynamicRecord | undefined): boolean {
  if (property?.writeOnly === true || getString(property, "format") === "password") return true;
  return SECRET_FIELD_PATTERN.test(`${id} ${getString(property, "title") ?? ""}`);
}

function elicitationOptionLabel(text: string): string {
  return text.slice(0, INPUT_LIMITS.promptOptionLabel);
}

function isElicitationOptionAnswer(text: string, answer: string | undefined): boolean {
  return text === answer || elicitationOptionLabel(text) === answer;
}

function elicitationOptions(property: DynamicRecord): Array<{ label: string; description: string }> | null {
  if (Array.isArray(property.oneOf)) {
    return property.oneOf.filter(isRecord).flatMap((option) => {
      const value = getString(option, "const");
      if (!value) return [];
      return [
        {
          label: elicitationOptionLabel(getString(option, "title") ?? value),
          description: (getString(option, "description") ?? "").slice(0, INPUT_LIMITS.promptOptionDescription),
        },
      ];
    });
  }
  if (Array.isArray(property.enum)) {
    return property.enum.filter(isString).map((value) => ({ label: elicitationOptionLabel(value), description: "" }));
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
    const selected = property.oneOf
      .filter(isRecord)
      .find((option) =>
        isElicitationOptionAnswer(getString(option, "title") ?? getString(option, "const") ?? "", answers[0]),
      );
    if (selected) return getString(selected, "const") ?? answers[0] ?? "";
  }
  if (Array.isArray(property.enum)) {
    const selected = property.enum.filter(isString).find((value) => isElicitationOptionAnswer(value, answers[0]));
    if (selected !== undefined) return selected;
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

export function elicitationFieldQuestions(params: unknown, subject: string): AgentPromptQuestion[] {
  const properties = getRecord(getRecord(params, "requestedSchema"), "properties") ?? {};
  const message = getString(params, "message")?.trim() || undefined;
  return Object.entries(properties).flatMap(([id, property], index) => {
    if (!isRecord(property)) return [];
    const description = getString(property, "description");
    const question = description ?? message ?? `${subject} needs more information.`;
    const options = elicitationOptions(property);
    const hidden = options?.slice(INPUT_LIMITS.promptOptions).map((option) => option.label) ?? [];
    const detail = [
      index === 0 && description && message && message !== description ? message : undefined,
      hidden.length > 0 ? sourceText("status.agent.elicitationMoreOptions", { options: hidden.join(", ") }) : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    return [
      {
        id,
        header: (getString(property, "title") ?? id).slice(0, INPUT_LIMITS.promptHeader),
        question: question.slice(0, INPUT_LIMITS.promptQuestion),
        ...(detail ? { detail: detail.slice(0, INPUT_LIMITS.promptQuestion) } : {}),
        isSecret: secretElicitationField(id, property),
        options: options?.slice(0, INPUT_LIMITS.promptOptions) ?? null,
      },
    ];
  });
}

function mcpSignInPage(params: unknown): { url: string; address: string } | null {
  const url = getString(params, "url");
  if (!url || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
  return {
    url: parsed.href.replaceAll("(", "%28").replaceAll(")", "%29").replaceAll("`", "%60"),
    address: `${parsed.origin}${parsed.pathname}`.replaceAll("`", "%60"),
  };
}

function mcpSignInPageQuestion(params: unknown, serverName: string | null): AgentPromptQuestion | null {
  const page = mcpSignInPage(params);
  const name = serverName?.trim();
  if (!page || !name || name === CODEX_APPS_MCP_SERVER_NAME) return null;
  const subject = name === COMPUTER_USE_MCP_SERVER_NAME ? "Computer Use" : name;
  const message = getString(params, "message")?.trim();
  return {
    id: MCP_ELICITATION_DECISION_QUESTION_ID,
    header: subject.slice(0, INPUT_LIMITS.promptHeader),
    question: sourceText("status.agent.mcpSignInPage", { name: subject, ...page }),
    ...(message ? { detail: message.slice(0, INPUT_LIMITS.promptQuestion) } : {}),
    isSecret: false,
    options: [
      { label: MCP_SIGN_IN_PAGE_DONE, description: sourceText("status.agent.mcpSignInPageDoneDetail") },
      { label: MCP_SIGN_IN_PAGE_DECLINE, description: sourceText("status.agent.mcpSignInPageDeclineDetail") },
    ],
  };
}

function elicitationServerName(params: unknown): string | null {
  const name = getString(params, "serverName")?.trim() || null;
  const shown = name?.startsWith("openbot_") ? name.slice("openbot_".length) : name;
  return shown && name && !isReservedMcpServerName(name) && shown !== CODEX_APPS_MCP_SERVER_NAME ? shown : name;
}

export function mcpElicitationQuestions(params: unknown): AgentPromptQuestion[] | null {
  const serverName = elicitationServerName(params);
  const mode = getString(params, "mode") ?? "form";
  const requestedSchema = getRecord(params, "requestedSchema");
  const properties = getRecord(requestedSchema, "properties");
  if (mode === "url") {
    const question = mcpSignInPageQuestion(params, serverName);
    return question && validPromptQuestions([question]) ? [question] : null;
  }
  if ((mode !== "form" && mode !== "openai/form") || !requestedSchema || !properties) return null;

  const questions =
    Object.keys(properties).length === 0
      ? [elicitationConsentQuestion(params, serverName)].filter((question) => question !== null)
      : elicitationFieldQuestions(params, serverName ?? "This plugin");
  return validPromptQuestions(questions) ? questions : null;
}

const CODEX_APPS_MCP_SERVER_NAME = "codex_apps";

export function declinedMcpElicitationText(params: unknown): string {
  const serverName = elicitationServerName(params);
  const signIn = getString(params, "mode") === "url";
  if (serverName === CODEX_APPS_MCP_SERVER_NAME) {
    const authFailure = getRecord(getRecord(getRecord(params, "_meta"), "_codex_apps"), "connector_auth_failure");
    const app = getString(authFailure, "connector_name")?.trim();
    return signIn && app
      ? sourceText("error.backend.mcpAppReconnect", { name: app })
      : sourceText("error.backend.mcpRequestDeclined");
  }
  if (!serverName) return sourceText("error.backend.mcpRequestDeclined");
  return sourceText(signIn ? "error.backend.mcpServerSignInPage" : "error.backend.mcpServerRequestDeclined", {
    name: serverName === COMPUTER_USE_MCP_SERVER_NAME ? "Computer Use" : serverName,
  });
}

const CODEX_MCP_TOOL_CALL_APPROVAL_KIND = "mcp_tool_call";

export const MCP_TOOL_CONSENT_ALLOW_ONCE: Record<string, string[]> = {
  [MCP_ELICITATION_DECISION_QUESTION_ID]: [MCP_ELICITATION_ALLOW_ONCE],
};

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
  if (getString(params, "mode") === "url") {
    const selected = answers[MCP_ELICITATION_DECISION_QUESTION_ID]?.[0];
    if (selected === MCP_SIGN_IN_PAGE_DONE) return { action: "accept", content: null, _meta: null };
    if (selected === MCP_SIGN_IN_PAGE_DECLINE) return { action: "decline", content: null, _meta: null };
    return { action: "cancel", content: null, _meta: null };
  }
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

const DETACHED_PROMPT_NOTE =
  "The user has not answered yet. The question stays open in the chat, and the answer arrives as the user's next message, which quotes the question. Do not ask it again. End your turn unless other work does not need the answer.";

export function detachedPromptResult(
  responseKind: "dynamic-tool" | "mcp-elicitation" | "user-input" | "ui-block",
): DynamicToolResult | { answers: Record<string, never>; note: string } {
  if (responseKind === "user-input") return { answers: {}, note: DETACHED_PROMPT_NOTE };
  const value = { status: "waiting", next: DETACHED_PROMPT_NOTE };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

export function lateAnswerText(questions: AgentPromptQuestion[], answers: Record<string, string[]>): string {
  return questions
    .flatMap((question) => {
      const values = answers[question.id] ?? [];
      if (values.length === 0) return [];
      return [`${quoted(question.question)}\n\n${values.join(", ")}`];
    })
    .join("\n\n");
}

export function editedPreviewQuestions(
  questions: AgentPromptQuestion[],
  spec: UiBlockSpec | undefined,
  preview: string | undefined,
): AgentPromptQuestion[] {
  if (preview === undefined || spec?.type !== "confirm") return questions;
  return uiBlockFallbackQuestions({ ...spec, preview: "" }).map((question) =>
    question.id === UI_CONFIRM_ACTION_QUESTION_ID
      ? { ...question, question: `${question.question}\n\n${preview}` }
      : question,
  );
}

export function vaultLateAnswerText(title: string, savedName: string | null): string {
  if (savedName === null) return "";
  return [title ? quoted(title) : "", savedName].filter(Boolean).join("\n\n");
}

function quoted(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

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

const USER_MESSAGE_NOTE =
  "The user wrote a new message in this chat instead of answering. Follow that message. If it is not in your input, end your turn: it starts next. Ask again only if you still need the answer.";

export function userMessagePromptResult(
  responseKind: "dynamic-tool" | "user-input" | "ui-block",
  blockId: string | undefined,
  userInputNote = false,
): DynamicToolResult | { answers: Record<string, never>; note?: string } {
  if (responseKind === "user-input") return userInputNote ? { answers: {}, note: USER_MESSAGE_NOTE } : { answers: {} };
  const value = {
    status: "skipped",
    ...(blockId ? { blockId } : {}),
    next: USER_MESSAGE_NOTE,
  };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

export type UiBlockPromptOutcome =
  | { status: "answered"; blockId: string; response: UiBlockResponse; preview?: string | undefined }
  | { status: "skipped" | "expired"; blockId: string };

export function uiBlockPromptResult(outcome: UiBlockPromptOutcome): DynamicToolResult {
  const value =
    outcome.status === "answered"
      ? {
          status: outcome.status,
          blockId: outcome.blockId,
          ...outcome.response,
          ...(outcome.preview
            ? {
                preview: outcome.preview,
                next: "The user edited the preview. For the chosen action, use this text exactly, not your draft.",
              }
            : outcome.response.actionId === UI_CONFIRM_EDIT_ACTION_ID
              ? { next: "The user wants changes to the preview. Ask what to change." }
              : {}),
        }
      : outcome.status === "expired"
        ? {
            status: outcome.status,
            blockId: outcome.blockId,
            next: "The block closed before the user answered. Ask again only if you still need the answer.",
          }
        : { status: outcome.status, blockId: outcome.blockId };
  return { success: outcome.status !== "expired", contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

export const API_KEY_FIELD_ID = "key";

export const API_KEY_SCOPE_FIELD_ID = UI_API_KEY_SCOPE_FIELD_ID;

export const API_KEY_SCOPE_AGENT = sourceText("status.agent.apiKeyScope.agent");

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

export function locationFormSpec(reason: string): UiBlockSpec | null {
  return normalizeUiBlockSpec({
    type: "form",
    title: reason,
    fields: [
      {
        id: UI_LOCATION_FIELD_ID,
        kind: "text",
        label: sourceText("status.agent.location.field"),
        placeholder: sourceText("status.agent.location.placeholder"),
        secret: true,
      },
    ],
    submit: sourceText("status.agent.location.submit"),
  });
}

const LOCATION_USE =
  "Use it only for this request. Do not repeat the coordinates unless the user asks, and do not save them to memory, files, or messages.";

export function locationPromptResult(blockId: string, response: UiBlockResponse | null): DynamicToolResult {
  const answer = response?.values?.[UI_LOCATION_FIELD_ID];
  const text = typeof answer === "string" ? answer.trim() : "";
  const location = text ? decodeSharedLocationAnswer(text) : null;
  const value = location
    ? { status: "shared", blockId, ...location, next: LOCATION_USE }
    : text
      ? { status: "shared", blockId, place: text, next: LOCATION_USE }
      : {
          status: "declined",
          blockId,
          next: "Do not ask again in this turn. Ask the user for a place if you still need one.",
        };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

type VaultRequestArguments = BrowserToolArguments<"request_vault_item">;

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

function vaultRequestValue(args: VaultRequestArguments, field: UiVaultRequestField): string | undefined {
  if (field === "expiry")
    return args.expMonth !== undefined && args.expYear !== undefined
      ? vaultExpiryText(args.expMonth, args.expYear)
      : undefined;
  if (UI_VAULT_SECRET_FIELDS.includes(field)) return undefined;
  const value = Object.entries(args).find(([key]) => key === field)?.[1];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

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

export function vaultPromptResult(
  blockId: string,
  saved: { id: string; kind: string; name: string } | null,
): DynamicToolResult {
  const value = saved
    ? { status: "saved", blockId, id: saved.id, kind: saved.kind, name: saved.name }
    : { status: "skipped", blockId };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

const TAKEOVER_SIGN_IN_MISSING_NEXT =
  "No sign-in came from the user's own device. Take a fresh snapshot. If the page still asks for a sign-in, tell the user in one short sentence that this site accepts only a sign-in from the OpenBot desktop app on their computer, then call request_takeover with reason sign-in-blocked once more so that they can answer the card there. If this result comes again, do not ask again: tell the user and end your turn.";

const TAKEOVER_USER_CANCELLED_NEXT =
  "The user selected Cancel. Do not call submit_secret or request_takeover again for this step, and do not try to get the same result another way. Say in your reply that the user cancelled it, and wait for the user before you try again.";

function browserTakeoverNotes(
  vault: string | undefined,
  vaultSkipped: string | undefined,
  signInMissing: boolean,
  secureInputFailed: string | undefined,
) {
  return {
    ...(vault ? { vault } : {}),
    ...(vaultSkipped ? { vaultSkipped } : {}),
    ...(signInMissing ? { signIn: "not-received" } : {}),
    ...(secureInputFailed === undefined
      ? {}
      : {
          secureInput: `OpenBot could not finish entering the value.${secureInputFailed ? ` ${secureInputFailed}` : ""} The page went to the user.`,
        }),
  };
}

export function browserTakeoverLateNotes(
  vault: string | undefined,
  vaultSkipped: string | undefined,
  signInMissing: boolean,
  secureInputFailed: string | undefined,
): string {
  const notes = browserTakeoverNotes(vault, vaultSkipped, signInMissing, secureInputFailed);
  if (Object.keys(notes).length === 0) return "";
  return JSON.stringify(signInMissing ? { ...notes, next: TAKEOVER_SIGN_IN_MISSING_NEXT } : notes);
}

export function browserTakeoverResult(
  decision: RespondToBrowserTakeoverInput["decision"],
  vault?: string,
  vaultSkipped?: string,
  signInMissing = false,
  userCancelled = false,
  secureInputFailed?: string,
): DynamicToolResult {
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          status: decision === "complete" ? "completed" : "cancelled",
          ...browserTakeoverNotes(vault, vaultSkipped, signInMissing, secureInputFailed),
          ...(decision === "complete"
            ? { next: signInMissing ? TAKEOVER_SIGN_IN_MISSING_NEXT : "Take a fresh snapshot and continue the task." }
            : userCancelled
              ? { next: TAKEOVER_USER_CANCELLED_NEXT }
              : {}),
        }),
      },
    ],
  };
}

export function browserTakeoverWaitingResult(tool: string, tabId: string): DynamicToolResult {
  const value = {
    status: "waiting",
    next: `The user has not finished yet. The card stays open. Call ${tool} again now with tabId "${tabId}" to keep waiting for it; that call does not show a new card. Do not end your turn: the card closes when the turn ends.`,
  };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

export function browserTakeoverReleasedResult(tool: string, tabId: string): DynamicToolResult {
  const value = {
    status: "waiting",
    next: `The user has not finished yet. The card stays open for the user, and the browser tools of this chat stay unavailable until the user finishes. When the user finishes or cancels, the result arrives as the user's next message. Do not call ${tool} again for tab "${tabId}" in this turn. Tell the user in one short sentence that the browser waits for them, and end your turn unless other work does not need the browser.`,
  };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

export function browserTakeoverExpiredResult(): DynamicToolResult {
  const value = {
    status: "expired",
    next: "The user did not answer in time, and the card closed. Tell the user in one short sentence what they must do in the browser, and end your turn.",
  };
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

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
