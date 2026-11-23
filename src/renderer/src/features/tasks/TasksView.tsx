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
  ResponseStyle,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { plainTaskTitle, taskApproval } from "@openbot/team-client/agent-tasks";
import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
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
import { useChatBubbleStyle } from "../../chat-bubble-style-preference";
import { readPanelWidth, savePanelWidth } from "../../components/panel-width-storage";
import { usePlatform } from "../../platform";
import { appendVoiceTranscript } from "../../voice-recording";
import { readAgentSelection, writeAgentSelection } from "../agents/agent-selection";
import { insertAtSelection, insertPastedText, rowAttachments } from "../conversation/composer-draft";
import { latestVisibleAgentMessageId } from "../conversation/conversation-read-state";
import { naturalThreadRows } from "../conversation/narration-rows";
import { importPastedFiles, type PastePreview, pastePreviewTracker } from "../conversation/stores/composer-actions";
import { createTurnSteps } from "../conversation/turn-steps";
import { createTurnStreamHold } from "../conversation/turn-stream-hold";
import { useTurnTrace } from "../conversation/turn-trace";
import { createPageHeaderFrame } from "../window/page-header-frame";
import type { TaskEvent, TasksSource } from "./tasks-port";

const UNDO_MS = 6_000;
const TASK_AGENT_STORAGE_KEY = "openbot:task-agent:v1";
const TASK_PANEL_WIDTH_STORAGE_KEY = "openbot:task-panel-width";

export interface TasksVoiceControls {
  serverId: () => string;
  draft: () => string;
  setDraft: (text: string) => void;
  start: (text: string) => boolean;
  showError: (message: string) => void;
  focus: () => void;
  openTaskId: () => string | null;
  appendTaskTranscript: (taskId: string, text: string) => void;
  sendTask: (taskId: string) => Promise<void>;
}

export interface TaskFiles {
  accepted: () => boolean;
  import: (data: AttachmentDataInput[], serverId: string) => Promise<DraftAttachment[]>;
  discard: (id: string, serverId: string) => Promise<void>;
}

export type TasksVoiceAdapter = TasksVoice & {
  submit: () => void;
  taskId: string | undefined;
  startTask: (taskId: string) => void;
  sendTask: () => void;
};

interface TasksViewProps {
  serverId: string;
  hostName: string;
  failureText?: ((error: string) => string) | undefined;
  onBack?: (() => void) | undefined;
  source: TasksSource;
  agents: AgentProfile[];
  voice?: ((controls: TasksVoiceControls) => TasksVoiceAdapter) | undefined;
  onOpenLink: (url: string) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  files?: TaskFiles | undefined;
  mediaSource?: AttachmentMediaSource | undefined;
  downloads?: AttachmentDownloads | undefined;
  approvals: readonly AgentApproval[];
  onRespondApproval: (approval: AgentApproval, decision: "accept" | "decline") => Promise<boolean>;
  onRead?: ((input: AgentTaskInput, messageId: string) => void) | undefined;
  waitsForAnswer?: ((task: AgentTask) => boolean) | undefined;
  onOpenInChat?: ((task: AgentTask) => void) | undefined;
  sendShortcut?: SendShortcut | undefined;
  responseStyle?: ResponseStyle | undefined;
}

interface PendingStart {
  task: AgentTask;
  text: string;
  attachments: DraftAttachment[];
  clientMessageId: string;
  serverId: string;
  timer: ReturnType<typeof setTimeout>;
}

interface TasksViewState {
  snapshots: Record<string, AgentTasksSnapshot>;
  conversations: Record<string, ConversationSnapshot>;
  drafts: Record<string, string>;
  files: Record<string, DraftAttachment[]>;
  pending: AgentTask | null;
  agentId: string;
  draft: string;
  focusRequest: number;
  startError: string | null;
  took: { taskId: string; pending: boolean } | null;
  selectedId: string | null;
  sideWidth: number;
  focusRequests: Record<string, number>;
}

const START_FILES = "start";

const sendIds = retryOperationIds(() => crypto.randomUUID());

