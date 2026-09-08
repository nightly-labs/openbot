import {
  assertHostAnalyticsScope,
  decodeHostAnalytics,
  type HostAnalytics,
  type HostAnalyticsInput,
  hostAnalyticsQuery,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";

export function readHostAnalytics(
  request: <T>(method: "GET", path: string, decode: (value: unknown) => T) => Promise<T>,
  capabilities: readonly string[],
  input: HostAnalyticsInput,
): Promise<HostAnalytics | null> {
  if (!capabilities.includes("host-analytics")) return Promise.resolve(null);
  return request("GET", `${TEAM_API_ROUTES.analytics}?${hostAnalyticsQuery(input)}`, (value) =>
    assertHostAnalyticsScope(decodeHostAnalytics(value), input),
  );
}
