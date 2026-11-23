import {
  AGENT_WAITS_CAPABILITY,
  AGENT_WAITS_REQUEST_TEXT_LIMIT,
  AGENT_WAITS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-waits-v1";
import { sourceText } from "@openbot/i18n/source";
import { AgentWaitError } from "../../backend/agent-waits/agent-wait-store";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, stringField } from "./request-helpers";

export async function routeAgentWaits(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listWaits" | "cancelWait" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || (url.pathname !== AGENT_WAITS_ROUTES.list && url.pathname !== AGENT_WAITS_ROUTES.cancel))
    return "unmatched";
  if (!capabilities.has(AGENT_WAITS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentWaitsUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, agentId, "chat");
  if (url.pathname === AGENT_WAITS_ROUTES.list) {
    const snapshot = agents.listWaits(agentId);
    return json(200, {
      agentId: snapshot.agentId,
      waits: snapshot.waits.map((wait) => ({
        ...wait,
        requestText: wait.requestText.slice(0, AGENT_WAITS_REQUEST_TEXT_LIMIT),
      })),
    });
  }
  try {
    agents.cancelWait(agentId, stringField(body, "waitId"));
  } catch (error) {
    if (error instanceof AgentWaitError) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}
