import { createHash } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentSummary,
  AVATAR_HUES,
  CHANNEL_ICON_NAMES,
  type Channel,
  type ChannelDraft,
  isAvatarHue,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { ChannelService } from "../channel-service";
import type { DynamicToolCallParams } from "../protocol";
import { loadAvatarFile } from "./avatar-file";
import { openBotToolResult } from "./routine-tools";
import { toolCallIdempotencyKey } from "./tool-call-idempotency";
import { ToolOperationFailed, toToolOperationFailed } from "./tool-operation";

/** The tools an agent creates and changes channels with, from its own chat or a channel task that a person started. */
export const CHANNEL_AGENT_TOOL_NAMES: ReadonlySet<string> = new Set(["create_channel", "update_channel"]);

const agentId = z.string().trim().min(1).max(INPUT_LIMITS.identifier);
const agentIds = z
  .array(agentId)
  .max(INPUT_LIMITS.agents)
  .refine((ids) => new Set(ids).size === ids.length, "Pass each agent id once.");

const channelFields = {
  name: z.string().trim().min(1).max(INPUT_LIMITS.agentName).describe("The channel name the sidebar shows."),
  title: z.string().trim().max(INPUT_LIMITS.agentTitle).describe("A short line under the name."),
  instructions: z
    .string()
    .trim()
    .max(INPUT_LIMITS.agentDescription)
    .describe("What the channel is for and how its members work. Every member reads it."),
  isolated: z.boolean().describe("true: memories made in the channel stay in the channel."),
  icon: z.strictObject({
    name: z.enum(CHANNEL_ICON_NAMES),
    // A number schema, not z.literal: Gemini rejects a request whose tool schema has a non-string enum.
    hue: z
      .number()
      .int()
      .refine(isAvatarHue, "Invalid hue.")
      .describe(`One of ${AVATAR_HUES.join(", ")}.`),
  }),
  imagePath: z.string().trim().min(1).max(INPUT_LIMITS.path),
};

const ICON_TEXT = "The channel picture: an icon on a colour. It replaces an image.";
const IMAGE_TEXT =
  "The channel picture: a PNG, JPEG, or WebP file up to 512 KB, absolute or relative to your workspace.";

// Not strict: list_channels took no arguments before, and a call with an extra key still lists.
export const listChannelsToolSchema = z.object({
  archived: z.boolean().describe("true lists the archived channels instead of the open ones.").optional(),
});

export const createChannelToolSchema = z
  .strictObject({
    name: channelFields.name,
    title: channelFields.title.optional(),
    instructions: channelFields.instructions.optional(),
    memberAgentIds: agentIds.min(1).describe("Ids from openbot.list_agents of the agents in the channel."),
    leadAgentId: agentId
      .describe("The member that routes requests that name no member. Omit it for the first member.")
      .optional(),
    isolated: channelFields.isolated.optional(),
    icon: channelFields.icon.describe(ICON_TEXT).optional(),
    imagePath: channelFields.imagePath.describe(IMAGE_TEXT).optional(),
  })
  .refine((args) => args.icon === undefined || args.imagePath === undefined, "Use icon or imagePath, not both.");

export const updateChannelToolSchema = z
  .strictObject({
    channelId: z.string().trim().min(1).max(INPUT_LIMITS.identifier).describe("Id from openbot.list_channels."),
    name: channelFields.name.optional(),
    title: channelFields.title.optional(),
    instructions: channelFields.instructions.optional(),
    addMemberAgentIds: agentIds.describe("Ids from openbot.list_agents of the agents to add.").optional(),
    removeMemberAgentIds: agentIds
      .describe("Ids of the members to remove. Their open tasks in the channel stop.")
      .optional(),
    leadAgentId: agentId.nullable().describe("A member to make the lead, or null for no lead.").optional(),
    isolated: channelFields.isolated.optional(),
    icon: channelFields.icon.nullable().describe(`${ICON_TEXT} null removes it.`).optional(),
    imagePath: channelFields.imagePath.nullable().describe(`${IMAGE_TEXT} null removes it.`).optional(),
    archived: z
      .boolean()
      .describe("true archives the channel and stops its work. false brings an archived channel back.")
      .optional(),
  })
  .refine(
    (args) => args.icon === undefined || args.icon === null || args.imagePath === undefined,
    "Use icon or imagePath, not both.",
  )
  .refine(
    ({ channelId: _channelId, ...change }) => Object.values(change).some((value) => value !== undefined),
    "At least one channel change is required.",
  );

