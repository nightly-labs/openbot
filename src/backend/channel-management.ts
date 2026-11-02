import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentAccessLevel,
  type AgentSummary,
  agentAccessRank,
  type Channel,
  type ChannelDraft,
  type ChannelMessage,
  type ChannelRoutine,
  type ChannelTask,
  type CreateChannelRoutineInput,
  type DeleteChannelRoutineInput,
  isReleasedRoutineSchedule,
  type UpdateChannelRoutineInput,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import {
  routineToolArguments,
  routineToolPolicies,
  routineToolSchedule,
  routineToolString,
} from "./agent/routine-tools";

const ROUTINE_TOOLS: ReadonlySet<string> = new Set([
  "channel_list_routines",
  "channel_create_routine",
  "channel_update_routine",
  "channel_delete_routine",
]);

/**
 * The tools a member agent changes its channel with. Only a person's request may start them, so a
 * routine run or a message that only an agent wrote cannot change who is in the channel.
 */
export const CHANNEL_MANAGEMENT_TOOLS: ReadonlySet<string> = new Set([
  "channel_add_member",
  "channel_remove_member",
  "channel_set_instructions",
  ...ROUTINE_TOOLS,
]);

export function isChannelRoutineTool(tool: string): boolean {
  return ROUTINE_TOOLS.has(tool);
}

export const PERSON_REQUEST_REQUIRED =
  "Only a person's request in this channel can change its members, instructions or routines. This task started from a routine run or from an agent.";

/** The schedule routines of the channels, as the channel settings change them. */
export interface ChannelRoutineToolPort {
  list(channelId: string): ChannelRoutine[];
  create(input: CreateChannelRoutineInput): ChannelRoutine;
  update(input: UpdateChannelRoutineInput): ChannelRoutine;
  delete(input: DeleteChannelRoutineInput): void;
  /** The server timezone, for a routine that the call gives no timezone. */
  timezone(): string;
}

/** The text of the note a change leaves in the channel, from the agent that made it and the person who asked. */
export type ChannelChangeNote = (agent: string, person: string) => string;

/**
 * The person whose message started the work of `task`. A routine run is written as a member with a
 * `routine:` id (`ChannelService.apply`), so the id tells it from a person. A subtask that an agent
 * assigned counts as the person's request that its root task answers.
 */
export function channelRequester(
  task: ChannelTask,
  tasks: readonly ChannelTask[],
  message: (messageId: string) => ChannelMessage | null,
): { id: string; name: string } | null {
  const root = tasks.find((item) => item.id === task.rootTaskId);
  const request = root ? message(root.requestMessageId) : null;
  if (request?.author.kind !== "member" || request.author.id.startsWith("routine:")) return null;
  return { id: request.author.id, name: request.author.name };
}

/** The owners of `task` and of each task above it: the work that the call runs inside. */
export function channelWorkOwners(task: ChannelTask, tasks: readonly ChannelTask[]): Set<string> {
  const owners = new Set<string>();
  const seen = new Set<string>();
  for (let item: ChannelTask | undefined = task; item && !seen.has(item.id); ) {
    seen.add(item.id);
    if (item.ownerAgentId) owners.add(item.ownerAgentId);
    const parentId: string | null = item.parentTaskId;
    item = parentId ? tasks.find((candidate) => candidate.id === parentId) : undefined;
  }
  return owners;
}

/**
 * The draft that a member or instructions tool saves, from the channel as it is stored when the
 * save's turn in the command queue comes. The person who asked must be able to chat with an agent
 * they add, and see one they remove, as for their own save through the Team API.
 *
 * A removal pauses every open task of the member and the tasks under them, so it cannot remove an
 * owner of the work that runs this call (`workOwners`): the save would stop the caller's own turn.
 */
export function channelDraftChange(
  channel: Channel,
  tool: string,
  args: DynamicRecord,
  callerAgentId: string,
  agents: readonly AgentSummary[],
  access: { hidden(agentId: string): boolean; level(agentId: string): AgentAccessLevel },
  workOwners: ReadonlySet<string>,
): { draft: ChannelDraft; note: ChannelChangeNote } {
  const draft: ChannelDraft = {
    name: channel.name,
    title: channel.title,
    instructions: channel.instructions,
    members: channel.members,
    leadAgentId: channel.leadAgentId,
  };
  if (tool === "channel_set_instructions") {
    if (!isString(args.instructions) || args.instructions.length > INPUT_LIMITS.agentDescription)
      throw new Error(`Provide instructions of at most ${INPUT_LIMITS.agentDescription} characters.`);
    return {
      draft: { ...draft, instructions: args.instructions },
      note: (agent, person) => sourceText("status.agent.channelInstructionsChanged", { agent, person }),
    };
  }
  if (!isString(args.agentId) || !args.agentId) throw new Error("Provide the agentId of the member.");
  const agentId = args.agentId;
  const member = channel.members.some((item) => item.agentId === agentId);
  const name = agents.find((agent) => agent.id === agentId)?.name ?? agentId;
  if (tool === "channel_add_member") {
    if (member) throw new Error(`${name} is already a member of this channel.`);
    if (!agents.some((agent) => agent.id === agentId))
      throw new Error("No agent has that id. Get the id from openbot.list_agents.");
    if (agentAccessRank(access.level(agentId)) < agentAccessRank("chat"))
      throw new Error(`The person who asked cannot chat with ${name}, so it stays out.`);
    if (access.hidden(agentId)) throw new Error(`${name} is hidden. Ask a person to show it again first.`);
    if (channel.members.length >= INPUT_LIMITS.agents)
      throw new Error(`A channel has at most ${INPUT_LIMITS.agents} members.`);
    return {
      draft: { ...draft, members: [...channel.members, { agentId }] },
      note: (agent, person) => sourceText("status.agent.channelMemberAdded", { agent, member: name, person }),
    };
  }
  if (tool !== "channel_remove_member") throw new Error("Unknown channel tool.");
  if (!member || access.level(agentId) === "none") throw new Error(`${name} is not a member of this channel.`);
  if (agentId === callerAgentId) throw new Error("You cannot remove yourself. Ask a person to do it.");
  if (workOwners.has(agentId))
    throw new Error(`${name} owns the work that this task is part of. Ask a person to remove ${name} after it ends.`);
  return {
    draft: {
      ...draft,
      members: channel.members.filter((item) => item.agentId !== agentId),
      leadAgentId: channel.leadAgentId === agentId ? null : channel.leadAgentId,
    },
    note: (agent, person) => sourceText("status.agent.channelMemberRemoved", { agent, member: name, person }),
  };
}

