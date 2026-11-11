import type { AgentEvent, AgentTask, AgentTasksSnapshot, ConversationSnapshot } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { createScopeGuard } from "../../scope-lifetime";
import type { AgentTasksPort } from "./agent-tasks-port";

export type AgentTaskEvent = Extract<
  AgentEvent,
  { type: "agent-tasks-changed" | "agent-task-conversation" | "agent-task-conversation-delta" }
>;

/** A task event of a host. Other events do not change a side thread. */
export function isAgentTaskEvent(event: { type: string }): event is AgentTaskEvent {
  return (
    event.type === "agent-tasks-changed" ||
    event.type === "agent-task-conversation" ||
    event.type === "agent-task-conversation-delta"
  );
}

interface AgentTasksState {
  /** The task list of each agent that loaded one, by agent id. */
  snapshots: Record<string, AgentTasksSnapshot>;
  /** The conversation of each task that loaded one, by task id. */
  conversations: Record<string, ConversationSnapshot>;
  /** The number of agent messages that the person has not read in each open thread, by agent id and task id. */
  unread: Record<string, Record<string, number>>;
  /** What each opened thread knows of its messages before the loaded ones, by task id. */
  history: Record<string, TaskHistory>;
}

/**
 * A thread's messages outside the loaded ones. The read of a thread gives only its newest messages,
 * so a long thread reads the older ones page by page. A jump to an old message reads only the part of
 * the thread around it: the thread then does not reach its latest message until it reads it again.
 */
interface TaskHistory {
  /** The server has messages before the oldest loaded one. */
  hasOlder: boolean;
  /** The loaded messages are a part around an old message: the server has messages after them. */
  hasNewer: boolean;
  /** A page read is in progress. */
  loading: boolean;
  /** A read of the latest messages, in the place of the part, is in progress. */
  loadingLatest?: boolean;
  /** The thread holds pages that it read, before the newest messages. */
  paged: boolean;
}

/** The most messages that one press of Load older messages reads. */
const OLDER_PAGE_SIZE = 50;

/** The messages around an old message that a jump reads, the most that the route gives. */
const AROUND_LIMIT = 100;

/**
 * The most loaded conversations of threads that no tab shows. The conversation of a thread that was
 * shown longer ago goes, and the thread reads it again when its tab opens.
 */
const HIDDEN_CONVERSATION_LIMIT = 5;

/**
 * A new conversation of a thread that read older pages keeps the messages before its first message.
 * The newest messages move on as messages arrive, so without them a gap opens between the pages. Null
 * when the new conversation does not start inside the held messages: the pages no longer join it.
 */
function withOlderMessages(held: ConversationSnapshot, snapshot: ConversationSnapshot): ConversationSnapshot | null {
  const first = snapshot.messages[0];
  if (!first) return snapshot;
  const index = held.messages.findIndex((message) => message.id === first.id);
  if (index < 0) return null;
  if (index === 0) return snapshot;
  const ids = new Set(snapshot.messages.map((message) => message.id));
  const older = held.messages.slice(0, index).filter((message) => !ids.has(message.id));
  return { ...snapshot, messages: [...older, ...snapshot.messages] };
}

export interface AgentTasksOptions {
  /** Read on each call: tests and stories replace the port per case. */
  port: () => AgentTasksPort;
  activeAgentId: () => string | undefined;
  /** The server moves a queued message to a new thread: this computer, or the `agent-queue-task-v1` route. */
  queuedMessageMovable: () => boolean;
  /** The server has side threads: the `agent-tasks-v1` routes. */
  available: () => boolean;
  /** The server renames and deletes side threads: the `agent-threads-v1` routes. */
  editable: () => boolean;
  /** The server keeps the person's read mark of each side thread: the `agent-thread-reads-v1` routes. */
  readable: () => boolean;
  /**
   * The server copies a conversation into a new thread: this computer, or the `agent-thread-branches-v1`
   * routes. The list of such a server gives the link of each branch; its events do not.
   */
  branchable: () => boolean;
  /** The server takes files in a side thread: this computer, or the `agent-thread-files-v1` routes. */
  filesAccepted: () => boolean;
  /** The server takes a reply to a message of a side thread: this computer, or the `agent-thread-replies-v1` route. */
  repliable: () => boolean;
  /** The server deletes a message of a side thread: this computer, or the `message-delete-v1` routes. */
  messageDeletable: () => boolean;
  /** The server reads the older messages of a side thread: this computer, or the `agent-thread-pages-v1` route. */
  pageable: () => boolean;
  /** The server reads the part of a side thread around one message: this computer, or the `message-pins-v1` route. */
  aroundReadable: () => boolean;
  /**
   * A change of this value reads the lists of the active agent and of each agent with a running thread
   * again, for example when the agent starts again.
   */
  reloadKey: () => unknown;
}

/**
 * The side threads of each agent on one server: their list, the conversation of each opened thread,
 * and the thread actions. A side thread is a task of the `agent-tasks-v1` routes. Only the active
 * agent's list loads; an `agent-tasks-changed` event updates any agent. Make it in the owner of the
 * server: a reply that arrives after that owner ends changes nothing.
 */
