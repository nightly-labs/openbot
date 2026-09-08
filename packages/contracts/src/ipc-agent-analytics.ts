import { isDynamicRecord, isString } from "./runtime-values";

export interface AgentAnalyticsInput {
  agentId: string;
  startDate: string;
  endDate: string;
  timeZone: string;
}

export interface UsageTokens {
  uncachedInput: number | null;
  cachedInput: number | null;
  cacheCreation: number | null;
  output: number | null;
}

export interface AnalyticsTotals extends UsageTokens {
  processedTokens: number;
  estimatedCostUsd: number | null;
  sessions: number;
  userMessages: number;
  assistantMessages: number;
  turns: number;
  missingUsageTurns: number;
  unpricedRecords: number;
  incompleteRecords: number;
}

export interface AnalyticsDay extends AnalyticsTotals {
  date: string;
}
export interface AnalyticsModel extends AnalyticsTotals {
  provider: string;
  model: string;
  share: number;
}
export interface AgentAnalytics {
  agentId: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  collectionStartedAt: string;
  updatedAt: string | null;
  totals: AnalyticsTotals;
  daily: AnalyticsDay[];
  models: AnalyticsModel[];
}

export function analyticsDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function analyticsRange(agentId: string, days = 30, now = new Date()): AgentAnalyticsInput {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const endDate = analyticsDate(now, timeZone);
  const start = new Date(`${endDate}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { agentId, startDate: start.toISOString().slice(0, 10), endDate, timeZone };
}

export class AnalyticsInputError extends Error {}

function dateValue(value: unknown): string {
  if (
    !isString(value) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new AnalyticsInputError("Invalid analytics date.");
  return value;
}

export function parseAnalyticsRange(value: unknown): Omit<AgentAnalyticsInput, "agentId"> {
  if (!isDynamicRecord(value) || !isString(value.timeZone) || value.timeZone.length > 100)
    throw new AnalyticsInputError("Invalid analytics request.");
  const startDate = dateValue(value.startDate);
  const endDate = dateValue(value.endDate);
  if (startDate > endDate || Date.parse(endDate) - Date.parse(startDate) > 366 * 86400000)
    throw new AnalyticsInputError("Choose an analytics range of at most 367 days.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format();
  } catch {
    throw new AnalyticsInputError("Invalid analytics time zone.");
  }
  return { startDate, endDate, timeZone: value.timeZone };
}
export function parseAgentAnalyticsInput(value: unknown): AgentAnalyticsInput {
  if (!isDynamicRecord(value) || !isString(value.agentId) || !value.agentId || value.agentId.length > 256)
    throw new AnalyticsInputError("Invalid analytics request.");
  return { ...parseAnalyticsRange(value), agentId: value.agentId };
}

export function analyticsQuery(input: Omit<AgentAnalyticsInput, "agentId">): string {
  return new URLSearchParams({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
  }).toString();
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid analytics number.");
  return value;
}
function nullableNumber(value: unknown): number | null {
  return value === null ? null : number(value);
}
function token(value: unknown): number | null {
  const parsed = nullableNumber(value);
  if (parsed !== null && !Number.isSafeInteger(parsed)) throw new Error("Invalid analytics token count.");
  return parsed;
}
export function decodeUsageTokens(value: unknown): UsageTokens {
  if (!isDynamicRecord(value)) throw new Error("Invalid usage tokens.");
  return {
    uncachedInput: token(value.uncachedInput),
    cachedInput: token(value.cachedInput),
    cacheCreation: token(value.cacheCreation),
    output: token(value.output),
  };
}
export function emptyAnalyticsTotals(): AnalyticsTotals {
  return {
    uncachedInput: null,
    cachedInput: null,
    cacheCreation: null,
    output: null,
    processedTokens: 0,
    estimatedCostUsd: null,
    sessions: 0,
    userMessages: 0,
    assistantMessages: 0,
    turns: 0,
    missingUsageTurns: 0,
    unpricedRecords: 0,
    incompleteRecords: 0,
  };
}
function totals(value: unknown): AnalyticsTotals {
  if (!isDynamicRecord(value)) throw new Error("Invalid analytics totals.");
  return {
    ...decodeUsageTokens(value),
    processedTokens: number(value.processedTokens),
    estimatedCostUsd: nullableNumber(value.estimatedCostUsd),
    sessions: number(value.sessions),
    userMessages: number(value.userMessages),
    assistantMessages: number(value.assistantMessages),
    turns: number(value.turns),
    missingUsageTurns: number(value.missingUsageTurns),
    unpricedRecords: number(value.unpricedRecords),
    incompleteRecords: number(value.incompleteRecords),
  };
}
function timestamp(value: unknown): string {
  if (!isString(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid analytics timestamp.");
  return value;
}
export function decodeAnalyticsReport(value: unknown): Omit<AgentAnalytics, "agentId"> {
  const input = parseAnalyticsRange(value);
  if (!isDynamicRecord(value) || !Array.isArray(value.daily) || !Array.isArray(value.models))
    throw new Error("Invalid agent analytics.");
  return {
    ...input,
    collectionStartedAt: timestamp(value.collectionStartedAt),
    updatedAt: value.updatedAt === null ? null : timestamp(value.updatedAt),
    totals: totals(value.totals),
    daily: value.daily.map((day) => {
      if (!isDynamicRecord(day)) throw new Error("Invalid daily analytics.");
      return { ...totals(day), date: dateValue(day.date) };
    }),
    models: value.models.map((model) => {
      if (
        !isDynamicRecord(model) ||
        !isString(model.provider) ||
        !isString(model.model) ||
        model.model.length > 256 ||
        model.provider.length > 100 ||
        number(model.share) > 1
      )
        throw new Error("Invalid model analytics.");
      return { ...totals(model), provider: model.provider, model: model.model, share: number(model.share) };
    }),
  };
}

export function decodeAgentAnalytics(value: unknown): AgentAnalytics {
  return { ...decodeAnalyticsReport(value), ...parseAgentAnalyticsInput(value) };
}

export function decodeOptionalAgentAnalytics(value: unknown): AgentAnalytics | null {
  return value === null ? null : decodeAgentAnalytics(value);
}

export function assertAnalyticsScope(result: AgentAnalytics, input: AgentAnalyticsInput): AgentAnalytics {
  if (
    result.agentId !== input.agentId ||
    result.startDate !== input.startDate ||
    result.endDate !== input.endDate ||
    result.timeZone !== input.timeZone
  )
    throw new Error("Analytics response does not match the request.");
  return result;
}
