import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentEvent,
  AgentTask,
  AgentTasksSnapshot,
  ArchivedAgentTasksCursor,
  ConversationSnapshot,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { isQuietSteerRefusal } from "../../quiet-steer-refusal";
import { createScopeGuard } from "../../scope-lifetime";
import type { AgentTasksPort } from "./agent-tasks-port";

export type AgentTaskEvent = Extract<
  AgentEvent,
  { type: "agent-tasks-changed" | "agent-task-conversation" | "agent-task-conversation-delta" }
>;

export function isAgentTaskEvent(event: { type: string }): event is AgentTaskEvent {
  return (
    event.type === "agent-tasks-changed" ||
    event.type === "agent-task-conversation" ||
    event.type === "agent-task-conversation-delta"
  );
}

interface AgentTasksState {
  snapshots: Record<string, AgentTasksSnapshot>;
  conversations: Record<string, ConversationSnapshot>;
  unread: Record<string, Record<string, number>>;
  history: Record<string, TaskHistory>;
  archived: Record<string, ArchivedPages>;
}

interface ArchivedPages {
  tasks: AgentTask[];
  hasMore: boolean;
  loading: boolean;
}

const listIsFull = (snapshot: AgentTasksSnapshot) => snapshot.tasks.length >= INPUT_LIMITS.agentTasks;

const listedBefore = (task: AgentTask, other: AgentTask) =>
  task.updatedAt > other.updatedAt || (task.updatedAt === other.updatedAt && task.threadId < other.threadId);

interface TaskHistory {
  hasOlder: boolean;
  hasNewer: boolean;
  loading: boolean;
  loadingLatest?: boolean;
  paged: boolean;
}

const OLDER_PAGE_SIZE = 50;

const AROUND_LIMIT = 100;