export function createAgentTasks(options: AgentTasksOptions) {
  const {
    port,
    activeAgentId,
    queuedMessageMovable,
    available,
    editable,
    readable,
    branchable,
    filesAccepted,
    repliable,
    messageDeletable,
    pageable,
    aroundReadable,
  } = options;
  const scopeIsCurrent = createScopeGuard();
  const [state, setState] = createStore<AgentTasksState>({ snapshots: {}, conversations: {}, unread: {}, history: {} });
  const listRequests = new Map<string, number>();
  const readRequests = new Map<string, number>();
  const unreadRequests = new Map<string, number>();
  /** The message that each thread's read mark last moved to, so a redraw does not send the same mark again. */
  const readMarks = new Map<string, string>();
  /** The threads whose mark move did not answer yet. A list read can be older than the move. */
  const marking = new Set<string>();
  /** The threads that a tab shows now. Their conversations stay loaded. */
  let shown: ReadonlySet<string> = new Set();
  /** The threads with a loaded conversation that no tab shows, the one shown longest ago first. */
  const hidden = new Set<string>();
  /**
   * The newest messages of each thread, as the last read or event gave them. When a thread shows a part
   * around an old message, a change that leaves them the same occurred in the older messages.
   */
  const newestMessages = new Map<string, string>();

  /** Keeps the newest messages of a thread. Returns the ones kept before. */
  function rememberNewest(taskId: string, snapshot: ConversationSnapshot): string | undefined {
    const before = newestMessages.get(taskId);
    const newest = snapshot.messages.map((message) => `${message.id}:${message.status}:${message.text.length}`);
    newestMessages.set(taskId, newest.join());
    return before;
  }

  /**
   * Reads the newest messages of a thread that now shows a part around an old message, and keeps them
   * only for the comparison. A read of the newest messages in progress no longer replaces the part.
   */
  function rememberNewestOf(agentId: string, taskId: string): void {
    const request = (readRequests.get(taskId) ?? 0) + 1;
    readRequests.set(taskId, request);
    const kept = newestMessages.get(taskId);
    void port()
      .readTask({ agentId, taskId })
      .then((snapshot) => {
        // An event that came in meanwhile gave newer ones.
        if (scopeIsCurrent() && newestMessages.get(taskId) === kept) rememberNewest(taskId, snapshot);
      })
      // Without them, the first change only gives the newest messages.
      .catch(() => undefined);
  }

  /** Removes the conversations of the hidden threads over the limit, the one shown longest ago first. */
  function dropHiddenConversations(): void {
    const dropped = [...hidden].slice(0, Math.max(0, hidden.size - HIDDEN_CONVERSATION_LIMIT));
    if (dropped.length === 0) return;
    for (const taskId of dropped) {
      hidden.delete(taskId);
      // A read in progress no longer stores the conversation.
      readRequests.set(taskId, (readRequests.get(taskId) ?? 0) + 1);
    }
    setState((current) => {
      for (const taskId of dropped) {
        delete current.conversations[taskId];
        delete current.history[taskId];
      }
    });
  }

  /** Counts a loaded conversation that no tab shows. An event can load the conversation of such a thread. */
  function keepHiddenConversation(taskId: string): void {
    if (shown.has(taskId) || hidden.has(taskId) || !untrack(() => state.conversations[taskId])) return;
    hidden.add(taskId);
    dropHiddenConversations();
  }

  /**
   * Sets the threads that a tab shows. A thread that a tab no longer shows keeps its conversation until
   * more than the limit of other hidden threads were shown after it.
   */
  function showConversations(taskIds: readonly string[]): void {
    const next = new Set(taskIds);
    for (const taskId of shown) {
      if (next.has(taskId) || !untrack(() => state.conversations[taskId])) continue;
      hidden.delete(taskId);
      hidden.add(taskId);
    }
    for (const taskId of next) hidden.delete(taskId);
    shown = next;
    dropHiddenConversations();
  }

  /**
   * Stores a thread list. A conversation of a thread that the list no longer has goes with it. A task
   * without `branch` keeps the link that the stored list has: an `agent-tasks-changed` event of a joined
   * server does not carry it, and a link does not change. A task without `queue` keeps the stored queue
   * in the same way, but only the messages that still wait. Returns true when a waiting message changed
   * and the stored list had a queue: then only a new read of the list gives the full queue.
   */
  function setSnapshot(snapshot: AgentTasksSnapshot): boolean {
    const ids = new Set(snapshot.tasks.map((task) => task.id));
    // An event handler runs this too: the stored list is input here, not a dependency.
    const stored = untrack(() => {
      const byId = new Map<string, AgentTask>();
      for (const task of state.snapshots[snapshot.agentId]?.tasks ?? []) byId.set(task.id, task);
      return byId;
    });
    let staleQueue = false;
    const tasks = snapshot.tasks.map((task) => {
      const held = stored.get(task.id);
      if (!held) return task;
      const next = { ...task };
      if (task.branch === undefined && held.branch) next.branch = { ...held.branch };
      if (task.queue === undefined && held.queue) {
        const waiting = new Set(task.queuedMessages.map((message) => message.deliveryId));
        next.queue = held.queue.filter((delivery) => waiting.has(delivery.id)).map((delivery) => ({ ...delivery }));
        if (queuedKey(task) !== queuedKey(held)) staleQueue = true;
      }
      return next;
    });
    setState((current) => {
      current.snapshots[snapshot.agentId] = { ...snapshot, tasks };
      for (const [taskId, conversation] of Object.entries(current.conversations)) {
        if (conversation.agentId === snapshot.agentId && !ids.has(taskId)) {
          delete current.conversations[taskId];
          delete current.history[taskId];
          hidden.delete(taskId);
        }
      }
    });
    return staleQueue;
  }

  /** What the waiting messages of a task are, as each list of the task gives them. */
  function queuedKey(task: AgentTask): string {
    return JSON.stringify(task.queuedMessages.map((message) => [message.deliveryId, message.text]));
  }

  function applySnapshot(snapshot: AgentTasksSnapshot): boolean {
    listRequests.set(snapshot.agentId, (listRequests.get(snapshot.agentId) ?? 0) + 1);
    return setSnapshot(snapshot);
  }

  /**
   * Keeps the newest conversation of a task. A delta raises the revision, so an older snapshot loses. A
   * thread that read older pages keeps them. When its first messages leave the newest ones, the thread
   * has older messages from then on. A part around an old message stays until the newest messages
   * reach it: then they join, and the thread follows its latest message again. A change outside the
   * newest messages, such as a delete on another device, reads the part again.
   */
  function applyConversation(taskId: string, snapshot: ConversationSnapshot): void {
    const stored = state.conversations[taskId];
    if (stored && snapshot.revision < stored.revision) return;
    const before = rememberNewest(taskId, snapshot);
    const changedOutside =
      stored !== undefined &&
      state.history[taskId]?.hasNewer === true &&
      snapshot.revision > stored.revision &&
      before === newestMessages.get(taskId);
    setState((current) => {
      const held = current.conversations[taskId];
      const history = current.history[taskId];
      if (held && history?.hasNewer) {
        const joined = withOlderMessages(held, snapshot);
        if (joined) {
          current.conversations[taskId] = joined;
          history.hasNewer = false;
          history.paged = true;
          return;
        }
        // The newest messages hold the whole part: the thread is whole again.
        const last = held.messages.at(-1);
        if (!last || snapshot.messages.some((message) => message.id === last.id)) {
          current.conversations[taskId] = snapshot;
          history.hasNewer = false;
          history.paged = false;
          return;
        }
        // A gap stays between the part and the newest messages. The part keeps its messages, and
        // takes the state of the thread, such as its running turn.
        current.conversations[taskId] = { ...snapshot, messages: held.messages };
        return;
      }
      if (held && history?.paged) {
        const joined = withOlderMessages(held, snapshot);
        current.conversations[taskId] = joined ?? snapshot;
        if (joined) return;
        // The thread reads its older messages again from the new first message.
        history.paged = false;
        history.hasOlder = true;
        return;
      }
      current.conversations[taskId] = snapshot;
      const first = snapshot.messages[0];
      const moved = held && first ? held.messages.findIndex((message) => message.id === first.id) > 0 : false;
      if (!moved || !pageable()) return;
      if (history) history.hasOlder = true;
      else current.history[taskId] = { hasOlder: true, hasNewer: false, loading: false, paged: false };
    });
    keepHiddenConversation(taskId);
    if (changedOutside) void readPartAgain(snapshot.agentId, taskId);
  }

  /**
   * Reads again the part around an old message that a thread shows: a message of the part can be
   * deleted. The read goes around a message of the part that the thread still has. When the thread
   * has none of them, it shows its latest messages.
   */
  async function readPartAgain(agentId: string, taskId: string): Promise<void> {
    const read = port().readTaskAround;
    const messages = state.conversations[taskId]?.messages ?? [];
    if (!read || messages.length === 0) return;
    const request = (readRequests.get(taskId) ?? 0) + 1;
    readRequests.set(taskId, request);
    const current = () => scopeIsCurrent() && readRequests.get(taskId) === request && state.history[taskId]?.hasNewer;
    const anchors = new Set([messages[Math.floor(messages.length / 2)], messages[0], messages.at(-1)]);
    try {
      for (const anchor of anchors) {
        if (!anchor) continue;
        const part = await read({ agentId, taskId, messageId: anchor.id, limit: AROUND_LIMIT });
        if (!current()) return;
        if (part.conversation.messages.length === 0) continue;
        setState((draft) => {
          draft.conversations[taskId] = part.conversation;
          draft.history[taskId] = { hasOlder: part.hasOlder, hasNewer: part.hasNewer, loading: false, paged: true };
        });
        return;
      }
      void loadLatest(agentId, taskId);
    } catch {
      // The part stays as it was. The next change or "Latest" reads it again.
    }
  }

  /**
   * Asks the server whether a thread has messages before the loaded ones, once its tab has read the
   * newest. A server without the page route shows only the newest messages.
   */
  function readHistory(agentId: string, taskId: string, snapshot: ConversationSnapshot): void {
    const read = port().readTaskPage;
    const oldest = snapshot.messages[0];
    if (!read || !pageable() || !oldest || state.history[taskId]) return;
    void read({ agentId, taskId, beforeMessageId: oldest.id, limit: 0 })
      .then((page) => {
        if (!scopeIsCurrent() || !state.conversations[taskId] || state.history[taskId]) return;
        setState((current) => {
          current.history[taskId] = { hasOlder: page.hasOlder, hasNewer: false, loading: false, paged: false };
        });
      })
      // The thread still shows its newest messages.
      .catch(() => undefined);
  }

  /** Reads the page of a thread's messages before the oldest loaded one, and puts it in front of them. */
  async function loadOlderMessages(agentId: string, taskId: string): Promise<void> {
    const read = port().readTaskPage;
    const oldest = state.conversations[taskId]?.messages[0];
    const history = state.history[taskId];
    if (!read || !oldest || !history?.hasOlder || history.loading) return;
    setState((current) => {
      const entry = current.history[taskId];
      if (entry) entry.loading = true;
    });
    try {
      const page = await read({ agentId, taskId, beforeMessageId: oldest.id, limit: OLDER_PAGE_SIZE });
      if (!scopeIsCurrent()) return;
      setState((current) => {
        const conversation = current.conversations[taskId];
        const entry = current.history[taskId];
        if (!conversation || !entry) return;
        entry.loading = false;
        // A new conversation can have come in meanwhile. The page goes before the message that it was read for.
        if (conversation.messages[0]?.id !== oldest.id) return;
        const ids = new Set(conversation.messages.map((message) => message.id));
        conversation.messages = [
          ...page.conversation.messages.filter((message) => !ids.has(message.id)),
          ...conversation.messages,
        ];
        entry.hasOlder = page.hasOlder;
        entry.paged = true;
      });
    } catch (error) {
      if (!scopeIsCurrent()) return;
      setState((current) => {
        const entry = current.history[taskId];
        if (entry) entry.loading = false;
      });
      const { t, errorMessage } = currentText();
      actionToast.error(errorMessage(error, t("chat.history.olderFailed")));
    }
  }

  /**
   * Reads the newest messages of a thread that shows a part around an old message, in the place of
   * that part. The thread then follows its latest message again.
   */
  async function loadLatest(agentId: string, taskId: string): Promise<void> {
    const history = state.history[taskId];
    if (!history?.hasNewer || history.loadingLatest) return;
    const request = (readRequests.get(taskId) ?? 0) + 1;
    readRequests.set(taskId, request);
    setState((current) => {
      const entry = current.history[taskId];
      if (entry) entry.loadingLatest = true;
    });
    try {
      const snapshot = await port().readTask({ agentId, taskId });
      if (!scopeIsCurrent() || readRequests.get(taskId) !== request) return;
      rememberNewest(taskId, snapshot);
      setState((current) => {
        current.conversations[taskId] = snapshot;
        delete current.history[taskId];
      });
      readHistory(agentId, taskId, snapshot);
    } catch (error) {
      if (!scopeIsCurrent() || readRequests.get(taskId) !== request) return;
      setState((current) => {
        const entry = current.history[taskId];
        if (entry) entry.loadingLatest = false;
      });
      const { t, errorMessage } = currentText();
      actionToast.error(errorMessage(error, t("conversation.threads.error.read")));
    }
  }

  function applyDelta(event: Extract<AgentTaskEvent, { type: "agent-task-conversation-delta" }>): void {
    const stored = state.conversations[event.taskId];
    // A task that did not load its conversation reads it whole when it opens. A part around an old
    // message does not hold the streamed message: the conversation of the turn's end comes later.
    if (!stored || event.revision <= stored.revision || state.history[event.taskId]?.hasNewer) return;
    setState((current) => {
      const conversation = current.conversations[event.taskId];
      if (!conversation) return;
      conversation.revision = event.revision;
      const existing = conversation.messages.find((message) => message.id === event.messageId);
      if (existing) {
        existing.text += event.delta;
        existing.status = "streaming";
        return;
      }
      conversation.messages.push({
        id: event.messageId,
        turnId: event.turnId,
        author: "assistant",
        text: event.delta,
        createdAt: event.createdAt,
        status: "streaming",
      });
    });
  }

  /**
   * A list from an event of a joined server has no branch links and no full queue. When it has a task
   * that the stored list does not have, the list is read again: the new task can be a branch from
   * another device. When a waiting message of a thread changed, the list is read again for its queue.
   */
  function applyTasksChanged(snapshot: AgentTasksSnapshot): void {
    const stored = untrack(() => state.snapshots[snapshot.agentId]);
    const known = stored && untrack(branchable) ? new Set(stored.tasks.map((task) => task.id)) : undefined;
    // Each progress line sends a list too. Only a saved message or an end of a turn changes a count.
    const before = stored ? untrack(() => unreadKey(stored)) : undefined;
    const staleQueue = applySnapshot(snapshot);
    if (staleQueue || (known && snapshot.tasks.some((task) => task.branch === undefined && !known.has(task.id))))
      void loadTasks(snapshot.agentId);
    // The host sends no event when a read mark moves, so a changed list reads the marks again.
    else if (unreadKey(snapshot) !== before) loadUnread(snapshot.agentId);
  }

  /** What a thread's unread count can follow: the threads, their states and their last changes. */
  function unreadKey(snapshot: AgentTasksSnapshot): string {
    return snapshot.tasks.map((task) => `${task.id}:${task.state}:${task.outcome}:${task.updatedAt}`).join("|");
  }

  function applyEvent(event: AgentTaskEvent): void {
    if (event.type === "agent-tasks-changed") applyTasksChanged(event.snapshot);
    else if (event.type === "agent-task-conversation") applyConversation(event.taskId, event.snapshot);
    else applyDelta(event);
  }

  /** Reads an agent's thread list. Resolves true when this read is the newest list. */
  function loadTasks(agentId: string): Promise<boolean> {
    const request = (listRequests.get(agentId) ?? 0) + 1;
    listRequests.set(agentId, request);
    return port()
      .listTasks(agentId)
      .then((snapshot) => {
        if (!scopeIsCurrent() || listRequests.get(agentId) !== request) return false;
        setSnapshot(snapshot);
        loadUnread(agentId);
        return true;
      })
      .catch((error) => {
        if (!scopeIsCurrent() || listRequests.get(agentId) !== request || agentId !== activeAgentId()) return false;
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("conversation.threads.error.load")));
        return false;
      });
  }

  // An effect runs again each time its key is computed, so the key is a memo. A reconnect gives the
  // server's capabilities again, and a list read for that alone repeats the read of the runtime snapshot.
  const listKey = createMemo(() => ({ agentId: activeAgentId(), reload: options.reloadKey(), shown: available() }), {
    equals: (before, after) =>
      before.agentId === after.agentId && before.reload === after.reload && before.shown === after.shown,
  });
  createEffect(
    () => ({
      ...listKey(),
      // A running thread can end while the server is away, and the sidebar shows its agent as working.
      running: untrack(() =>
        Object.values(state.snapshots).flatMap((snapshot) =>
          snapshot.tasks.some((task) => task.state === "running") ? [snapshot.agentId] : [],
        ),
      ),
    }),
    ({ agentId, shown, running }) => {
      if (!shown) return;
      for (const id of new Set([...(agentId ? [agentId] : []), ...running])) void loadTasks(id);
    },
  );

  /** Starts a read of the marks of an agent. A read that started before it has an older count. */
  function nextUnreadRequest(agentId: string): number {
    const request = (unreadRequests.get(agentId) ?? 0) + 1;
    unreadRequests.set(agentId, request);
    return request;
  }

  function setUnread(agentId: string, taskId: string, count: number): void {
    setState((current) => {
      current.unread[agentId] ??= {};
      current.unread[agentId][taskId] = count;
    });
  }

  /**
   * Reads the person's read mark of each open thread of an agent. A failure keeps the old counts: the
   * next list reads them again.
   */
  function loadUnread(agentId: string): void {
    // An event handler runs this too: the capability is input here, not a dependency.
    const list = untrack(readable) ? port().listTaskReads : undefined;
    if (!list) return;
    const request = nextUnreadRequest(agentId);
    void list(agentId)
      .then((reads) => {
        if (!scopeIsCurrent() || unreadRequests.get(agentId) !== request) return;
        setState((current) => {
          const previous = current.unread[agentId] ?? {};
          current.unread[agentId] = Object.fromEntries(
            reads.map((read) => [
              read.taskId,
              marking.has(read.taskId) ? (previous[read.taskId] ?? 0) : read.unreadCount,
            ]),
          );
        });
      })
      .catch(() => undefined);
  }

  /** The agent messages of a thread that the person has not read. An archived thread has none. */
  function unreadCount(task: AgentTask): number {
    return task.state === "closed" ? 0 : (state.unread[task.agentId]?.[task.id] ?? 0);
  }

  /** The unread agent messages of all open threads, by agent id. Agents without any are left out. */
  const unreadTotals = createMemo(() => {
    const totals: Record<string, number> = {};
    for (const agentId of Object.keys(state.unread)) {
      const total = (state.snapshots[agentId]?.tasks ?? []).reduce((sum, task) => sum + unreadCount(task), 0);
      if (total > 0) totals[agentId] = total;
    }
    return totals;
  });

  /** Reads the whole conversation of a thread, when its tab opens. */
  function openTask(agentId: string, taskId: string): void {
    const request = (readRequests.get(taskId) ?? 0) + 1;
    readRequests.set(taskId, request);
    void port()
      .readTask({ agentId, taskId })
      .then((snapshot) => {
        if (!scopeIsCurrent()) return;
        // A part around an old message can take the place of this read. It still compares the next changes with it.
        if (readRequests.get(taskId) !== request) {
          rememberNewest(taskId, snapshot);
          return;
        }
        applyConversation(taskId, snapshot);
        readHistory(agentId, taskId, snapshot);
      })
      .catch((error) => {
        if (!scopeIsCurrent() || readRequests.get(taskId) !== request) return;
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("conversation.threads.error.read")));
      });
  }

  /** Adds a task that an action returned, so its tab shows before the list event arrives. */
  function rememberTask(task: AgentTask): void {
    setState((current) => {
      const snapshot = current.snapshots[task.agentId];
      if (!snapshot) return;
      const stored = snapshot.tasks.find((entry) => entry.id === task.id);
      // The event of a joined server can arrive first, without the link of a branch.
      if (stored) {
        if (!stored.branch && task.branch) stored.branch = task.branch;
        return;
      }
      snapshot.tasks.unshift(task);
    });
  }

  async function runAction<Result>(action: () => Promise<Result>, fallback: AppTextKey): Promise<Result | null> {
    try {
      return await action();
    } catch (error) {
      if (!scopeIsCurrent()) return null;
      const { t, errorMessage } = currentText();
      actionToast.error(errorMessage(error, t(fallback)));
      return null;
    }
  }

  /** Sends `attachmentDraftIds` only when there are files, so a server with text-only threads gets no new key. */
  async function startTask(
    agentId: string,
    text: string,
    attachmentDraftIds: string[] = [],
  ): Promise<AgentTask | null> {
    const task = await runAction(
      () =>
        port().startTask({
          agentId,
          text,
          ...(attachmentDraftIds.length ? { attachmentDraftIds } : {}),
          clientMessageId: crypto.randomUUID(),
        }),
      "conversation.threads.error.start",
    );
    if (task && scopeIsCurrent()) rememberTask(task);
    return task;
  }

  async function runQueuedMessageAsTask(agentId: string, deliveryId: string): Promise<AgentTask | null> {
    const run = port().runQueuedMessageAsTask;
    if (!run) return null;
    const task = await runAction(() => run({ agentId, deliveryId }), "conversation.threads.error.start");
    if (task && scopeIsCurrent()) rememberTask(task);
    return task;
  }

  /** Whether the server copies a conversation into a new thread. */
  const canBranch = (): boolean => branchable() && port().branchTask !== undefined;

  /**
   * Copies a conversation through an agent answer into a new thread: the agent's own chat when
   * `sourceTaskId` is null, or a side thread. A retry of one click would send the same request id.
   */
  async function branchTask(
    agentId: string,
    sourceTaskId: string | null,
    messageId: string,
  ): Promise<AgentTask | null> {
    const branch = port().branchTask;
    if (!branch || !branchable()) return null;
    const analytics = desktopAnalytics.scope();
    const task = await runAction(
      () => branch({ agentId, taskId: sourceTaskId, messageId, requestId: crypto.randomUUID() }),
      "conversation.threads.error.branch",
    );
    analytics.track("agent_action", { action: "branch", result: task ? "succeeded" : "failed" });
    if (task && scopeIsCurrent()) rememberTask(task);
    return task;
  }

  /** Steers the task's running turn, or queues the message in the task. */
  async function sendToTask(
    agentId: string,
    taskId: string,
    text: string,
    attachmentDraftIds: string[] = [],
    replyToMessageId: string | null = null,
  ): Promise<boolean> {
    // The sent message and the answer come after the part around an old message, so the thread shows
    // its latest messages again.
    void loadLatest(agentId, taskId);
    const receipt = await runAction(
      () =>
        port().sendToTask({
          agentId,
          taskId,
          text,
          ...(attachmentDraftIds.length ? { attachmentDraftIds } : {}),
          ...(replyToMessageId ? { replyToMessageId } : {}),
          clientMessageId: crypto.randomUUID(),
        }),
      "conversation.threads.error.send",
    );
    return receipt !== null;
  }

  /** Removes a queued message of a thread. */
  function cancelQueuedMessage(agentId: string, deliveryId: string): void {
    const queue = port().queue;
    if (queue) void runAction(() => queue.cancelQueuedMessage({ agentId, deliveryId }), "app.errorStatus.cancel");
  }

  /**
   * Gives a queued message of a thread to the thread's running turn. After the turn ended, the
   * message runs as the next turn, so the refusal is not shown, as in the agent's own chat (#3206).
   */
  function steerQueuedMessage(agentId: string, taskId: string, deliveryId: string, expectedTurnId: string): void {
    const queue = port().queue;
    if (!queue) return;
    void queue.steerQueuedMessage({ agentId, deliveryId, expectedTurnId }).catch((error: unknown) => {
      if (!scopeIsCurrent()) return;
      const task = state.snapshots[agentId]?.tasks.find((entry) => entry.id === taskId);
      if (task?.activeTurnId !== expectedTurnId) return;
      // A message that left the queue is in the turn already.
      if (!task.queue?.some((delivery) => delivery.id === deliveryId)) return;
      const { t, errorMessage } = currentText();
      actionToast.error(errorMessage(error, t("app.errorStatus.steer")));
    });
  }

  /** Orders the queued messages of one thread. The other work of the agent keeps its places. */
  function reorderQueue(agentId: string, taskId: string, deliveryIds: string[]): void {
    const queue = port().queue;
    if (queue) void runAction(() => queue.reorderQueue({ agentId, taskId, deliveryIds }), "app.errorStatus.reorder");
  }

  function stopTask(agentId: string, taskId: string): void {
    void runAction(() => port().stopTask({ agentId, taskId }), "conversation.threads.error.stop");
  }

  /**
   * Archives a thread. Its queued messages stop; a running turn must stop first. A `serverId` sends
   * the request to that server, also after a server switch.
   */
  async function closeTask(agentId: string, taskId: string, serverId?: string): Promise<boolean> {
    const done = await runAction(
      () => port().closeTask({ agentId, taskId }, serverId),
      "conversation.threads.error.archive",
    );
    return done !== null;
  }

  async function reopenTask(agentId: string, taskId: string, serverId?: string): Promise<boolean> {
    const done = await runAction(
      () => port().reopenTask({ agentId, taskId }, serverId),
      "conversation.threads.error.restore",
    );
    return done !== null;
  }

  async function renameTask(agentId: string, taskId: string, title: string): Promise<boolean> {
    const done = await runAction(
      () => port().renameTask({ agentId, taskId, title }),
      "conversation.threads.error.rename",
    );
    return done !== null;
  }

  async function deleteTask(agentId: string, taskId: string, serverId?: string): Promise<boolean> {
    const done = await runAction(
      () => port().deleteTask({ agentId, taskId }, serverId),
      "conversation.threads.error.delete",
    );
    if (done === null || !scopeIsCurrent()) return false;
    setState((current) => {
      delete current.conversations[taskId];
      delete current.history[taskId];
    });
    hidden.delete(taskId);
    return true;
  }

  /** Whether the server deletes a message of a side thread. */
  const canDeleteMessage = (): boolean => messageDeletable() && port().deleteTaskMessage !== undefined;

  /**
   * Deletes one message of a thread. The server sends the changed conversation, but the thread also
   * removes the message at once. A failure throws to the dialog that asked.
   */
  async function deleteTaskMessage(agentId: string, taskId: string, messageId: string): Promise<void> {
    const remove = port().deleteTaskMessage;
    if (!remove || !messageDeletable()) throw new Error(currentText().t("error.team.messageDeleteUnsupported"));
    await remove({ agentId, taskId, messageId });
    if (!scopeIsCurrent()) return;
    setState((current) => {
      const conversation = current.conversations[taskId];
      if (conversation) conversation.messages = conversation.messages.filter((message) => message.id !== messageId);
    });
  }

  /**
   * Moves the person's read mark of a side thread to the message that they see. The member's other
   * devices read the mark, so the phone no longer shows the thread as unread. The thread shows as
   * read at once. A failure keeps the old mark and shows its count again: the next message moves it.
   */
  function markTaskRead(agentId: string, taskId: string, throughMessageId: string): void {
    // In a part around an old message, the message in view is not the latest that the person saw.
    if (!readable() || readMarks.get(taskId) === throughMessageId || state.history[taskId]?.hasNewer) return;
    readMarks.set(taskId, throughMessageId);
    // A list read that started before this mark has the old count.
    nextUnreadRequest(agentId);
    setUnread(agentId, taskId, 0);
    marking.add(taskId);
    void port()
      .markTaskRead({ agentId, taskId, throughMessageId })
      .then((read) => {
        if (readMarks.get(taskId) !== throughMessageId) return;
        marking.delete(taskId);
        // A message that arrived after the mark stays unread.
        if (scopeIsCurrent()) setUnread(agentId, taskId, read.unreadCount);
      })
      .catch(() => {
        if (readMarks.get(taskId) !== throughMessageId) return;
        marking.delete(taskId);
        readMarks.delete(taskId);
        if (scopeIsCurrent()) loadUnread(agentId);
      });
  }

  /** The newest messages of a thread: the loaded conversation, else a read of it. */
  async function taskMessages(agentId: string, taskId: string): Promise<ConversationSnapshot["messages"]> {
    const loaded = state.history[taskId]?.hasNewer ? undefined : state.conversations[taskId];
    return loaded?.messages ?? (await port().readTask({ agentId, taskId })).messages;
  }

  /**
   * Loads the messages of a thread around one message, so a jump to an old message can scroll to it.
   * A loaded message needs no read. Else one read gives the part of the thread around the message: it
   * joins the loaded messages when they meet, else it takes their place until the thread reads its
   * latest messages again. A server without that read shows the newest messages only. False when the
   * thread does not have the message. A store write shows in `state` only after the next flush, so the
   * answer after a write comes from the messages that were read.
   */
  /** The newest read around a message for each thread. */
  const aroundRequests = new Map<string, number>();
  async function loadMessage(agentId: string, taskId: string, messageId: string): Promise<boolean> {
    const has = (messages: readonly { id: string }[]) => messages.some((message) => message.id === messageId);
    const loaded = () => has(state.conversations[taskId]?.messages ?? []);
    if (loaded()) return true;
    const read = port().readTaskAround;
    if (!read || !aroundReadable()) {
      if (!state.conversations[taskId]) {
        const snapshot = await port().readTask({ agentId, taskId });
        if (!scopeIsCurrent()) return false;
        applyConversation(taskId, snapshot);
        readHistory(agentId, taskId, snapshot);
        return has(snapshot.messages);
      }
      return loaded();
    }
    // Two fast jumps in one thread: the part of the later jump stays, though its read can end first.
    const request = (aroundRequests.get(taskId) ?? 0) + 1;
    aroundRequests.set(taskId, request);
    const part = await read({ agentId, taskId, messageId, limit: AROUND_LIMIT });
    if (!scopeIsCurrent() || aroundRequests.get(taskId) !== request || part.conversation.messages.length === 0)
      return false;
    // The tab's read of the newest messages can have come in meanwhile, with the message in it.
    if (loaded()) return true;
    let replaced = false;
    setState((current) => {
      const held = current.conversations[taskId];
      const history = current.history[taskId];
      const messages = part.conversation.messages;
      const last = messages.at(-1)?.id;
      const meet = held && last ? held.messages.findIndex((message) => message.id === last) : -1;
      if (held && meet >= 0) {
        // The loaded messages go on from the part.
        current.conversations[taskId] = { ...held, messages: [...messages, ...held.messages.slice(meet + 1)] };
        current.history[taskId] = {
          hasOlder: part.hasOlder,
          hasNewer: history?.hasNewer ?? false,
          loading: false,
          paged: true,
        };
        return;
      }
      current.conversations[taskId] = part.conversation;
      current.history[taskId] = { hasOlder: part.hasOlder, hasNewer: part.hasNewer, loading: false, paged: true };
      replaced = true;
    });
    keepHiddenConversation(taskId);
    // A read of the newest messages that started before the part no longer replaces it. The next
    // changes are compared with the newest messages, so a delete in the part reads it again.
    if (replaced) rememberNewestOf(agentId, taskId);
    return has(part.conversation.messages);
  }

  /**
   * Whether a thread has a message: in its loaded or newest messages, else, where the server can, in a
   * read of the one message.
   */
  async function taskHasMessage(agentId: string, taskId: string, messageId: string): Promise<boolean> {
    const held = state.conversations[taskId]?.messages.some((message) => message.id === messageId);
    if (held || (await taskMessages(agentId, taskId)).some((message) => message.id === messageId)) return true;
    const read = port().readTaskAround;
    if (!read || !aroundReadable()) return false;
    return (await read({ agentId, taskId, messageId, limit: 1 })).conversation.messages.length > 0;
  }

  /** Moves the read mark of each open thread of an agent with unread messages to its latest message. */
  async function markAllTasksRead(agentId: string): Promise<void> {
    const unread = (state.snapshots[agentId]?.tasks ?? []).filter((task) => unreadCount(task) > 0);
    await Promise.all(
      unread.map(async (task) => {
        const latestMessageId = (await taskMessages(agentId, task.id)).at(-1)?.id;
        if (latestMessageId && scopeIsCurrent()) markTaskRead(agentId, task.id, latestMessageId);
      }),
    );
  }

  /**
   * Reads the lists of the active agent, of each agent with a running thread and of each loaded
   * conversation again, after the server was away. Then it reads each loaded conversation. The lists
   * come first: a thread that another device deleted meanwhile is not read again.
   */
  function reload(): void {
    if (!available()) return;
    const agentIds = new Set(Object.values(state.conversations).map((conversation) => conversation.agentId));
    const active = activeAgentId();
    if (active) agentIds.add(active);
    // A running thread can end while the server is away, and the sidebar shows its agent as working.
    for (const snapshot of Object.values(state.snapshots))
      if (snapshot.tasks.some((task) => task.state === "running")) agentIds.add(snapshot.agentId);
    for (const agentId of agentIds) {
      void loadTasks(agentId).then((loaded) => {
        if (!loaded) return;
        for (const [taskId, conversation] of Object.entries(state.conversations)) {
          if (conversation.agentId === agentId) openTask(agentId, taskId);
        }
      });
    }
  }

  return {
    available,
    editable,
    queuedMessageMovable,
    filesAccepted,
    repliable,
    snapshot: (agentId: string): AgentTasksSnapshot | undefined => state.snapshots[agentId],
    conversation: (taskId: string): ConversationSnapshot | undefined => state.conversations[taskId],
    /** The thread has messages before the loaded ones, and whether it reads them now. Undefined while it is not known. */
    olderMessages: (taskId: string): { loading: boolean } | undefined => {
      const history = state.history[taskId];
      return history?.hasOlder ? { loading: history.loading } : undefined;
    },
    loadOlderMessages,
    /** The thread shows a part around an old message, and whether it reads its latest messages now. */
    newerMessages: (taskId: string): { loading: boolean } | undefined => {
      const history = state.history[taskId];
      return history?.hasNewer ? { loading: history.loadingLatest === true } : undefined;
    },
    loadLatest,
    applyEvent,
    reload,
    loadTasks,
    openTask,
    showConversations,
    startTask,
    runQueuedMessageAsTask,
    canBranch,
    branchTask,
    sendToTask,
    stopTask,
    queueActions: (): boolean => port().queue !== undefined,
    cancelQueuedMessage,
    steerQueuedMessage,
    reorderQueue,
    closeTask,
    reopenTask,
    renameTask,
    deleteTask,
    canDeleteMessage,
    deleteTaskMessage,
    markTaskRead,
    markAllTasksRead,
    taskHasMessage,
    loadMessage,
    unreadCount,
    unreadTotals,
    loadUnread,
  };
}

export type AgentTasks = ReturnType<typeof createAgentTasks>;
