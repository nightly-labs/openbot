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
  readThreadsSeenThrough,
  readThreadTabs,
  type ThreadTabsByServer,
  takePendingThreadDelete,
  writeThreadsSeenThrough,
  writeThreadTabs,
} from "./thread-tabs-storage";

const NO_TABS: AgentThreadTabs = { open: [], active: null, side: [] };
const BEFORE_ANY_THREAD = new Date(0).toISOString();
const OTHER_WINDOW_DELAY_MS = 5_000;

export interface AgentThreadTabsOptions {
  serverId: () => string;
  activeAgentId: () => string | undefined;
  tasks: AgentTasks;
}

export function createAgentThreadTabs(options: AgentThreadTabsOptions) {
  const { serverId, activeAgentId, tasks } = options;
  const scopeIsCurrent = createScopeGuard();
  const ownServerId = untrack(serverId);
  const [tabsByServer, setTabsByServer] = createSignal<ThreadTabsByServer>(readThreadTabs());
  const [drafts, setDrafts] = createSignal<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const seen = new Set<string>();
  const [messageFocus, setMessageFocus] = createSignal<ThreadMessageFocus | null>(null);
  const sessionStart = new Date().toISOString();

  const storedTabs = (agentId: string): AgentThreadTabs => tabsByServer()[serverId()]?.[agentId] ?? NO_TABS;
  const task = (agentId: string, id: string): AgentTask | undefined =>
    tasks.snapshot(agentId)?.tasks.find((entry) => entry.id === id);
  const shown = (agentId: string, id: string): boolean => {
    const entry = task(agentId, id);
    return entry !== undefined && entry.state !== "closed" && !hidden().has(id);
  };
  const resting = (agentId: string, id: string): boolean => task(agentId, id)?.state === "closed" && !hidden().has(id);
  const openIds = (agentId: string): string[] => storedTabs(agentId).open.filter((id) => shown(agentId, id));
  const sideIds = (agentId: string): string[] => storedTabs(agentId).side.filter((id) => shown(agentId, id));
  const kept = (agentId: string, ids: readonly string[]): string[] =>
    ids.filter((id) => !hidden().has(id) && (!tasks.snapshot(agentId) || task(agentId, id) !== undefined));
  const keptIds = (agentId: string): string[] => kept(agentId, storedTabs(agentId).open);
  const keptSideIds = (agentId: string): string[] => kept(agentId, storedTabs(agentId).side);
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
    const focus = untrack(messageFocus);
    if (focus && focus.taskId !== tabs?.active) setMessageFocus(null);
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

  function withRestingTabs(agentId: string, open: readonly string[], dropped: readonly string[]): string[] {
    const before = keptIds(agentId);
    const result = [...open];
    before.forEach((id, index) => {
      if (!resting(agentId, id) || result.includes(id) || dropped.includes(id)) return;
      const neighbor = before.slice(0, index).findLast((other) => result.includes(other));
      result.splice(neighbor === undefined ? 0 : result.indexOf(neighbor) + 1, 0, id);
    });
    return result;
  }

  function setOrder(agentId: string, order: readonly string[], active: string, dropped: readonly string[] = []): void {
    const open = order.filter((id) => id !== MAIN_THREAD_ID && id !== DRAFT_THREAD_ID);
    setDraft(agentId, order.includes(DRAFT_THREAD_ID));
    writeTabs(agentId, {
      open: withRestingTabs(agentId, open, dropped),
      active: active === MAIN_THREAD_ID ? null : active,
    });
  }

  function open(agentId: string, id: string): void {
    if (id === MAIN_THREAD_ID || id === DRAFT_THREAD_ID) {
      writeTabs(agentId, { open: keptIds(agentId), active: id === MAIN_THREAD_ID ? null : id });
      return;
    }
    const ids = keptIds(agentId);
    writeTabs(agentId, { open: ids.includes(id) ? ids : [...ids, id], active: id });
  }

  async function openConversation(agentId: string, threadId: string): Promise<void> {
    const find = () => tasks.snapshot(agentId)?.tasks.find((entry) => entry.threadId === threadId);
    if (!find() && tasks.available()) await tasks.loadTasks(agentId);
    if (!scopeIsCurrent()) return;
    const entry = find();
    if (!entry) open(agentId, MAIN_THREAD_ID);
    else if (entry.state !== "closed") open(agentId, entry.id);
  }

  function startNew(agentId: string): void {
    setDraft(agentId, true);
    writeTabs(agentId, { open: keptIds(agentId), active: DRAFT_THREAD_ID });
  }

  function close(agentId: string, id: string): void {
    if (id === MAIN_THREAD_ID) return;
    const order = tabOrder(agentId);
    const index = order.indexOf(id);
    const next = order.filter((entry) => entry !== id);
    const current = activeId(agentId);
    setOrder(agentId, next, current === id ? (next[Math.max(0, index - 1)] ?? MAIN_THREAD_ID) : current, [id]);
  }

  function closeOthers(agentId: string, id: string): void {
    setOrder(agentId, id === MAIN_THREAD_ID ? [MAIN_THREAD_ID] : [MAIN_THREAD_ID, id], id, keptIds(agentId));
  }

  function closeToTheRight(agentId: string, id: string): void {
    const order = tabOrder(agentId);
    const next = order.slice(0, order.indexOf(id) + 1);
    const current = activeId(agentId);
    const stored = keptIds(agentId);
    setOrder(agentId, next, next.includes(current) ? current : id, stored.slice(stored.indexOf(id) + 1));
  }

  function move(agentId: string, id: string, index: number): void {
    const order = tabOrder(agentId).filter((entry) => entry !== id && entry !== MAIN_THREAD_ID);
    order.splice(index, 0, id);
    const sides = order.filter((entry) => entry !== DRAFT_THREAD_ID);
    setOrder(agentId, [MAIN_THREAD_ID, ...sides, ...(hasDraft(agentId) ? [DRAFT_THREAD_ID] : [])], activeId(agentId));
  }

  function toSide(agentId: string, id: string): void {
    if (id === MAIN_THREAD_ID || id === DRAFT_THREAD_ID) return;
    const active = activeId(agentId);
    writeTabs(agentId, {
      open: keptIds(agentId).filter((entry) => entry !== id),
      active: active === id || active === MAIN_THREAD_ID ? null : active,
      side: [...keptSideIds(agentId).filter((entry) => entry !== id), id],
    });
  }

  function toChat(agentId: string, id: string): void {
    writeTabs(agentId, {
      open: [...keptIds(agentId).filter((entry) => entry !== id), id],
      active: id,
      side: keptSideIds(agentId).filter((entry) => entry !== id),
    });
  }

  function closeSide(agentId: string, id: string): void {
    const active = activeId(agentId);
    writeTabs(agentId, {
      open: keptIds(agentId),
      active: active === MAIN_THREAD_ID ? null : active,
      side: keptSideIds(agentId).filter((entry) => entry !== id),
    });
  }

  function moveSide(agentId: string, id: string, index: number): void {
    const side = keptSideIds(agentId).filter((entry) => entry !== id);
    side.splice(index, 0, id);
    const active = activeId(agentId);
    writeTabs(agentId, { open: keptIds(agentId), active: active === MAIN_THREAD_ID ? null : active, side });
  }

  async function archive(agentId: string, id: string): Promise<void> {
    if (!(await tasks.closeTask(agentId, id)) || !scopeIsCurrent()) return;
    if (storedTabs(agentId).side.includes(id)) closeSide(agentId, id);
    else close(agentId, id);
  }

  async function restore(agentId: string, id: string): Promise<void> {
    if (task(agentId, id)?.state === "closed" && !(await tasks.reopenTask(agentId, id))) return;
    if (scopeIsCurrent()) open(agentId, id);
  }

  async function rename(agentId: string, id: string, title: string): Promise<void> {
    await tasks.renameTask(agentId, id, title);
  }

  const pendingDeletes = new Map<string, () => void>();
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

  async function remove(agentId: string, id: string): Promise<void> {
    const entry = task(agentId, id);
    if (!entry || hidden().has(id)) return;
    const server = serverId();
    const before = storedTabs(agentId);
    const wasActive = activeId(agentId) === id;
    const index = tabOrder(agentId).indexOf(id);
    const sideIndex = keptSideIds(agentId).indexOf(id);
    const restore = entry.state !== "closed";
    close(agentId, id);
    setHiddenThread(id, true);

    function showTab(): void {
      setHiddenThread(id, false);
      if (sideIndex >= 0) {
        const side = keptSideIds(agentId).filter((other) => other !== id);
        side.splice(Math.min(sideIndex, side.length), 0, id);
        const active = activeId(agentId);
        writeTabs(agentId, { open: keptIds(agentId), active: active === MAIN_THREAD_ID ? null : active, side });
        return;
      }
      if (index < 0) return;
      const open = openIds(agentId).filter((other) => other !== id);
      open.splice(Math.max(0, index - 1), 0, id);
      writeTabs(agentId, { open, active: wasActive ? id : (before.active ?? null) });
    }

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
    if (!scopeIsCurrent()) return;

    const toastId = `agent-thread-delete-${server}-${id}`;
    let settled = false;
    function settle(): boolean {
      if (settled) return false;
      settled = true;
      pendingDeletes.delete(id);
      queueMicrotask(() => toast.dismiss(toastId));
      return true;
    }
    async function undo(): Promise<void> {
      if (!settle()) return;
      takePendingThreadDelete(pending);
      if (!scopeIsCurrent()) return;
      if (restore && !(await tasks.reopenTask(agentId, id, server))) {
        if (scopeIsCurrent()) setHiddenThread(id, false);
        return;
      }
      if (scopeIsCurrent()) showTab();
    }
    async function commit(): Promise<void> {
      if (!settle()) return;
      const deleted = await tasks.deleteTask(agentId, id, server);
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

  async function finishStoredDelete(entry: PendingThreadDelete): Promise<void> {
    if (pendingDeletes.has(entry.threadId)) return;
    if (!takePendingThreadDelete(entry)) {
      if (scopeIsCurrent()) setHiddenThread(entry.threadId, false);
      return;
    }
    const deleted = await tasks.deleteTask(entry.agentId, entry.threadId, entry.serverId);
    if (deleted) return;
    if (scopeIsCurrent()) setHiddenThread(entry.threadId, false);
    else addPendingThreadDelete(entry);
  }

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

  async function send(
    agentId: string,
    id: string,
    text: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null = null,
  ): Promise<boolean> {
    if (task(agentId, id)?.state === "closed" && !(await tasks.reopenTask(agentId, id))) return false;
    return tasks.sendToTask(agentId, id, text, attachmentDraftIds, replyToMessageId);
  }

  async function sendDraft(agentId: string, text: string, attachmentDraftIds: string[]): Promise<boolean> {
    const started = await tasks.startTask(agentId, text, attachmentDraftIds);
    if (!started) return false;
    if (!scopeIsCurrent()) {
      const stored = readThreadTabs();
      const tabs = stored[ownServerId]?.[agentId] ?? NO_TABS;
      const open = [...tabs.open.filter((entry) => entry !== started.id), started.id];
      const active = tabs.active === DRAFT_THREAD_ID ? started.id : tabs.active;
      writeThreadTabs({ ...stored, [ownServerId]: { ...stored[ownServerId], [agentId]: { ...tabs, open, active } } });
      return true;
    }
    seen.add(started.id);
    const stillOpen = activeId(agentId) === DRAFT_THREAD_ID;
    setDraft(agentId, false);
    writeTabs(agentId, {
      open: [...keptIds(agentId).filter((entry) => entry !== started.id), started.id],
      active: stillOpen ? started.id : storedTabs(agentId).active,
    });
    return true;
  }

  async function runQueuedMessage(agentId: string, deliveryId: string): Promise<void> {
    const started = await tasks.runQueuedMessageAsTask(agentId, deliveryId);
    if (!started || !scopeIsCurrent()) return;
    seen.add(started.id);
    open(agentId, started.id);
  }

  async function branch(agentId: string, sourceTaskId: string | null, messageId: string): Promise<boolean> {
    const started = await tasks.branchTask(agentId, sourceTaskId, messageId);
    if (!started || !scopeIsCurrent()) return false;
    seen.add(started.id);
    const ids = keptIds(agentId).filter((id) => id !== started.id);
    const at = sourceTaskId === null ? -1 : ids.indexOf(sourceTaskId);
    ids.splice(at < 0 ? ids.length : at + 1, 0, started.id);
    writeTabs(agentId, { open: ids, active: started.id });
    return true;
  }

  async function openAt(agentId: string, id: string, messageId: string): Promise<void> {
    setMessageFocus({ taskId: id, messageId, nonce: (messageFocus()?.nonce ?? 0) + 1 });
    if (!task(agentId, id) && !(await tasks.reopenTask(agentId, id))) return;
    if (!scopeIsCurrent() || sideIds(agentId).includes(id)) return;
    await restore(agentId, id);
  }

  function forgetAgent(agentId: string): void {
    forgetPendingThreadDeletes(serverId(), agentId);
    writeThreadsSeenThrough(serverId(), agentId, null);
    setDraft(agentId, false);
    writeTabs(agentId, null);
  }

  createEffect(
    () => {
      const agentId = activeAgentId();
      return agentId ? [activeId(agentId), ...sideIds(agentId)].join("\n") : "";
    },
    (key) => tasks.showConversations(key ? key.split("\n") : []),
  );

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

  createEffect(
    () => {
      const agentId = activeAgentId();
      if (!agentId) return null;
      const snapshot = tasks.snapshot(agentId);
      if (!snapshot) return null;
      const stored = readThreadsSeenThrough(serverId(), agentId);
      let newest = stored ?? BEFORE_ANY_THREAD;
      const added: string[] = [];
      for (const entry of snapshot.tasks) {
        if (entry.createdAt > newest) newest = entry.createdAt;
        const unseen = entry.createdAt >= sessionStart || (stored !== undefined && entry.createdAt > stored);
        if (unseen && entry.state !== "closed" && !seen.has(entry.id)) added.push(entry.id);
      }
      return added.length === 0 && newest === stored ? null : [agentId, newest, ...added].join("\n");
    },
    (key) => {
      if (!key) return;
      const [agentId = "", newest = "", ...added] = key.split("\n");
      writeThreadsSeenThrough(serverId(), agentId, newest);
      if (added.length === 0) return;
      for (const id of added) seen.add(id);
      untrack(() => {
        const ids = keptIds(agentId);
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
    branch,
    openAt,
    messageFocus,
    forgetAgent,
  };
}

export interface ThreadMessageFocus {
  taskId: string;
  messageId: string;
  nonce: number;
}

export type AgentThreadTabsState = ReturnType<typeof createAgentThreadTabs>;