type CreateChannelArgs = z.infer<typeof createChannelToolSchema>;
type UpdateChannelArgs = z.infer<typeof updateChannelToolSchema>;

const UNKNOWN_CHANNEL = "No channel has that channelId. Call openbot.list_channels.";
const OWN_CHANNEL_IN_TASK =
  "update_channel does not change the channel of your current task. For this channel, use channel_add_member, channel_remove_member and channel_set_instructions.";

/** An agent that a channel can take: one that exists. */
function requireAvailable(agents: readonly AgentSummary[], id: string): AgentSummary {
  const agent = agents.find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`No agent has the id ${id}. Get the ids from openbot.list_agents.`);
  return agent;
}

function requireMemberCount(count: number): void {
  if (count > INPUT_LIMITS.agents) throw new Error(`A channel has at most ${INPUT_LIMITS.agents} members.`);
}

function channelIcon(icon: ChannelDraft["icon"]): Pick<ChannelDraft, "icon"> {
  return icon === undefined ? {} : { icon };
}

/** The draft of a new channel. The lead is the first member unless the call names one, as in the create dialog. */
function createdChannelDraft(args: CreateChannelArgs, agents: readonly AgentSummary[]): ChannelDraft {
  for (const id of args.memberAgentIds) requireAvailable(agents, id);
  const leadAgentId = args.leadAgentId ?? args.memberAgentIds[0] ?? null;
  if (leadAgentId !== null && !args.memberAgentIds.includes(leadAgentId))
    throw new Error("leadAgentId must be one of memberAgentIds.");
  return {
    name: args.name,
    title: args.title ?? "",
    instructions: args.instructions ?? "",
    members: args.memberAgentIds.map((id) => ({ agentId: id })),
    leadAgentId,
    ...(args.isolated === undefined ? {} : { isolated: args.isolated }),
    ...channelIcon(args.icon),
  };
}

/**
 * The draft of a changed channel, from the channel as it is stored when the save's turn comes. Adding
 * a member that is already there, or removing one that is not, changes nothing, so a retried call
 * gives the same draft. A removed lead leaves no lead unless the call names a new one.
 */
function updatedChannelDraft(
  stored: Channel | null,
  args: UpdateChannelArgs,
  agents: readonly AgentSummary[],
): ChannelDraft {
  if (!stored) throw new Error(UNKNOWN_CHANNEL);
  const removed = new Set(args.removeMemberAgentIds ?? []);
  const kept = stored.members.filter((member) => !removed.has(member.agentId));
  const added = (args.addMemberAgentIds ?? [])
    .filter((id) => !removed.has(id) && !kept.some((member) => member.agentId === id))
    .map((id) => ({ agentId: requireAvailable(agents, id).id }));
  const members = [...kept, ...added];
  requireMemberCount(members.length);
  const leadAgentId =
    args.leadAgentId !== undefined
      ? args.leadAgentId
      : stored.leadAgentId !== null && removed.has(stored.leadAgentId)
        ? null
        : stored.leadAgentId;
  if (leadAgentId !== null && !members.some((member) => member.agentId === leadAgentId))
    throw new Error("leadAgentId must be a member of the channel after this change.");
  return {
    name: args.name ?? stored.name,
    title: args.title ?? stored.title,
    instructions: args.instructions ?? stored.instructions,
    members,
    leadAgentId,
    ...(args.isolated === undefined ? {} : { isolated: args.isolated }),
    ...channelIcon(args.icon),
  };
}

/**
 * The id of the channel that one `create_channel` call makes. It comes from the call's idempotency
 * key, so a retried call finds the channel that the first attempt made and does not make a second.
 */
