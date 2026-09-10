import {
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  parseChannelCommand,
  parseChannelRead,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { CHANNEL_ROUTES, channelRequest, isChannelSettingsRoute } from "@openbot/contracts/team-protocol/channels-v1";
import type { ChannelService } from "../../backend/channel-service";
import {
  parseCreateChannelMemory,
  parseCreateChannelRoutine,
  parseDeleteChannelMemory,
  parseDeleteChannelRoutine,
  parseListChannelRoutineRuns,
  parseTestChannelRoutine,
  parseUpdateChannelMemory,
  parseUpdateChannelRoutine,
} from "../ipc/agent-inputs";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, stringField } from "./request-helpers";

/**
 * The settings half of a channel is served from `AgentService`, the same object the IPC handlers
 * call, so a memory or a routine written over the Team API cannot differ from one written in the
 * app. `ChannelService` still owns the chat half below.
 */
export type ChannelSettingsAgents = Pick<
  TeamApiAgents,
  | "listChannelMemories"
  | "createChannelMemory"
  | "updateChannelMemory"
  | "deleteChannelMemory"
  | "clearChannelMemories"
  | "listChannelRoutines"
  | "createChannelRoutine"
  | "updateChannelRoutine"
  | "deleteChannelRoutine"
  | "testChannelRoutine"
  | "listChannelRoutineRuns"
>;

export async function routeChannels(
  context: TeamApiRequestContext,
  channels: ChannelService | undefined,
  agents: ChannelSettingsAgents,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json, empty } = context;
  const list = method === "GET" && url.pathname === CHANNEL_ROUTES.list;
  const read = method === "POST" && url.pathname === CHANNEL_ROUTES.read;
  const command = method === "POST" && url.pathname === CHANNEL_ROUTES.command;
  const remove = method === "POST" && url.pathname === CHANNEL_ROUTES.delete;
  // Every settings route is a POST that names its channel in the body, so one test covers all
  // eleven of them and an unknown method on a known path stays a 404 rather than a 400.
  const settings = method === "POST" && isChannelSettingsRoute(url.pathname);
  if (!list && !read && !command && !remove && !settings) return "unmatched";
  if (!channels || !capabilities.has(CHANNEL_CHATS_CAPABILITY))
    throw new HttpError(400, "Channel chats are not supported by this connection.");
  if (list) return json(200, channels.store.list(member.id));
  if (read) {
    const input = parseChannelRead(channelRequest(url.pathname, await readJson(request)));
    return json(200, channels.store.page(input.channelId, input.beforeSequence));
  }
  if (remove) {
    if (!capabilities.has(CHANNEL_DELETE_CAPABILITY))
      throw new HttpError(400, "Channel deletion is not supported by this connection.");
    if (member.role === "member") throw new HttpError(403, "Members cannot delete channels.");
    const body = await readJson(request);
    await channels.deleteChannel(channelId(body));
    return empty(204);
  }
  if (settings) return routeChannelSettings(context, agents);
  const input = parseChannelCommand(channelRequest(url.pathname, await readJson(request)));
  if (input.type === "archive" && member.role === "member")
    throw new HttpError(403, "Members cannot archive channels.");
  return json(200, await channels.command(input, { id: member.id, name: member.name ?? "Team member" }));
}

async function routeChannelSettings(
  context: TeamApiRequestContext,
  agents: ChannelSettingsAgents,
): Promise<RouteOutcome> {
  const { url, request, json, empty } = context;
  // `readJson` has already run the body through the channel wire codec, so every field below is
  // decoded and bounded before the IPC parsers see it.
  const body = await readJson(request);
  switch (url.pathname) {
    case CHANNEL_ROUTES.memories:
      return json(200, agents.listChannelMemories(channelId(body)));
    case CHANNEL_ROUTES.memoryCreate:
      return json(201, agents.createChannelMemory(parseCreateChannelMemory(body)));
    case CHANNEL_ROUTES.memoryUpdate:
      return json(200, agents.updateChannelMemory(parseUpdateChannelMemory(body)));
    case CHANNEL_ROUTES.memoryDelete:
      agents.deleteChannelMemory(parseDeleteChannelMemory(body));
      return empty(204);
    case CHANNEL_ROUTES.memoryClear:
      agents.clearChannelMemories(channelId(body));
      return empty(204);
    case CHANNEL_ROUTES.routines:
      return json(200, agents.listChannelRoutines(channelId(body)));
    case CHANNEL_ROUTES.routineCreate:
      return json(201, agents.createChannelRoutine(parseCreateChannelRoutine(body)));
    case CHANNEL_ROUTES.routineUpdate:
      return json(200, agents.updateChannelRoutine(parseUpdateChannelRoutine(body)));
    case CHANNEL_ROUTES.routineDelete:
      agents.deleteChannelRoutine(parseDeleteChannelRoutine(body));
      return empty(204);
    case CHANNEL_ROUTES.routineTest:
      return json(201, await agents.testChannelRoutine(parseTestChannelRoutine(body)));
    default:
      return json(200, agents.listChannelRoutineRuns(parseListChannelRoutineRuns(body)));
  }
}

function channelId(body: DynamicRecord): string {
  return stringField(body, "channelId");
}
