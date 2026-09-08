import { CHANNEL_CHATS_CAPABILITY, parseChannelCommand, parseChannelRead } from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES, channelRequest } from "@openbot/contracts/team-protocol/channels-v1";
import type { ChannelService } from "../../backend/channel-service";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

export async function routeChannels(
  context: TeamApiRequestContext,
  channels: ChannelService | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const list = method === "GET" && url.pathname === CHANNEL_ROUTES.list;
  const read = method === "POST" && url.pathname === CHANNEL_ROUTES.read;
  const command = method === "POST" && url.pathname === CHANNEL_ROUTES.command;
  if (!list && !read && !command) return "unmatched";
  if (!channels || !capabilities.has(CHANNEL_CHATS_CAPABILITY))
    throw new HttpError(400, "Channel chats are not supported by this connection.");
  if (list) return json(200, channels.store.list(member.id));
  if (read) {
    const input = parseChannelRead(channelRequest(url.pathname, await readJson(request)));
    return json(200, channels.store.page(input.channelId, input.beforeSequence));
  }
  const input = parseChannelCommand(channelRequest(url.pathname, await readJson(request)));
  if (input.type === "archive" && member.role === "member")
    throw new HttpError(403, "Members cannot archive channels.");
  return json(200, await channels.command(input, { id: member.id, name: member.name ?? "Team member" }));
}
