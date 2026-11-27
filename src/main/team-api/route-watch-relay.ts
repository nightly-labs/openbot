import { WATCH_RELAY_ROUTES } from "@openbot/contracts/team-protocol/watch-relay-v1";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiWatchRelay } from "./dependencies";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";

export async function routeWatchRelay(
  context: TeamApiRequestContext,
  watchRelay: TeamApiWatchRelay | undefined,
): Promise<RouteOutcome> {
  const { method, url, json } = context;
  if (method !== "GET" || url.pathname !== WATCH_RELAY_ROUTES.setup || !watchRelay) return "unmatched";
  const setup = await runCauseEffect(watchRelay.setup());
  if (!setup) return "unmatched";
  return json(200, setup);
}
