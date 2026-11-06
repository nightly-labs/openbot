import type { AgentApproval, AgentContextState, AgentEvent, AgentTask } from "@openbot/contracts/ipc";
import { isAgentTaskActive, taskApproval } from "@openbot/team-client/agent-tasks";
import {
  activeThreadId,
  type ThreadListsInput,
  threadLists,
} from "@openbot/ui/features/conversation/threads/thread-items";
import { DRAFT_THREAD_ID, MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import type { AgentTasks } from "../agent-tasks/agent-tasks-state";
import type {
  BrowserTakeoverRequest,
  ConversationBranchSource,
  ConversationThreads,
  PromptAnswerOptions,
  SideThread,
} from "../conversation/conversation-types";
import type { AgentThreadTabsState } from "./agent-thread-tabs";

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;

export interface ConversationThreadsInput {
  agent: { id: string; updatedAt: string };
  tasks: AgentTasks;
  tabs: AgentThreadTabsState;
  /** The approvals that wait on the server. A side thread's turn waits for the one of its own thread. */
  approvals: readonly AgentApproval[];
  /** The questions that wait on the server. A side thread's turn waits for the one of its own thread. */
  prompts: readonly PromptEvent[];
  /** The browser takeovers that wait on the server. A side thread's turn waits for the one of its own thread. */
  takeovers: readonly BrowserTakeoverRequest[];
  newThreadTitle: string;
  onRespondApproval: (
    approval: AgentApproval,
    decision: "accept" | "decline",
    options?: PromptAnswerOptions,
  ) => Promise<boolean>;
  /**
   * The context of each side thread that reported it, by thread id. Only this computer reports it.
   * Read only by `contextState`, so a new runtime snapshot does not build the threads again.
   */
  contextStates?: (() => Readonly<Record<string, AgentContextState>>) | undefined;
  /** Missing when the host cannot compact a side thread. */
  onCompactContext?: ((taskId: string) => Promise<void>) | undefined;
  /**
   * Opens the agent's own chat at a message, as a search result does. Without it, a click on
   * "Branched from" opens the agent's own chat at its latest message.
   */
  onOpenMainMessage?: ((messageId: string) => void) | undefined;
}

/** The threads of one agent, for the conversation. Read it in a memo: it reads the thread state. */
export function conversationThreads(input: ConversationThreadsInput): ConversationThreads {
  const { agent, tasks, tabs, approvals, prompts, takeovers, onCompactContext } = input;
  const agentId = agent.id;
  const snapshot = tasks.snapshot(agentId);
  const list = snapshot?.tasks ?? [];
  const listInput: Omit<ThreadListsInput, "open" | "draft"> = {
    mainUpdatedAt: agent.updatedAt,
    tasks: list,
    draftTitle: input.newThreadTitle,
    hidden: tabs.hidden(),
    waitsFor: (task) =>
      taskApproval(task, approvals) !== undefined
        ? "approval"
        : ofTaskThread(task, prompts) !== undefined
          ? "question"
          : ofTaskThread(task, takeovers) !== undefined
            ? "takeover"
            : undefined,
    unread: (task) => tasks.unreadCount(task),
  };
  const lists = threadLists({ ...listInput, open: tabs.openIds(agentId), draft: tabs.hasDraft(agentId) });
  const activeId = activeThreadId(lists.tabs, tabs.activeId(agentId));
  const open =
    activeId === MAIN_THREAD_ID
      ? undefined
      : activeId === DRAFT_THREAD_ID
        ? null
        : list.find((task) => task.id === activeId);
  const approval = open ? taskApproval(open, approvals) : undefined;
  const editable = tasks.editable();
  /** A thread in the side panel, with the actions of its own message box. */
  const sideThread = (id: string): SideThread | undefined => {
    const task = list.find((entry) => entry.id === id);
    if (!task) return undefined;
    const sideApproval = taskApproval(task, approvals);
    return {
      task,
      conversation: tasks.conversation(task.id),
      approval: sideApproval,
      onSend: (text, attachmentDraftIds, replyToMessageId) =>
        tabs.send(agentId, task.id, text, attachmentDraftIds, replyToMessageId),
      onStop: () => tasks.stopTask(agentId, task.id),
      onRead: (messageId) => tasks.markTaskRead(agentId, task.id, messageId),
      onRespondApproval: (decision, options) =>
        sideApproval ? input.onRespondApproval(sideApproval, decision, options) : Promise.resolve(false),
      get contextState() {
        return input.contextStates?.()[task.threadId];
      },
      onCompactContext: onCompactContext ? () => onCompactContext(task.id) : undefined,
    };
  };
  /**
   * The source of a branch. The list has the current title of a listed source. The list can leave out an
   * archived source, so the link's title is the fallback; a link with no title is a deleted source.
   */
  const branchSource = (task: AgentTask): ConversationBranchSource | undefined => {
    const branch = task.branch;
    if (!branch) return undefined;
    const { sourceTaskId, sourceMessageId, throughMessageId } = branch;
    if (sourceTaskId === null)
      return {
        throughMessageId,
        title: null,
        deleted: false,
        onOpen: () => {
          tabs.open(agentId, MAIN_THREAD_ID);
          input.onOpenMainMessage?.(sourceMessageId);
        },
      };
    const title = list.find((entry) => entry.id === sourceTaskId)?.title ?? branch.sourceTitle;
    return {
      throughMessageId,
      title,
      deleted: title === null,
      onOpen: () => void tabs.openAt(agentId, sourceTaskId, sourceMessageId),
    };
  };
  const focus = tabs.messageFocus();
  return {
    header: {
      ...lists,
      activeId,
      canStartNew: true,
      onOpen: (id) => tabs.open(agentId, id),
      onNew: () => tabs.startNew(agentId),
      onClose: (id) => tabs.close(agentId, id),
      onCloseOthers: (id) => tabs.closeOthers(agentId, id),
      onCloseToTheRight: (id) => tabs.closeToTheRight(agentId, id),
      onMove: (id, index) => tabs.move(agentId, id, index),
      onArchive: (id) => void tabs.archive(agentId, id),
      onRestore: (id) => void tabs.restore(agentId, id),
      onRename: editable ? (id, title) => void tabs.rename(agentId, id, title) : undefined,
      onDelete: editable ? (id) => void tabs.remove(agentId, id) : undefined,
    },
    side: {
      tabs: threadLists({ ...listInput, open: tabs.sideIds(agentId), draft: false }).tabs,
      thread: sideThread,
      onToSide: (id) => tabs.toSide(agentId, id),
      onToChat: (id) => tabs.toChat(agentId, id),
      onClose: (id) => tabs.closeSide(agentId, id),
      onMove: (id, index) => tabs.moveSide(agentId, id, index),
    },
    open,
    tasks: list,
    limit: snapshot?.limit ?? 1,
    running: list.filter(isAgentTaskActive).length,
    conversation: open ? tasks.conversation(open.id) : undefined,
    approval,
    acceptsFiles: tasks.filesAccepted(),
    acceptsReplies: tasks.repliable(),
    onSend: (text, attachmentDraftIds, replyToMessageId) =>
      open
        ? tabs.send(agentId, open.id, text, attachmentDraftIds, replyToMessageId)
        : tabs.sendDraft(agentId, text, attachmentDraftIds),
    onStop: () => {
      if (open) tasks.stopTask(agentId, open.id);
    },
    onRead: (messageId) => {
      if (open) tasks.markTaskRead(agentId, open.id, messageId);
    },
    onRespondApproval: (decision, options) =>
      approval ? input.onRespondApproval(approval, decision, options) : Promise.resolve(false),
    get contextState() {
      return open ? input.contextStates?.()[open.threadId] : undefined;
    },
    onCompactContext: open && onCompactContext ? () => onCompactContext(open.id) : undefined,
    // Only this computer moves a queued message to a new thread.
    onRunQueuedMessage: tasks.local() ? (deliveryId) => void tabs.runQueuedMessage(agentId, deliveryId) : undefined,
    queueActions: tasks.queueActions()
      ? {
          cancel: (deliveryId) => tasks.cancelQueuedMessage(agentId, deliveryId),
          steer: (task, deliveryId) => {
            if (task.activeTurnId) tasks.steerQueuedMessage(agentId, task.id, deliveryId, task.activeTurnId);
          },
          reorder: (taskId, deliveryIds) => tasks.reorderQueue(agentId, taskId, deliveryIds),
        }
      : undefined,
    onBranch: tasks.canBranch()
      ? (sourceTaskId, messageId) => tabs.branch(agentId, sourceTaskId, messageId)
      : undefined,
    onDeleteMessage: tasks.canDeleteMessage()
      ? (taskId, messageId) => tasks.deleteTaskMessage(agentId, taskId, messageId)
      : undefined,
    branchSource,
    routineThread: (routineId) => {
      const task = routineTask(list, routineId);
      return task ? () => tabs.open(agentId, task.id) : undefined;
    },
    onOpenRoutineThread: async (routineId) => {
      const listed = () => routineTask(tasks.snapshot(agentId)?.tasks ?? [], routineId);
      if (!listed()) await tasks.loadTasks(agentId);
      const task = listed();
      if (task) tabs.open(agentId, task.id);
      return task !== undefined;
    },
    onOpenRoutineRun: async (routineId, messageId) => {
      // An archived thread of the routine keeps its runs too. `openAt` restores it.
      const listed = () =>
        (tasks.snapshot(agentId)?.tasks ?? [])
          .filter((task) => task.routineId === routineId)
          .sort((left, right) => Number(left.state === "closed") - Number(right.state === "closed"));
      if (listed().length === 0) await tasks.loadTasks(agentId);
      for (const task of listed()) {
        if (!(await tasks.taskHasMessage(agentId, task.id, messageId))) continue;
        await tabs.openAt(agentId, task.id, messageId);
        return true;
      }
      return false;
    },
    focusMessage: focus && list.some((task) => task.id === focus.taskId) ? focus : null,
  };
}

/** The open side thread where the routine runs. */
function routineTask(list: readonly AgentTask[], routineId: string): AgentTask | undefined {
  return list.find((task) => task.routineId === routineId && task.state !== "closed");
}

type TaskThread = { agentId: string; threadId: string };

/** The question or takeover that the turn of this task waits for: the one of the task's own thread. */
function ofTaskThread<Request extends TaskThread>(task: TaskThread, requests: readonly Request[]): Request | undefined {
  return requests.find((request) => request.agentId === task.agentId && request.threadId === task.threadId);
}
