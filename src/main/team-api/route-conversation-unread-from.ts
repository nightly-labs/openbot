import {
  CONVERSATION_UNREAD_FROM_CAPABILITY,
  CONVERSATION_UNREAD_FROM_ROUTE,
} from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  markerExclusionsForCapabilities,
  readJson,
  requireAgentLevel,
  requireListedAgent,
  stringField,
} from "./request-helpers";

export async function routeConversationUnreadFrom(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "markConversationUnread" | "readConversationPageFor">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== CONVERSATION_UNREAD_FROM_ROUTE) return "unmatched";
  if (!capabilities.has(CONVERSATION_UNREAD_FROM_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.markUnreadUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(agents, agentId);
  requireAgentLevel(context, agentId, "view");
  const fromMessageId = stringField(body, "fromMessageId");
  const exclusions = markerExclusionsForCapabilities(capabilities);
  const page = await runCauseEffect(
    agents.readConversationPageFor(agentId, member.id, { type: "around", messageId: fromMessageId }, 1, exclusions),
  );
  if (!page.messages.some((message) => message.id === fromMessageId))
    throw new HttpError(404, sourceText("error.backend.readBoundaryUnavailable"));
  return json(200, await runCauseEffect(agents.markConversationUnread(agentId, member.id, fromMessageId, exclusions)));
}
