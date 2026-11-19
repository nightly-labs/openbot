import { FOCUS_USE_CAPABILITY, FOCUS_USE_ROUTES } from "@openbot/contracts/team-protocol/focus-use-v1";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

export async function routeFocusUse(
  context: TeamApiRequestContext,
  recordFocus: ((sessionId: string) => void) | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, sessionId } = context;
  if (method !== "POST" || url.pathname !== FOCUS_USE_ROUTES.ping) return "unmatched";
  if (!recordFocus || !capabilities.has(FOCUS_USE_CAPABILITY)) return "unmatched";
  await readJson(request);
  recordFocus(sessionId);
  return json(200, {});
}
