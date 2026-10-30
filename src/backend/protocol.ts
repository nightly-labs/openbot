import {
  type AgentProviderId,
  isAgentProvider,
  PROVIDER_USAGE_RESET_OUTCOMES,
  type ProviderUsageResetOutcome,
} from "@openbot/contracts/ipc";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import {
  type DynamicRecord,
  isBoolean,
  isDynamicRecord,
  isNumber,
  isOneOf,
  isString,
} from "@openbot/contracts/runtime-values";

export type RequestId = string | number;

interface RpcRequest {
  method: string;
  id: RequestId;
  params?: unknown;
}

interface RpcNotification {
  method: string;
  params?: unknown;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface RpcResponse {
  id: RequestId;
  result?: unknown;
  error?: RpcError;
}

export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

export interface DynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  ownerAgentId?: string | null;
  namespace: string | null;
  tool: string;
  arguments: unknown;
}

export interface DynamicToolResult {
  contentItems: Array<{ type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }>;
  success: boolean;
}

export interface AppServerNotification {
  method: string;
  params: unknown;
}

export interface AppServerRequest {
  method: string;
  id: RequestId;
  params: unknown;
  /**
   * In process only, never on the wire. Aborts when the provider stops waiting for the answer, such
   * as an MCP client whose tool call timed out. An answer after that reaches nobody.
   */
  signal?: AbortSignal;
}

/** The account type of Claude's own sign-in when it runs on the saved key, with no claude.ai account. */
export const CLAUDE_API_KEY_ACCOUNT_TYPE = "claude-api-key";

/**
 * Whether Codex can run on a login of this type: a ChatGPT plan, or an OpenAI API key that Codex
 * keeps in its own home (`codex login --with-api-key`). Turns on a key use API credits.
 */
export function isCodexLoginType(type: string | undefined): boolean {
  return type === "chatgpt" || type === "apiKey";
}

export interface AccountReadResult {
  account: null | {
    type: string;
    email?: string | null | undefined;
    planType?: string | null | undefined;
  };
  requiresOpenaiAuth: boolean;
}

export interface AccountLoginStartResult {
  type: "chatgpt";
  loginId: string;
  authUrl: string;
}

/**
 * The device-code form of the same login.
 *
 * The user types the code on a phone or another browser, so the reply carries a code and the page
 * to type it on instead of a URL this computer is expected to open. The code authorises nothing on
 * its own and is meant to be read out; the token it is later traded for never appears here.
 */
