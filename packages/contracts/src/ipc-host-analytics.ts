import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  AnalyticsInputError,
  analyticsQuery,
  decodeAnalyticsReport,
  parseAnalyticsRange,
} from "./ipc-agent-analytics";
import { isDynamicRecord, isString } from "./runtime-values";

export interface HostAnalyticsInput extends Omit<AgentAnalyticsInput, "agentId"> {
  agentId?: string;
}
export interface HostAnalytics extends Omit<AgentAnalytics, "agentId"> {
  agentId?: string;
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
  return { ...decodeAnalyticsReport(value), ...parseHostAnalyticsInput(value) };
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
