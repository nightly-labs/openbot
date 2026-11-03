import { parseSetAgentNotificationLevelInput, parseSetOwnServerNotificationLevelInput } from "@openbot/contracts/ipc";
import {
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgentNotificationLevels, TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireVisibleBodyAgent } from "./request-helpers";

/**
 * Each member reads and sets, for themselves only, the notification level of this server and of each
 * agent. The levels of an agent that this peer cannot see are not in the list and cannot be set.
 */
export async function routeAgentNotificationLevels(
  context: TeamApiRequestContext,
  levels: TeamApiAgentNotificationLevels | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member } = context;
  if (method !== "POST" || !Object.values(AGENT_NOTIFICATION_LEVELS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!levels || !capabilities.has(AGENT_NOTIFICATION_LEVELS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentNotificationLevelsUnsupported"));
  const body = await readJson(request);
  if (url.pathname === AGENT_NOTIFICATION_LEVELS_ROUTES.read)
    return json(200, levels.snapshot(member.id, hiddenAgentIds));
  if (url.pathname === AGENT_NOTIFICATION_LEVELS_ROUTES.server) {
    await runCauseEffect(levels.setServer(member.id, parseSetOwnServerNotificationLevelInput(body).level));
    return json(200, levels.snapshot(member.id, hiddenAgentIds));
  }
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const input = parseSetAgentNotificationLevelInput(body);
  if (!agents.listAgents().some((agent) => agent.id === input.agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  await runCauseEffect(levels.set(member.id, input));
  return json(200, levels.snapshot(member.id, hiddenAgentIds));
}
