import { CHANNEL_CHATS_CAPABILITY, canAdministerServer } from "@openbot/contracts/ipc";
import { CHAT_HISTORY_CAPABILITY, CHAT_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/chat-history-v1";
import { ContextCompactRefusedError } from "@openbot/contracts/team-protocol/context-compact-v1";
import { ContextResetBusyError } from "@openbot/contracts/team-protocol/context-reset-v1";
import { sourceText } from "@openbot/i18n/source";
import type { ChannelService } from "../../backend/channel-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, stringField } from "./request-helpers";
import { requireVisibleChannel } from "./route-channels";

/**
 * "Delete history" of an agent's own chat, and "New conversation", "Compact now" and "Delete history"
 * of a channel, from a joined server. Frozen by `chat-history-v1`.
 *
 * Deleting an agent's history needs manage access to the agent; the agent id is in the body, so the
 * router's check of the path does not see it, and this module refuses an agent hidden from the
 * caller. A member who sees a channel starts a new conversation or compacts it; only an owner or
 * admin deletes its history. A host without channels answers the channel routes as it answers every
 * channel route.
 */
export async function routeChatHistory(
  context: TeamApiRequestContext,
  agents: Pick<
    TeamApiAgents,
    "deleteAgentHistory" | "clearChannelContext" | "compactChannelContext" | "deleteChannelHistory" | "listAgents"
  >,
  channels: Pick<ChannelService, "store"> | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (
    method !== "POST" ||
    (path !== CHAT_HISTORY_ROUTES.agentDelete &&
      path !== CHAT_HISTORY_ROUTES.channelClear &&
      path !== CHAT_HISTORY_ROUTES.channelCompact &&
      path !== CHAT_HISTORY_ROUTES.channelDelete)
  )
    return "unmatched";
  if (!capabilities.has(CHAT_HISTORY_CAPABILITY))
    throw new HttpError(
      400,
      sourceText(
        path === CHAT_HISTORY_ROUTES.channelClear || path === CHAT_HISTORY_ROUTES.channelCompact
          ? "error.team.channelContextUnsupported"
          : "error.team.historyDeleteUnsupported",
      ),
    );
  // `readJson` has already run the body through the chat-history wire codec.
  const body = await readJson(request);
  try {
    if (path === CHAT_HISTORY_ROUTES.agentDelete) {
      const agentId = stringField(body, "agentId");
      if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
        throw new HttpError(404, sourceText("error.team.agentNotFound"));
      requireAgentLevel(context, agentId, "manage");
      await runCauseEffect(agents.deleteAgentHistory(agentId));
      return json(200, {});
    }
    if (!channels || !capabilities.has(CHANNEL_CHATS_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.channelsUnsupported"));
    const channelId = stringField(body, "channelId");
    if (!channels.store.exists(channelId)) throw new HttpError(404, sourceText("error.backend.channelNotFound"));
    const admin = canAdministerServer(member.role);
    // Owners and admins see every channel, as in the channel list.
    requireVisibleChannel(channels, channelId, admin ? new Set() : hiddenAgentIds);
    if (path === CHAT_HISTORY_ROUTES.channelClear)
      await runCauseEffect(
        agents.clearChannelContext(channelId, { id: member.id, name: member.name ?? "Team member" }),
      );
    else if (path === CHAT_HISTORY_ROUTES.channelCompact) await runCauseEffect(agents.compactChannelContext(channelId));
    else {
      if (!admin) throw new HttpError(403, sourceText("error.team.membersCannotDeleteChannelHistory"));
      await runCauseEffect(agents.deleteChannelHistory(channelId));
    }
  } catch (error) {
    // Work that still runs or waits, an archived channel, or a provider that cannot compact, is a
    // sentence for the member. Any other error is a host fault.
    if (
      error instanceof ContextResetBusyError ||
      error instanceof ContextCompactRefusedError ||
      (error instanceof Error && channelRefusals().has(error.message))
    )
      throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}

/** The sentences with which `ChannelService` refuses these actions. It throws a plain `Error` with them. */
function channelRefusals(): ReadonlySet<string> {
  return new Set([
    sourceText("error.backend.channelWaitBeforeNewConversation"),
    sourceText("error.backend.channelWaitBeforeCompact"),
    sourceText("error.backend.channelWaitBeforeDeleteHistory"),
    sourceText("error.backend.channelArchived"),
  ]);
}
