import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { AgentTask } from "@openbot/contracts/ipc";

export const TASKS_CLOSED_SHOWN = 2;

export type TasksSectionId = "needsYou" | "working" | "waiting" | "unread" | "read" | "closed";

export interface TasksSection {
  id: TasksSectionId;
  tasks: AgentTask[];
  count: number;
}

export const isAgentTaskOpen = (task: AgentTask): boolean => task.state !== "closed";
export const isAgentTaskActive = (task: AgentTask): boolean => task.state === "running" || task.state === "queued";

export const taskNeedsYou = (task: AgentTask) => task.state === "idle" && task.outcome !== null;

const taskWaits = (task: AgentTask) => task.state === "queued" || (task.state === "idle" && task.outcome === null);

const newestFirst = (a: AgentTask, b: AgentTask) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

export function taskSections(
  tasks: readonly AgentTask[],
  showAllClosed: boolean,
  isUnread?: (task: AgentTask) => boolean,
  waitsForYou?: (task: AgentTask) => boolean,
): TasksSection[] {
  const open = tasks.filter(isAgentTaskOpen).sort(newestFirst);
  const closed = tasks
    .filter((task) => !isAgentTaskOpen(task))
    .sort((a, b) => Date.parse(b.closedAt ?? b.updatedAt) - Date.parse(a.closedAt ?? a.updatedAt));
  const section = (id: TasksSectionId, shown: AgentTask[], count = shown.length): TasksSection => ({
    id,
    tasks: shown,
    count,
  });
  const closedSection = section("closed", showAllClosed ? closed : closed.slice(0, TASKS_CLOSED_SHOWN), closed.length);
  if (isUnread) {
    const idle = open.filter((task) => !isAgentTaskActive(task));
    return [
      section("working", open.filter(isAgentTaskActive)),
      section("unread", idle.filter(isUnread)),
      section(
        "read",
        idle.filter((task) => !isUnread(task)),
      ),
      closedSection,
    ];
  }
  const blocked = (task: AgentTask) => task.state === "running" && (waitsForYou?.(task) ?? false);
  return [
    section(
      "needsYou",
      open.filter((task) => taskNeedsYou(task) || blocked(task)),
    ),
    section(
      "working",
      open.filter((task) => task.state === "running" && !blocked(task)),
    ),
    section("waiting", open.filter(taskWaits)),
    closedSection,
  ];
}

export function taskApproval<Item extends { agentId: string; threadId: string }>(
  task: AgentTask,
  approvals: readonly Item[],
): Item | undefined {
  return approvals.find((approval) => approval.agentId === task.agentId && approval.threadId === task.threadId);
}

export function taskTone(task: AgentTask): "working" | "danger" | "attention" | undefined {
  if (task.state === "running") return "working";
  if (task.state === "idle" && (task.outcome === "failed" || task.outcome === "interrupted")) return "danger";
  return taskNeedsYou(task) ? "attention" : undefined;
}

export function plainTaskTitle(text: string): string {
  let title = "";
  let cursor = 0;
  for (const tag of chatTagReferences(text)) {
    title += text.slice(cursor, tag.start);
    if (tag.kind !== "agent" || title.trim()) title += tag.name;
    cursor = tag.end;
  }
  return (title + text.slice(cursor))
    .replace(/^[\s,:]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}
