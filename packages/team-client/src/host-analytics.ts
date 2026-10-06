import {
  assertHostAnalyticsScope,
  decodeHostAnalytics,
  type HostAnalytics,
  type HostAnalyticsInput,
  hostAnalyticsQuery,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect } from "effect";
import { AnalyticsRequestError } from "./agent-analytics";

export const readHostAnalytics = Effect.fn("TeamClient.readHostAnalytics")(function* (
  request: <T>(method: "GET", path: string, decode: (value: unknown) => T) => Promise<T>,
  capabilities: readonly string[],
  input: HostAnalyticsInput,
): Effect.fn.Return<HostAnalytics | null, AnalyticsRequestError> {
  if (!capabilities.includes("host-analytics")) return null;
  return yield* Effect.tryPromise({
    try: () =>
      request("GET", `${TEAM_API_ROUTES.analytics}?${hostAnalyticsQuery(input)}`, (value) =>
        assertHostAnalyticsScope(decodeHostAnalytics(value), input),
      ),
    catch: (cause) => new AnalyticsRequestError({ cause }),
  });
});
