import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { AgentTask } from "@openbot/contracts/ipc";

/** The closed tasks that a task list shows before "Show all". */
export const TASKS_CLOSED_SHOWN = 2;

export type TasksSectionId = "needsYou" | "working" | "waiting" | "unread" | "read" | "closed";

export interface TasksSection {
  id: TasksSectionId;
  /** The shown tasks. */
  tasks: AgentTask[];
  /** All tasks of the section, also the closed tasks that "Show all" hides. */
  count: number;
}

export const isAgentTaskOpen = (task: AgentTask): boolean => task.state !== "closed";
/** A task whose turn runs, or whose next message waits to start. */
export const isAgentTaskActive = (task: AgentTask): boolean => task.state === "running" || task.state === "queued";

/** A task the user must look at: its last turn ended, as an answer, a failure or a stop. */
export const taskNeedsYou = (task: AgentTask) => task.state === "idle" && task.outcome !== null;

const taskWaits = (task: AgentTask) => task.state === "queued" || (task.state === "idle" && task.outcome === null);

const newestFirst = (a: AgentTask, b: AgentTask) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/**
 * The tasks by what they need: needs you, working, waiting, then the newest closed tasks. A running
 * task that `waitsForYou` (an approval, a question or a browser takeover) needs you too. With
 * `isUnread`, the person's read marks: working (a turn runs or waits to start), unread, read, then
 * the newest closed tasks.
 */
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

/** The approval that the turn of this task waits for: the one of the task's own thread. */
export function taskApproval<Item extends { agentId: string; threadId: string }>(
  task: AgentTask,
  approvals: readonly Item[],
): Item | undefined {
  return approvals.find((approval) => approval.agentId === task.agentId && approval.threadId === task.threadId);
}

/** The color of a task's state on the page. */
export function taskTone(task: AgentTask): "working" | "danger" | "attention" | undefined {
  if (task.state === "running") return "working";
  if (task.state === "idle" && (task.outcome === "failed" || task.outcome === "interrupted")) return "danger";
  return taskNeedsYou(task) ? "attention" : undefined;
}

/**
 * The text of a task as its title shows it: no agent mention at the start, and the plain name of each
 * other tag. Empty when the text has nothing to do.
 */
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
