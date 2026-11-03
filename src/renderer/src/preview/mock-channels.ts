import { leadingAddress } from "@openbot/contracts/chat-tag-references";
import type {
  AgentEvent,
  CancelChannelTaskInput,
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
  RecoverChannelTaskInput,
  RoutineSchedule,
  RoutineTrigger,
  SetChannelImageInput,
  TestChannelRoutineInput,
  UpdateChannelMemoryInput,
  UpdateChannelRoutineInput,
} from "@openbot/contracts/ipc";
import { channelRoutingConversationEventItemType } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { sourceText } from "@openbot/i18n/source";
import { avatarImageDataUrl } from "@openbot/ui/avatar-image";

/** A save keeps the picture, as the host does: the draft carries the icon only when it changes. */
function storedPicture(channel: Channel | undefined): Pick<Channel, "icon" | "imageUrl"> {
  return {
    ...(channel?.icon === undefined ? {} : { icon: channel.icon }),
    ...(channel?.imageUrl === undefined ? {} : { imageUrl: channel.imageUrl }),
  };
}

/** A channel that exists when the preview starts, with its history. */
export interface MockChannelSeed {
  channel: Channel;
  messages: ChannelMessage[];
  tasks?: ChannelTask[];
}

export function createMockChannels(
  emit: (event: AgentEvent) => void,
  agentName: (agentId: string) => string,
  seeds: readonly MockChannelSeed[] = [],
) {
  const channels = new Map<string, Channel>(seeds.map((seed) => [seed.channel.id, structuredClone(seed.channel)]));
  const messages = new Map<string, ChannelMessage[]>(
    seeds.map((seed) => [seed.channel.id, structuredClone(seed.messages)]),
  );
  const tasks = new Map<string, ChannelTask[]>(
    seeds.map((seed) => [seed.channel.id, structuredClone(seed.tasks ?? [])]),
  );
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
  const reviewed = (input: CancelChannelTaskInput) => {
    const channel = requireChannel(input.channelId);
    const work = tasks.get(channel.id) ?? [];
    const selected = work.find((task) => task.id === input.taskId);
    if (!selected) throw new Error(sourceText("error.backend.channelTaskNotFound"));
    if (channel.archived) throw new Error(sourceText("error.backend.channelArchived"));
    if (channel.revision !== input.expectedChannelRevision || selected.revision !== input.expectedRevision)
      throw new Error(sourceText("error.backend.channelTaskChanged"));
    if (selected.state !== "paused" && selected.state !== "failed")
      throw new Error(sourceText("error.backend.channelTaskNotStopped"));
    const ids = new Set([selected.id]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const task of work)
        if (task.parentTaskId && ids.has(task.parentTaskId) && !ids.has(task.id)) {
          ids.add(task.id);
          changed = true;
        }
    }
    return {
      channel,
      work,
      selected,
      ids,
      branch: work.filter((task) => ids.has(task.id) && task.state !== "completed" && task.state !== "cancelled"),
    };
  };
  return {
    cancelChannelTask: async (input: CancelChannelTaskInput): Promise<Channel> => {
      const key = `cancel-task:${JSON.stringify([input.channelId, input.taskId, input.operationId])}`;
      if (receipts.has(key)) return structuredClone(requireChannel(input.channelId));
      const { channel, work, selected, branch } = reviewed(input);
      for (const task of branch) {
        task.state = "cancelled";
        task.revision += 1;
        task.error = sourceText("error.backend.channelTaskCancelled");
      }
      const ancestors = new Set<string>();
      for (let id = selected.parentTaskId; id && !ancestors.has(id); ) {
        ancestors.add(id);
        const parent = work.find((task) => task.id === id);
        if (!parent) break;
        if (parent.state === "waiting") {
          parent.state = "paused";
          parent.revision += 1;
          parent.error = sourceText("error.backend.channelTaskDependencyCancelled");
        }
        id = parent.parentTaskId;
      }
      const list = messages.get(channel.id) ?? [];
      const id = crypto.randomUUID();
      list.push({
        id,
        channelId: channel.id,
        taskId: selected.id,
        sequence: list.length + 1,
        superseded: false,
        author: { kind: "member", id: "preview", name: "You" },
        message: {
          id,
          author: "system",
          text: sourceText("status.agent.channelTaskCancelled", { person: "You", task: selected.id }),
          createdAt: new Date().toISOString(),
          status: "completed",
          source: "system",
          itemType: "channel-change",
        },
      });
      messages.set(channel.id, list);
      channel.revision += 1;
      receipts.set(key, structuredClone(channel));
      changed(channel.id, channel.revision);
      return structuredClone(channel);
    },
    recoverChannelTask: async (input: RecoverChannelTaskInput): Promise<Channel> => {
      const key = `recover-task:${JSON.stringify([input.channelId, input.taskId, input.operationId])}`;
      if (receipts.has(key)) return structuredClone(requireChannel(input.channelId));
      const { channel, work, selected, branch, ids } = reviewed(input);
      if (input.action === "reassign") {
        if (!input.recipientAgentId || !channel.members.some((member) => member.agentId === input.recipientAgentId))
          throw new Error(sourceText("error.backend.channelSelectAgent"));
        selected.ownerAgentId = input.recipientAgentId;
      }
      for (const task of branch) {
        if (
          input.action === "reassign" &&
          task.id !== selected.id &&
          task.state !== "paused" &&
          task.state !== "failed"
        )
          continue;
        task.state = "queued";
        task.revision += 1;
        task.assignmentCount = 0;
        task.error = null;
        task.dependencies = task.dependencies.filter(
          (id) => !ids.has(id) || !work.some((item) => item.id === id && item.state === "cancelled"),
        );
      }
      channel.revision += 1;
      receipts.set(key, structuredClone(channel));
      changed(channel.id, channel.revision);
      return structuredClone(channel);
    },
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
                text: markdownPreviewText(latest.message.text),
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
              ...storedPicture(channels.get(input.channelId)),
              // A draft without `isolated` keeps the stored value, as the service does.
              ...(channels.get(input.channelId)?.isolated ? { isolated: true } : {}),
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
      if (input.type === "cancel") {
        const task = work.find((item) => item.id === input.taskId);
        if (!task) throw new Error("Channel task not found.");
        for (const item of work)
          if (item.rootTaskId === task.rootTaskId && item.state !== "completed" && item.state !== "cancelled") {
            item.state = "cancelled";
            item.error = null;
            item.revision += 1;
          }
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
        // As in the real service, each member that the message opens with gets a task of its own.
        const address = leadingAddress(input.text);
        const recipients = [
          ...new Set([
            ...(input.recipientAgentId ? [input.recipientAgentId] : []),
            ...address.mentions
              .map((mention) => mention.id)
              .filter((agentId) => channel.members.some((member) => member.agentId === agentId)),
            ...(address.everyone ? channel.members.map((member) => member.agentId) : []),
          ]),
        ];
        const routed = !recipients.length && channel.members.length > 1 && channel.leadAgentId !== null;
        work.push({
          id: taskId,
          channelId: channel.id,
          rootTaskId: taskId,
          parentTaskId: null,
          ownerAgentId: recipients[0] ?? channel.leadAgentId,
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
        for (const agentId of recipients.slice(1)) {
          const siblingId = crypto.randomUUID();
          work.push({
            id: siblingId,
            channelId: channel.id,
            rootTaskId: siblingId,
            parentTaskId: null,
            ownerAgentId: agentId,
            requestMessageId: id,
            instruction: input.text,
            attachmentDraftIds: [],
            expectedResult: "Complete the requested work and report the result.",
            sourceMessageIds: [id],
            dependencies: [],
            resources: ["host"],
            state: "queued",
            revision: 0,
            assignmentCount: 0,
            error: null,
          });
        }
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
              itemType: channelRoutingConversationEventItemType("assigned", channel.leadAgentId),
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
    setChannelImage: async (input: SetChannelImageInput): Promise<Channel> => {
      const current = requireChannel(input.channelId);
      const channel = {
        ...current,
        imageUrl: input.image ? avatarImageDataUrl(input.image) : null,
        revision: current.revision + 1,
      };
      channels.set(channel.id, structuredClone(channel));
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
        limitPolicy: input.limitPolicy ?? "wait",
        missedPolicy: input.missedPolicy ?? "skip",
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
        ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
        ...(input.missedPolicy === undefined ? {} : { missedPolicy: input.missedPolicy }),
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
