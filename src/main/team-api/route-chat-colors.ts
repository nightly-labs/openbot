import {
  type AgentSummary,
  type ChatColors,
  parseSetAgentChatColorInput,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { CHAT_COLORS_CAPABILITY, CHAT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/chat-colors-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, requireVisibleBodyAgent } from "./request-helpers";

/** The `chat-colors-v1` members list bound, the bound of the released presence snapshot. */
const CHAT_COLOR_MEMBERS_LIMIT = 100;

/**
 * Any member reads the chat colour of each agent that the member can see, and the chat colour of each
 * member. A member sets the chat colour of an agent with manage access to it, as for its avatar on the
 * released agent route, and the change goes through the same `updateAgent` operation. A member's own
 * chat colour comes from their account, so this route cannot set it. Frozen by `chat-colors-v1`.
 */
export async function routeChatColors(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "updateAgent"> | undefined,
  members: () => readonly TeamMemberSummary[],
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || !Object.values(CHAT_COLORS_ROUTES).some((path) => path === url.pathname)) return "unmatched";
  if (!agents || !capabilities.has(CHAT_COLORS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.chatColorsUnsupported"));
  // `readJson` has already run the body through the chat-colors wire codec.
  const body = await readJson(request);
  const snapshot = () => visibleChatColors(chatColorsOf(agents.listAgents(), members()), hiddenAgentIds);
  if (url.pathname === CHAT_COLORS_ROUTES.read) return json(200, snapshot());
  requireVisibleBodyAgent(body, hiddenAgentIds);
  let input: ReturnType<typeof parseSetAgentChatColorInput>;
  try {
    input = parseSetAgentChatColorInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid chat color request.");
  }
  requireAgentLevel(context, input.agentId, "manage");
  // The released route refuses a provider change during work, so this change does the same.
  await runCauseEffect(agents.updateAgent({ agentId: input.agentId, chatColor: input.color }, undefined, false));
  return json(200, snapshot());
}

/** The agents and members that have a chat colour. */
export function chatColorsOf(agents: readonly AgentSummary[], members: readonly TeamMemberSummary[]): ChatColors {
  return {
    agents: agents.flatMap((agent) => (agent.chatColor ? [{ agentId: agent.id, color: agent.chatColor }] : [])),
    members: members
      .flatMap((member) => (member.chatColor ? [{ memberId: member.id, color: member.chatColor }] : []))
      .slice(0, CHAT_COLOR_MEMBERS_LIMIT),
  };
}

/** The chat colours without the agents that this peer cannot see. Each peer sees all members. */
export function visibleChatColors(colors: ChatColors, hiddenAgentIds: ReadonlySet<string>): ChatColors {
  return {
    agents: colors.agents.filter((entry) => !hiddenAgentIds.has(entry.agentId)),
    members: colors.members,
  };
}