function toastError(error: unknown, fallback: AppTextKey): void {
  const { t, errorMessage } = currentText();
  actionToast.error(errorMessage(error, t(fallback)));
}

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
  const bubbleStyle = useChatBubbleStyle();
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

  const textOf = (key: string) => (key === START_FILES ? state.draft : (state.drafts[key] ?? ""));
  function setText(key: string, text: string): void {
    setState((draft) => {
      if (key === START_FILES) draft.draft = text;
      else draft.drafts[key] = text;
    });
  }
  const rowFilesOf = (key: string) => rowAttachments(textOf(key), filesOf(key));

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

  function takeFiles(key: string): DraftAttachment[] {
    const taken = filesOf(key);
    if (taken.length)
      setState((draft) => {
        delete draft.files[key];
      });
    return taken;
  }

  function returnFiles(key: string, attachments: readonly DraftAttachment[]): void {
    if (!attachments.length) return;
    setState((draft) => {
      draft.files[key] = [...attachments, ...(draft.files[key] ?? [])];
    });
  }

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

  function rememberTask(task: AgentTask): void {
    listRequests.set(task.agentId, (listRequests.get(task.agentId) ?? 0) + 1);
    setState((draft) => {
      const snapshot = draft.snapshots[task.agentId];
      if (!snapshot) draft.snapshots[task.agentId] = { agentId: task.agentId, tasks: [task], limit: 1 };
      else if (!snapshot.tasks.some((entry) => entry.id === task.id)) snapshot.tasks.unshift(task);
    });
  }

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

  function commitNow(): void {
    if (pending) void commit();
  }

  function start(text: string): boolean {
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

  async function sendToTask(taskId: string, text: string): Promise<boolean> {
    const task = taskOf(taskId);
    if (!task || task.id.startsWith("pending:")) return false;
    const target = { agentId: task.agentId, taskId: task.id };
    const serverId = untrack(() => props.serverId);
    const files = untrack(() => filesOf(taskId));
    const message = sendIds([serverId, taskId, text, files.map((file) => file.id)]);
    const sent = await runAction(async () => {
      if (taskOf(taskId)?.state === "closed") await props.source.reopen(target, serverId);
      await props.source.send(
        {
          ...target,
          text,
          clientMessageId: message.id,
          ...(files.length ? { attachmentDraftIds: files.map((file) => file.id) } : {}),
        },
        serverId,
      );
    }, "conversation.tasks.error.send");
    if (!sent) message.failed();
    if (sent) {
      const sentIds = new Set(files.map((file) => file.id));
      setState((draft) => {
        delete draft.drafts[taskId];
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
      flush();
      if (state.selectedId !== taskId) return;
      const text = textOf(taskId).trim();
      if (text || filesOf(taskId).length > 0) await sendToTask(taskId, text);
      if (state.selectedId === taskId)
        setState((draft) => {
          draft.focusRequests[taskId] = (draft.focusRequests[taskId] ?? 0) + 1;
        });
    },
  };
  const voice = untrack(() => props.voice?.(voiceControls));
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

  createEffect(
    () => props.serverId,
    (serverId) => {
      setState((draft) => {
        draft.snapshots = {};
        draft.conversations = {};
        draft.drafts = {};
        for (const file of draft.files[START_FILES] ?? [])
          draft.draft = removeAttachmentReferences(draft.draft, file.id);
        draft.files = {};
        draft.pending = null;
        draft.selectedId = null;
        draft.took = null;
        draft.agentId = "";
      });
      listRequests.clear();
      readRequests.clear();
      untrack(() => loadLists(props.agents.map((agent) => agent.id)));
      const unsubscribe = props.source.onEvent(serverId, applyEvent, () => {
        loadLists(props.agents.map((agent) => agent.id));
        const task = state.selectedId ? taskOf(state.selectedId) : undefined;
        if (task && !task.id.startsWith("pending:")) readTask(task);
      });
      return () => {
        commitNow();
        discardFiles(Object.values(untrack(() => state.files)).flat(), serverId);
        generation++;
        unsubscribe();
      };
    },
  );

  createEffect(
    () => props.agents.map((agent) => agent.id),
    (ids) => {
      const missing = ids.filter((id) => !untrack(() => state.snapshots[id]) && !listRequests.has(id));
      if (missing.length > 0) untrack(() => loadLists(missing));
    },
  );

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

  function waitOf(task: AgentTask): AgentTaskWait {
    if (task.state !== "running") return undefined;
    if (taskApproval(task, props.approvals)) return "approval";
    return props.waitsForAnswer?.(task) ? "answer" : undefined;
  }

  function panel(taskId: string) {
    const task = () => taskOf(taskId) ?? null;
    const hosted = () => {
      const current = task();
      return current && !current.id.startsWith("pending:") ? current : null;
    };
    const owner = () => agentOf(task()?.agentId ?? "");
    const messages = createProjection<AgentMessage[]>(
      () => {
        const conversation = state.conversations[taskId];
        const shown = conversation?.messages.filter((message) => message.questionPrompt?.resolution !== null);
        return shown ? toAgentMessages(shown, task()?.agentId) : [];
      },
      [],
      { key: "id" },
    );
    const streamHeld = createTurnStreamHold(() => hosted()?.activeTurnId);
    const shownMessages = createMemo(() =>
      props.responseStyle === "natural"
        ? naturalThreadRows(messages, (owner() ?? props.agents[0])?.provider, streamHeld)
        : messages,
    );
    const turnSteps = createTurnSteps({
      messages: () => messages,
      lines: () => undefined,
      activeTurnId: () => hosted()?.activeTurnId,
    });
    const turnTrace = useTurnTrace({
      turnSteps,
      agentName: () => (owner() ?? props.agents[0])?.name,
      agents: () => props.agents,
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
    const answerCard = (agentName: string) => {
      if (wait() !== "answer") return undefined;
      return <TaskAnswerCard agentName={agentName} onAnswer={chatAction()} />;
    };
    createEffect(
      () => ({ target: input(), messageId: appFocused() ? latestVisibleAgentMessageId(messages) : null }),
      ({ target, messageId }) => {
        if (target && messageId) props.onRead?.(target, messageId);
      },
    );
    const panelVoice = voice && taskVoice(voice, taskId);
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
              bubbleStyle={bubbleStyle()}
              responseStyle={props.responseStyle}
              agents={props.agents}
              messages={shownMessages()}
              draft={state.drafts[taskId] ?? ""}
              draftAttachments={filesOf(taskId)}
              rowAttachments={rowFilesOf(taskId)}
              failureText={props.failureText}
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
              traceAbove={turnTrace}
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

  const headerFrame = createPageHeaderFrame();
  return (
    <TasksPage
      hostName={props.hostName}
      onBack={props.onBack}
      frame={headerFrame()}
      agents={props.agents}
      tasks={tasks()}
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
