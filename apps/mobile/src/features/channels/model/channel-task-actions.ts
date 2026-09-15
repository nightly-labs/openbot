import type { ChannelMessage, ChannelTask } from "@openbot/contracts/ipc";

import type { MobileAgentActivity } from "../../workspace/model/agent-activity";

export function channelTasksNeedingAction(tasks: readonly ChannelTask[]) {
  return tasks.filter((task) => task.state === "failed" || task.state === "paused");
}

/** Channel work has its own tasks; single-chat activity can belong to another thread. */
export function channelTaskActivities(
  tasks: readonly ChannelTask[],
  messages: readonly ChannelMessage[],
  leadAgentId: string | null,
): MobileAgentActivity[] {
  const workers = new Set<string>();
  for (const task of tasks) {
    if (task.state === "running" && task.ownerAgentId) workers.add(task.ownerAgentId);
  }
  const latestByAgent = new Map<string, ChannelMessage>();
  for (const entry of messages) {
    if (entry.superseded || entry.author.kind === "member") continue;
    if (entry.message.status === "streaming") workers.add(entry.author.id);
    if (entry.message.turnId) latestByAgent.set(entry.author.id, entry);
  }
  if (
    leadAgentId &&
    tasks.some((task) => !task.ownerAgentId && (task.state === "queued" || task.state === "waiting"))
  ) {
    workers.add(leadAgentId);
  }
  return [...workers].map((agentId) => {
    const latest = latestByAgent.get(agentId);
    const activeMessage =
      latest &&
      (latest.message.status === "streaming" ||
        tasks.some((task) => task.id === latest.taskId && task.state === "running"));
    return {
      agentId,
      turnId: activeMessage ? (latest.message.turnId ?? null) : null,
      phase:
        activeMessage && latest.message.status === "streaming" && latest.message.itemType !== "commentary"
          ? "responding"
          : "working",
      detail: "Working on it…",
    };
  });
}
