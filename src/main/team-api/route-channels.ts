import {
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  CHANNEL_TASK_CANCEL_CAPABILITY,
  type ChannelCommand,
  type ChannelMessage,
  canAdministerServer,
  isReleasedRoutineSchedule,
  parseChannelCommand,
  parseChannelRead,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { CHANNEL_ROUTES, channelRequest, isChannelSettingsRoute } from "@openbot/contracts/team-protocol/channels-v1";
import { sourceText } from "@openbot/i18n/source";
import type { ChannelService } from "../../backend/channel-service";
import { runCauseEffect } from "../../backend/effect-boundary";
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
import {
  readJson,
  requireAgentLevel,
  requireReleasedSchedule,
  stringField,
  WEBRTC_FRAME_BODY_BUDGET,
} from "./request-helpers";

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
  hiddenAgentIds: ReadonlySet<string> = new Set(),
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
    throw new HttpError(400, sourceText("error.team.channelsUnsupported"));
  // The agents that hide a whole channel. Owners and admins keep every channel: on an older
  // client, the agents of a provider that its protocol does not know are hidden from them too.
  const channelHiddenAgentIds: ReadonlySet<string> = canAdministerServer(member.role) ? new Set() : hiddenAgentIds;
  if (list)
    return json(
      200,
      channels.store.list(member.id).filter((channel) => seesChannel(channel.members, channelHiddenAgentIds)),
    );
  if (read) {
    const input = parseChannelRead(channelRequest(url.pathname, await readJson(request)));
    requireVisibleChannel(channels, input.channelId, channelHiddenAgentIds);
    // Long messages, such as a member's thinking, make a page of fewer messages, so it fits one WebRTC
    // frame. The client reads the rest as older pages. A page larger than the frame cannot reach a
    // remote client.
    for (let limit = 100; ; limit = Math.floor(limit / 2)) {
      const page = channels.store.page(input.channelId, input.beforeSequence, limit);
      const body = { ...page, messages: page.messages.filter((item) => !hiddenAuthor(item, hiddenAgentIds)) };
      if (limit === 1 || Buffer.byteLength(JSON.stringify(body)) <= WEBRTC_FRAME_BODY_BUDGET) return json(200, body);
    }
  }
  if (remove) {
    if (!capabilities.has(CHANNEL_DELETE_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.channelDeleteUnsupported"));
    if (!canAdministerServer(member.role))
      throw new HttpError(403, sourceText("error.team.membersCannotDeleteChannels"));
    const body = await readJson(request);
    await runCauseEffect(channels.deleteChannel(channelId(body)));
    return empty(204);
  }
  if (settings) return routeChannelSettings(context, agents, channels, channelHiddenAgentIds);
  const input = parseChannelCommand(channelRequest(url.pathname, await readJson(request)));
  requireVisibleChannel(channels, input.channelId, channelHiddenAgentIds);
  if (input.type === "archive" && !canAdministerServer(member.role))
    throw new HttpError(403, sourceText("error.team.membersCannotArchiveChannels"));
  // A restore undoes a delete, so only the people who can delete a channel can restore it.
  if (input.type === "restore" && !canAdministerServer(member.role))
    throw new HttpError(403, sourceText("error.team.membersCannotRestoreChannels"));
  if (input.type === "cancel" && !capabilities.has(CHANNEL_TASK_CANCEL_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.channelTaskCancelUnsupported"));
  if (input.type === "save") requireChatForAddedAgents(context, input, channels, hiddenAgentIds);
  return json(
    200,
    await runCauseEffect(
      channels.command(input, { id: member.id, name: member.name ?? "Team member" }, (queued) =>
        keepHiddenMembers(queued, channels, hiddenAgentIds),
      ),
    ),
  );
}

/**
 * A channel that has members, all of them agents this peer cannot see, is not in the list of this
 * peer: it has no agent there that it can use or read.
 */
function seesChannel(members: readonly { agentId: string }[], hiddenAgentIds: ReadonlySet<string>): boolean {
  return members.length === 0 || members.some((item) => !hiddenAgentIds.has(item.agentId));
}

/** A channel that the list leaves out answers as a channel that does not exist. */
function requireVisibleChannel(channels: ChannelService, channelId: string, hiddenAgentIds: ReadonlySet<string>): void {
  if (hiddenAgentIds.size === 0 || !channels.store.exists(channelId)) return;
  if (!seesChannel(channels.store.get(channelId).members, hiddenAgentIds))
    throw new HttpError(404, sourceText("error.backend.channelNotFound"));
}

/**
 * A message of an agent that this peer cannot see is not on its page. The agent view removes the
 * author of that message, and the channel codec refuses a message without an author, so the whole
 * page failed for the peer.
 */
function hiddenAuthor(message: ChannelMessage, hiddenAgentIds: ReadonlySet<string>): boolean {
  return message.author.kind === "agent" && hiddenAgentIds.has(message.author.id);
}

/**
 * A peer never sees an agent its protocol hides, so its save names only the members it sees and no
 * lead when the lead is hidden. The stored hidden members and the hidden lead stay: without them,
 * renaming a channel on that peer would remove those agents from it and pause their tasks.
 *
 * It runs when the save's turn in the command queue comes, not when the request arrives: a save
 * that still waits in the queue can add a hidden member, and the channel read at arrival does not
 * have that member yet.
 */
function keepHiddenMembers(
  input: ChannelCommand,
  channels: ChannelService,
  hiddenAgentIds: ReadonlySet<string>,
): ChannelCommand {
  if (input.type !== "save" || hiddenAgentIds.size === 0 || !channels.store.exists(input.channelId)) return input;
  const stored = channels.store.get(input.channelId);
  const named = new Set(input.draft.members.map((item) => item.agentId));
  const kept = stored.members.filter((item) => hiddenAgentIds.has(item.agentId) && !named.has(item.agentId));
  const leadAgentId =
    input.draft.leadAgentId === null && stored.leadAgentId !== null && hiddenAgentIds.has(stored.leadAgentId)
      ? stored.leadAgentId
      : input.draft.leadAgentId;
  if (kept.length === 0 && leadAgentId === input.draft.leadAgentId) return input;
  return { ...input, draft: { ...input.draft, members: [...input.draft.members, ...kept], leadAgentId } };
}

/** An agent that a save adds to a channel talks there, so the member needs `chat` for it. */
function requireChatForAddedAgents(
  context: TeamApiRequestContext,
  input: Extract<ChannelCommand, { type: "save" }>,
  channels: ChannelService,
  hiddenAgentIds: ReadonlySet<string>,
): void {
  const stored = new Set(
    channels.store.exists(input.channelId)
      ? channels.store.get(input.channelId).members.map((item) => item.agentId)
      : [],
  );
  for (const { agentId } of input.draft.members) {
    if (stored.has(agentId)) continue;
    if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
    requireAgentLevel(context, agentId, "chat");
  }
}

async function routeChannelSettings(
  context: TeamApiRequestContext,
  agents: ChannelSettingsAgents,
  channels: ChannelService,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { url, request, json, empty } = context;
  // `readJson` has already run the body through the channel wire codec, so every field below is
  // decoded and bounded before the IPC parsers see it.
  const body = await readJson(request);
  requireVisibleChannel(channels, channelId(body), hiddenAgentIds);
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
      // A `once` routine stays on this computer: the channel codec rejects its schedule.
      return json(
        200,
        agents
          .listChannelRoutines(channelId(body))
          .filter((routine) => isReleasedRoutineSchedule(routine.trigger.schedule)),
      );
    case CHANNEL_ROUTES.routineCreate: {
      const input = parseCreateChannelRoutine(body);
      requireReleasedSchedule(input.schedule);
      return json(201, agents.createChannelRoutine(input));
    }
    case CHANNEL_ROUTES.routineUpdate: {
      const input = parseUpdateChannelRoutine(body);
      requireReleasedSchedule(input.schedule);
      const hidden = agents
        .listChannelRoutines(input.channelId)
        .some((routine) => routine.id === input.routineId && !isReleasedRoutineSchedule(routine.trigger.schedule));
      if (hidden) throw new HttpError(404, sourceText("error.backend.routineGone"));
      return json(200, agents.updateChannelRoutine(input));
    }
    case CHANNEL_ROUTES.routineDelete:
      agents.deleteChannelRoutine(parseDeleteChannelRoutine(body));
      return empty(204);
    case CHANNEL_ROUTES.routineTest:
      return json(201, await runCauseEffect(agents.testChannelRoutine(parseTestChannelRoutine(body))));
    default:
      return json(200, agents.listChannelRoutineRuns(parseListChannelRoutineRuns(body)));
  }
}

function channelId(body: DynamicRecord): string {
  return stringField(body, "channelId");
}
