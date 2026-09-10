import { expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import type {
  AgentEvent,
  Channel,
  ChannelCommand,
  ChannelMemory,
  ChannelMessage,
  ChannelPage,
  ChannelRoutine,
  ChannelRoutineRun,
  ChannelSummary,
  ChannelTask,
  CreateChannelMemoryInput,
  CreateChannelRoutineInput,
  DeleteChannelMemoryInput,
  DeleteChannelRoutineInput,
  ListChannelRoutineRunsInput,
  RoutineSchedule,
  RoutineTrigger,
  TestChannelRoutineInput,
  UpdateChannelMemoryInput,
  UpdateChannelRoutineInput,
} from "@openbot/contracts/ipc";

export function createMockChannels(emit: (event: AgentEvent) => void, agentName: (agentId: string) => string) {
  const channels = new Map<string, Channel>();
  const messages = new Map<string, ChannelMessage[]>();
  const tasks = new Map<string, ChannelTask[]>();
  const receipts = new Map<string, Channel>();
  const memories = new Map<string, ChannelMemory[]>();
  const routines = new Map<string, ChannelRoutine[]>();
  const routineRuns = new Map<string, ChannelRoutineRun[]>();
  const changed = (channelId: string, revision: number) => emit({ type: "channels-changed", channelId, revision });
  const requireChannel = (id: string) => {
    const channel = channels.get(id);
    if (!channel) throw new Error("Channel not found.");
    return channel;
  };
  return {
    listChannels: async (): Promise<ChannelSummary[]> =>
      [...channels.values()].map((channel) => {
        const latest = (messages.get(channel.id) ?? []).at(-1);
        return {
          ...structuredClone(channel),
          unreadCount: 0,
          activeTasks: (tasks.get(channel.id) ?? []).filter((task) => task.state === "running").length,
          lastMessage: latest
            ? {
                authorName: latest.author.name,
                text: expandChatTagReferences(latest.message.text),
                at: latest.message.createdAt,
              }
            : null,
        };
      }),
    readChannel: async ({ channelId }: { channelId: string }): Promise<ChannelPage> => ({
      channel: structuredClone(requireChannel(channelId)),
      messages: structuredClone(messages.get(channelId) ?? []),
      tasks: structuredClone(tasks.get(channelId) ?? []),
      olderCursor: null,
      throughSequence: messages.get(channelId)?.length ?? 0,
    }),
    channelCommand: async (input: ChannelCommand): Promise<Channel> => {
      const receipt = receipts.get(input.operationId);
      if (receipt) return structuredClone(receipt);
      let channel =
        input.type === "save"
          ? {
              ...input.draft,
              id: input.channelId,
              revision: channels.get(input.channelId)?.revision ?? 0,
              archived: channels.get(input.channelId)?.archived ?? false,
              createdAt: channels.get(input.channelId)?.createdAt ?? new Date().toISOString(),
            }
          : requireChannel(input.channelId);
      channel = { ...channel, revision: channel.revision + 1 };
      if (input.type === "archive" || input.type === "restore") channel.archived = input.type === "archive";
      const work = tasks.get(channel.id) ?? [];
      if (input.type === "archive")
        for (const task of work) {
          if (task.state !== "completed" && task.state !== "cancelled") task.state = "paused";
        }
      if (input.type === "stop" || input.type === "resume" || input.type === "reassign") {
        const task = work.find((item) => item.id === input.taskId);
        if (!task) throw new Error("Channel task not found.");
        task.state = input.type === "stop" ? "paused" : "queued";
        task.revision += 1;
        if (input.type === "reassign") task.ownerAgentId = input.recipientAgentId;
      }
      if (input.type === "send") {
        const list = messages.get(channel.id) ?? [];
        const id = crypto.randomUUID();
        const taskId = crypto.randomUUID();
        // The real service routes a request with no recipient through the lead's model and posts the
        // choice as a channel message. It skips both when the answer is already known: a named
        // recipient, or a channel with one member. The preview has no model, so it keeps assigning
        // the lead, but it reproduces which requests get a visible dispatch row and which do not.
        const routed = !input.recipientAgentId && channel.members.length > 1 && channel.leadAgentId !== null;
        work.push({
          id: taskId,
          channelId: channel.id,
          rootTaskId: taskId,
          parentTaskId: null,
          ownerAgentId: input.recipientAgentId ?? channel.leadAgentId,
          requestMessageId: id,
          instruction: input.text,
          attachmentDraftIds: input.attachmentDraftIds,
          expectedResult: "Complete the requested work and report the result.",
          sourceMessageIds: [id],
          dependencies: [],
          resources: ["host"],
          state: "queued",
          revision: 0,
          assignmentCount: 0,
          error: null,
        });
        list.push({
          id,
          channelId: channel.id,
          sequence: list.length + 1,
          author: { kind: "member", id: "preview", name: "You" },
          taskId,
          superseded: false,
          message: {
            id,
            author: "user",
            text: input.text,
            createdAt: new Date().toISOString(),
            status: "completed",
            replyToMessageId: input.replyToMessageId,
          },
        });
        if (routed && channel.leadAgentId) {
          const dispatchId = crypto.randomUUID();
          // The name is resolved from the agent roster by the timeline, so the id stands in for it.
          list.push({
            id: dispatchId,
            channelId: channel.id,
            sequence: list.length + 1,
            author: { kind: "agent", id: channel.leadAgentId, name: agentName(channel.leadAgentId) },
            taskId,
            superseded: false,
            message: {
              id: dispatchId,
              author: "system",
              text: `Assigned to ${agentName(channel.leadAgentId)}.`,
              createdAt: new Date().toISOString(),
              status: "completed",
            },
          });
        }
        messages.set(channel.id, list);
      }
      tasks.set(channel.id, work);
      channels.set(channel.id, structuredClone(channel));
      receipts.set(input.operationId, structuredClone(channel));
      changed(channel.id, channel.revision);
      return structuredClone(channel);
    },
    deleteChannel: async (channelId: string): Promise<void> => {
      requireChannel(channelId);
      channels.delete(channelId);
      messages.delete(channelId);
      tasks.delete(channelId);
      memories.delete(channelId);
      const channelRoutines = routines.get(channelId) ?? [];
      routines.delete(channelId);
      for (const routine of channelRoutines) routineRuns.delete(routine.id);
      emit({ type: "channels-changed", channelId, revision: 0 });
    },
    listChannelMemories: async (channelId: string): Promise<ChannelMemory[]> => {
      requireChannel(channelId);
      return structuredClone(memories.get(channelId) ?? []);
    },
    createChannelMemory: async (input: CreateChannelMemoryInput): Promise<ChannelMemory> => {
      requireChannel(input.channelId);
      const now = new Date().toISOString();
      const memory: ChannelMemory = {
        id: crypto.randomUUID(),
        channelId: input.channelId,
        text: input.text.trim(),
        origin: "manual",
        sourceTurnId: null,
        createdAt: now,
        updatedAt: now,
      };
      memories.set(input.channelId, [...(memories.get(input.channelId) ?? []), memory]);
      emit({ type: "channel-memories-changed", channelId: input.channelId });
      return structuredClone(memory);
    },
    updateChannelMemory: async (input: UpdateChannelMemoryInput): Promise<ChannelMemory> => {
      const current = memories.get(input.channelId)?.find((memory) => memory.id === input.memoryId);
      if (!current) throw new Error("This memory no longer exists.");
      const updated = { ...current, text: input.text.trim(), updatedAt: new Date().toISOString() };
      memories.set(
        input.channelId,
        (memories.get(input.channelId) ?? []).map((memory) => (memory.id === input.memoryId ? updated : memory)),
      );
      emit({ type: "channel-memories-changed", channelId: input.channelId });
      return structuredClone(updated);
    },
    deleteChannelMemory: async (input: DeleteChannelMemoryInput): Promise<void> => {
      memories.set(
        input.channelId,
        (memories.get(input.channelId) ?? []).filter((memory) => memory.id !== input.memoryId),
      );
      emit({ type: "channel-memories-changed", channelId: input.channelId });
    },
    clearChannelMemories: async (channelId: string): Promise<void> => {
      memories.delete(channelId);
      emit({ type: "channel-memories-changed", channelId });
    },
    listChannelRoutines: async (channelId: string): Promise<ChannelRoutine[]> => {
      requireChannel(channelId);
      return structuredClone(routines.get(channelId) ?? []);
    },
    createChannelRoutine: async (input: CreateChannelRoutineInput): Promise<ChannelRoutine> => {
      requireChannel(input.channelId);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const routine: ChannelRoutine = {
        id,
        channelId: input.channelId,
        name: input.name.trim(),
        instruction: input.instruction.trim(),
        active: input.active,
        timezone: input.timezone,
        trigger: nextTrigger(id, input.schedule, now),
        createdAt: now,
        updatedAt: now,
      };
      routines.set(input.channelId, [routine, ...(routines.get(input.channelId) ?? [])]);
      emit({ type: "channel-routines-changed", channelId: input.channelId });
      return structuredClone(routine);
    },
    updateChannelRoutine: async (input: UpdateChannelRoutineInput): Promise<ChannelRoutine> => {
      const current = routines.get(input.channelId)?.find((routine) => routine.id === input.routineId);
      if (!current) throw new Error("Routine not found.");
      const now = new Date().toISOString();
      const updated: ChannelRoutine = {
        ...current,
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.instruction === undefined ? {} : { instruction: input.instruction.trim() }),
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.schedule === undefined ? {} : { trigger: nextTrigger(current.id, input.schedule, now) }),
        updatedAt: now,
      };
      routines.set(
        input.channelId,
        (routines.get(input.channelId) ?? []).map((routine) => (routine.id === current.id ? updated : routine)),
      );
      emit({ type: "channel-routines-changed", channelId: input.channelId });
      return structuredClone(updated);
    },
    deleteChannelRoutine: async (input: DeleteChannelRoutineInput): Promise<void> => {
      routines.set(
        input.channelId,
        (routines.get(input.channelId) ?? []).filter((routine) => routine.id !== input.routineId),
      );
      routineRuns.delete(input.routineId);
      emit({ type: "channel-routines-changed", channelId: input.channelId });
    },
    testChannelRoutine: async (input: TestChannelRoutineInput): Promise<ChannelRoutineRun> => {
      const routine = routines.get(input.channelId)?.find((candidate) => candidate.id === input.routineId);
      if (!routine) throw new Error("Routine not found.");
      const now = new Date().toISOString();
      const run: ChannelRoutineRun = {
        id: crypto.randomUUID(),
        channelId: input.channelId,
        routineId: routine.id,
        triggerId: null,
        kind: "manual",
        scheduledFor: now,
        routineName: routine.name,
        instruction: routine.instruction,
        requestMessageId: crypto.randomUUID(),
        status: "queued",
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      routineRuns.set(routine.id, [run, ...(routineRuns.get(routine.id) ?? [])]);
      emit({ type: "channel-routines-changed", channelId: input.channelId });
      return structuredClone(run);
    },
    listChannelRoutineRuns: async (input: ListChannelRoutineRunsInput): Promise<ChannelRoutineRun[]> =>
      structuredClone((routineRuns.get(input.routineId) ?? []).slice(0, input.limit ?? 50)),
  };
}

/** One fire an hour from now is enough for the preview: nothing here evaluates a schedule. */
function nextTrigger(routineId: string, schedule: RoutineSchedule, now: string): RoutineTrigger {
  return {
    id: crypto.randomUUID(),
    routineId,
    schedule,
    nextRunAt: new Date(Date.parse(now) + 3_600_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
}
