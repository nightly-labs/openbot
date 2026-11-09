import {
  expandAttachmentReferences,
  removeAttachmentReferences,
  serializeAttachmentReference,
} from "@openbot/contracts/attachment-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentApproval,
  AgentTask,
  AgentTaskInput,
  AgentTasksSnapshot,
  AttachmentDataInput,
  AttachmentSummary,
  ConversationSnapshot,
  DraftAttachment,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { plainTaskTitle, taskApproval } from "@openbot/team-client/agent-tasks";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import type { AgentTaskWait } from "@openbot/ui/features/conversation/AgentTasks";
import type { AttachmentDownloads, AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import type { ComposerPasteResult, ComposerSelection } from "@openbot/ui/features/conversation/ComposerEditor";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import { AgentThreadView, type AgentThreadVoice } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import { TaskAnswerCard, TaskPanel } from "@openbot/ui/features/tasks/TaskPanel";
import { TASKS_SIDE_DEFAULT, TASKS_SIDE_MIN, TasksPage, type TasksVoice } from "@openbot/ui/features/tasks/TasksPage";
import { currentText } from "@openbot/ui/text";
import {
  createEffect,
  createMemo,
  createProjection,
  createSignal,
  createStore,
  flush,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { actionToast } from "../../action-toast";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { toAgentMessages } from "../../app-message-projection";
import { readPanelWidth, savePanelWidth } from "../../components/panel-width-storage";
import { usePlatform } from "../../platform";
import { appendVoiceTranscript } from "../../voice-recording";
import { readAgentSelection, writeAgentSelection } from "../agents/agent-selection";
import { insertAtSelection, insertPastedText, rowAttachments } from "../conversation/composer-draft";
import { latestVisibleAgentMessageId } from "../conversation/conversation-read-state";
import { importPastedFiles, type PastePreview, pastePreviewTracker } from "../conversation/stores/composer-actions";
import { createTurnSteps } from "../conversation/turn-steps";
import type { TaskEvent, TasksSource } from "./tasks-port";

/** How long a start waits before it reaches the agent. Undo cancels it in this time. */
const UNDO_MS = 6_000;
/** The agent last chosen on this page for each server, kept apart from the chat agent. */
const TASK_AGENT_STORAGE_KEY = "openbot:task-agent:v1";
/** The width of the task panel beside the list, the same on every server. */
const TASK_PANEL_WIDTH_STORAGE_KEY = "openbot:task-panel-width";

/** What the voice of the composer can do on the page: read and change the draft, and start a task. */
export interface TasksVoiceControls {
  serverId: () => string;
  draft: () => string;
  setDraft: (text: string) => void;
  /** Starts a task with this text. False when the text has nothing to do. */
  start: (text: string) => boolean;
  showError: (message: string) => void;
  focus: () => void;
  /** The task whose panel shows. Its message box can record too. */
  openTaskId: () => string | null;
  /** Adds what was said to the draft of a task's message box. */
  appendTaskTranscript: (taskId: string, text: string) => void;
  /** Sends the draft of a task's message box, when its panel still shows. */
  sendTask: (taskId: string) => Promise<void>;
}

/**
 * The files of a task message: a start or a message to a task. Only a server that takes files in a
 * side thread has them: this computer, or a host with `agent-thread-files-v1`.
 */
export interface TaskFiles {
  accepted: () => boolean;
  import: (data: AttachmentDataInput[], serverId: string) => Promise<DraftAttachment[]>;
  discard: (id: string, serverId: string) => Promise<void>;
}

/**
 * The voice of the composer and of the open task's message box: one recording at a time. `submit` sends
 * while the composer records: the transcript starts the task.
 */
export type TasksVoiceAdapter = TasksVoice & {
  submit: () => void;
  /** The task of the last recording. Undefined when the Tasks composer recorded last. */
  taskId: string | undefined;
  startTask: (taskId: string) => void;
  /** Stops the task's recording, and sends its message with the transcript. */
  sendTask: () => void;
};

interface TasksViewProps {
  serverId: string;
  hostName: string;
  onBack?: (() => void) | undefined;
  agentsOpen?: boolean | undefined;
  onToggleAgents?: (() => void) | undefined;
  source: TasksSource;
  agents: AgentProfile[];
  /** Absent where the client cannot record. */
  voice?: ((controls: TasksVoiceControls) => TasksVoiceAdapter) | undefined;
  onOpenLink: (url: string) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  /** Absent where the client cannot send files with a task message. */
  files?: TaskFiles | undefined;
  /** Loads the images of a client that gets no `previewUrl`. */
  mediaSource?: AttachmentMediaSource | undefined;
  /** The download state of attachments from a joined server. */
  downloads?: AttachmentDownloads | undefined;
  /** The waiting approvals of the server's agents. */
  approvals: readonly AgentApproval[];
  onRespondApproval: (approval: AgentApproval, decision: "accept" | "decline") => Promise<boolean>;
  /** Moves the read mark of an open task to a message. Absent where the server keeps no read marks. */
  onRead?: ((input: AgentTaskInput, messageId: string) => void) | undefined;
  /** Whether the task's running turn waits for a question or a browser takeover, which the chat answers. */
  waitsForAnswer?: ((task: AgentTask) => boolean) | undefined;
  /** Opens the task as a thread tab in its agent's chat, and leaves the page. */
  onOpenInChat?: ((task: AgentTask) => void) | undefined;
  sendShortcut?: SendShortcut | undefined;
}

/** A start that waits for its Undo time. Its task shows in the list as queued. */
interface PendingStart {
  task: AgentTask;
  text: string;
  attachments: DraftAttachment[];
  clientMessageId: string;
  /** The server of the start. A server change commits it after `props.serverId` names the new one. */
  serverId: string;
  timer: ReturnType<typeof setTimeout>;
}

interface TasksViewState {
  /** The task list of each agent, by agent id. */
  snapshots: Record<string, AgentTasksSnapshot>;
  /** The conversation of each opened task, by task id. */
  conversations: Record<string, ConversationSnapshot>;
  /** The unsent text of each task's message box, by task id. */
  drafts: Record<string, string>;
  /** The files of each message box that the text does not name: `START_FILES` for the start, or a task id. */
  files: Record<string, DraftAttachment[]>;
  pending: AgentTask | null;
  agentId: string;
  draft: string;
  focusRequest: number;
  startError: string | null;
  took: { taskId: string; pending: boolean } | null;
  selectedId: string | null;
  /** The width of the task panel that the user chose. */
  sideWidth: number;
  /** Each increase moves the caret of a task's message box to the end, as after a dictation. By task id. */
  focusRequests: Record<string, number>;
}

/** The key of the start composer's files in `TasksViewState.files`. A task id never has this form. */
const START_FILES = "start";

function toastError(error: unknown, fallback: AppTextKey): void {
  const { t, errorMessage } = currentText();
  actionToast.error(errorMessage(error, t(fallback)));
}

/**
 * The tasks of all agents of a server, on desktop and on the web. The page starts a task for the
 * chosen agent a few seconds after the send, so Undo can take it back; opening it or leaving the page
 * starts it at once.
 */
export function TasksView(props: TasksViewProps) {
  const [state, setState] = createStore<TasksViewState>({
    snapshots: {},
    conversations: {},
    drafts: {},
    files: {},
    pending: null,
    agentId: "",
    draft: "",
    focusRequest: 0,
    startError: null,
    took: null,
    selectedId: null,
    focusRequests: {},
    sideWidth: readPanelWidth(
      TASK_PANEL_WIDTH_STORAGE_KEY,
      TASKS_SIDE_DEFAULT,
      TASKS_SIDE_MIN,
      Number.POSITIVE_INFINITY,
    ),
  });
  const { appFocused, appInfo } = usePlatform();
  const showAgentSteps = useShowAgentSteps();
  let pending: PendingStart | null = null;
  let generation = 0;
  const listRequests = new Map<string, number>();
  const readRequests = new Map<string, number>();
  const [pastePreviews, setPastePreviews] = createSignal<readonly PastePreview[]>([]);
  const filesOf = (key: string) => state.files[key] ?? [];
  const pendingImagesOf = (key: string) => pastePreviews().filter((preview) => preview.draftKey === key);
  const filesAccepted = () => props.files?.accepted() === true;

  function discardFiles(attachments: readonly DraftAttachment[], serverId: string): void {
    for (const attachment of attachments) void props.files?.discard(attachment.id, serverId).catch(() => undefined);
  }

  /** The text of a message box: `START_FILES` for the start, or a task id. */
  const textOf = (key: string) => (key === START_FILES ? state.draft : (state.drafts[key] ?? ""));
  function setText(key: string, text: string): void {
    setState((draft) => {
      if (key === START_FILES) draft.draft = text;
      else draft.drafts[key] = text;
    });
  }
  const rowFilesOf = (key: string) => rowAttachments(textOf(key), filesOf(key));

  /**
   * Imports pasted files into a message box, and puts their references at the selection, or at the end
   * when the text changed. The files go to the server of the paste only. `text` is the text of a long
   * paste that `files` holds: when no file comes, that text goes at the selection instead.
   */
  async function pasteFiles(
    key: string,
    files: ReadonlyArray<File | Promise<File>>,
    selection: ComposerSelection,
    text?: string,
  ): Promise<ComposerPasteResult | undefined> {
    const before = textOf(key);
    const fallback = (): ComposerPasteResult | undefined => {
      if (text === undefined) return;
      const result = insertPastedText(textOf(key), text, { before, selection });
      if (result) setText(key, result.value);
      return result;
    };
    const port = props.files;
    if (!port || !filesAccepted()) return fallback();
    const current = generation;
    const serverId = untrack(() => props.serverId);
    const previews = pastePreviewTracker(key, setPastePreviews);
    try {
      const imported = await importPastedFiles(
        files,
        () => filesOf(key).length,
        (data) => port.import(data, serverId),
        previews.onAccepted,
      );
      if (current !== generation) {
        discardFiles(imported, serverId);
        return;
      }
      // Another paste can fill the box while this one imports.
      const accepted = imported.slice(0, Math.max(0, INPUT_LIMITS.attachments - filesOf(key).length));
      discardFiles(imported.slice(accepted.length), serverId);
      if (accepted.length < imported.length)
        actionToast.error(currentText().t("composer.error.attachmentLimit", { limit: INPUT_LIMITS.attachments }));
      if (!accepted.length) return fallback();
      setState((draft) => {
        draft.files[key] = [...(draft.files[key] ?? []), ...accepted];
      });
      const references = accepted.map((file) => serializeAttachmentReference(file.name, file.id)).join(" ");
      const result = insertAtSelection(textOf(key), references, { before, selection });
      // A message that would be too long keeps the files in the row only.
      if (result.value.length > INPUT_LIMITS.messageText) return;
      setText(key, result.value);
      return result;
    } catch (error) {
      if (current !== generation) return;
      toastError(error, "composer.error.keepAttachments");
      return fallback();
    } finally {
      previews.stop();
    }
  }

  function removeFile(key: string, attachment: DraftAttachment): void {
    setText(key, removeAttachmentReferences(textOf(key), attachment.id));
    setState((draft) => {
      const next = (draft.files[key] ?? []).filter((file) => file.id !== attachment.id);
      if (next.length) draft.files[key] = next;
      else delete draft.files[key];
    });
    discardFiles(
      [attachment],
      untrack(() => props.serverId),
    );
  }

  /** Takes the files of a message box out of the page state, for a message that carries them. */
  function takeFiles(key: string): DraftAttachment[] {
    const taken = filesOf(key);
    if (taken.length)
      setState((draft) => {
        delete draft.files[key];
      });
    return taken;
  }

  /** Puts files back in front of a message box's row, after a start that failed or was undone. */
  function returnFiles(key: string, attachments: readonly DraftAttachment[]): void {
    if (!attachments.length) return;
    setState((draft) => {
      draft.files[key] = [...attachments, ...(draft.files[key] ?? [])];
    });
  }

  // The agent chosen last on this server stays the default, so the user does not choose it again on each visit.
  const savedAgentId = createMemo(() => readAgentSelection(TASK_AGENT_STORAGE_KEY)[props.serverId] ?? "");
  const isListed = (id: string) => props.agents.some((agent) => agent.id === id);
  const agentId = () =>
    isListed(state.agentId) ? state.agentId : isListed(savedAgentId()) ? savedAgentId() : (props.agents[0]?.id ?? "");
  const agentOf = (id: string) => props.agents.find((agent) => agent.id === id);

  const tasks = createMemo<AgentTask[]>(() => {
    const listed = props.agents.flatMap((agent) => state.snapshots[agent.id]?.tasks ?? []);
    return state.pending ? [state.pending, ...listed] : listed;
  });
  const taskOf = (taskId: string) => tasks().find((task) => task.id === taskId);

  /** Stores a task list. A task that the list no longer has loses its conversation, its draft and the panel. */
  function setSnapshot(snapshot: AgentTasksSnapshot): void {
    const kept = new Set(snapshot.tasks.map((task) => task.id));
    const gone = (state.snapshots[snapshot.agentId]?.tasks ?? []).filter((task) => !kept.has(task.id));
    setState((draft) => {
      draft.snapshots[snapshot.agentId] = snapshot;
      for (const { id } of gone) {
        delete draft.conversations[id];
        delete draft.drafts[id];
        if (draft.selectedId === id) draft.selectedId = null;
        if (draft.took?.taskId === id) draft.took = null;
      }
    });
  }

  function applySnapshot(snapshot: AgentTasksSnapshot): void {
    listRequests.set(snapshot.agentId, (listRequests.get(snapshot.agentId) ?? 0) + 1);
    setSnapshot(snapshot);
  }

  /** Keeps the newest conversation of a task. A delta raises the revision, so an older snapshot loses. */
  function applyConversation(taskId: string, snapshot: ConversationSnapshot): void {
    const stored = state.conversations[taskId];
    if (stored && snapshot.revision < stored.revision) return;
    setState((draft) => {
      draft.conversations[taskId] = snapshot;
    });
  }

  function applyEvent(event: TaskEvent): void {
    if (event.type === "agent-tasks-changed") {
      applySnapshot(event.snapshot);
      return;
    }
    if (event.type === "agent-task-conversation") {
      applyConversation(event.taskId, event.snapshot);
      return;
    }
    const stored = state.conversations[event.taskId];
    // A task that did not load its conversation reads it whole when it opens.
    if (!stored || event.revision <= stored.revision) return;
    setState((draft) => {
      const conversation = draft.conversations[event.taskId];
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

  /** Reads the task lists of the agents. One toast tells of a failure, not one for each agent. */
  function loadLists(agentIds: readonly string[]): void {
    const serverId = props.serverId;
    const current = generation;
    const loads = agentIds.map((id) => {
      const request = (listRequests.get(id) ?? 0) + 1;
      listRequests.set(id, request);
      return props.source.list(id, serverId).then((snapshot) => {
        if (current !== generation || listRequests.get(id) !== request) return;
        setSnapshot(snapshot);
      });
    });
    void Promise.allSettled(loads).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed && current === generation) toastError(failed.reason, "conversation.tasks.error.load");
    });
  }

  function readTask(task: AgentTask): void {
    const serverId = props.serverId;
    const current = generation;
    const request = (readRequests.get(task.id) ?? 0) + 1;
    readRequests.set(task.id, request);
    props.source.read({ agentId: task.agentId, taskId: task.id }, serverId).then(
      (snapshot) => {
        if (current === generation && readRequests.get(task.id) === request) applyConversation(task.id, snapshot);
      },
      (error) => {
        if (current === generation && readRequests.get(task.id) === request)
          toastError(error, "conversation.tasks.error.read");
      },
    );
  }

  /**
   * Adds a task that a start returned, so it shows before the list event arrives. A list read that started
   * before the task does not have it, so its answer no longer counts.
   */
  function rememberTask(task: AgentTask): void {
    listRequests.set(task.agentId, (listRequests.get(task.agentId) ?? 0) + 1);
    setState((draft) => {
      const snapshot = draft.snapshots[task.agentId];
      if (!snapshot) draft.snapshots[task.agentId] = { agentId: task.agentId, tasks: [task], limit: 1 };
      else if (!snapshot.tasks.some((entry) => entry.id === task.id)) snapshot.tasks.unshift(task);
    });
  }

  /**
   * Starts the waiting task now. The page shows the real task when the host returns it; a failure
   * puts the text back in an empty composer.
   */
  async function commit(): Promise<AgentTask | null> {
    const start = pending;
    if (!start) return null;
    pending = null;
    clearTimeout(start.timer);
    const current = generation;
    try {
      const task = await props.source.start(
        {
          agentId: start.task.agentId,
          text: start.text,
          clientMessageId: start.clientMessageId,
          ...(start.attachments.length ? { attachmentDraftIds: start.attachments.map((file) => file.id) } : {}),
        },
        start.serverId,
      );
      if (current !== generation) return task;
      rememberTask(task);
      setState((draft) => {
        if (draft.pending?.id === start.task.id) draft.pending = null;
        if (draft.took?.taskId === start.task.id) draft.took = { taskId: task.id, pending: false };
        if (draft.selectedId === start.task.id) draft.selectedId = task.id;
      });
      return task;
    } catch (error) {
      if (current !== generation) {
        toastError(error, "conversation.tasks.error.start");
        discardFiles(start.attachments, start.serverId);
        return null;
      }
      const { t, errorMessage } = currentText();
      setState((draft) => {
        if (draft.pending?.id === start.task.id) draft.pending = null;
        if (draft.took?.taskId === start.task.id) draft.took = null;
        if (draft.selectedId === start.task.id) draft.selectedId = null;
        if (!draft.draft.trim()) {
          draft.draft = start.text;
          draft.agentId = start.task.agentId;
          draft.focusRequest += 1;
        }
        draft.startError = errorMessage(error, t("conversation.tasks.error.start"));
      });
      returnFiles(START_FILES, start.attachments);
      return null;
    }
  }

  /** A start leaves the page at once: a send before it, the page closing, or a server change. */
  function commitNow(): void {
    if (pending) void commit();
  }

  function start(text: string): boolean {
    // A start of images only names them, as a side thread does. A file gives its name to the title.
    if (!plainTaskTitle(expandAttachmentReferences(text)))
      text = filesOf(START_FILES)
        .map((file) => serializeAttachmentReference(file.name, file.id))
        .join(" ");
    const title = plainTaskTitle(expandAttachmentReferences(text));
    const owner = agentId();
    if (!title || !owner) return false;
    commitNow();
    const clientMessageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const task: AgentTask = {
      id: `pending:${clientMessageId}`,
      agentId: owner,
      threadId: "",
      origin: "user",
      title: title.slice(0, INPUT_LIMITS.agentTaskTitle),
      state: "queued",
      outcome: null,
      hold: null,
      activeTurnId: null,
      progress: null,
      error: null,
      queuedMessages: [],
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    pending = {
      task,
      text,
      attachments: takeFiles(START_FILES),
      clientMessageId,
      serverId: props.serverId,
      timer: setTimeout(() => void commit(), UNDO_MS),
    };
    setState((draft) => {
      draft.pending = task;
      draft.took = { taskId: task.id, pending: true };
      draft.draft = "";
      draft.startError = null;
    });
    return true;
  }

  /** Takes the waiting start back: its text and agent return to the composer. */
  function undo(): void {
    const start = pending;
    if (!start) return;
    pending = null;
    clearTimeout(start.timer);
    setState((draft) => {
      draft.pending = null;
      draft.took = null;
      if (draft.selectedId === start.task.id) draft.selectedId = null;
      draft.draft = start.text;
      draft.agentId = start.task.agentId;
      draft.focusRequest += 1;
    });
    returnFiles(START_FILES, start.attachments);
  }

  /** A waiting task opens as soon as it starts; the panel shows it as queued until then. */
  function select(taskId: string | null): void {
    setState((draft) => {
      draft.selectedId = taskId;
    });
    if (taskId && taskId === pending?.task.id) void commit();
  }

  async function runAction(action: () => Promise<unknown>, fallback: AppTextKey): Promise<boolean> {
    const current = generation;
    try {
      await action();
      return true;
    } catch (error) {
      if (current === generation) toastError(error, fallback);
      return false;
    }
  }

  /** Sends a message to a task. An archived task is restored first, as in a thread tab. */
  async function sendToTask(taskId: string, text: string): Promise<boolean> {
    const task = taskOf(taskId);
    if (!task || task.id.startsWith("pending:")) return false;
    const target = { agentId: task.agentId, taskId: task.id };
    const serverId = untrack(() => props.serverId);
    const files = untrack(() => filesOf(taskId));
    const sent = await runAction(async () => {
      if (taskOf(taskId)?.state === "closed") await props.source.reopen(target, serverId);
      await props.source.send(
        {
          ...target,
          text,
          clientMessageId: crypto.randomUUID(),
          ...(files.length ? { attachmentDraftIds: files.map((file) => file.id) } : {}),
        },
        serverId,
      );
    }, "conversation.tasks.error.send");
    if (sent) {
      const sentIds = new Set(files.map((file) => file.id));
      setState((draft) => {
        delete draft.drafts[taskId];
        // A file that came during the send stays.
        const rest = (draft.files[taskId] ?? []).filter((file) => !sentIds.has(file.id));
        if (rest.length) draft.files[taskId] = rest;
        else delete draft.files[taskId];
      });
    }
    return sent;
  }

  const voiceControls: TasksVoiceControls = {
    serverId: () => props.serverId,
    draft: () => state.draft,
    setDraft: (text) =>
      setState((draft) => {
        draft.draft = text;
      }),
    start,
    showError: (message) =>
      setState((draft) => {
        draft.startError = message;
      }),
    focus: () =>
      setState((draft) => {
        draft.focusRequest += 1;
      }),
    openTaskId: () => {
      const taskId = state.selectedId;
      return taskId && !taskId.startsWith("pending:") ? taskId : null;
    },
    appendTaskTranscript: (taskId, text) =>
      setState((draft) => {
        draft.drafts[taskId] = appendVoiceTranscript(draft.drafts[taskId] ?? "", text);
        draft.focusRequests[taskId] = (draft.focusRequests[taskId] ?? 0) + 1;
      }),
    sendTask: async (taskId) => {
      // The transcript was just appended; the send reads the draft, so apply that write first.
      flush();
      if (state.selectedId !== taskId) return;
      const text = textOf(taskId).trim();
      if (text || filesOf(taskId).length > 0) await sendToTask(taskId, text);
      // The locked message box did not take the earlier focus request.
      if (state.selectedId === taskId)
        setState((draft) => {
          draft.focusRequests[taskId] = (draft.focusRequests[taskId] ?? 0) + 1;
        });
    },
  };
  const voice = untrack(() => props.voice?.(voiceControls));
  /** The microphone of the Tasks composer. It waits while a task's message box records. */
  const composerVoice = voice && startVoice(voice);
  function startVoice(adapter: TasksVoiceAdapter): TasksVoice {
    return {
      get phase() {
        return adapter.taskId === undefined ? adapter.phase : "idle";
      },
      get blocked() {
        return adapter.taskId !== undefined && adapter.phase !== "idle";
      },
      get levels() {
        return adapter.levels;
      },
      get elapsedSeconds() {
        return adapter.elapsedSeconds;
      },
      get liveText() {
        return adapter.taskId === undefined ? adapter.liveText : "";
      },
      get modelProgress() {
        return adapter.modelProgress;
      },
      onStart: adapter.onStart,
      onCancel: adapter.onCancel,
      onFinish: adapter.onFinish,
    };
  }
  /** The microphone of a task's message box, as in a side thread of the chat. */
  function taskVoice(adapter: TasksVoiceAdapter, taskId: string): AgentThreadVoice {
    const owned = () => adapter.taskId === taskId;
    return {
      get phase() {
        return owned() ? adapter.phase : "idle";
      },
      get blocked() {
        return !owned() && adapter.phase !== "idle";
      },
      get liveText() {
        return owned() ? adapter.liveText : "";
      },
      get levels() {
        return adapter.levels;
      },
      get elapsedSeconds() {
        return adapter.elapsedSeconds;
      },
      get modelProgress() {
        return adapter.modelProgress;
      },
      onStart: () => adapter.startTask(taskId),
      onCancel: adapter.onCancel,
      onFinish: adapter.onFinish,
      onSend: adapter.sendTask,
    };
  }

  // The page stays open when the user switches the server, so the tasks clear, load and listen again.
  createEffect(
    () => props.serverId,
    (serverId) => {
      setState((draft) => {
        draft.snapshots = {};
        draft.conversations = {};
        draft.drafts = {};
        // The old server discarded the files, so the start text no longer names them.
        for (const file of draft.files[START_FILES] ?? [])
          draft.draft = removeAttachmentReferences(draft.draft, file.id);
        draft.files = {};
        draft.pending = null;
        draft.selectedId = null;
        draft.took = null;
        // Agent IDs can repeat on two servers, so the new server starts from its own saved agent.
        draft.agentId = "";
      });
      // The agents of the new server load again, also an agent ID that the old server had.
      listRequests.clear();
      readRequests.clear();
      untrack(() => loadLists(props.agents.map((agent) => agent.id)));
      // A turn can end while the host is away, so the open task reads its whole conversation again.
      const unsubscribe = props.source.onEvent(serverId, applyEvent, () => {
        loadLists(props.agents.map((agent) => agent.id));
        const task = state.selectedId ? taskOf(state.selectedId) : undefined;
        if (task && !task.id.startsWith("pending:")) readTask(task);
      });
      return () => {
        // A waiting start goes to the server it was sent on.
        commitNow();
        // The files of the message boxes are drafts on the old server, so they go.
        discardFiles(Object.values(untrack(() => state.files)).flat(), serverId);
        generation++;
        unsubscribe();
      };
    },
  );

  // A new agent loads its list; the agents that loaded keep theirs.
  createEffect(
    () => props.agents.map((agent) => agent.id),
    (ids) => {
      const missing = ids.filter((id) => !untrack(() => state.snapshots[id]) && !listRequests.has(id));
      if (missing.length > 0) untrack(() => loadLists(missing));
    },
  );

  // The opened task reads its whole conversation; events keep it current after that.
  createEffect(
    () => {
      const taskId = state.selectedId;
      return taskId && !taskId.startsWith("pending:") ? taskId : null;
    },
    (taskId) => {
      if (!taskId) return;
      untrack(() => {
        const task = taskOf(taskId);
        if (task) readTask(task);
      });
    },
  );

  onCleanup(() => {
    commitNow();
    generation++;
  });

  /** What a running task waits for from the person. The chat answers a question or a browser takeover. */
  function waitOf(task: AgentTask): AgentTaskWait {
    if (task.state !== "running") return undefined;
    if (taskApproval(task, props.approvals)) return "approval";
    return props.waitsForAnswer?.(task) ? "answer" : undefined;
  }

  function panel(taskId: string) {
    const task = () => taskOf(taskId) ?? null;
    /** The task on the host. A start that waits for its Undo time has none yet. */
    const hosted = () => {
      const current = task();
      return current && !current.id.startsWith("pending:") ? current : null;
    };
    const owner = () => agentOf(task()?.agentId ?? "");
    /** Reconciled by id, so a stream chunk redraws only the message that changed. */
    const messages = createProjection<AgentMessage[]>(
      () => {
        const conversation = state.conversations[taskId];
        // The chat answers a question that waits, so its message is left out, as in a thread tab.
        const shown = conversation?.messages.filter((message) => message.questionPrompt?.resolution !== null);
        return shown ? toAgentMessages(shown, task()?.agentId) : [];
      },
      [],
      { key: "id" },
    );
    // The page gets only the latest progress line of a running turn, so its steps are the thoughts,
    // and after the turn the tool steps of its stored trace.
    const turnSteps = createTurnSteps({
      messages: () => messages,
      lines: () => undefined,
      activeTurnId: () => hosted()?.activeTurnId,
    });
    const input = () => {
      const current = hosted();
      return current ? { agentId: current.agentId, taskId: current.id } : null;
    };
    const approval = () => {
      const current = hosted();
      return current ? taskApproval(current, props.approvals) : undefined;
    };
    const wait = () => {
      const current = hosted();
      return current ? waitOf(current) : undefined;
    };
    /** An archived task is restored first: the chat does not show an archived thread as a tab. */
    const openInChat = async () => {
      const current = hosted();
      if (!current) return;
      const target = { agentId: current.agentId, taskId: current.id };
      if (
        current.state === "closed" &&
        !(await runAction(() => props.source.reopen(target, props.serverId), "conversation.threads.error.restore"))
      )
        return;
      props.onOpenInChat?.(current);
    };
    const chatAction = () => (props.onOpenInChat ? () => void openInChat() : undefined);
    /** A question or a browser takeover waits: the card sends the person to the chat, which answers it. */
    const answerCard = (agentName: string) => {
      if (wait() !== "answer") return undefined;
      return <TaskAnswerCard agentName={agentName} onAnswer={chatAction()} />;
    };
    // The person reads the open task while the window has focus, as in its thread tab.
    createEffect(
      () => ({ target: input(), messageId: appFocused() ? latestVisibleAgentMessageId(messages) : null }),
      ({ target, messageId }) => {
        if (target && messageId) props.onRead?.(target, messageId);
      },
    );
    const panelVoice = voice && taskVoice(voice, taskId);
    // The message box is new each time a task opens. A focus request from before is not for it.
    const shownAt = untrack(() => state.focusRequests[taskId] ?? 0);
    const focusRequest = () => {
      const request = state.focusRequests[taskId] ?? 0;
      return request > shownAt ? request : undefined;
    };
    return (
      <Show when={owner() ?? props.agents[0]}>
        {(agent) => (
          <TaskPanel
            task={hosted()}
            title={task()?.title ?? ""}
            wait={wait()}
            onArchive={() => {
              const target = input();
              if (target)
                void runAction(() => props.source.close(target, props.serverId), "conversation.threads.error.archive");
            }}
            onRestore={() => {
              const target = input();
              if (target)
                void runAction(() => props.source.reopen(target, props.serverId), "conversation.threads.error.restore");
            }}
            onOpenInChat={chatAction()}
            onClose={() => select(null)}
          >
            <AgentThreadView
              task={hosted()}
              limit={state.snapshots[task()?.agentId ?? ""]?.limit ?? 1}
              agent={agent()}
              agents={props.agents}
              messages={messages}
              draft={state.drafts[taskId] ?? ""}
              draftAttachments={filesOf(taskId)}
              rowAttachments={rowFilesOf(taskId)}
              pendingImages={pendingImagesOf(taskId)}
              onRemoveAttachment={filesAccepted() ? (attachment) => removeFile(taskId, attachment) : undefined}
              onPasteFiles={
                filesAccepted() ? (files, selection, text) => pasteFiles(taskId, files, selection, text) : undefined
              }
              onDraftChange={(text) =>
                setState((draft) => {
                  draft.drafts[taskId] = text;
                })
              }
              onSend={(text) => sendToTask(taskId, text)}
              voice={hosted() ? panelVoice : undefined}
              focusRequest={focusRequest()}
              onStop={() => {
                const target = input();
                if (target)
                  void runAction(() => props.source.stop(target, props.serverId), "conversation.tasks.error.stop");
              }}
              onOpenLink={props.onOpenLink}
              onPreview={(attachment) => props.onAttachmentAction(attachment, "open")}
              onAttachmentAction={props.onAttachmentAction}
              mediaSource={props.mediaSource}
              downloads={props.downloads}
              approval={approval()}
              onRespondApproval={async (decision) => {
                const current = approval();
                return current ? props.onRespondApproval(current, decision) : false;
              }}
              waitsForAnswer={wait() === "answer"}
              attention={answerCard(agent().name)}
              stepsAbove={turnSteps.stepsAbove}
              factsAbove={turnSteps.factsAbove}
              activeSteps={turnSteps.activeSteps()}
              stepsOpenByDefault={showAgentSteps()}
              sendShortcut={props.sendShortcut}
            />
          </TaskPanel>
        )}
      </Show>
    );
  }

  const took = () => {
    const current = state.took;
    const task = current ? taskOf(current.taskId) : undefined;
    return current && task ? { task, pending: current.pending } : null;
  };

  return (
    <TasksPage
      hostName={props.hostName}
      onBack={props.onBack}
      agentsOpen={props.agentsOpen}
      onToggleAgents={props.onToggleAgents}
      agents={props.agents}
      tasks={tasks()}
      // A list that did not load keeps its agent out, so a failed load does not show the empty page.
      // With no agents yet, the agent list did not load.
      loaded={props.agents.length > 0 && props.agents.every((agent) => state.snapshots[agent.id] !== undefined)}
      agentId={agentId()}
      onAgentChange={(id) => {
        writeAgentSelection(TASK_AGENT_STORAGE_KEY, props.serverId, id);
        setState((draft) => {
          draft.agentId = id;
        });
      }}
      draft={state.draft}
      onDraftChange={voiceControls.setDraft}
      files={filesOf(START_FILES)}
      rowFiles={rowFilesOf(START_FILES)}
      pendingImages={pendingImagesOf(START_FILES)}
      onRemoveFile={(attachment) => removeFile(START_FILES, attachment)}
      onPasteFiles={
        filesAccepted() ? (files, selection, text) => pasteFiles(START_FILES, files, selection, text) : undefined
      }
      focusRequest={state.focusRequest}
      startError={state.startError}
      onDismissStartError={() =>
        setState((draft) => {
          draft.startError = null;
        })
      }
      onStart={() => {
        if (voice && composerVoice?.phase === "recording") voice.submit();
        else start(state.draft);
      }}
      voice={composerVoice}
      took={took()}
      onTookAgentChange={(id) => {
        if (!pending) return;
        pending.task = { ...pending.task, agentId: id };
        writeAgentSelection(TASK_AGENT_STORAGE_KEY, props.serverId, id);
        setState((draft) => {
          if (draft.pending) draft.pending.agentId = id;
          draft.agentId = id;
        });
      }}
      onUndo={undo}
      onOpenTook={() => {
        const current = state.took;
        if (current) select(current.taskId);
      }}
      onDismissTook={() =>
        setState((draft) => {
          draft.took = null;
        })
      }
      selectedId={state.selectedId}
      waitOf={waitOf}
      sendShortcut={props.sendShortcut}
      macWindowControls={appInfo()?.platform === "darwin"}
      onSelect={select}
      panel={panel}
      sideWidth={state.sideWidth}
      onSideResize={(width) =>
        setState((draft) => {
          draft.sideWidth = width;
        })
      }
      onSideResizeEnd={(width) => savePanelWidth(TASK_PANEL_WIDTH_STORAGE_KEY, width)}
    />
  );
}