export interface AccountDeviceCodeLoginStartResult {
  type: "chatgptDeviceCode";
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export interface AccountLoginCompletedResult {
  loginId: string | null;
  success: boolean;
  error: string | null;
}

export interface AccountRateLimitWindowResult {
  usedPercent?: number | null | undefined;
  windowDurationMins?: number | null | undefined;
  resetsAt?: number | null | undefined;
}

export interface AccountRateLimitResult {
  limitId?: string | null | undefined;
  limitName?: string | null | undefined;
  normalModelSlug?: string | null | undefined;
  primary?: AccountRateLimitWindowResult | null | undefined;
  secondary?: AccountRateLimitWindowResult | null | undefined;
}

/** One named quota of the plan and the model names it covers. Antigravity only. */
export interface AccountRateLimitGroupResult {
  name: string;
  models: string[];
  primary: AccountRateLimitWindowResult | null;
  secondary: AccountRateLimitWindowResult | null;
}

export interface AccountRateLimitsReadResult {
  rateLimits?: AccountRateLimitResult | null | undefined;
  /** Antigravity only: every quota group of the plan. `rateLimits` is one of them. */
  groups?: AccountRateLimitGroupResult[] | undefined;
  /** Cursor only: the provider whose plan quota this reading also counts, such as Grok on a merged plan. */
  sharedQuotaWith?: AgentProviderId | undefined;
  rateLimitsByLimitId?: Record<string, AccountRateLimitResult | undefined> | null | undefined;
  /** Codex only: the usage reset credits of the account. Null when Codex could not count them. */
  rateLimitResetCredits?: { availableCount: number } | null | undefined;
}

export interface ThreadItem {
  type: string;
  id?: string | undefined;
  clientId?: string | null;
  text?: string;
  content?: Array<{ type: string; text?: string }>;
  status?: string;
  [key: string]: unknown;
}

interface TurnRecord {
  id: string;
  status?: string;
  startedAt?: number;
  items?: ThreadItem[];
}

interface ThreadRecord {
  id: string;
  turns?: TurnRecord[];
}

export interface ThreadResponse {
  thread: ThreadRecord;
}

export interface TurnResponse {
  turn: {
    id: string;
    status?: string;
  };
}

export type ResponseDecoder<T> = (value: unknown) => T;

export interface ModelListResponse {
  nextCursor?: string;
  data: Array<{
    model?: string;
    displayName?: string;
    defaultReasoningEffort?: string;
    supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
    reasoningEffortConfigurable?: boolean;
    hidden?: boolean;
    /** Codex: the service tiers of the model, such as `{ id: "priority", name: "Fast" }`. */
    serviceTiers?: Array<{ id: string; name?: string }>;
    /** Codex: the older, deprecated form of `serviceTiers`, such as `["fast"]`. */
    additionalSpeedTiers?: string[];
  }>;
}

export function decodeModelListResponse(value: unknown): ModelListResponse {
  const data = getArray(value, "data");
  const nextCursor = getString(value, "nextCursor");
  return {
    ...(nextCursor ? { nextCursor } : {}),
    data: data.filter(isRecord).map((item) => ({
      ...(isString(item.model) ? { model: item.model } : {}),
      ...(isString(item.displayName) ? { displayName: item.displayName } : {}),
      ...(isString(item.defaultReasoningEffort) ? { defaultReasoningEffort: item.defaultReasoningEffort } : {}),
      ...(isBoolean(item.hidden) ? { hidden: item.hidden } : {}),
      ...(isBoolean(item.reasoningEffortConfigurable)
        ? { reasoningEffortConfigurable: item.reasoningEffortConfigurable }
        : {}),
      ...(Array.isArray(item.serviceTiers)
        ? {
            serviceTiers: item.serviceTiers
              .filter(isRecord)
              .flatMap((tier) =>
                isString(tier.id) ? [{ id: tier.id, ...(isString(tier.name) ? { name: tier.name } : {}) }] : [],
              ),
          }
        : {}),
      ...(Array.isArray(item.additionalSpeedTiers)
        ? { additionalSpeedTiers: item.additionalSpeedTiers.filter(isString) }
        : {}),
      ...(Array.isArray(item.supportedReasoningEfforts)
        ? {
            supportedReasoningEfforts: item.supportedReasoningEfforts
              .filter(isRecord)
              .flatMap((effort) =>
                isString(effort.reasoningEffort) ? [{ reasoningEffort: effort.reasoningEffort }] : [],
              ),
          }
        : {}),
    })),
  };
}

export function decodeRecordResponse(value: unknown): DynamicRecord {
  return decodeRecord(value, "response");
}

export function decodeAccountReadResult(value: unknown): AccountReadResult {
  const record = decodeRecord(value, "account response");
  const account = record.account;
  const requiresOpenaiAuth = record.requiresOpenaiAuth;
  if (account === null) {
    return {
      account: null,
      requiresOpenaiAuth: requiresOpenaiAuth === undefined ? false : recordBoolean(record, "requiresOpenaiAuth"),
    };
  }
  const accountRecord = decodeRecord(account, "account");
  const email = optionalString(accountRecord, "email");
  const planType = optionalString(accountRecord, "planType");
  return {
    account: {
      type: requiredString(accountRecord, "type"),
      ...(email === undefined ? {} : { email }),
      ...(planType === undefined ? {} : { planType }),
    },
    requiresOpenaiAuth: requiresOpenaiAuth === undefined ? false : recordBoolean(record, "requiresOpenaiAuth"),
  };
}

export function decodeAccountLoginStartResult(value: unknown): AccountLoginStartResult {
  const record = decodeRecord(value, "account login response");
  if (requiredString(record, "type") !== "chatgpt") throw new Error("Unexpected Codex login type.");
  const authUrl = requiredString(record, "authUrl");
  const url = new URL(authUrl);
  if (url.protocol !== "https:") throw new Error("Codex returned an unsafe login URL.");
  return { type: "chatgpt", loginId: requiredString(record, "loginId"), authUrl: url.toString() };
}

export function decodeAccountDeviceCodeLoginStartResult(value: unknown): AccountDeviceCodeLoginStartResult {
  const record = decodeRecord(value, "account device login response");
  if (requiredString(record, "type") !== "chatgptDeviceCode") throw new Error("Unexpected Codex login type.");
  // Held to the same rule as the browser login's URL: this is the address OpenBot shows the user
  // and offers to open, so a downgrade to plain HTTP is refused before it reaches the screen.
  const url = new URL(requiredString(record, "verificationUrl"));
  if (url.protocol !== "https:") throw new Error("Codex returned an unsafe login URL.");
  return {
    type: "chatgptDeviceCode",
    loginId: requiredString(record, "loginId"),
    verificationUrl: url.toString(),
    userCode: requiredString(record, "userCode"),
  };
}

export function decodeAccountLoginCompletedResult(value: unknown): AccountLoginCompletedResult {
  const record = decodeRecord(value, "account login completion");
  const loginId = optionalString(record, "loginId");
  const error = optionalString(record, "error");
  return {
    loginId: loginId ?? null,
    success: recordBoolean(record, "success"),
    error: error ?? null,
  };
}

export function decodeAccountRateLimitsReadResult(value: unknown): AccountRateLimitsReadResult {
  const record = decodeRecord(value, "rate limits response");
  const rateLimits = decodeRateLimit(record.rateLimits);
  const rateLimitsByLimitId = decodeRateLimitsById(record.rateLimitsByLimitId);
  const rateLimitResetCredits = decodeRateLimitResetCredits(record.rateLimitResetCredits);
  const groups = decodeRateLimitGroups(record.groups);
  const { sharedQuotaWith } = record;
  if (sharedQuotaWith !== undefined && !isAgentProvider(sharedQuotaWith))
    throw new Error("Invalid rate limit shared quota provider.");
  return {
    ...(rateLimits === undefined ? {} : { rateLimits }),
    ...(rateLimitsByLimitId === undefined ? {} : { rateLimitsByLimitId }),
    ...(groups === undefined ? {} : { groups }),
    ...(sharedQuotaWith === undefined ? {} : { sharedQuotaWith }),
    ...(rateLimitResetCredits === undefined ? {} : { rateLimitResetCredits }),
  };
}

export function decodeRateLimitResetCreditConsumeResult(value: unknown): ProviderUsageResetOutcome {
  const outcome = decodeRecord(value, "rate limit reset response").outcome;
  if (!isOneOf(PROVIDER_USAGE_RESET_OUTCOMES, outcome)) throw new Error("Invalid rate limit reset outcome.");
  return outcome;
}

/** A sparse `account/rateLimits/updated` push: only the windows it holds changed. */
export function decodeAccountRateLimitsUpdated(value: unknown): AccountRateLimitResult {
  const rateLimit = decodeRateLimit(decodeRecord(value, "rate limits update").rateLimits);
  if (!rateLimit) throw new Error("Invalid rate limits update.");
  return rateLimit;
}

export function decodeThreadResponse(value: unknown): ThreadResponse {
  const record = decodeRecord(value, "thread response");
  return { thread: decodeThreadRecord(record.thread) };
}

export function decodeTurnResponse(value: unknown): TurnResponse {
  const record = decodeRecord(value, "turn response");
  const turn = decodeRecord(record.turn, "turn");
  const status = optionalString(turn, "status");
  return {
    turn: {
      id: requiredString(turn, "id"),
      ...(status !== undefined && status !== null ? { status } : {}),
    },
  };
}

function decodeThreadRecord(value: unknown): ThreadRecord {
  const record = decodeRecord(value, "thread");
  const turns = Array.isArray(record.turns) ? record.turns.map(decodeTurnRecord) : undefined;
  return { id: requiredString(record, "id"), ...(turns ? { turns } : {}) };
}

function decodeTurnRecord(value: unknown): TurnRecord {
  const record = decodeRecord(value, "thread turn");
  const items = Array.isArray(record.items) ? record.items.map(decodeThreadItem) : undefined;
  const status = optionalString(record, "status");
  return {
    id: requiredString(record, "id"),
    ...(status !== undefined && status !== null ? { status } : {}),
    ...(items ? { items } : {}),
  };
}

export function decodeThreadItem(value: unknown): ThreadItem {
  const record = decodeRecord(value, "thread item");
  const item: ThreadItem = { type: requiredString(record, "type") };
  const id = optionalString(record, "id");
  const clientId = optionalString(record, "clientId");
  const text = optionalString(record, "text");
  const status = optionalString(record, "status");
  const name = optionalString(record, "name");
  const toolKind = optionalString(record, "toolKind");
  if (id !== undefined && id !== null) item.id = id;
  if (clientId !== undefined) item.clientId = clientId;
  if (text !== undefined && text !== null) item.text = text;
  if (status !== undefined && status !== null) item.status = status;
  if (name !== undefined && name !== null) item.name = name;
  if (toolKind !== undefined && toolKind !== null) item.toolKind = toolKind;
  if (record.arguments !== undefined) item.arguments = record.arguments;
  if (record.result !== undefined) item.result = record.result;
  const phase = optionalString(record, "phase");
  if (phase !== undefined && phase !== null) item.phase = phase;
  if (record.content !== undefined && item.type !== "reasoning") item.content = decodeThreadContent(record.content);
  if (item.type === "reasoning") {
    return { ...item, type: "agentMessage", phase: "commentary", text: reasoningText(record) };
  }
  return item;
}

/** Prefer the readable summary when a provider also includes raw reasoning content. */
export function reasoningText(item: unknown): string {
  const summary = getArray(item, "summary").filter(isString);
  const content = getArray(item, "content").filter(isString);
  return (summary.length > 0 ? summary : content).join("\n\n");
}

function decodeThreadContent(value: unknown): Array<{ type: string; text?: string }> {
  if (!Array.isArray(value)) throw new Error("Invalid thread item content.");
  return value.map((item) => {
    const record = decodeRecord(item, "thread item content");
    const text = optionalString(record, "text");
    return {
      type: requiredString(record, "type"),
      ...(text !== undefined && text !== null ? { text } : {}),
    };
  });
}

function decodeRateLimit(value: unknown): AccountRateLimitResult | null | undefined {
  if (value === undefined || value === null) return value;
  const record = decodeRecord(value, "rate limit");
  const limitId = optionalString(record, "limitId");
  const limitName = optionalString(record, "limitName");
  const normalModelSlug = optionalString(record, "normalModelSlug");
  const primary = decodeRateLimitWindow(record.primary);
  const secondary = decodeRateLimitWindow(record.secondary);
  return {
    ...(limitId === undefined ? {} : { limitId }),
    ...(limitName === undefined ? {} : { limitName }),
    ...(normalModelSlug === undefined ? {} : { normalModelSlug }),
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
  };
}

function decodeRateLimitGroups(value: unknown): AccountRateLimitGroupResult[] | undefined {
  if (value === undefined) return value;
  if (!Array.isArray(value)) throw new Error("Invalid rate limit groups.");
  return value.map((item) => {
    const record = decodeRecord(item, "rate limit group");
    const models = record.models;
    if (!Array.isArray(models) || !models.every((model) => typeof model === "string"))
      throw new Error("Invalid rate limit group models.");
    return {
      name: requiredString(record, "name"),
      models,
      primary: decodeRateLimitWindow(record.primary) ?? null,
      secondary: decodeRateLimitWindow(record.secondary) ?? null,
    };
  });
}

function decodeRateLimitWindow(value: unknown): AccountRateLimitWindowResult | null | undefined {
  if (value === undefined || value === null) return value;
  const record = decodeRecord(value, "rate limit window");
  const usedPercent = optionalNumber(record, "usedPercent");
  const windowDurationMins = optionalNumber(record, "windowDurationMins");
  const resetsAt = optionalNumber(record, "resetsAt");
  return {
    ...(usedPercent === undefined ? {} : { usedPercent }),
    ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

/**
 * Only the count: the credit rows are display text that OpenBot does not show. A count it cannot
 * read is unknown, so the usage reading that carries it still decodes.
 */
function decodeRateLimitResetCredits(value: unknown): AccountRateLimitsReadResult["rateLimitResetCredits"] {
  if (value === undefined) return value;
  const availableCount = isDynamicRecord(value) ? value.availableCount : undefined;
  return typeof availableCount === "number" && Number.isSafeInteger(availableCount) && availableCount >= 0
    ? { availableCount }
    : null;
}

function decodeRateLimitsById(value: unknown): AccountRateLimitsReadResult["rateLimitsByLimitId"] {
  if (value === undefined || value === null) return value;
  const record = decodeRecord(value, "rate limits by ID");
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => {
      const rateLimit = decodeRateLimit(item);
      return [key, rateLimit === null ? undefined : rateLimit];
    }),
  );
}

function optionalString(record: DynamicRecord, key: string): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null || isString(value)) return value;
  throw new Error(`Invalid ${key}.`);
}

