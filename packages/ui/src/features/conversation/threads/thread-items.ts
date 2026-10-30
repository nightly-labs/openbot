import type { AgentTask } from "@openbot/contracts/ipc";
import type { SidebarWaitReason } from "@openbot/ui/features/sidebar/sidebar-types";
import { DRAFT_THREAD_ID, MAIN_THREAD_ID, type ThreadItem, type ThreadStatus } from "./thread-types";

/** What a side thread does now. A turn that waits for an approval or an answer waits for the user. */
export function agentTaskThreadStatus(task: AgentTask, waitsFor: SidebarWaitReason | undefined): ThreadStatus {
  if (task.state === "running") return waitsFor ? { kind: "waiting", reason: waitsFor } : { kind: "working" };
  if (task.state === "queued") return { kind: "queued" };
  if (task.outcome === "failed") return { kind: "failed" };
  return { kind: "idle" };
}

export interface ThreadListsInput {
  /** When the agent's own chat changed last. The new thread tab shows this time. */
  mainUpdatedAt: string;
  /** The side threads of the agent: open ones and archived (`closed`) ones. */
  tasks: readonly AgentTask[];
  /** The side threads that have a tab on this device, in tab order. */
  open: readonly string[];
  /** Whether the new thread tab shows. */
  draft: boolean;
  draftTitle: string;
  /** Side threads that wait to be deleted: they show nowhere. */
  hidden: ReadonlySet<string>;
  /** What the running turn of a side thread waits for the user to do, if anything. */
  waitsFor: (task: AgentTask) => SidebarWaitReason | undefined;
}

export interface ThreadLists {
  threads: ThreadItem[];
  tabs: ThreadItem[];
  archived: ThreadItem[];
}

/**
 * The thread lists of the header. The agent's own chat is in neither list: the agent's name in the
 * header opens it. The menu lists the side threads that changed last first. A tab of a thread that is
 * archived or deleted, also on another device, does not show.
 */
export function threadLists(input: ThreadListsInput): ThreadLists {
  const items = new Map<string, ThreadItem>();
  const archived: ThreadItem[] = [];
  const open: ThreadItem[] = [];
  for (const task of input.tasks) {
    if (input.hidden.has(task.id)) continue;
    const item: ThreadItem = {
      id: task.id,
      kind: "side",
      title: task.title,
      updatedAt: task.updatedAt,
      status: agentTaskThreadStatus(task, input.waitsFor(task)),
    };
    if (task.state === "closed") archived.push(item);
    else {
      items.set(task.id, item);
      open.push(item);
    }
  }
  open.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  archived.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const tabs: ThreadItem[] = [];
  for (const id of input.open) {
    const item = items.get(id);
    if (item) tabs.push(item);
  }
  if (input.draft)
    tabs.push({
      id: DRAFT_THREAD_ID,
      kind: "draft",
      title: input.draftTitle,
      updatedAt: input.mainUpdatedAt,
      status: { kind: "idle" },
    });
  return { threads: open, tabs, archived };
}

/** The open tab, or the agent's own chat when it is open or the open tab no longer shows. */
export function activeThreadId(tabs: readonly ThreadItem[], active: string | null): string {
  return active !== null && tabs.some((tab) => tab.id === active) ? active : MAIN_THREAD_ID;
}
