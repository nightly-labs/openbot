import { canAdministerServer, type HiddenAgentsSnapshot, parseSetAgentHiddenInput } from "@openbot/contracts/ipc";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiHiddenAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireVisibleBodyAgent } from "./request-helpers";

export async function routeAgentHidden(
  context: TeamApiRequestContext,
  hiddenAgents: TeamApiHiddenAgents | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || !Object.values(AGENT_HIDDEN_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!hiddenAgents || !capabilities.has(AGENT_HIDDEN_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentHideUnsupported"));
  const body = await readJson(request);
  if (url.pathname === AGENT_HIDDEN_ROUTES.read)
    return json(200, visibleSnapshot(hiddenAgents.listHiddenAgents(), hiddenAgentIds));
  if (!canAdministerServer(context.member.role))
    throw new HttpError(403, sourceText("error.team.membersCannotHideAgents"));
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const snapshot = await runCauseEffect(hiddenAgents.setAgentHidden(parseSetAgentHiddenInput(body)));
  return json(200, visibleSnapshot(snapshot, hiddenAgentIds));
}

export function visibleSnapshot(
  snapshot: HiddenAgentsSnapshot,
  hiddenAgentIds: ReadonlySet<string>,
): HiddenAgentsSnapshot {
  return { agents: snapshot.agents.filter((agent) => !hiddenAgentIds.has(agent.agentId)) };
}
