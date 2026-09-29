import {
  CONTEXT_RESET_CAPABILITY,
  CONTEXT_RESET_ROUTES,
  ContextResetBusyError,
} from "@openbot/contracts/team-protocol/context-reset-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, stringField } from "./request-helpers";

/**
 * A new chat with one agent, started from a joined server. Any member can start one, as any member
 * can send the agent a message. The agent id is in the body, so the router's check of the path does
 * not see it, and this module refuses an agent hidden from the caller. Frozen by `context-reset-v1`.
 */
export async function routeContextReset(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "clearAgentContext" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== CONTEXT_RESET_ROUTES.clear) return "unmatched";
  if (!capabilities.has(CONTEXT_RESET_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.contextResetUnsupported"));
  // `readJson` has already run the body through the context-reset wire codec.
  const agentId = stringField(await readJson(request), "agentId");
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  try {
    agents.clearAgentContext(agentId);
  } catch (error) {
    // A busy agent is a sentence for the member. Any other error is a host fault.
    if (error instanceof ContextResetBusyError) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}