/** Runs one routine tool on `channelId`. A change returns the note it leaves in the channel. */
export function channelRoutineTool(
  routines: ChannelRoutineToolPort,
  channelId: string,
  tool: string,
  value: unknown,
  remotePerson: boolean,
): { result: unknown; note?: ChannelChangeNote } {
  const all = routines.list(channelId);
  // A one-time routine stays on this computer: the Team API neither lists nor changes it, so a team
  // member's request works only with the routines their own app has.
  const visible = remotePerson ? all.filter((routine) => isReleasedRoutineSchedule(routine.trigger.schedule)) : all;
  const schedule = (input: unknown) => {
    const parsed = routineToolSchedule(input);
    if (remotePerson && !isReleasedRoutineSchedule(parsed))
      throw new RoutineInputError(
        "The person who asked uses OpenBot on another computer, which cannot show a one-time channel routine. Use a repeating schedule.",
      );
    return parsed;
  };
  if (tool === "channel_list_routines") {
    routineToolArguments(value, []);
    return { result: { routines: visible } };
  }
  if (tool === "channel_create_routine") {
    const args = routineToolArguments(value, [
      "name",
      "instruction",
      "schedule",
      "active",
      "timezone",
      "limitPolicy",
      "missedPolicy",
    ]);
    const active = args.active ?? true;
    if (!isBoolean(active)) throw new RoutineInputError("active must be a boolean.");
    const name = routineToolString(args.name, "name", INPUT_LIMITS.routineName, "A routine name is required.");
    requireFreeName(all, name);
    const routine = routines.create({
      channelId,
      name,
      instruction: routineToolString(
        args.instruction,
        "instruction",
        INPUT_LIMITS.routineInstruction,
        "A routine instruction is required.",
      ),
      active,
      timezone:
        args.timezone === undefined
          ? routines.timezone()
          : routineToolString(args.timezone, "timezone", 128, "A routine timezone is required."),
      schedule: schedule(args.schedule),
      ...routineToolPolicies(args),
    });
    return {
      result: routine,
      note: (agent, person) =>
        sourceText("status.agent.channelRoutineCreated", { agent, routine: routine.name, person }),
    };
  }
  const args = routineToolArguments(
    value,
    tool === "channel_update_routine"
      ? ["routineId", "name", "instruction", "schedule", "active", "limitPolicy", "missedPolicy"]
      : ["routineId"],
  );
  const routineId = routineToolString(args.routineId, "routineId", INPUT_LIMITS.identifier, "routineId is required.");
  const current = visible.find((routine) => routine.id === routineId);
  if (!current)
    throw new RoutineInputError(
      `This channel has no scheduled routine with routineId ${routineId}. Call channel_list_routines.`,
    );
  if (tool === "channel_delete_routine") {
    routines.delete({ channelId, routineId });
    return {
      result: { deleted: true, routineId },
      note: (agent, person) =>
        sourceText("status.agent.channelRoutineDeleted", { agent, routine: current.name, person }),
    };
  }
  if (tool !== "channel_update_routine") throw new Error("Unknown channel tool.");
  const input: UpdateChannelRoutineInput = { channelId, routineId, ...routineToolPolicies(args) };
  if (args.name !== undefined) {
    input.name = routineToolString(args.name, "name", INPUT_LIMITS.routineName, "A routine name is required.");
    if (input.name.trim().toLowerCase() !== current.name.trim().toLowerCase()) requireFreeName(all, input.name);
  }
  if (args.instruction !== undefined)
    input.instruction = routineToolString(
      args.instruction,
      "instruction",
      INPUT_LIMITS.routineInstruction,
      "A routine instruction is required.",
    );
  if (args.active !== undefined) {
    if (!isBoolean(args.active)) throw new RoutineInputError("active must be a boolean.");
    input.active = args.active;
  }
  if (args.schedule !== undefined) input.schedule = schedule(args.schedule);
  if (Object.keys(input).length === 2) throw new RoutineInputError("At least one routine update is required.");
  const routine = routines.update(input);
  return {
    result: routine,
    note: (agent, person) => sourceText("status.agent.channelRoutineUpdated", { agent, routine: routine.name, person }),
  };
}

function requireFreeName(routines: readonly ChannelRoutine[], name: string): void {
  const key = name.trim().toLowerCase();
  const existing = routines.find((routine) => routine.name.trim().toLowerCase() === key);
  if (existing)
    throw new RoutineInputError(
      `Routine "${existing.name}" already exists with routineId ${existing.id}. Call channel_update_routine to change it instead of creating another.`,
    );
}