function createdChannelId(params: { threadId: string; turnId: string; callId: string }): string {
  const hex = createHash("sha256")
    .update(`create_channel:${toolCallIdempotencyKey(params)}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** What the calling agent reads back: the channel as it is now, with member names. */
function channelResult(channel: Channel, agents: readonly AgentSummary[]) {
  const name = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;
  return {
    id: channel.id,
    name: channel.name,
    title: channel.title,
    instructions: channel.instructions,
    members: channel.members.map((member) => ({ agentId: member.agentId, name: name(member.agentId) })),
    leadAgentId: channel.leadAgentId,
    isolated: channel.isolated === true,
    icon: channel.icon ?? null,
    hasImage: Boolean(channel.imageUrl),
    archived: channel.archived,
  };
}

export interface ChannelAgentToolDependencies {
  channels: ChannelService;
  listAgents(): AgentSummary[];
  /**
   * The channel of the channel task that makes the call, if any. `update_channel` does not change it:
   * the channel tools change it, write the change note, and do not stop the work of the caller.
   */
  taskChannelId?: string | null;
}

/**
 * `create_channel` and `update_channel`. The channel commands are the ones the channel settings send,
 * through the same queue, so a change waits for the commands before it. A picture file is read before
 * anything is written: a file that cannot be used refuses the whole call.
 */
export const handleChannelAgentTool = Effect.fn("ChannelAgentTool.handle")(function* (
  params: DynamicToolCallParams,
  senderAgentId: string,
  dependencies: ChannelAgentToolDependencies,
) {
  const { channels, listAgents, taskChannelId } = dependencies;
  // The drafts read the agents again at their turn in the queue. The sender and the member names
  // of the result come from this one read.
  const agents = listAgents();
  const sender = agents.find((agent) => agent.id === senderAgentId);
  if (!sender) throw new Error("The calling agent no longer exists.");
  const operationId = toolCallIdempotencyKey(params);
  const picture = (path: string | null | undefined) =>
    path === undefined || path === null
      ? Effect.succeed(path)
      : loadAvatarFile(path, sender.workspacePath).pipe(toToolOperationFailed);
  const removeImage = (channel: Channel) =>
    channel.imageUrl ? channels.setImage(channel.id, null) : Effect.succeed(channel);

  if (params.tool === "create_channel") {
    const args = createChannelToolSchema.parse(params.arguments, { reportInput: true });
    const image = yield* picture(args.imagePath);
    const channelId = createdChannelId(params);
    let channel = yield* channels.agentSave({ channelId, operationId, agentId: senderAgentId, create: true }, () =>
      createdChannelDraft(args, listAgents()),
    );
    // The channel is already there: a failure says so, or the agent makes a second one with a new call.
    if (image)
      channel = yield* channels.setImage(channelId, image).pipe(
        Effect.mapError(
          () =>
            new ToolOperationFailed({
              cause: new Error(
                `Channel ${channelId} was created, but its picture was not saved. To try again, call openbot.update_channel with that channelId and imagePath.`,
              ),
            }),
        ),
      );
    return openBotToolResult({ status: "created", channel: channelResult(channel, agents) });
  }

  const args = updateChannelToolSchema.parse(params.arguments, { reportInput: true });
  const { channelId, archived, imagePath, ...draftChange } = args;
  if (channelId === taskChannelId) throw new Error(OWN_CHANNEL_IN_TASK);
  const image = yield* picture(imagePath);
  if (!channels.store.exists(channelId)) throw new Error(UNKNOWN_CHANNEL);
  const actor = channels.agentActor(senderAgentId);
  const changesDraft = Object.values(draftChange).some((value) => value !== undefined);
  // A restore comes before the other changes and an archive after them, so an archived channel
  // takes the same changes as an open one and the archive stops the work they start. The changes
  // are checked first, so that a refused change does not leave the channel restored.
  const stored = channels.store.get(channelId);
  if (archived === false && stored.archived) {
    if (changesDraft) updatedChannelDraft(stored, args, agents);
    yield* channels.command({ type: "restore", operationId: `${operationId}:restore`, channelId }, actor);
  }
  let channel = changesDraft
    ? yield* channels.agentSave({ channelId, operationId, agentId: senderAgentId, create: false }, (stored) =>
        updatedChannelDraft(stored, args, listAgents()),
      )
    : channels.store.get(channelId);
  // An icon replaces the picture, as in the channel settings.
  if (image) channel = yield* channels.setImage(channelId, image);
  else if (image === null || (args.icon !== undefined && args.icon !== null)) channel = yield* removeImage(channel);
  if (archived === true && !channel.archived)
    channel = yield* channels.command({ type: "archive", operationId: `${operationId}:archive`, channelId }, actor);
  return openBotToolResult({ status: "updated", channel: channelResult(channel, agents) });
});

/** The refusal in a channel task that a routine run, an agent, a member reply or a team member started. */
export const CHANNEL_AGENT_TOOL_NEEDS_LOCAL_PERSON =
  "In a channel task, create_channel and update_channel work only when this computer's user made the request that started the task. This task started from a routine run, an agent, a member reply or a team member. Ask the user to request it in your own chat.";
