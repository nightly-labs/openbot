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
  const sources = new Map<string, string>();
  for (const task of input.tasks) {
    const sourceId = task.branch?.sourceTaskId;
    if (sourceId) sources.set(task.id, sourceId);
  }
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
  return { threads: nestedBranches(open, (id) => sources.get(id)), tabs, archived };
}

/**
 * The deepest level of the tree lines in the thread menu. A deeper branch shows at this level, below
 * its source, so that its title stays readable in the menu.
 */
const BRANCH_LEVELS = 4;

/**
 * Puts each branch under the open thread that it came from, with tree lines before its title. A
 * branch whose source is archived or deleted, or of the agent's own chat, stays at the top. Each
 * level keeps the order of `items`. The items of the tabs do not change.
 */
function nestedBranches(items: readonly ThreadItem[], sourceOf: (id: string) => string | undefined): ThreadItem[] {
  const ids = new Set(items.map((item) => item.id));
  const parent = (item: ThreadItem): string | null => {
    const sourceId = sourceOf(item.id);
    return sourceId !== undefined && sourceId !== item.id && ids.has(sourceId) ? sourceId : null;
  };
  const children = new Map<string | null, ThreadItem[]>();
  for (const item of items) {
    const key = parent(item);
    children.set(key, [...(children.get(key) ?? []), item]);
  }
  const placed = new Set<string>();
  const walk = (id: string | null, level: number): { item: ThreadItem; level: number }[] =>
    (children.get(id) ?? []).flatMap((item) => {
      if (placed.has(item.id)) return [];
      placed.add(item.id);
      return [{ item, level }, ...walk(item.id, Math.min(level + 1, BRANCH_LEVELS))];
    });
  const rows = walk(null, 0);
  // The line of a level continues down to the next row on that level, if no row above it comes first.
  const continues = (from: number, level: number) => {
    for (const row of rows.slice(from + 1)) if (row.level <= level) return row.level === level;
    return false;
  };
  const nested = rows.map(({ item, level }, index) =>
    level === 0
      ? item
      : {
          ...item,
          stem: {
            through: Array.from({ length: level - 1 }, (_, outer) => continues(index, outer + 1)),
            last: !continues(index, level),
          },
        },
  );
  // A loop of sources has no top. Its threads still show, at the top.
  return [...nested, ...items.filter((item) => !placed.has(item.id))];
}

/** The open tab, or the agent's own chat when it is open or the open tab no longer shows. */
export function activeThreadId(tabs: readonly ThreadItem[], active: string | null): string {
  return active !== null && tabs.some((tab) => tab.id === active) ? active : MAIN_THREAD_ID;
}
