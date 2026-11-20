import { agentAccessRank } from "@openbot/contracts/ipc";
import {
  PENDING_PROMPTS_CAPABILITY,
  PENDING_PROMPTS_LIMIT,
  PENDING_PROMPTS_ROUTES,
} from "@openbot/contracts/team-protocol/pending-prompts-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";

export async function routePendingPrompts(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "pendingPrompts" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, json } = context;
  if (method !== "POST" || url.pathname !== PENDING_PROMPTS_ROUTES.list) return "unmatched";
  if (!capabilities.has(PENDING_PROMPTS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.pendingPromptsUnsupported"));
  const shownAgentIds = new Set(
    agents
      .listAgents()
      .map((agent) => agent.id)
      .filter((agentId) => !hiddenAgentIds.has(agentId) && agentAccessRank(context.agentLevel(agentId)) > 0),
  );
  const prompts = agents
    .pendingPrompts()
    .filter((prompt) => shownAgentIds.has(prompt.agentId))
    .slice(0, PENDING_PROMPTS_LIMIT);
  return json(200, { prompts });
}
