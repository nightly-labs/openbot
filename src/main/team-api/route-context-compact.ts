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

/**
 * "Compact now" for one agent's chat or one of its open tasks, from a joined server. A member who can
 * send the agent a message can ask, as for a new chat. The agent id is in the body, so the router's
 * check of the path does not see it, and this module refuses an agent hidden from the caller. Frozen
 * by `context-compact-v1`.
 */
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
  // `readJson` has already run the body through the context-compact wire codec.
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, agentId, "chat");
  try {
    if (url.pathname === CONTEXT_COMPACT_ROUTES.compact) await runCauseEffect(agents.compactAgentContext(agentId));
    else await runCauseEffect(agents.compactTaskContext({ agentId, taskId: stringField(body, "taskId") }));
  } catch (error) {
    // A busy chat, or a provider that cannot compact, is a sentence for the member. Any other error is
    // a host fault.
    if (error instanceof ContextCompactRefusedError) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}
