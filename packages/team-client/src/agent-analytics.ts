import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  analyticsQuery,
  assertAnalyticsScope,
  decodeAgentAnalytics,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";

export function readAgentAnalytics(
  request: <T>(method: "GET", path: string, decode: (value: unknown) => T) => Promise<T>,
  capabilities: readonly string[],
  input: AgentAnalyticsInput,
): Promise<AgentAnalytics | null> {
  if (!capabilities.includes("agent-analytics")) return Promise.resolve(null);
  return request("GET", `${TEAM_API_ROUTES.agent.analytics(input.agentId)}?${analyticsQuery(input)}`, (value) =>
    assertAnalyticsScope(decodeAgentAnalytics(value), input),
  );
}
