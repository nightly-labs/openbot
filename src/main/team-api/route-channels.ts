import { readFile } from "node:fs/promises";
import { isAvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  CHANNEL_TASK_CANCEL_CAPABILITY,
  type ChannelCommand,
  type ChannelMessage,
  type ChannelTask,
  canAdministerServer,
  isReleasedRoutineSchedule,
  parseChannelCommand,
  parseChannelRead,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import {
  CHANNEL_PICTURE_CAPABILITY,
  CHANNEL_PICTURE_ROUTES,
} from "@openbot/contracts/team-protocol/channel-picture-v1";
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
  messageTextCut,
  readBinary,
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
  // Only a peer that advertises channel-picture-v1 has the image route; for any other it does not exist.
  const image =
    (method === "GET" || method === "PUT" || method === "DELETE") &&
    url.pathname === CHANNEL_PICTURE_ROUTES.image &&
    capabilities.has(CHANNEL_PICTURE_CAPABILITY);
  if (!list && !read && !command && !remove && !settings && !image) return "unmatched";
  if (!channels || !capabilities.has(CHANNEL_CHATS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.channelsUnsupported"));
  // The agents that hide a whole channel. Owners and admins keep every channel: on an older
  // client, the agents of a provider that its protocol does not know are hidden from them too.
  const channelHiddenAgentIds: ReadonlySet<string> = canAdministerServer(member.role) ? new Set() : hiddenAgentIds;
  if (image) return routeChannelImage(context, channels, channelHiddenAgentIds);
  if (list)
    return json(
      200,
      channels.store
        .list(member.id)
        .filter((channel) => seesChannel(channel.members, channelHiddenAgentIds))
        .map(peerChannel),
    );
  if (read) {
    const input = parseChannelRead(channelRequest(url.pathname, await readJson(request)));
    requireVisibleChannel(channels, input.channelId, channelHiddenAgentIds);
    // Long messages, such as a member's thinking, make a page of fewer messages, so it fits one WebRTC
    // frame. The client reads the rest as older pages. A page larger than the frame cannot reach a
    // remote client.
    for (let limit = 100; ; limit = Math.floor(limit / 2)) {
      const page = channels.store.page(input.channelId, input.beforeSequence, limit);
      let body = {
        ...page,
        channel: peerChannel(page.channel),
        messages: page.messages.filter((item) => !hiddenAuthor(item, hiddenAgentIds)),
      };
      let bytes = Buffer.byteLength(JSON.stringify(body));
      if (bytes > WEBRTC_FRAME_BODY_BUDGET) {
        body = { ...body, tasks: pageTasks(body.tasks, body.messages) };
        bytes = Buffer.byteLength(JSON.stringify(body));
      }
      if (bytes <= WEBRTC_FRAME_BODY_BUDGET) return json(200, body);
      if (limit === 1) {
        // One message alone is too large: cut its text, so the channel opens and the older pages load.
        const cut = messageTextCut(
          body.messages.map((item) => item.message),
          bytes - WEBRTC_FRAME_BODY_BUDGET,
        );
        return json(200, { ...body, messages: body.messages.map((item) => ({ ...item, message: cut(item.message) })) });
      }
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
  // `readJson` has already run the body through the channel wire codec, with the `isolated` of a peer
  // that advertises channel-isolation-v1. A second pass through channels-v1 would drop it.
  const input = parseChannelCommand(await readJson(request));
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
    peerChannel(
      await runCauseEffect(
        channels.command(input, { id: member.id, name: member.name ?? "Team member" }, (queued) =>
          keepLongInstructions(keepHiddenMembers(queued, channels, hiddenAgentIds), channels),
        ),
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
export function requireVisibleChannel(
  channels: Pick<ChannelService, "store">,
  channelId: string,
  hiddenAgentIds: ReadonlySet<string>,
): void {
  if (hiddenAgentIds.size === 0 || !channels.store.exists(channelId)) return;
  if (!seesChannel(channels.store.get(channelId).members, hiddenAgentIds))
    throw new HttpError(404, sourceText("error.backend.channelNotFound"));
}

/**
 * The tasks that a page shows: every task of a run with open work (Stop, the stopped-task cards and
 * the awaiting replies read them), and the tasks of the messages on the page. A channel keeps every
 * task it ever had, one for each member of each request, so in a large channel the tasks alone
 * passed one WebRTC frame and the channel did not open on a remote client (#6045).
 */
function pageTasks(tasks: readonly ChannelTask[], messages: readonly ChannelMessage[]): ChannelTask[] {
  const openRuns = new Set(
    tasks.flatMap((task) => (task.state === "completed" || task.state === "cancelled" ? [] : [task.rootTaskId])),
  );
  const shown = new Set(messages.map((item) => item.taskId));
  return tasks.filter((task) => openRuns.has(task.rootTaskId) || shown.has(task.id));
}

/**
 * A message of an agent that this peer cannot see is not on its page. The agent view removes the
 * author of that message, and the channel codec refuses a message without an author, so the whole
 * page failed for the peer.
 */
export function hiddenAuthor(message: ChannelMessage, hiddenAgentIds: ReadonlySet<string>): boolean {
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

/**
 * Released peers read at most `agentDescription` characters of instructions, and the channel codec
 * refuses more, so stored instructions over the limit (#5929) go to a peer cut to it.
 */
function peerInstructions(text: string): string {
  if (text.length <= INPUT_LIMITS.agentDescription) return text;
  const cut = text.slice(0, INPUT_LIMITS.agentDescription);
  // Do not end on half of a surrogate pair.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

function peerChannel<T extends { instructions: string }>(channel: T): T {
  const instructions = peerInstructions(channel.instructions);
  return instructions === channel.instructions ? channel : { ...channel, instructions };
}

/**
 * A peer's save carries the whole draft, so a member change on a peer sends back the cut text that
 * `peerChannel` gave it. That text keeps the stored instructions, rather than losing their end.
 * Like `keepHiddenMembers`, it runs when the save's turn in the command queue comes.
 */
function keepLongInstructions(input: ChannelCommand, channels: ChannelService): ChannelCommand {
  if (input.type !== "save" || !channels.store.exists(input.channelId)) return input;
  const stored = channels.store.get(input.channelId).instructions;
  if (stored.length <= INPUT_LIMITS.agentDescription || input.draft.instructions !== peerInstructions(stored))
    return input;
  return { ...input, draft: { ...input.draft, instructions: stored } };
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

/**
 * The uploaded image of a channel (channel-picture-v1). Like a save, any member who sees the channel
 * can change it, as on the desktop. The image is served by its version, so a stale version is 404.
 */
async function routeChannelImage(
  context: TeamApiRequestContext,
  channels: ChannelService,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, request, response, json } = context;
  const id = url.searchParams.get("channelId") ?? "";
  if (!id || id.length > INPUT_LIMITS.identifier) throw new HttpError(400, "channelId is required.");
  if (!channels.store.exists(id)) throw new HttpError(404, sourceText("error.backend.channelNotFound"));
  requireVisibleChannel(channels, id, hiddenAgentIds);
  if (method === "GET") {
    const file = channels.images.resolve(channels.store.get(id));
    if (!file || file.version !== url.searchParams.get("v"))
      throw new HttpError(404, sourceText("error.team.avatarNotFound"));
    const bytes = await readFile(file.path);
    response.writeHead(200, {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(bytes);
    return "handled";
  }
  if (method === "DELETE") return json(200, peerChannel(await runCauseEffect(channels.setImage(id, null))));
  const mimeType = request.headers["content-type"]?.split(";", 1)[0]?.trim() ?? "";
  if (!isAvatarMimeType(mimeType)) throw new HttpError(415, sourceText("error.team.avatarType"));
  const bytes = await readBinary(request, AVATAR_IMAGE_LIMITS.storedBytes);
  // Bad input is the peer's error: 400, not the 500 of a failed write.
  if (!isValidAvatarImage(mimeType, bytes)) throw new HttpError(400, sourceText("error.team.logoInvalid"));
  return json(200, peerChannel(await runCauseEffect(channels.setImage(id, { mimeType, bytes }))));
}

function channelId(body: DynamicRecord): string {
  return stringField(body, "channelId");
}
