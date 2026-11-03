import {
  COMPUTER_ACTIVITY_CAPABILITY,
  COMPUTER_ACTIVITY_ROUTES,
} from "@openbot/contracts/team-protocol/computer-activity-v1";
import type { PushNotificationService } from "../push-notifications";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * The computer of the calling member's desktop app had input, so the member's phones stay quiet.
 * Frozen by `computer-activity-v1`; only a host that sends phone notifications serves it.
 */
export async function routeComputerActivity(
  context: TeamApiRequestContext,
  notifications: PushNotificationService | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member, sessionId } = context;
  if (method !== "POST" || url.pathname !== COMPUTER_ACTIVITY_ROUTES.report) return "unmatched";
  if (!notifications || !capabilities.has(COMPUTER_ACTIVITY_CAPABILITY)) return "unmatched";
  // `readJson` has already run the body through the computer-activity wire codec.
  const { idleSeconds } = await readJson(request);
  if (typeof idleSeconds !== "number") return "unmatched";
  return json(200, { phones: notifications.computerInput(sessionId, member.id, idleSeconds) });
}
