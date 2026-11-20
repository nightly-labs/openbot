import {
  CONTEXT_RESET_CAPABILITY,
  CONTEXT_RESET_ROUTES,
  ContextResetBusyError,
} from "@openbot/contracts/team-protocol/context-reset-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, stringField } from "./request-helpers";

export async function routeContextReset(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "clearAgentContext" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== CONTEXT_RESET_ROUTES.clear) return "unmatched";
  if (!capabilities.has(CONTEXT_RESET_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.contextResetUnsupported"));
  const agentId = stringField(await readJson(request), "agentId");
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, agentId, "chat");
  try {
    await runCauseEffect(agents.clearAgentContext(agentId));
  } catch (error) {
    if (error instanceof ContextResetBusyError) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}