function optionalNumber(record: DynamicRecord, key: string): number | null | undefined {
  const value = record[key];
  if (value === undefined || value === null || isNumber(value)) return value;
  throw new Error(`Invalid ${key}.`);
}

function recordBoolean(record: DynamicRecord, key: string): boolean {
  const value = record[key];
  if (!isBoolean(value)) throw new Error(`Invalid ${key}.`);
  return value;
}

export function isRecord(value: unknown): value is DynamicRecord {
  return isDynamicRecord(value);
}

export function isRpcMessage(value: unknown): value is RpcMessage {
  if (!isRecord(value)) return false;

  if ("method" in value) {
    return isString(value.method);
  }

  return (isString(value.id) || isNumber(value.id)) && ("result" in value || "error" in value);
}

export function getString(record: unknown, key: string): string | null {
  return isRecord(record) && isString(record[key]) ? record[key] : null;
}

export function getRecord(record: unknown, key: string): DynamicRecord | null {
  return isRecord(record) && isRecord(record[key]) ? record[key] : null;
}

/** The qualified name that a `tool_call` bridge item asks for. The model writes it, so check it before use. */
export function bridgedToolName(item: ThreadItem): string | null {
  const tool = getString(item, "tool") ?? getString(item, "name");
  if (tool !== "tool_call" && tool !== "mcp__openbot__tool_call") return null;
  return getString(getRecord(item, "arguments"), "name");
}

export function getArray(record: unknown, key: string): unknown[] {
  return isRecord(record) && Array.isArray(record[key]) ? record[key] : [];
}
