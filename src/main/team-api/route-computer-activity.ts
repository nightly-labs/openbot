import {
  COMPUTER_ACTIVITY_CAPABILITY,
  COMPUTER_ACTIVITY_ROUTES,
} from "@openbot/contracts/team-protocol/computer-activity-v1";
import type { PushNotificationService } from "../push-notifications";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

export async function routeComputerActivity(
  context: TeamApiRequestContext,
  notifications: PushNotificationService | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member, sessionId } = context;
  if (method !== "POST" || url.pathname !== COMPUTER_ACTIVITY_ROUTES.report) return "unmatched";
  if (!notifications || !capabilities.has(COMPUTER_ACTIVITY_CAPABILITY)) return "unmatched";
  const { idleSeconds } = await readJson(request);
  if (typeof idleSeconds !== "number") return "unmatched";
  return json(200, { phones: notifications.computerInput(sessionId, member.id, idleSeconds) });
}
