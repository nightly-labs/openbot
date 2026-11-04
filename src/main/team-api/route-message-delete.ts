import { agentAccessRank, CHANNEL_CHATS_CAPABILITY, canAdministerServer } from "@openbot/contracts/ipc";
import { MESSAGE_DELETE_CAPABILITY, MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import { sourceText } from "@openbot/i18n/source";
import type { ChannelService } from "../../backend/channel-service";
import { MessageDeleteRefusedError, runMessageDelete } from "../message-delete-refusal";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, stringField } from "./request-helpers";

const REFUSED_STATUS = { forbidden: 403, "not-found": 404, busy: 409 } as const;

/**
 * Deletes one message from the chat of an agent, of one of its open tasks, or of a channel, for a
 * member of a joined server. Frozen by `message-delete-v1`.
 *
 * A member deletes the messages they sent: in an agent chat with `chat` on the agent, in a channel
 * as any member. With `manage` on the agent, or as an owner or admin for a channel, they delete any
 * message. The agent id is in the body, so the router's check of the path does not see it, and this
 * module refuses an agent hidden from the caller. A host without channels answers the channel route
 * as it answers every channel route.
 */
export async function routeMessageDelete(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "deleteConversationMessage" | "listAgents">,
  channels: Pick<ChannelService, "deleteMessage" | "store"> | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (
    method !== "POST" ||
    (path !== MESSAGE_DELETE_ROUTES.agent &&
      path !== MESSAGE_DELETE_ROUTES.task &&
      path !== MESSAGE_DELETE_ROUTES.channel)
  )
    return "unmatched";
  if (!capabilities.has(MESSAGE_DELETE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.messageDeleteUnsupported"));
  // `readJson` has already run the body through the message-delete wire codec.
  const body = await readJson(request);
  const messageId = stringField(body, "messageId");
  try {
    if (path === MESSAGE_DELETE_ROUTES.channel) {
      if (!channels || !capabilities.has(CHANNEL_CHATS_CAPABILITY))
        throw new HttpError(400, sourceText("error.team.channelsUnsupported"));
      const channelId = stringField(body, "channelId");
      if (!channels.store.exists(channelId)) throw new HttpError(404, sourceText("error.backend.channelNotFound"));
      await runMessageDelete(
        channels.deleteMessage(
          { channelId, messageId },
          { memberId: member.id, deleteAny: canAdministerServer(member.role) },
        ),
      );
      return json(200, {});
    }
    const agentId = stringField(body, "agentId");
    if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
      throw new HttpError(404, sourceText("error.team.agentNotFound"));
    requireAgentLevel(context, agentId, "chat");
    const deleteAny = agentAccessRank(context.agentLevel(agentId)) >= agentAccessRank("manage");
    await runMessageDelete(
      agents.deleteConversationMessage(
        path === MESSAGE_DELETE_ROUTES.task
          ? { agentId, taskId: stringField(body, "taskId"), messageId }
          : { agentId, messageId },
        { memberId: member.id, deleteAny },
      ),
    );
  } catch (error) {
    // A refusal is a sentence for the member. Any other error is a host fault.
    if (error instanceof MessageDeleteRefusedError) throw new HttpError(REFUSED_STATUS[error.reason], error.message);
    throw error;
  }
  return json(200, {});
}
