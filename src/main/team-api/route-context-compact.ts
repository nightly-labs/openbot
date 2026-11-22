import {
  CONTEXT_COMPACT_CAPABILITY,
  CONTEXT_COMPACT_ROUTES,
  ContextCompactRefusedError,
} from "@openbot/contracts/team-protocol/context-compact-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, stringField } from "./request-helpers";

export async function routeContextCompact(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "compactAgentContext" | "compactTaskContext" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== CONTEXT_COMPACT_ROUTES.compact && url.pathname !== CONTEXT_COMPACT_ROUTES.compactTask)
  )
    return "unmatched";
  if (!capabilities.has(CONTEXT_COMPACT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.contextCompactUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, agentId, "chat");
  try {
    if (url.pathname === CONTEXT_COMPACT_ROUTES.compact) await runCauseEffect(agents.compactAgentContext(agentId));
    else await runCauseEffect(agents.compactTaskContext({ agentId, taskId: stringField(body, "taskId") }));
  } catch (error) {
    if (error instanceof ContextCompactRefusedError) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}
