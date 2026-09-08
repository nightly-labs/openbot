import type { Group, GroupCommand, GroupMessage, GroupPage, GroupSummary, GroupTask } from "@openbot/contracts/ipc";

export function createMockGroups(changed: (groupId: string, revision: number) => void) {
  const groups = new Map<string, Group>();
  const messages = new Map<string, GroupMessage[]>();
  const tasks = new Map<string, GroupTask[]>();
  const receipts = new Map<string, Group>();
  const requireGroup = (id: string) => {
    const group = groups.get(id);
    if (!group) throw new Error("Group not found.");
    return group;
  };
  return {
    listGroups: async (): Promise<GroupSummary[]> =>
      [...groups.values()].map((group) => ({
        ...structuredClone(group),
        unreadCount: 0,
        activeTasks: (tasks.get(group.id) ?? []).filter((task) => task.state === "running").length,
      })),
    readGroup: async ({ groupId }: { groupId: string }): Promise<GroupPage> => ({
      group: structuredClone(requireGroup(groupId)),
      messages: structuredClone(messages.get(groupId) ?? []),
      tasks: structuredClone(tasks.get(groupId) ?? []),
      olderCursor: null,
      throughSequence: messages.get(groupId)?.length ?? 0,
    }),
    groupCommand: async (input: GroupCommand): Promise<Group> => {
      const receipt = receipts.get(input.operationId);
      if (receipt) return structuredClone(receipt);
      let group =
        input.type === "save"
          ? {
              ...input.draft,
              id: input.groupId,
              revision: groups.get(input.groupId)?.revision ?? 0,
              archived: groups.get(input.groupId)?.archived ?? false,
              createdAt: groups.get(input.groupId)?.createdAt ?? new Date().toISOString(),
            }
          : requireGroup(input.groupId);
      group = { ...group, revision: group.revision + 1 };
      if (input.type === "archive" || input.type === "restore") group.archived = input.type === "archive";
      const work = tasks.get(group.id) ?? [];
      if (input.type === "archive")
        for (const task of work) {
          if (task.state !== "completed" && task.state !== "cancelled") task.state = "paused";
        }
      if (input.type === "stop" || input.type === "resume" || input.type === "reassign") {
        const task = work.find((item) => item.id === input.taskId);
        if (!task) throw new Error("Group task not found.");
        task.state = input.type === "stop" ? "paused" : "queued";
        task.revision += 1;
        if (input.type === "reassign") task.ownerAgentId = input.recipientAgentId;
      }
      if (input.type === "send") {
        const list = messages.get(group.id) ?? [];
        const id = crypto.randomUUID();
        const taskId = crypto.randomUUID();
        work.push({
          id: taskId,
          groupId: group.id,
          rootTaskId: taskId,
          parentTaskId: null,
          ownerAgentId: input.recipientAgentId ?? group.leadAgentId,
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
          groupId: group.id,
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
        messages.set(group.id, list);
      }
      tasks.set(group.id, work);
      groups.set(group.id, structuredClone(group));
      receipts.set(input.operationId, structuredClone(group));
      changed(group.id, group.revision);
      return structuredClone(group);
    },
  };
}
