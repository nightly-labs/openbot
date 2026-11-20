import { type AgentColors, type AgentSummary, parseSetAgentColorInput } from "@openbot/contracts/ipc";
import { AGENT_COLORS_CAPABILITY, AGENT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, requireVisibleBodyAgent } from "./request-helpers";

export async function routeAgentColors(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "updateAgent"> | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || !Object.values(AGENT_COLORS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!agents || !capabilities.has(AGENT_COLORS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentColorsUnsupported"));
  const body = await readJson(request);
  if (url.pathname === AGENT_COLORS_ROUTES.read)
    return json(200, visibleAgentColors(agentColorsOf(agents.listAgents()), hiddenAgentIds));
  requireVisibleBodyAgent(body, hiddenAgentIds);
  let input: ReturnType<typeof parseSetAgentColorInput>;
  try {
    input = parseSetAgentColorInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent color request.");
  }
  requireAgentLevel(context, input.agentId, "manage");
  await runCauseEffect(agents.updateAgent({ agentId: input.agentId, avatarColor: input.color }, undefined, false));
  return json(200, visibleAgentColors(agentColorsOf(agents.listAgents()), hiddenAgentIds));
}

export function agentColorsOf(agents: readonly AgentSummary[]): AgentColors {
  return {
    agents: agents.flatMap((agent) => (agent.avatarColor ? [{ agentId: agent.id, color: agent.avatarColor }] : [])),
  };
}

export function visibleAgentColors(colors: AgentColors, hiddenAgentIds: ReadonlySet<string>): AgentColors {
  return { agents: colors.agents.filter((entry) => !hiddenAgentIds.has(entry.agentId)) };
}
