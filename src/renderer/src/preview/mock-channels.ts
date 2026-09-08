import { expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import type {
  Channel,
  ChannelCommand,
  ChannelMessage,
  ChannelPage,
  ChannelSummary,
  ChannelTask,
} from "@openbot/contracts/ipc";

export function createMockChannels(changed: (channelId: string, revision: number) => void) {
  const channels = new Map<string, Channel>();
  const messages = new Map<string, ChannelMessage[]>();
  const tasks = new Map<string, ChannelTask[]>();
  const receipts = new Map<string, Channel>();
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
        messages.set(channel.id, list);
      }
      tasks.set(channel.id, work);
      channels.set(channel.id, structuredClone(channel));
      receipts.set(input.operationId, structuredClone(channel));
      changed(channel.id, channel.revision);
      return structuredClone(channel);
    },
  };
}
