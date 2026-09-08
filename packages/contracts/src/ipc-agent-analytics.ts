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
export interface AnalyticsAgent extends AnalyticsTotals {
  agentId: string;
  share: number;
}
// One cell of the daily-by-provider grid. The chart reads exactly these two measures, so
// the cell carries them rather than the eleven other fields of AnalyticsTotals: at the
// 367-day cap a full-totals cell per provider is four times the payload for nothing.
export interface AnalyticsProviderDay {
  date: string;
  provider: string;
  processedTokens: number;
  estimatedCostUsd: number | null;
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

// One formatter per time zone, not per call. A report walks every usage and activity row
// through `analyticsDate`, so a host with 100,000 records used to construct 100,000 formatters
// synchronously in the main process. The zone is validated before it reaches here - a string of
// at most 100 characters that `Intl` accepts - so the key space is the IANA list, not user text.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dateFormatters.set(timeZone, formatter);
  return formatter;
}

export function analyticsDate(date: Date, timeZone: string): string {
  const parts = dateFormatter(timeZone).formatToParts(date);
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

// The host report groups by agent beside provider and model, and the renderer joins each
// row to the agent list it already reads, so only the id crosses the boundary.
export function decodeAnalyticsAgents(value: unknown): AnalyticsAgent[] {
  if (!Array.isArray(value)) throw new Error("Invalid agent analytics rows.");
  return value.map((agent) => {
    if (!isDynamicRecord(agent) || !isString(agent.agentId) || !agent.agentId || agent.agentId.length > 256)
      throw new Error("Invalid agent analytics row.");
    if (number(agent.share) > 1) throw new Error("Invalid agent analytics row.");
    return { ...totals(agent), agentId: agent.agentId, share: number(agent.share) };
  });
}

// The daily grid is host-only for the same reason as the agent split, and it is a
// separate array rather than a field on each AnalyticsDay because a day carries no
// provider dimension anywhere else in the report.
export function decodeAnalyticsProviderDays(value: unknown): AnalyticsProviderDay[] {
  if (!Array.isArray(value)) throw new Error("Invalid provider analytics rows.");
  return value.map((cell) => {
    if (!isDynamicRecord(cell) || !isString(cell.provider) || cell.provider.length > 100)
      throw new Error("Invalid provider analytics row.");
    return {
      date: dateValue(cell.date),
      provider: cell.provider,
      processedTokens: number(cell.processedTokens),
      estimatedCostUsd: nullableNumber(cell.estimatedCostUsd),
    };
  });
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
