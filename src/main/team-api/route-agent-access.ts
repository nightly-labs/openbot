import { parseAgentAccessChange } from "@openbot/contracts/ipc";
import { AGENT_ACCESS_CAPABILITY, AGENT_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/agent-access-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { agentAccessSnapshot } from "../agent-access-store";
import type { TeamApiAgentAccess, TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The roles of this server. Each member reads the levels that apply to them; an owner or admin also
 * reads and replaces the roles. Frozen by `agent-access-v1`.
 */
export async function routeAgentAccess(
  context: TeamApiRequestContext,
  access: TeamApiAgentAccess | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
  serverId: string | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || (url.pathname !== AGENT_ACCESS_ROUTES.read && url.pathname !== AGENT_ACCESS_ROUTES.set))
    return "unmatched";
  if (!access || !serverId || !capabilities.has(AGENT_ACCESS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentAccessUnsupported"));
  // `hiddenAgentIds` holds the agents that the roles close to a member, so `mine` leaves them out.
  const existing = agents.listAgents().map((agent) => agent.id);
  const shown = existing.filter((agentId) => !hiddenAgentIds.has(agentId));
  const body = await readJson(request);
  if (url.pathname === AGENT_ACCESS_ROUTES.read)
    return json(200, agentAccessSnapshot(access.levels(serverId), member, shown));
  requireAdmin(member);
  let change: ReturnType<typeof parseAgentAccessChange>;
  try {
    change = parseAgentAccessChange(body);
  } catch {
    throw new HttpError(400, "Invalid agent access change.");
  }
  const saved = await Effect.runPromise(Effect.result(access.set(serverId, change, new Set(shown), new Set(existing))));
  if (Result.isFailure(saved)) {
    if (saved.failure._tag === "AgentAccessStale") throw new HttpError(409, sourceText("error.team.agentAccessStale"));
    throw saved.failure.cause;
  }
  return json(200, agentAccessSnapshot(access.levels(serverId), member, shown));
}
