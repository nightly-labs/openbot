import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  analyticsQuery,
  assertAnalyticsScope,
  decodeAgentAnalytics,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect, Schema } from "effect";

export class AnalyticsRequestError extends Schema.TaggedError<AnalyticsRequestError>()("AnalyticsRequestError", {
  cause: Schema.Defect(),
}) {}

export const readAgentAnalytics = Effect.fn("TeamClient.readAgentAnalytics")(function* (
  request: <T>(method: "GET", path: string, decode: (value: unknown) => T) => Promise<T>,
  capabilities: readonly string[],
  input: AgentAnalyticsInput,
): Effect.fn.Return<AgentAnalytics | null, AnalyticsRequestError> {
  if (!capabilities.includes("agent-analytics")) return null;
  return yield* Effect.tryPromise({
    try: () =>
      request("GET", `${TEAM_API_ROUTES.agent.analytics(input.agentId)}?${analyticsQuery(input)}`, (value) =>
        assertAnalyticsScope(decodeAgentAnalytics(value), input),
      ),
    catch: (cause) => new AnalyticsRequestError({ cause }),
  });
});
