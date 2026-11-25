import type { AgentTask } from "@openbot/contracts/ipc";
import type { SidebarWaitReason } from "@openbot/ui/features/sidebar/sidebar-types";
import { DRAFT_THREAD_ID, MAIN_THREAD_ID, type ThreadItem, type ThreadStatus } from "./thread-types";

export function agentTaskThreadStatus(task: AgentTask, waitsFor: SidebarWaitReason | undefined): ThreadStatus {
  if (task.state === "running") return waitsFor ? { kind: "waiting", reason: waitsFor } : { kind: "working" };
  if (task.state === "queued") return { kind: "queued" };
  if (task.outcome === "failed") return { kind: "failed" };
  return task.awaitedReplies?.length ? { kind: "awaiting" } : { kind: "idle" };
}

export function sideThreadItem(
  task: AgentTask,
  waitsFor: SidebarWaitReason | undefined,
  unread: number | undefined,
): ThreadItem {
  const item: ThreadItem = {
    id: task.id,
    kind: "side",
    title: task.title,
    updatedAt: task.updatedAt,
    status: agentTaskThreadStatus(task, waitsFor),
  };
  if (unread !== undefined) item.unread = unread;
  return item;
}

export interface ThreadListsInput {
  mainUpdatedAt: string;
  tasks: readonly AgentTask[];
  open: readonly string[];
  draft: boolean;
  draftTitle: string;
  hidden: ReadonlySet<string>;
  waitsFor: (task: AgentTask) => SidebarWaitReason | undefined;
  unread?: ((task: AgentTask) => number) | undefined;
}

export interface ThreadLists {
  threads: ThreadItem[];
  tabs: ThreadItem[];
  archived: ThreadItem[];
}

export function threadLists(input: ThreadListsInput): ThreadLists {
  const items = new Map<string, ThreadItem>();
  const archived: ThreadItem[] = [];
  const open: ThreadItem[] = [];
  for (const task of input.tasks) {
    if (input.hidden.has(task.id)) continue;
    const item = sideThreadItem(task, input.waitsFor(task), input.unread?.(task));
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

const BRANCH_LEVELS = 4;

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
  return [...nested, ...items.filter((item) => !placed.has(item.id))];
}

export function activeThreadId(tabs: readonly ThreadItem[], active: string | null): string {
  return active !== null && tabs.some((tab) => tab.id === active) ? active : MAIN_THREAD_ID;
}
