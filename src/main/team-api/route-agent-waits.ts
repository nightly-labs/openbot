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

/**
 * The open waits of one agent, and Cancel on one of them, from a joined server. A member who can send
 * the agent a message can use them, as the composer of this computer does. The agent id is in the
 * body, so the router's check of the path does not see it, and this module refuses an agent hidden
 * from the caller. Frozen by `agent-waits-v1`.
 */
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
  // `readJson` has already run the body through the agent-waits wire codec.
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, agentId, "chat");
  if (url.pathname === AGENT_WAITS_ROUTES.list) {
    const snapshot = agents.listWaits(agentId);
    // The composer shows only the start of the request, and 20 whole messages would not fit one frame.
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
    // A wait that closed in the meantime is a sentence for the member. Any other error is a host fault.
    if (error instanceof AgentWaitError) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}
