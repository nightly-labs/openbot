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
  type ChannelTaskWait,
  canAdministerServer,
  channelPageTasks,
  isReleasedRoutineSchedule,
  parseChannelCommand,
  parseChannelRead,
  settingLinkEvent,
  type TeamRole,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import {
  CHANNEL_PICTURE_CAPABILITY,
  CHANNEL_PICTURE_ROUTES,
} from "@openbot/contracts/team-protocol/channel-picture-v1";
import { CHANNEL_ROUTES, channelRequest, isChannelSettingsRoute } from "@openbot/contracts/team-protocol/channels-v1";
import {
  CHANNEL_PAGE_TASKS_CAPABILITY,
  CHANNEL_SEEN_SUBTASKS_CAPABILITY,
  CHANNEL_TASK_WAITS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { SETTING_LINK_MARKERS_CAPABILITY } from "@openbot/contracts/team-protocol/setting-link-markers-v1";
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

const DEFAULT_CHANNEL_PAGE_LIMIT = 100;
const REMOTE_INITIAL_CHANNEL_PAGE_LIMIT = 24;

function firstChannelPageLimit(messagesAfterRead: number): number {
  return Math.min(DEFAULT_CHANNEL_PAGE_LIMIT, Math.max(REMOTE_INITIAL_CHANNEL_PAGE_LIMIT, messagesAfterRead + 1));
}

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
  const settings = method === "POST" && isChannelSettingsRoute(url.pathname);
  const image =
    (method === "GET" || method === "PUT" || method === "DELETE") &&
    url.pathname === CHANNEL_PICTURE_ROUTES.image &&
    capabilities.has(CHANNEL_PICTURE_CAPABILITY);
  if (!list && !read && !command && !remove && !settings && !image) return "unmatched";
  if (!channels || !capabilities.has(CHANNEL_CHATS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.channelsUnsupported"));
  const channelHiddenAgentIds: ReadonlySet<string> = canAdministerServer(member.role) ? new Set() : hiddenAgentIds;
  if (image) return routeChannelImage(context, channels, channelHiddenAgentIds);
  if (list) return json(200, visiblePeerChannels(channels, member, hiddenAgentIds));
  if (read) {
    const input = parseChannelRead(channelRequest(url.pathname, await readJson(request)));
    requireVisibleChannel(channels, input.channelId, channelHiddenAgentIds);
    return json(
      200,
      channelReadPage(channels, input.channelId, input.beforeSequence, {
        capabilities,
        hiddenAgentIds,
        channelHiddenAgentIds,
        memberId: member.id,
      }),
    );
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
  const input = parseChannelCommand(await readJson(request));
  requireVisibleChannel(channels, input.channelId, channelHiddenAgentIds);
  if (input.type === "archive" && !canAdministerServer(member.role))
    throw new HttpError(403, sourceText("error.team.membersCannotArchiveChannels"));
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

export function channelReadPage(
  channels: Pick<ChannelService, "store" | "taskWaits">,
  channelId: string,
  beforeSequence: number | undefined,
  viewer: {
    capabilities: ReadonlySet<string>;
    hiddenAgentIds: ReadonlySet<string>;
    channelHiddenAgentIds: ReadonlySet<string>;
    memberId?: string;
  },
) {
  const { capabilities, hiddenAgentIds, channelHiddenAgentIds, memberId } = viewer;
  const seenSubtasks = capabilities.has(CHANNEL_SEEN_SUBTASKS_CAPABILITY);
  const taskWaits = capabilities.has(CHANNEL_TASK_WAITS_CAPABILITY) && beforeSequence === undefined;
  const settingLinks = capabilities.has(SETTING_LINK_MARKERS_CAPABILITY);
  const pageTasksOnly = capabilities.has(CHANNEL_PAGE_TASKS_CAPABILITY);
  const initialLimit =
    beforeSequence === undefined && memberId !== undefined
      ? firstChannelPageLimit(channels.store.messagesAfterRead(channelId, memberId, DEFAULT_CHANNEL_PAGE_LIMIT))
      : DEFAULT_CHANNEL_PAGE_LIMIT;
  const newest = channels.store.pageWithoutExtent(channelId, beforeSequence, initialLimit);
  const tasks =
    seenSubtasks && beforeSequence === undefined
      ? channels.store.withSeenDependencies(channelId, newest.tasks)
      : newest.tasks;
  const waits = taskWaits
    ? visibleWaits(channels, channels.taskWaits(channelId, newest.tasks), hiddenAgentIds, channelHiddenAgentIds)
    : [];
  const withWaits = <Page extends { tasks: ChannelTask[] }>(value: Page): Page & { waits?: ChannelTaskWait[] } => {
    const kept = waits.filter((wait) => value.tasks.some((task) => task.id === wait.taskId));
    return kept.length ? { ...value, waits: kept } : value;
  };
  for (let limit = initialLimit; ; limit = Math.floor(limit / 2)) {
    const messages = newest.messages.slice(-limit);
    const hasOlder = newest.olderCursor !== null || newest.messages.length > limit;
    const olderCursor = hasOlder ? (messages[0]?.sequence ?? null) : null;
    const shown = messages.filter((item) => shownChannelMessage(item, hiddenAgentIds, settingLinks));
    const base = {
      ...newest,
      tasks: pageTasksOnly ? channelPageTasks(tasks, shown) : tasks,
      olderCursor,
      channel: peerChannel(newest.channel),
      messages: shown,
    };
    let extent: { olderCount: number; oldestAt?: string } | undefined;
    const sized = <Page extends typeof base>(value: Page) => {
      if (olderCursor !== null) extent ??= channels.store.olderExtent(channelId, olderCursor);
      const page = extent ? { ...value, ...extent } : value;
      return { body: page, bytes: Buffer.byteLength(JSON.stringify(page)) };
    };
    let body = withWaits(base);
    let bytes = Buffer.byteLength(JSON.stringify(body));
    if (bytes <= WEBRTC_FRAME_BODY_BUDGET) ({ body, bytes } = sized(body));
    if (bytes > WEBRTC_FRAME_BODY_BUDGET) {
      body = withWaits({ ...base, tasks: channelPageTasks(base.tasks, base.messages) });
      bytes = Buffer.byteLength(JSON.stringify(body));
      if (bytes <= WEBRTC_FRAME_BODY_BUDGET || limit === 1) ({ body, bytes } = sized(body));
    }
    if (bytes <= WEBRTC_FRAME_BODY_BUDGET) return body;
    if (limit === 1) {
      const cut = messageTextCut(
        body.messages.map((item) => item.message),
        bytes - WEBRTC_FRAME_BODY_BUDGET,
      );
      return { ...body, messages: body.messages.map((item) => ({ ...item, message: cut(item.message) })) };
    }
  }
}

export function visiblePeerChannels(
  channels: Pick<ChannelService, "store">,
  member: { id: string; role: TeamRole | null },
  hiddenAgentIds: ReadonlySet<string>,
) {
  const channelHiddenAgentIds: ReadonlySet<string> = canAdministerServer(member.role) ? new Set() : hiddenAgentIds;
  return channels.store
    .list(member.id)
    .filter((channel) => seesChannel(channel.members, channelHiddenAgentIds))
    .map(peerChannel);
}

export function seesChannel(members: readonly { agentId: string }[], hiddenAgentIds: ReadonlySet<string>): boolean {
  return members.length === 0 || members.some((item) => !hiddenAgentIds.has(item.agentId));
}

function visibleWaits(
  channels: Pick<ChannelService, "store">,
  waits: readonly ChannelTaskWait[],
  hiddenAgentIds: ReadonlySet<string>,
  channelHiddenAgentIds: ReadonlySet<string>,
): ChannelTaskWait[] {
  return waits.filter(
    (wait) =>
      !hiddenAgentIds.has(wait.agentId) &&
      (wait.reason !== "agent-busy" || seesChannel(channels.store.get(wait.channelId).members, channelHiddenAgentIds)),
  );
}

export function requireVisibleChannel(
  channels: Pick<ChannelService, "store">,
  channelId: string,
  hiddenAgentIds: ReadonlySet<string>,
): void {
  if (!channelVisible(channels, channelId, hiddenAgentIds))
    throw new HttpError(404, sourceText("error.backend.channelNotFound"));
}

export function channelVisible(
  channels: Pick<ChannelService, "store">,
  channelId: string,
  hiddenAgentIds: ReadonlySet<string>,
): boolean {
  if (hiddenAgentIds.size === 0 || !channels.store.exists(channelId)) return true;
  return seesChannel(channels.store.get(channelId).members, hiddenAgentIds);
}

export function hiddenAuthor(message: ChannelMessage, hiddenAgentIds: ReadonlySet<string>): boolean {
  return message.author.kind === "agent" && hiddenAgentIds.has(message.author.id);
}

export function shownChannelMessage(
  item: ChannelMessage,
  hiddenAgentIds: ReadonlySet<string>,
  settingLinks: boolean,
): boolean {
  return !hiddenAuthor(item, hiddenAgentIds) && (settingLinks || settingLinkEvent(item.message) === null);
}

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

function peerInstructions(text: string): string {
  if (text.length <= INPUT_LIMITS.agentDescription) return text;
  const cut = text.slice(0, INPUT_LIMITS.agentDescription);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function peerChannel<T extends { instructions: string }>(channel: T): T {
  const instructions = peerInstructions(channel.instructions);
  return instructions === channel.instructions ? channel : { ...channel, instructions };
}

function keepLongInstructions(input: ChannelCommand, channels: ChannelService): ChannelCommand {
  if (input.type !== "save" || !channels.store.exists(input.channelId)) return input;
  const stored = channels.store.get(input.channelId).instructions;
  if (stored.length <= INPUT_LIMITS.agentDescription || input.draft.instructions !== peerInstructions(stored))
    return input;
  return { ...input, draft: { ...input.draft, instructions: stored } };
}

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
  if (!isValidAvatarImage(mimeType, bytes)) throw new HttpError(400, sourceText("error.team.logoInvalid"));
  return json(200, peerChannel(await runCauseEffect(channels.setImage(id, { mimeType, bytes }))));
}

function channelId(body: DynamicRecord): string {
  return stringField(body, "channelId");
}
