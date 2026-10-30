import type { AgentTask } from "@openbot/contracts/ipc";
import { TOAST_DURATION, toast } from "@openbot/ui";
import { DRAFT_THREAD_ID, MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { createScopeGuard } from "../../scope-lifetime";
import type { AgentTasks } from "../agent-tasks/agent-tasks-state";
import {
  type AgentThreadTabs,
  addPendingThreadDelete,
  forgetPendingThreadDeletes,
  type PendingThreadDelete,
  readPendingThreadDeletes,
  readThreadTabs,
  type ThreadTabsByServer,
  takePendingThreadDelete,
  writeThreadTabs,
} from "./thread-tabs-storage";

const NO_TABS: AgentThreadTabs = { open: [], active: null, side: [] };
/** The window that shows the Undo toast finishes the delete. Another window waits this much longer. */
const OTHER_WINDOW_DELAY_MS = 5_000;

export interface AgentThreadTabsOptions {
  serverId: () => string;
  activeAgentId: () => string | undefined;
  tasks: AgentTasks;
}

/**
 * The thread tabs of each agent on this device: which side threads have a tab, in which order, and
 * which tab is open. The threads themselves, and whether they are archived, come from the host.
 * A tab of a thread that is archived or deleted, also on another device, does not show, and the open
 * tab then falls back to the agent's own chat. Make it in the owner of the server: when that owner
 * ends, each delete that waits for its Undo time runs at once.
 */
export function createAgentThreadTabs(options: AgentThreadTabsOptions) {
  const { serverId, activeAgentId, tasks } = options;
  const scopeIsCurrent = createScopeGuard();
  const [tabsByServer, setTabsByServer] = createSignal<ThreadTabsByServer>(readThreadTabs());
  /** Agents with a new thread tab. A new thread that has no message is not kept after a restart. */
  const [drafts, setDrafts] = createSignal<ReadonlySet<string>>(new Set());
  /** Threads that wait for the end of their Undo time before the delete. */
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  /** Agent-started threads that already had their tab added, so a closed tab stays closed. */
  const seen = new Set<string>();
  const sessionStart = new Date().toISOString();

  const storedTabs = (agentId: string): AgentThreadTabs => tabsByServer()[serverId()]?.[agentId] ?? NO_TABS;
  const task = (agentId: string, id: string): AgentTask | undefined =>
    tasks.snapshot(agentId)?.tasks.find((entry) => entry.id === id);
  const shown = (agentId: string, id: string): boolean => {
    const entry = task(agentId, id);
    return entry !== undefined && entry.state !== "closed" && !hidden().has(id);
  };
  /** The side threads with a tab that shows. */
  const openIds = (agentId: string): string[] => storedTabs(agentId).open.filter((id) => shown(agentId, id));
  /** The side threads with a tab in the side panel that shows. */
  const sideIds = (agentId: string): string[] => storedTabs(agentId).side.filter((id) => shown(agentId, id));
  /** The side threads whose tabs a write keeps. Before the thread list loads, no stored tab is dropped. */
  const keptIds = (agentId: string): string[] =>
    tasks.snapshot(agentId) ? openIds(agentId) : storedTabs(agentId).open.filter((id) => !hidden().has(id));
  /** The same for the side panel tabs. */
  const keptSideIds = (agentId: string): string[] =>
    tasks.snapshot(agentId) ? sideIds(agentId) : storedTabs(agentId).side.filter((id) => !hidden().has(id));
  const hasDraft = (agentId: string) => drafts().has(agentId);
  const tabOrder = (agentId: string): string[] => [
    MAIN_THREAD_ID,
    ...openIds(agentId),
    ...(hasDraft(agentId) ? [DRAFT_THREAD_ID] : []),
  ];

  function activeId(agentId: string): string {
    const active = storedTabs(agentId).active;
    if (active === DRAFT_THREAD_ID) return hasDraft(agentId) ? DRAFT_THREAD_ID : MAIN_THREAD_ID;
    return active !== null && shown(agentId, active) && openIds(agentId).includes(active) ? active : MAIN_THREAD_ID;
  }

  /**
   * Writes the tabs of one agent. Another window can write other agents, so the stored value is read
   * first. Without `side`, the side panel keeps its tabs, less a thread that now has a chat tab.
   */
  function writeTabs(agentId: string, tabs: (Omit<AgentThreadTabs, "side"> & { side?: string[] }) | null): void {
    const server = serverId();
    const stored = readThreadTabs();
    const agents = { ...stored[server] };
    const side = tabs?.side ?? keptSideIds(agentId).filter((id) => !tabs?.open.includes(id));
    if (tabs && (tabs.open.length > 0 || side.length > 0 || tabs.active !== null))
      agents[agentId] = { open: tabs.open, active: tabs.active, side };
    else delete agents[agentId];
    const next = { ...stored, [server]: agents };
    if (Object.keys(agents).length === 0) delete next[server];
    setTabsByServer(next);
    writeThreadTabs(next);
  }

  function setDraft(agentId: string, shownDraft: boolean): void {
    setDrafts((current) => {
      if (current.has(agentId) === shownDraft) return current;
      const next = new Set(current);
      if (shownDraft) next.add(agentId);
      else next.delete(agentId);
      return next;
    });
  }

  /** Sets the open tabs from a tab order. The agent's own chat and the new thread keep their places. */
  function setOrder(agentId: string, order: readonly string[], active: string): void {
    const open = order.filter((id) => id !== MAIN_THREAD_ID && id !== DRAFT_THREAD_ID);
    setDraft(agentId, order.includes(DRAFT_THREAD_ID));
    writeTabs(agentId, { open, active: active === MAIN_THREAD_ID ? null : active });
  }

  /** Opens a thread. A thread without a tab gets one at the end. */
  function open(agentId: string, id: string): void {
    if (id === MAIN_THREAD_ID || id === DRAFT_THREAD_ID) {
      writeTabs(agentId, { open: keptIds(agentId), active: id === MAIN_THREAD_ID ? null : id });
      return;
    }
    const ids = keptIds(agentId);
    writeTabs(agentId, { open: ids.includes(id) ? ids : [...ids, id], active: id });
  }

  /**
   * Opens the tab of a conversation thread from outside the header, for example a notification: a
   * side thread's tab, or the agent's own chat for a thread that is no side thread. An archived side
   * thread does not open, and the tabs stay as they are.
   */
  async function openConversation(agentId: string, threadId: string): Promise<void> {
    const find = () => tasks.snapshot(agentId)?.tasks.find((entry) => entry.threadId === threadId);
    if (!find() && tasks.available()) await tasks.loadTasks(agentId);
    if (!scopeIsCurrent()) return;
    const entry = find();
    if (!entry) open(agentId, MAIN_THREAD_ID);
    else if (entry.state !== "closed") open(agentId, entry.id);
  }

  /** Opens the new thread tab. Its first message starts the thread. */
  function startNew(agentId: string): void {
    setDraft(agentId, true);
    writeTabs(agentId, { open: keptIds(agentId), active: DRAFT_THREAD_ID });
  }

  /** Closes a tab only. The thread stays in the thread list. The tab to its left opens. */
  function close(agentId: string, id: string): void {
    if (id === MAIN_THREAD_ID) return;
    const order = tabOrder(agentId);
    const index = order.indexOf(id);
    const next = order.filter((entry) => entry !== id);
    const current = activeId(agentId);
    setOrder(agentId, next, current === id ? (next[Math.max(0, index - 1)] ?? MAIN_THREAD_ID) : current);
  }

  function closeOthers(agentId: string, id: string): void {
    setOrder(agentId, id === MAIN_THREAD_ID ? [MAIN_THREAD_ID] : [MAIN_THREAD_ID, id], id);
  }

  function closeToTheRight(agentId: string, id: string): void {
    const order = tabOrder(agentId);
    const next = order.slice(0, order.indexOf(id) + 1);
    const current = activeId(agentId);
    setOrder(agentId, next, next.includes(current) ? current : id);
  }

  /** Moves a tab to an index among the shown tabs, which do not include the agent's own chat. */
  function move(agentId: string, id: string, index: number): void {
    const order = tabOrder(agentId).filter((entry) => entry !== id && entry !== MAIN_THREAD_ID);
    order.splice(index, 0, id);
    // The agent's own chat stays first, and the new thread stays last.
    const sides = order.filter((entry) => entry !== DRAFT_THREAD_ID);
    setOrder(agentId, [MAIN_THREAD_ID, ...sides, ...(hasDraft(agentId) ? [DRAFT_THREAD_ID] : [])], activeId(agentId));
  }

  /**
   * Moves a chat tab to the side panel, where its thread shows beside the agent's own chat. When the
   * thread was open in the chat, the agent's own chat opens.
   */
  function toSide(agentId: string, id: string): void {
    if (id === MAIN_THREAD_ID || id === DRAFT_THREAD_ID) return;
    const active = activeId(agentId);
    writeTabs(agentId, {
      open: keptIds(agentId).filter((entry) => entry !== id),
      active: active === id || active === MAIN_THREAD_ID ? null : active,
      side: [...keptSideIds(agentId).filter((entry) => entry !== id), id],
    });
  }

  /** Moves a side panel tab back to the end of the chat tabs, and opens its thread in the chat. */
  function toChat(agentId: string, id: string): void {
    writeTabs(agentId, {
      open: [...keptIds(agentId).filter((entry) => entry !== id), id],
      active: id,
      side: keptSideIds(agentId).filter((entry) => entry !== id),
    });
  }

  /** Closes a side panel tab. The thread stays in the thread list. */
  function closeSide(agentId: string, id: string): void {
    const active = activeId(agentId);
    writeTabs(agentId, {
      open: keptIds(agentId),
      active: active === MAIN_THREAD_ID ? null : active,
      side: keptSideIds(agentId).filter((entry) => entry !== id),
    });
  }

  /** Moves a side panel tab to an index among the side panel tabs. */
  function moveSide(agentId: string, id: string, index: number): void {
    const side = keptSideIds(agentId).filter((entry) => entry !== id);
    side.splice(index, 0, id);
    const active = activeId(agentId);
    writeTabs(agentId, { open: keptIds(agentId), active: active === MAIN_THREAD_ID ? null : active, side });
  }

  /** Archives a thread. Its tab closes when the host archived it; the thread then shows in the archived list. */
  async function archive(agentId: string, id: string): Promise<void> {
    if (!(await tasks.closeTask(agentId, id)) || !scopeIsCurrent()) return;
    if (storedTabs(agentId).side.includes(id)) closeSide(agentId, id);
    else close(agentId, id);
  }

  /** Restores an archived thread and opens it. */
  async function restore(agentId: string, id: string): Promise<void> {
    if (task(agentId, id)?.state === "closed" && !(await tasks.reopenTask(agentId, id))) return;
    if (scopeIsCurrent()) open(agentId, id);
  }

  async function rename(agentId: string, id: string, title: string): Promise<void> {
    await tasks.renameTask(agentId, id, title);
  }

  /**
   * Deletes that wait for the end of the Undo time, by thread. A server switch ends this scope and the
   * Undo time with it: each delete then runs at once, against the server it was made on.
   */
  const pendingDeletes = new Map<string, () => void>();
  /** Stored deletes of other windows or of an earlier session, which this window finishes. */
  const storedDeleteTimers = new Set<ReturnType<typeof setTimeout>>();
  onCleanup(() => {
    for (const timer of storedDeleteTimers) clearTimeout(timer);
    for (const commit of [...pendingDeletes.values()]) commit();
  });

  function setHiddenThread(id: string, hide: boolean): void {
    setHidden((current) => {
      if (current.has(id) === hide) return current;
      const next = new Set(current);
      if (hide) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * The thread is archived at once, so it stays archived also when the app quits, and a toast offers
   * Undo. The host deletes it only when the time is over. The delete is stored on this device until
   * then, so a later start of the app finishes it. Each request goes to the server of the delete.
   */
  async function remove(agentId: string, id: string): Promise<void> {
    const entry = task(agentId, id);
    if (!entry || hidden().has(id)) return;
    const server = serverId();
    const before = storedTabs(agentId);
    const wasActive = activeId(agentId) === id;
    const index = tabOrder(agentId).indexOf(id);
    const restore = entry.state !== "closed";
    close(agentId, id);
    setHiddenThread(id, true);

    function showTab(): void {
      setHiddenThread(id, false);
      if (index < 0) return;
      const open = openIds(agentId).filter((other) => other !== id);
      open.splice(Math.max(0, index - 1), 0, id);
      writeTabs(agentId, { open, active: wasActive ? id : (before.active ?? null) });
    }

    // The archive shows its own error. The thread then stays, with its tab.
    if (restore && !(await tasks.closeTask(agentId, id, server))) {
      if (scopeIsCurrent()) showTab();
      return;
    }
    const pending: PendingThreadDelete = {
      serverId: server,
      agentId,
      threadId: id,
      deadline: Date.now() + TOAST_DURATION,
      restore,
    };
    addPendingThreadDelete(pending);
    // The scope ended during the archive: the next start finishes the delete.
    if (!scopeIsCurrent()) return;

    const toastId = `agent-thread-delete-${server}-${id}`;
    let settled = false;
    function settle(): boolean {
      if (settled) return false;
      settled = true;
      pendingDeletes.delete(id);
      // A scope cleanup can call this, and a write to the Toaster from there stops the reactive system.
      queueMicrotask(() => toast.dismiss(toastId));
      return true;
    }
    async function undo(): Promise<void> {
      if (!settle()) return;
      takePendingThreadDelete(pending);
      if (!scopeIsCurrent()) return;
      // A thread that does not open again stays in the archived list.
      if (restore && !(await tasks.reopenTask(agentId, id, server))) {
        if (scopeIsCurrent()) setHiddenThread(id, false);
        return;
      }
      if (scopeIsCurrent()) showTab();
    }
    async function commit(): Promise<void> {
      if (!settle()) return;
      const deleted = await tasks.deleteTask(agentId, id, server);
      // A delete that failed after this scope ended stays stored: the next start finishes it. A
      // thread that the host kept while the scope is current comes back in the archived list.
      if (deleted || scopeIsCurrent()) takePendingThreadDelete(pending);
      if (!deleted && scopeIsCurrent()) setHiddenThread(id, false);
    }
    pendingDeletes.set(id, () => void commit());
    const { t } = currentText();
    toast(t("conversation.threads.deleteUndo.title", { title: entry.title }), {
      id: toastId,
      duration: TOAST_DURATION,
      action: { label: t("conversation.threads.deleteUndo.action"), onClick: () => void undo() },
      onAutoClose: () => void commit(),
      onDismiss: () => void commit(),
    });
  }

  /** Finishes a stored delete of this server that no window of this session owns. */
  async function finishStoredDelete(entry: PendingThreadDelete): Promise<void> {
    if (pendingDeletes.has(entry.threadId)) return;
    // Another window finished it, or its Undo restored the thread.
    if (!takePendingThreadDelete(entry)) {
      if (scopeIsCurrent()) setHiddenThread(entry.threadId, false);
      return;
    }
    const deleted = await tasks.deleteTask(entry.agentId, entry.threadId, entry.serverId);
    if (deleted) return;
    if (scopeIsCurrent()) setHiddenThread(entry.threadId, false);
    else addPendingThreadDelete(entry);
  }

  // The stored deletes of this server stay hidden. The window that shows their toast finishes them;
  // after that window's time, or after a quit, this window does.
  createEffect(
    () => serverId(),
    (server) => {
      for (const entry of readPendingThreadDeletes()) {
        if (entry.serverId !== server || pendingDeletes.has(entry.threadId)) continue;
        setHiddenThread(entry.threadId, true);
        const timer = setTimeout(
          () => {
            storedDeleteTimers.delete(timer);
            void finishStoredDelete(entry);
          },
          Math.max(0, entry.deadline + OTHER_WINDOW_DELAY_MS - Date.now()),
        );
        storedDeleteTimers.add(timer);
      }
    },
  );

  /** Sends a message to a side thread. An archived thread is restored first. */
  async function send(agentId: string, id: string, text: string, attachmentDraftIds: string[]): Promise<boolean> {
    if (task(agentId, id)?.state === "closed" && !(await tasks.reopenTask(agentId, id))) return false;
    return tasks.sendToTask(agentId, id, text, attachmentDraftIds);
  }

  /** The first message of the new thread tab starts the thread, which then takes the place of the tab. */
  async function sendDraft(agentId: string, text: string, attachmentDraftIds: string[]): Promise<boolean> {
    const started = await tasks.startTask(agentId, text, attachmentDraftIds);
    if (!started || !scopeIsCurrent()) return false;
    seen.add(started.id);
    const stillOpen = activeId(agentId) === DRAFT_THREAD_ID;
    setDraft(agentId, false);
    writeTabs(agentId, {
      open: [...keptIds(agentId).filter((entry) => entry !== started.id), started.id],
      active: stillOpen ? started.id : storedTabs(agentId).active,
    });
    return true;
  }

  /** Runs a queued message of the agent's own chat in a new thread, and opens it. */
  async function runQueuedMessage(agentId: string, deliveryId: string): Promise<void> {
    const started = await tasks.runQueuedMessageAsTask(agentId, deliveryId);
    if (!started || !scopeIsCurrent()) return;
    seen.add(started.id);
    open(agentId, started.id);
  }

  /** Removes the tabs of a deleted agent. */
  function forgetAgent(agentId: string): void {
    forgetPendingThreadDeletes(serverId(), agentId);
    setDraft(agentId, false);
    writeTabs(agentId, null);
  }

  // The open thread and the threads in the side panel read their conversations once, also when their
  // tabs are open after a restart. Events then keep them current. A thread that waits for its read is
  // not read again when another thread loads; it is read again only after it stops waiting and waits again.
  let reading: ReadonlySet<string> = new Set();
  createEffect(
    () => {
      const agentId = activeAgentId();
      if (!agentId) return null;
      const ids = [activeId(agentId), ...sideIds(agentId)].filter(
        (id) => id !== MAIN_THREAD_ID && id !== DRAFT_THREAD_ID && !tasks.conversation(id),
      );
      return ids.length === 0 ? null : [agentId, ...ids].join("\n");
    },
    (key) => {
      const [agentId = "", ...ids] = key?.split("\n") ?? [];
      for (const id of ids) if (!reading.has(id)) tasks.openTask(agentId, id);
      reading = new Set(ids);
    },
  );

  // A thread that the agent starts in this session gets a tab, but does not open.
  createEffect(
    () => {
      const agentId = activeAgentId();
      if (!agentId) return null;
      const added = (tasks.snapshot(agentId)?.tasks ?? [])
        .filter(
          (entry) =>
            entry.origin === "agent" &&
            entry.state !== "closed" &&
            entry.createdAt >= sessionStart &&
            !seen.has(entry.id),
        )
        .map((entry) => entry.id);
      return added.length === 0 ? null : [agentId, ...added].join("\n");
    },
    (key) => {
      if (!key) return;
      const [agentId = "", ...added] = key.split("\n");
      for (const id of added) seen.add(id);
      untrack(() => {
        const ids = openIds(agentId);
        const open = [...ids, ...added.filter((id) => !ids.includes(id))];
        writeTabs(agentId, { open, active: storedTabs(agentId).active });
      });
    },
  );

  return {
    openIds,
    sideIds,
    hasDraft,
    activeId,
    hidden,
    open,
    openConversation,
    startNew,
    close,
    closeOthers,
    closeToTheRight,
    move,
    toSide,
    toChat,
    closeSide,
    moveSide,
    archive,
    restore,
    rename,
    remove,
    send,
    sendDraft,
    runQueuedMessage,
    forgetAgent,
  };
}

export type AgentThreadTabsState = ReturnType<typeof createAgentThreadTabs>;
