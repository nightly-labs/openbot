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
  agentId?: string | undefined;
}
// Only the host report carries the per-agent split and the daily-by-provider grid: on an
// agent-scoped report the agent array would be one row restating the totals, and adding
// either to AgentAnalytics would drag the agent codec and the mobile screen along.
export interface HostAnalytics extends Omit<AgentAnalytics, "agentId"> {
  agentId?: string | undefined;
  agents: AnalyticsAgent[];
  providerDaily: AnalyticsProviderDay[];
  /**
   * The skills the agents loaded in the range, most tokens first. Only the local host sends it: the
   * frozen Team API host analytics wire has no skills, so a remote report has none.
   */
  skills?: AnalyticsSkill[] | undefined;
}
/** The loads of one skill in a report. */
export interface AnalyticsSkill {
  /** The skill's folder name. */
  skill: string;
  loads: number;
  /** The estimated tokens that the loads added to the context. Loads of a skill file that was not found add none. */
  tokens: number;
  /** The tokens priced as input of each turn's model. Null when no load has a price. */
  estimatedCostUsd: number | null;
  /** The number of agents that loaded it. */
  agents: number;
  /** Its part of the tokens of all skill loads in the report. */
  share: number;
}
const SKILL_NAME_LIMIT = 128;
function decodeAnalyticsSkills(value: unknown): AnalyticsSkill[] {
  if (!Array.isArray(value)) throw new Error("Invalid skill analytics rows.");
  return value.map((row) => {
    if (
      !isDynamicRecord(row) ||
      !isString(row.skill) ||
      !row.skill ||
      row.skill.length > SKILL_NAME_LIMIT ||
      !count(row.loads) ||
      !count(row.tokens) ||
      !count(row.agents) ||
      !(row.estimatedCostUsd === null || (typeof row.estimatedCostUsd === "number" && row.estimatedCostUsd >= 0)) ||
      typeof row.share !== "number" ||
      !(row.share >= 0 && row.share <= 1)
    )
      throw new Error("Invalid skill analytics row.");
    return {
      skill: row.skill,
      loads: row.loads,
      tokens: row.tokens,
      estimatedCostUsd: row.estimatedCostUsd,
      agents: row.agents,
      share: row.share,
    };
  });
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
    ...(value.skills === undefined ? {} : { skills: decodeAnalyticsSkills(value.skills) }),
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
