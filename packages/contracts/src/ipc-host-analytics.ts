import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  type AnalyticsAgent,
  AnalyticsInputError,
  type AnalyticsProviderDay,
  analyticsQuery,
  decodeAnalyticsAgents,
  decodeAnalyticsProviderDays,
  decodeAnalyticsReport,
  parseAnalyticsRange,
} from "./ipc-agent-analytics";
import { isDynamicRecord, isString } from "./runtime-values";

export interface HostAnalyticsInput extends Omit<AgentAnalyticsInput, "agentId"> {
  agentId?: string;
}
// Only the host report carries the per-agent split and the daily-by-provider grid: on an
// agent-scoped report the agent array would be one row restating the totals, and adding
// either to AgentAnalytics would drag the agent codec and the mobile screen along.
export interface HostAnalytics extends Omit<AgentAnalytics, "agentId"> {
  agentId?: string;
  agents: AnalyticsAgent[];
  providerDaily: AnalyticsProviderDay[];
}
export function parseHostAnalyticsInput(value: unknown): HostAnalyticsInput {
  const range = parseAnalyticsRange(value);
  if (!isDynamicRecord(value)) throw new AnalyticsInputError("Invalid analytics request.");
  if (value.agentId === undefined) return range;
  if (!isString(value.agentId) || !value.agentId || value.agentId.length > 256)
    throw new AnalyticsInputError("Invalid analytics agent filter.");
  return { ...range, agentId: value.agentId };
}
export function decodeHostAnalytics(value: unknown): HostAnalytics {
  if (!isDynamicRecord(value)) throw new AnalyticsInputError("Invalid analytics request.");
  return {
    ...decodeAnalyticsReport(value),
    ...parseHostAnalyticsInput(value),
    agents: decodeAnalyticsAgents(value.agents),
    providerDaily: decodeAnalyticsProviderDays(value.providerDaily),
  };
}
export function decodeOptionalHostAnalytics(value: unknown): HostAnalytics | null {
  return value === null ? null : decodeHostAnalytics(value);
}
export function hostAnalyticsQuery(input: HostAnalyticsInput): string {
  const query = new URLSearchParams(analyticsQuery(input));
  if (input.agentId !== undefined) query.set("agentId", input.agentId);
  return query.toString();
}
export function assertHostAnalyticsScope(result: HostAnalytics, input: HostAnalyticsInput): HostAnalytics {
  if (
    result.agentId !== input.agentId ||
    result.startDate !== input.startDate ||
    result.endDate !== input.endDate ||
    result.timeZone !== input.timeZone
  )
    throw new Error("Analytics response does not match the request.");
  return result;
}