const HIDDEN_CONVERSATION_LIMIT = 5;

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
  port: () => AgentTasksPort;
  activeAgentId: () => string | undefined;
  queuedMessageMovable: () => boolean;
  available: () => boolean;
  editable: () => boolean;
  readable: () => boolean;
  branchable: () => boolean;
  filesAccepted: () => boolean;
  repliable: () => boolean;
  messageDeletable: () => boolean;
  pageable: () => boolean;
  aroundReadable: () => boolean;
  archivedPageable: () => boolean;
  reloadKey: () => unknown;
}

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
    archivedPageable,
  } = options;
  const scopeIsCurrent = createScopeGuard();
  const [state, setState] = createStore<AgentTasksState>({
    snapshots: {},
    conversations: {},
    unread: {},
    history: {},
    archived: {},
  });
  const archivedRequests = new Map<string, number>();
  const listRequests = new Map<string, number>();
  const readRequests = new Map<string, number>();
  const unreadRequests = new Map<string, number>();
  const readMarks = new Map<string, string>();
  const marking = new Set<string>();
  let shown: ReadonlySet<string> = new Set();
  const hidden = new Set<string>();
  const newestMessages = new Map<string, string>();

  function rememberNewest(taskId: string, snapshot: ConversationSnapshot): string | undefined {
    const before = newestMessages.get(taskId);
    const newest = snapshot.messages.map((message) => `${message.id}:${message.status}:${message.text.length}`);
    newestMessages.set(taskId, newest.join());
    return before;
  }

  function rememberNewestOf(agentId: string, taskId: string): void {
    const request = (readRequests.get(taskId) ?? 0) + 1;
    readRequests.set(taskId, request);
    const kept = newestMessages.get(taskId);
    void port()
      .readTask({ agentId, taskId })
      .then((snapshot) => {
        if (scopeIsCurrent() && newestMessages.get(taskId) === kept) rememberNewest(taskId, snapshot);
      })
      .catch(() => undefined);
  }

  function dropHiddenConversations(): void {
    const dropped = [...hidden].slice(0, Math.max(0, hidden.size - HIDDEN_CONVERSATION_LIMIT));
    if (dropped.length === 0) return;
    for (const taskId of dropped) {
      hidden.delete(taskId);
      readRequests.set(taskId, (readRequests.get(taskId) ?? 0) + 1);
    }
    setState((current) => {
      for (const taskId of dropped) {
        delete current.conversations[taskId];
        delete current.history[taskId];
      }
    });
  }

  function keepHiddenConversation(taskId: string): void {
    if (shown.has(taskId) || hidden.has(taskId) || !untrack(() => state.conversations[taskId])) return;
    hidden.add(taskId);
    dropHiddenConversations();
  }

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

  function setSnapshot(snapshot: AgentTasksSnapshot): boolean {
    const listed = new Set(snapshot.tasks.map((task) => task.id));
    const pages = untrack(() => keptArchivedPages(snapshot, listed));
    const ids = new Set([...listed, ...(pages?.tasks.map((task) => task.id) ?? [])]);
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
      if (task.awaitedReplies === undefined && held.awaitedReplies) {
        next.awaitedReplies = held.awaitedReplies.map((reply) => ({ ...reply }));
        const changed = task.state !== held.state && (task.state === "idle" || held.awaitedReplies.length > 0);
        if (changed || held.awaitedReplies.some((reply) => reply.status === "queued")) staleQueue = true;
      }
      return next;
    });
    setState((current) => {
      current.snapshots[snapshot.agentId] = { ...snapshot, tasks };
      if (pages) current.archived[snapshot.agentId] = pages;
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

  function keptArchivedPages(snapshot: AgentTasksSnapshot, listed: ReadonlySet<string>): ArchivedPages | undefined {
    const pages = state.archived[snapshot.agentId];
    if (!pages) return undefined;
    const oldest = snapshot.tasks.findLast((task) => task.state === "closed");
    const left = listIsFull(snapshot)
      ? (state.snapshots[snapshot.agentId]?.tasks ?? []).filter(
          (task) => task.state === "closed" && !listed.has(task.id) && !(oldest && listedBefore(task, oldest)),
        )
      : [];
    const seen = new Set(listed);
    const tasks = [...left, ...pages.tasks].filter((task) => !seen.has(task.id) && seen.add(task.id));
    return { ...pages, tasks: tasks.map((task) => ({ ...task })) };
  }

  function loadArchivedPage(agentId: string): void {
    const list = port().listArchivedTasks;
    const snapshot = state.snapshots[agentId];
    if (!list || !snapshot || state.archived[agentId]?.loading) return;
    const last = state.archived[agentId]?.tasks.at(-1) ?? snapshot.tasks.findLast((task) => task.state === "closed");
    const before: ArchivedAgentTasksCursor | null = last
      ? { updatedAt: last.updatedAt, threadId: last.threadId }
      : null;
    const request = (archivedRequests.get(agentId) ?? 0) + 1;
    archivedRequests.set(agentId, request);
    setState((current) => {
      const pages = current.archived[agentId];
      current.archived[agentId] = { tasks: pages?.tasks ?? [], hasMore: pages?.hasMore ?? true, loading: true };
    });
    const settle = (change: (pages: ArchivedPages) => ArchivedPages) => {
      if (!scopeIsCurrent() || archivedRequests.get(agentId) !== request) return;
      setState((current) => {
        current.archived[agentId] = change(current.archived[agentId] ?? { tasks: [], hasMore: true, loading: false });
      });
    };
    list({ agentId, before })
      .then((page) =>
        settle((pages) => {
          const seen = new Set([
            ...(state.snapshots[agentId]?.tasks ?? []).map((task) => task.id),
            ...pages.tasks.map((task) => task.id),
          ]);
          return {
            tasks: [...pages.tasks, ...page.tasks.filter((task) => !seen.has(task.id))],
            hasMore: page.hasMore,
            loading: false,
          };
        }),
      )
      .catch((error) => {
        settle((pages) => ({ ...pages, loading: false }));
        if (!scopeIsCurrent() || archivedRequests.get(agentId) !== request) return;
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("conversation.threads.error.load")));
      });
  }

  function dropArchivedPages(agentId: string): void {
    if (!untrack(() => state.archived[agentId])) return;
    archivedRequests.set(agentId, (archivedRequests.get(agentId) ?? 0) + 1);
    setState((current) => {
      delete current.archived[agentId];
    });
  }

  function updateArchivedPage(agentId: string, taskId: string, change: (tasks: AgentTask[]) => AgentTask[]): void {
    setState((current) => {
      const pages = current.archived[agentId];
      if (pages?.tasks.some((task) => task.id === taskId)) pages.tasks = change(pages.tasks);
    });
  }

  function queuedKey(task: AgentTask): string {
    return JSON.stringify(task.queuedMessages.map((message) => [message.deliveryId, message.text]));
  }

  function applySnapshot(snapshot: AgentTasksSnapshot): boolean {
    listRequests.set(snapshot.agentId, (listRequests.get(snapshot.agentId) ?? 0) + 1);
    return setSnapshot(snapshot);
  }

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
        const last = held.messages.at(-1);
        if (!last || snapshot.messages.some((message) => message.id === last.id)) {
          current.conversations[taskId] = snapshot;
          history.hasNewer = false;
          history.paged = false;
          return;
        }
        current.conversations[taskId] = { ...snapshot, messages: held.messages };
        return;
      }
      if (held && history?.paged) {
        const joined = withOlderMessages(held, snapshot);
        current.conversations[taskId] = joined ?? snapshot;
        if (joined) return;
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
    } catch {}
  }

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
      .catch(() => undefined);
  }

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

  function applyTasksChanged(snapshot: AgentTasksSnapshot): void {
    const stored = untrack(() => state.snapshots[snapshot.agentId]);
    const known = stored && untrack(branchable) ? new Set(stored.tasks.map((task) => task.id)) : undefined;
    const before = stored ? untrack(() => unreadKey(stored)) : undefined;
    const staleQueue = applySnapshot(snapshot);
    if (staleQueue || (known && snapshot.tasks.some((task) => task.branch === undefined && !known.has(task.id))))
      void loadTasks(snapshot.agentId);
    else if (unreadKey(snapshot) !== before) loadUnread(snapshot.agentId);
  }

  function unreadKey(snapshot: AgentTasksSnapshot): string {
    return snapshot.tasks.map((task) => `${task.id}:${task.state}:${task.outcome}:${task.updatedAt}`).join("|");
  }

  function applyEvent(event: AgentTaskEvent): void {
    if (event.type === "agent-tasks-changed") applyTasksChanged(event.snapshot);
    else if (event.type === "agent-task-conversation") applyConversation(event.taskId, event.snapshot);
    else applyDelta(event);
  }

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

  const listKey = createMemo(() => ({ agentId: activeAgentId(), reload: options.reloadKey(), shown: available() }), {
    equals: (before, after) =>
      before.agentId === after.agentId && before.reload === after.reload && before.shown === after.shown,
  });
  createEffect(
    () => ({
      ...listKey(),
      running: untrack(() =>
        Object.values(state.snapshots).flatMap((snapshot) =>
          snapshot.tasks.some((task) => task.state === "running") ? [snapshot.agentId] : [],
        ),
      ),
    }),
    ({ agentId, shown, running }) => {
      if (!shown) return;
      for (const id of new Set([...(agentId ? [agentId] : []), ...running])) {
        dropArchivedPages(id);
        void loadTasks(id);
      }
    },
  );

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

  function loadUnread(agentId: string): void {
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

  function unreadCount(task: AgentTask): number {
    return task.state === "closed" ? 0 : (state.unread[task.agentId]?.[task.id] ?? 0);
  }

  const unreadTotals = createMemo(() => {
    const totals: Record<string, number> = {};
    for (const agentId of Object.keys(state.unread)) {
      const total = (state.snapshots[agentId]?.tasks ?? []).reduce((sum, task) => sum + unreadCount(task), 0);
      if (total > 0) totals[agentId] = total;
    }
    return totals;
  });

  function openTask(agentId: string, taskId: string): void {
    const request = (readRequests.get(taskId) ?? 0) + 1;
    readRequests.set(taskId, request);
    void port()
      .readTask({ agentId, taskId })
      .then((snapshot) => {
        if (!scopeIsCurrent()) return;
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

  function rememberTask(task: AgentTask): void {
    setState((current) => {
      const snapshot = current.snapshots[task.agentId];
      if (!snapshot) return;
      const stored = snapshot.tasks.find((entry) => entry.id === task.id);
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

  const startIds = retryOperationIds(() => crypto.randomUUID());

  async function startTask(
    agentId: string,
    text: string,
    attachmentDraftIds: string[] = [],
  ): Promise<AgentTask | null> {
    const start = startIds([agentId, text, attachmentDraftIds]);
    const task = await runAction(
      () =>
        port().startTask({
          agentId,
          text,
          ...(attachmentDraftIds.length ? { attachmentDraftIds } : {}),
          clientMessageId: start.id,
        }),
      "conversation.threads.error.start",
    );
    if (!task) start.failed();
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

  const canBranch = (): boolean => branchable() && port().branchTask !== undefined;

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

  const sendIds = retryOperationIds(() => crypto.randomUUID());

  async function sendToTask(
    agentId: string,
    taskId: string,
    text: string,
    attachmentDraftIds: string[] = [],
    replyToMessageId: string | null = null,
  ): Promise<boolean> {
    void loadLatest(agentId, taskId);
    const message = sendIds([agentId, taskId, text, attachmentDraftIds, replyToMessageId]);
    const receipt = await runAction(
      () =>
        port().sendToTask({
          agentId,
          taskId,
          text,
          ...(attachmentDraftIds.length ? { attachmentDraftIds } : {}),
          ...(replyToMessageId ? { replyToMessageId } : {}),
          clientMessageId: message.id,
        }),
      "conversation.threads.error.send",
    );
    if (receipt === null) message.failed();
    return receipt !== null;
  }

  function cancelQueuedMessage(agentId: string, deliveryId: string): void {
    const queue = port().queue;
    if (queue) void runAction(() => queue.cancelQueuedMessage({ agentId, deliveryId }), "app.errorStatus.cancel");
  }

  function steerQueuedMessage(agentId: string, taskId: string, deliveryId: string, expectedTurnId: string): void {
    const queue = port().queue;
    if (!queue) return;
    void queue.steerQueuedMessage({ agentId, deliveryId, expectedTurnId }).catch((error: unknown) => {
      if (!scopeIsCurrent()) return;
      const task = state.snapshots[agentId]?.tasks.find((entry) => entry.id === taskId);
      if (task?.activeTurnId !== expectedTurnId) return;
      if (!task.queue?.some((delivery) => delivery.id === deliveryId)) return;
      if (isQuietSteerRefusal(error)) return;
      const { t, errorMessage } = currentText();
      actionToast.error(errorMessage(error, t("app.errorStatus.steer")));
    });
  }

  function reorderQueue(agentId: string, taskId: string, deliveryIds: string[]): void {
    const queue = port().queue;
    if (queue) void runAction(() => queue.reorderQueue({ agentId, taskId, deliveryIds }), "app.errorStatus.reorder");
  }

  function stopTask(agentId: string, taskId: string): void {
    void runAction(() => port().stopTask({ agentId, taskId }), "conversation.threads.error.stop");
  }

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
    if (done !== null && scopeIsCurrent())
      updateArchivedPage(agentId, taskId, (tasks) =>
        tasks.map((task) => (task.id === taskId ? { ...task, title } : task)),
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
    updateArchivedPage(agentId, taskId, (tasks) => tasks.filter((task) => task.id !== taskId));
    hidden.delete(taskId);
    return true;
  }

  const canDeleteMessage = (): boolean => messageDeletable() && port().deleteTaskMessage !== undefined;

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

  function markTaskRead(agentId: string, taskId: string, throughMessageId: string): void {
    if (!readable() || readMarks.get(taskId) === throughMessageId || state.history[taskId]?.hasNewer) return;
    readMarks.set(taskId, throughMessageId);
    nextUnreadRequest(agentId);
    setUnread(agentId, taskId, 0);
    marking.add(taskId);
    void port()
      .markTaskRead({ agentId, taskId, throughMessageId })
      .then((read) => {
        if (readMarks.get(taskId) !== throughMessageId) return;
        marking.delete(taskId);
        if (scopeIsCurrent()) setUnread(agentId, taskId, read.unreadCount);
      })
      .catch(() => {
        if (readMarks.get(taskId) !== throughMessageId) return;
        marking.delete(taskId);
        readMarks.delete(taskId);
        if (scopeIsCurrent()) loadUnread(agentId);
      });
  }

  async function taskMessages(agentId: string, taskId: string): Promise<ConversationSnapshot["messages"]> {
    const loaded = state.history[taskId]?.hasNewer ? undefined : state.conversations[taskId];
    return loaded?.messages ?? (await port().readTask({ agentId, taskId })).messages;
  }

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
    const request = (aroundRequests.get(taskId) ?? 0) + 1;
    aroundRequests.set(taskId, request);
    const part = await read({ agentId, taskId, messageId, limit: AROUND_LIMIT });
    if (!scopeIsCurrent() || aroundRequests.get(taskId) !== request || part.conversation.messages.length === 0)
      return false;
    if (loaded()) return true;
    let replaced = false;
    setState((current) => {
      const held = current.conversations[taskId];
      const history = current.history[taskId];
      const messages = part.conversation.messages;
      const last = messages.at(-1)?.id;
      const meet = held && last ? held.messages.findIndex((message) => message.id === last) : -1;
      if (held && meet >= 0) {
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
    if (replaced) rememberNewestOf(agentId, taskId);
    return has(part.conversation.messages);
  }

  async function taskHasMessage(agentId: string, taskId: string, messageId: string): Promise<boolean> {
    const held = state.conversations[taskId]?.messages.some((message) => message.id === messageId);
    if (held || (await taskMessages(agentId, taskId)).some((message) => message.id === messageId)) return true;
    const read = port().readTaskAround;
    if (!read || !aroundReadable()) return false;
    return (await read({ agentId, taskId, messageId, limit: 1 })).conversation.messages.length > 0;
  }

  async function markAllTasksRead(agentId: string): Promise<void> {
    const unread = (state.snapshots[agentId]?.tasks ?? []).filter((task) => unreadCount(task) > 0);
    await Promise.all(
      unread.map(async (task) => {
        const latestMessageId = (await taskMessages(agentId, task.id)).at(-1)?.id;
        if (latestMessageId && scopeIsCurrent()) markTaskRead(agentId, task.id, latestMessageId);
      }),
    );
  }

  function reload(): void {
    if (!available()) return;
    const agentIds = new Set(Object.values(state.conversations).map((conversation) => conversation.agentId));
    const active = activeAgentId();
    if (active) agentIds.add(active);
    for (const snapshot of Object.values(state.snapshots))
      if (snapshot.tasks.some((task) => task.state === "running")) agentIds.add(snapshot.agentId);
    for (const agentId of agentIds) {
      dropArchivedPages(agentId);
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
    snapshot: (agentId: string): AgentTasksSnapshot | undefined => {
      const snapshot = state.snapshots[agentId];
      const pages = state.archived[agentId]?.tasks;
      return snapshot && pages?.length ? { ...snapshot, tasks: [...snapshot.tasks, ...pages] } : snapshot;
    },
    olderArchived: (agentId: string): { loading: boolean } | undefined => {
      const snapshot = state.snapshots[agentId];
      const pages = state.archived[agentId];
      if (!snapshot || !archivedPageable() || !port().listArchivedTasks) return undefined;
      if (pages ? !pages.hasMore : !listIsFull(snapshot)) return undefined;
      return { loading: pages?.loading ?? false };
    },
    loadArchivedPage,
    conversation: (taskId: string): ConversationSnapshot | undefined => state.conversations[taskId],
    olderMessages: (taskId: string): { loading: boolean } | undefined => {
      const history = state.history[taskId];
      return history?.hasOlder ? { loading: history.loading } : undefined;
    },
    loadOlderMessages,
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
