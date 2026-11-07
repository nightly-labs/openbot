import { limitedQuoteText } from "@openbot/contracts/chat-tag-references";
import type {
  AgentApproval,
  AgentTask,
  AgentTaskHold,
  AttachmentSummary,
  DraftAttachment,
  InstalledSkill,
  QueueDelivery,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { isAgentTaskActive } from "@openbot/team-client/agent-tasks";
import { Button } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import type {
  AgentMessage,
  AgentProfile,
  ComposerBrowserTab,
  ComposerMcpServer,
  ComposerThread,
} from "@openbot/ui/data";
import { AgentActivityIndicator, nextAgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import {
  type AgentStep,
  AgentStepsDisclosure,
  type AgentStepsFacts,
} from "@openbot/ui/features/conversation/AgentSteps";
import type { AttachmentDownloads, AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import { agentActivityExitDuration } from "@openbot/ui/features/conversation/activity-timing";
import { branchPointIds } from "@openbot/ui/features/conversation/branch-points";
import { type ChatMessageAuthor, ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ComposerAddMenu } from "@openbot/ui/features/conversation/ComposerAddMenu";
import {
  ComposerAttachmentRow,
  type ComposerPendingImage,
} from "@openbot/ui/features/conversation/ComposerAttachmentRow";
import {
  ComposerEditor,
  type ComposerPasteResult,
  type ComposerSelection,
  type QuoteRequest,
} from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import { ComposerReplyPreview } from "@openbot/ui/features/conversation/ComposerReplyPreview";
import { ComposerSendControl } from "@openbot/ui/features/conversation/ComposerSendControl";
import { ContextUsageMeter, type ContextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import {
  DeleteMessageDialog,
  MessageActions,
  MessageMenu,
  MessageMenuItems,
  type MessageMenuItemsProps,
} from "@openbot/ui/features/conversation/MessageRendering";
import { QueuePanel } from "@openbot/ui/features/conversation/QueuePanel";
import {
  MessageSelectionActions,
  type QuoteShortcutModifier,
} from "@openbot/ui/features/conversation/SelectionActions";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import { ComposerVoiceControls, type VoicePhase } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { type TextValue, useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { children, createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { type AgentThreadBranchSource, BranchDivider } from "./BranchDivider";

const HOLD_TEXT = {
  "agent-restarting": "conversation.threads.hold.agentRestarting",
  "usage-limit": "conversation.threads.hold.usageLimit",
  "server-busy": "conversation.threads.hold.serverBusy",
  "agent-busy": "conversation.threads.hold.agentBusy",
  "one-turn": "conversation.threads.hold.oneTurn",
} as const satisfies Record<Exclude<AgentTaskHold, "task-limit">, AppTextKey>;

/** The list stays at its end while new text comes in, when the user has not scrolled up. */
const STICK_DISTANCE = 48;

/**
 * Whether the thread shows this message as a row. A stopped turn can leave an agent message with no
 * text and nothing else in it. The thinking and the memory changes of a turn show in its steps.
 */
function shownInThread(message: AgentMessage): boolean {
  if (message.kind === "thinking" || message.kind === "memory-changes") return false;
  return (
    message.author === "you" ||
    message.streaming === true ||
    message.body.trim().length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    message.imageGeneration !== undefined ||
    message.questionPrompt !== undefined ||
    message.plan !== undefined ||
    message.actionMarker !== undefined
  );
}

/** Why the next message of a queued thread waits. */
export function agentThreadHoldText(task: AgentTask, limit: number, t: TextValue["t"]): string | null {
  if (task.state !== "queued") return null;
  if (task.hold === "task-limit" || task.hold === null)
    return t("conversation.threads.hold.threadLimit", { count: limit });
  return t(HOLD_TEXT[task.hold]);
}

/** Dictation into the thread's message box, as in the agent's own chat. */
export interface AgentThreadVoice {
  /** The phase of this thread's recording; "idle" when it has none. */
  phase: VoicePhase;
  /** Another message box records, so this one cannot start. */
  blocked: boolean;
  /** What was said so far. */
  liveText: string;
  levels: readonly number[];
  elapsedSeconds: number;
  /** The download progress of the speech model, in percent, while it is prepared. */
  modelProgress: number | null;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  /** Stops the recording and sends the message with its text. */
  onSend: () => void;
}

/** A thread's messages before the loaded ones, which it reads page by page. */
export interface AgentThreadOlderMessages {
  /** A page read is in progress. */
  loading: boolean;
  onLoad: () => void;
}

/** The queue of a thread, with the actions of the queue in the agent's own chat. */
export interface AgentThreadQueue {
  /** The messages that wait to start in the thread, in queue order. */
  deliveries: QueueDelivery[];
  /** The queued message that the message box edits now, or null. */
  editingDeliveryId: string | null;
  /** A save or a cancel of the edit is in progress. */
  editBusy: boolean;
  /** Steers a queued message into the running turn. Missing where the provider cannot steer. */
  onSteer?: ((deliveryId: string) => void) | undefined;
  onCancel: (deliveryId: string) => void;
  /** Puts a queued message in the message box. Send saves it in its place. */
  onEdit: (delivery: QueueDelivery) => void;
  onCancelEdit: () => void;
  onReorder: (deliveryIds: string[]) => void;
}

export interface AgentThreadViewProps {
  /** Null for a new thread: its first message starts it. */
  task: AgentTask | null;
  /** How many threads of the agent can run at the same time. */
  limit: number;
  agent: AgentProfile;
  agents: AgentProfile[];
  messages: readonly AgentMessage[];
  /** The agent's skills, for the `$` picker and the skill tags in messages. */
  skills?: InstalledSkill[] | undefined;
  /** The last skill list request failed, so an empty picker says so instead of "no skills". */
  skillsLoadFailed?: boolean | undefined;
  /** The host's MCP servers, offered by the same `$` the skills answer. */
  mcpServers?: ComposerMcpServer[] | undefined;
  /** The agent's browser tabs, for the `@` picker. */
  browserTabs?: ComposerBrowserTab[] | undefined;
  /** The agent's side threads, newest first, for the `@` picker. The view leaves out its own thread. */
  threads?: ComposerThread[] | undefined;
  /** Shows the browser tab, or opens the thread by its task id, that a tag names. */
  onOpenTag?: ((kind: "tab" | "thread", id: string) => void) | undefined;
  /** The unsent text of this thread's message box. The host keeps it for each thread. */
  draft: string;
  /** The files that the draft names. */
  draftAttachments?: DraftAttachment[] | undefined;
  /** The images of the draft that show in the thumbnail row. A send takes them with the text. */
  rowAttachments?: readonly DraftAttachment[] | undefined;
  /** The pasted images that still import, with their local previews. */
  pendingImages?: readonly ComposerPendingImage[] | undefined;
  onRemoveAttachment?: ((attachment: DraftAttachment) => void) | undefined;
  /** Loads the images of a client that gets no `previewUrl`. */
  mediaSource?: AttachmentMediaSource | undefined;
  /** The download state of attachments from a joined server. */
  downloads?: AttachmentDownloads | undefined;
  onDraftChange: (text: string) => void;
  /** Receives pasted files and long text pastes, as `ComposerEditor` says. Without it, a file paste does nothing here. */
  onPasteFiles?:
    | ((
        files: File[],
        selection: ComposerSelection,
        text?: string,
      ) => undefined | Promise<ComposerPasteResult | undefined>)
    | undefined;
  onOpenDraftAttachment?: ((attachment: DraftAttachment) => void) | undefined;
  /** Opens the file picker. Without it, the "+" menu has no image or context item. */
  onAttachFiles?: (() => void) | undefined;
  /** Opens the agent's side question with the draft. Without it, the "+" menu has no side question. */
  onSideQuestion?: (() => void) | undefined;
  /** Without it, the message box has no microphone. */
  voice?: AgentThreadVoice | undefined;
  /** Each increase moves the caret to the end of the text, as after a dictation. */
  focusRequest?: number | undefined;
  /** Sends a message. The host clears the text when the message went; when it did not, the text stays. */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  /** The window draws the macOS window controls over the top start corner. The image viewer leaves room. */
  macWindowControls?: boolean | undefined;
  /** The approval that the thread's running turn waits for. */
  approval?: AgentApproval | undefined;
  onRespondApproval: (decision: "accept" | "decline") => Promise<boolean>;
  /** How full the thread's context is, when its provider reported it. */
  context?: ContextUsageView | undefined;
  /** Compacts the thread's context now. Missing when the host cannot. */
  onCompactContext?: (() => Promise<void>) | undefined;
  /** Whether the thread's running turn waits for the person: a question or a browser takeover. */
  waitsForAnswer?: boolean | undefined;
  /** Another card that the thread shows, such as a question or a browser takeover. The app builds it. */
  attention?: JSX.Element | undefined;
  /**
   * The thread has messages before the loaded ones. Missing when it has none, when it is not known yet,
   * or when the server cannot read them.
   */
  olderMessages?: AgentThreadOlderMessages | undefined;
  /** The card that the app draws in the place of a message row, such as an MCP sign-in. Undefined keeps the row. */
  messageCard?: ((message: AgentMessage) => JSX.Element | undefined) | undefined;
  /**
   * The steps of the finished turn above an answer, or on the thinking row of a finished turn with no
   * answer. Undefined for a message that has none.
   */
  stepsAbove?: ((messageId: string) => AgentStep[] | undefined) | undefined;
  /** The time that the turn of an answer took, and how many of its steps failed. */
  factsAbove?: ((messageId: string) => AgentStepsFacts | undefined) | undefined;
  /** The steps of the running turn, for its activity row. */
  activeSteps?: readonly AgentStep[] | undefined;
  /** The "Show agent steps" setting: the steps are open at first. */
  stepsOpenByDefault?: boolean | undefined;
  /** Receives the message list, where the app searches the thread. */
  scrollRef?: ((element: HTMLElement) => void) | undefined;
  /** Whether a long message draws in full, with no fold: the app searches the drawn text of the thread. */
  showFullMessage?: ((message: AgentMessage) => boolean) | undefined;
  /** The user's send shortcut. Enter when absent. */
  sendShortcut?: SendShortcut | undefined;
  /** Copies a message. Without it, the messages have no action row and no right-click menu. */
  onCopyMessage?: ((message: AgentMessage) => void) | undefined;
  /** The message that the copy action copied a moment ago. The full action row shows it. */
  copiedMessageId?: string | null | undefined;
  /**
   * True (the default) shows Reply and a More button in the action row. False shows Reply, Copy and
   * Branch in the row, as before.
   */
  compactMessageActions?: boolean | undefined;
  /**
   * Copies the thread through an answer into a new thread. Only the last answer of each finished turn
   * offers it. Missing where the host cannot branch.
   */
  onBranch?: ((messageId: string) => void) | undefined;
  /**
   * Deletes a message of the thread, after the reader confirms. Missing where the host cannot delete
   * messages. `canDeleteMessage` says which messages offer it.
   */
  onDeleteMessage?: ((messageId: string) => Promise<void>) | undefined;
  /** Whether the reader can delete a message. Without it, every message that is not streaming can. */
  canDeleteMessage?: ((message: AgentMessage) => boolean) | undefined;
  /** Where the thread came from, when it is a branch. A line shows after the copied messages. */
  branchSource?: AgentThreadBranchSource | undefined;
  /** Makes the draft a reply to a message of the thread. Missing where the host cannot take a reply in a thread. */
  onReply?: ((message: AgentMessage) => void) | undefined;
  /** The message that the draft replies to. It shows above the message box. */
  replyTo?: AgentMessage | undefined;
  /** Removes the reply from the draft. */
  onCancelReply?: (() => void) | undefined;
  /** A message to scroll to and mark once, when it shows. Each new request has a new nonce. */
  focusMessage?: { messageId: string; nonce: number } | undefined;
  /**
   * The queue of the thread, as the agent's own chat shows its queue. Without it the thread lists the
   * start of each queued message: a joined server sends no more on `agent-tasks-v1`.
   */
  queue?: AgentThreadQueue | undefined;
  /**
   * The actions for text selected in the thread. Quote puts the text in this message box, and a send
   * goes to this thread. Without it, selected text has no actions.
   */
  selectionActions?: AgentThreadSelectionActions | undefined;
}

export interface AgentThreadSelectionActions {
  /** Sends the instruction about a selected passage of a message to this thread. */
  onSend: (messageId: string, body: string) => Promise<boolean>;
  quoteShortcut: QuoteShortcutModifier;
}

/**
 * A side thread of an agent, in the place of its chat: the messages, why the thread waits, and a
 * message box. While a turn runs, a message waits in the thread, or steers the turn as the
 * busy-message mode says.
 */
export function AgentThreadView(props: AgentThreadViewProps) {
  const { t } = useText();
  // Resolved once, so the card is built one time for the check and the row.
  const attention = children(() => props.attention);
  const [sending, setSending] = createSignal(false);
  const [addMenuOpen, setAddMenuOpen] = createSignal(false);
  const [skillPickerRequest, setSkillPickerRequest] = createSignal(0);
  const [selectionScope, setSelectionScope] = createSignal<HTMLElement>();
  const [quoteRequest, setQuoteRequest] = createSignal<QuoteRequest>();
  const quoteSelection = (messageId: string, text: string) =>
    // A passage past the message limit would make the editor drop it with the text after it.
    setQuoteRequest((current) => ({ id: (current?.id ?? 0) + 1, messageId, text: limitedQuoteText(text) }));
  /* A thread does not tag itself. */
  const otherThreads = createMemo(() => props.threads?.filter((thread) => thread.id !== props.task?.id));
  let scroller: HTMLElement | undefined;
  let atEnd = true;
  /**
   * The place of the reader when they asked for older messages: the first message then, and where its
   * row was. The page goes in above, and the view keeps that row in its place.
   */
  let olderAnchor: { firstId: string | undefined; row: Element; top: number } | undefined;
  function loadOlder(older: AgentThreadOlderMessages): void {
    const row = scroller?.querySelector(".virtual-chat-row");
    if (row) olderAnchor = { firstId: props.messages[0]?.id, row, top: row.getBoundingClientRect().top };
    older.onLoad();
  }
  // A read that ends with no new messages leaves no place to keep.
  createEffect(
    () => props.olderMessages?.loading === true,
    (loading) => {
      if (!loading && olderAnchor && untrack(() => props.messages[0]?.id) === olderAnchor.firstId)
        olderAnchor = undefined;
    },
  );
  let shownTaskId = untrack(() => props.task?.id);
  const activityLabel = nextAgentActivityLabel();
  const fades = createScrollFades();
  // The view stays when another thread opens in its place, so each thread opens at its latest message.
  // The effect can run again with the same thread, which must not move the reader.
  createEffect(
    () => props.task?.id,
    (taskId) => {
      if (taskId === shownTaskId) return;
      shownTaskId = taskId;
      atEnd = true;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    },
  );
  onSettled(() => {
    const element = scroller;
    const list = element?.firstElementChild;
    if (!element || !list) return fades.stop;
    let lastTop = element.scrollTop;
    let lastHeight = element.scrollHeight;
    // The scroll event of the view's own follow can come after more text, far from the new end (#5002).
    // That follow moves the view down, so only a move up, with no shorter content, stops the follow.
    const onScroll = () => {
      const { scrollTop, scrollHeight } = element;
      if (scrollHeight - scrollTop - element.clientHeight < STICK_DISTANCE) atEnd = true;
      else if (scrollTop < lastTop && scrollHeight >= lastHeight) atEnd = false;
      lastTop = scrollTop;
      lastHeight = scrollHeight;
    };
    const follow = new ResizeObserver(() => {
      const anchor = olderAnchor;
      if (anchor && untrack(() => props.messages[0]?.id) !== anchor.firstId) {
        olderAnchor = undefined;
        element.scrollTop += anchor.row.getBoundingClientRect().top - anchor.top;
        return;
      }
      if (atEnd) element.scrollTop = element.scrollHeight;
    });
    follow.observe(list);
    element.scrollTop = element.scrollHeight;
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      follow.disconnect();
      element.removeEventListener("scroll", onScroll);
      fades.stop();
    };
  });
  /** Scrolls to the row of a message and marks it, as a click on a quote does. False when the row does not show. */
  function showMessage(messageId: string): boolean {
    const message = scroller?.querySelector<HTMLElement>(`[data-chat-search-message="${CSS.escape(messageId)}"]`);
    const row = message?.closest<HTMLElement>(".virtual-chat-row");
    if (!row) return false;
    atEnd = false;
    row.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    // The row lights up, then fades.
    delete row.dataset.replyFlash;
    void row.offsetWidth;
    row.dataset.replyFlash = "";
    const end = (event: AnimationEvent) => {
      if (event.target !== row || event.animationName !== "reply-flash") return;
      row.removeEventListener("animationend", end);
      delete row.dataset.replyFlash;
    };
    row.addEventListener("animationend", end);
    return true;
  }
  let focusedNonce: number | undefined;
  // The thread scrolls to a message once, when its row shows, for example its source after "Branched from".
  createEffect(
    () => ({ focus: props.focusMessage, count: props.messages.length, taskId: props.task?.id }),
    ({ focus }) => {
      if (!focus || focus.nonce === focusedNonce) return;
      if (showMessage(focus.messageId)) focusedNonce = focus.nonce;
    },
  );
  const messagesById = createMemo(() => new Map(props.messages.map((message) => [message.id, message])));
  /** The message that a reply quotes, when the thread has it. */
  const referenced = (message: AgentMessage) => {
    const id = message.replyToMessageId;
    return id ? messagesById().get(id) : undefined;
  };
  /** Each Reply moves the caret to the message box, as in the agent's own chat. */
  const [replyFocus, setReplyFocus] = createSignal(0);
  const replyAction = (message: AgentMessage) => {
    const onReply = props.onReply;
    if (!onReply) return undefined;
    return () => {
      onReply(message);
      setReplyFocus((current) => current + 1);
    };
  };
  const active = () => (props.task ? isAgentTaskActive(props.task) : false);
  /** The answers that end a finished turn: each offers a branch. */
  const branchPoints = createMemo(() => branchPointIds(props.messages, props.task?.activeTurnId));
  /** A turn runs, so a branch waits: the backend copies only a thread that does not run. */
  const branchBusy = () => props.task?.activeTurnId != null;
  const branchAction = (message: AgentMessage) => {
    const onBranch = props.onBranch;
    if (!onBranch || !branchPoints().has(message.id)) return undefined;
    return () => onBranch(message.id);
  };
  /** The message that the delete dialog asks about. */
  const [deleteTargetId, setDeleteTargetId] = createSignal<string | null>(null);
  const deleteAction = (message: AgentMessage) => {
    if (!props.onDeleteMessage || message.streaming) return undefined;
    if (props.canDeleteMessage && !props.canDeleteMessage(message)) return undefined;
    return () => setDeleteTargetId(message.id);
  };
  const deleteMessage = (messageId: string) => props.onDeleteMessage?.(messageId) ?? Promise.resolve();
  const title = () => props.task?.title ?? t("conversation.threads.new");
  const placeholder = () =>
    props.task
      ? t("conversation.threads.view.placeholder", { name: props.agent.name, title: props.task.title })
      : t("conversation.threads.view.newPlaceholder", { name: props.agent.name });
  const voicePhase = () => props.voice?.phase ?? "idle";
  const recording = () => voicePhase() === "recording";
  /** As in the agent's own chat, nothing sends while the microphone opens or the speech becomes text. */
  const voiceBusy = () => voicePhase() !== "idle" && !recording();
  const send = async () => {
    // As in the agent's own chat, a send while recording sends what was said.
    if (recording()) {
      props.voice?.onSend();
      return;
    }
    const text = props.draft.trim();
    if (draftEmpty() || sending() || voiceBusy()) return;
    setSending(true);
    try {
      await props.onSend(text);
    } finally {
      setSending(false);
    }
  };
  // An answer from another agent to a request of this thread shows with the name of that agent.
  const author = (message: AgentMessage): ChatMessageAuthor => {
    if (message.author === "you") return { kind: "you", name: t("chat.message.you") };
    const senderId = message.senderAgentId;
    if (senderId === undefined || senderId === props.agent.id)
      return { kind: "agent", name: props.agent.name, agent: props.agent };
    const sender = props.agents.find((candidate) => candidate.id === senderId);
    return {
      kind: "agent",
      name: sender?.name ?? t("chat.message.agentFallback"),
      agent: sender,
      avatarSeed: senderId,
    };
  };
  /** The items of a message's menu: Reply, Copy, Branch on the last answer of a finished turn, and Delete. */
  function menuItems(message: AgentMessage, onCopy: (message: AgentMessage) => void): MessageMenuItemsProps {
    return {
      message,
      reactions: false,
      onReact: () => undefined,
      onReply: replyAction(message),
      onCopy: () => onCopy(message),
      onBranch: branchAction(message),
      branchDisabled: branchBusy(),
      onDelete: deleteAction(message),
    };
  }
  /**
   * The action row of a message. The compact row has Reply, and More with the items of the right-click
   * menu. The full row has Reply, Copy, and Branch on the last answer of a finished turn.
   */
  function messageActions(message: AgentMessage): JSX.Element | undefined {
    const onCopy = props.onCopyMessage;
    if (!onCopy || message.streaming) return undefined;
    return (
      <Show
        when={props.compactMessageActions !== false}
        fallback={
          <MessageActions
            message={message}
            authorName={author(message).name}
            reactions={false}
            pickerOpen={false}
            expandedEmoji={false}
            copied={props.copiedMessageId === message.id}
            onTogglePicker={() => undefined}
            onExpandEmoji={() => undefined}
            onReact={() => undefined}
            onReply={replyAction(message)}
            onCopy={() => onCopy(message)}
            onBranch={branchAction(message)}
            branchDisabled={branchBusy()}
          />
        }
      >
        <MessageActions
          message={message}
          authorName={author(message).name}
          reactions={false}
          pickerOpen={false}
          expandedEmoji={false}
          onTogglePicker={() => undefined}
          onExpandEmoji={() => undefined}
          onReact={() => undefined}
          onReply={replyAction(message)}
          menu={() => <MessageMenuItems {...menuItems(message, onCopy)} />}
        />
      </Show>
    );
  }
  /** The right-click menu of a message, with the items of its More button. */
  function messageMenu(message: AgentMessage): (() => JSX.Element) | undefined {
    const onCopy = props.onCopyMessage;
    if (!onCopy || message.streaming) return undefined;
    return () => <MessageMenu {...menuItems(message, onCopy)} authorName={author(message).name} />;
  }
  /** A finished turn with no answer shows its steps on its thinking row, with no message under them. */
  const shownRow = (message: AgentMessage) =>
    shownInThread(message) || (message.kind === "thinking" && props.stepsAbove?.(message.id) !== undefined);
  /**
   * The row that the branch line follows: the last message that the branch copied. That message can be
   * one that the thread does not show as a row, such as a thought in the steps of a turn. Then the line
   * follows the last shown message from before the branch was made: the copies keep their times.
   */
  const branchDividerId = createMemo(() => {
    const source = props.branchSource;
    if (!source) return undefined;
    const shown = props.messages.filter(shownRow);
    if (shown.some((message) => message.id === source.throughMessageId)) return source.throughMessageId;
    const branchedAt = props.task ? Date.parse(props.task.createdAt) : Number.NaN;
    if (Number.isNaN(branchedAt)) return undefined;
    return shown.findLast((message) => message.createdAt !== undefined && Date.parse(message.createdAt) < branchedAt)
      ?.id;
  });
  function branchDividerAfter(messageId: string): AgentThreadBranchSource | undefined {
    return branchDividerId() === messageId ? props.branchSource : undefined;
  }
  const failed = () => (props.task?.state === "idle" && props.task.outcome === "failed" ? props.task : undefined);
  const running = () =>
    props.task?.state === "running" && !props.approval && !props.waitsForAnswer ? props.task : undefined;
  const queued = () => (props.task && props.task.queuedMessages.length > 0 ? props.task : undefined);
  const hold = () => (props.task ? agentThreadHoldText(props.task, props.limit, t) : null);
  const editingQueued = () => Boolean(props.queue?.editingDeliveryId);
  const sendLabel = () =>
    t(recording() ? "composer.send.voice" : editingQueued() ? "composer.send.saveQueued" : "composer.send.message");
  /*
   * The rows that the queue panel shows. When the last message goes, the slot closes at once and keeps
   * these rows, so the whole panel goes down behind the input in one move, as in the agent's own chat.
   * Another thread does not get the rows of the one before.
   */
  const [queueRows, setQueueRows] = createSignal<{ taskId: string | undefined; deliveries: QueueDelivery[] }>({
    taskId: undefined,
    deliveries: [],
  });
  let queueExitTimer: number | undefined;
  createEffect(
    () => ({ taskId: props.task?.id, deliveries: props.queue?.deliveries ?? [] }),
    (next) => {
      const shown = untrack(queueRows);
      if (next.deliveries.length > 0 || next.taskId !== shown.taskId) {
        if (queueExitTimer !== undefined) window.clearTimeout(queueExitTimer);
        queueExitTimer = undefined;
        // Each change of the thread sends its queue again. A row that did not change keeps its object,
        // so the panel does not draw it again and the pointer and the focus stay on it.
        const previous = new Map(shown.deliveries.map((delivery) => [delivery.id, delivery]));
        const deliveries = next.deliveries.map((delivery) => {
          const known = previous.get(delivery.id);
          return known && JSON.stringify(known) === JSON.stringify(delivery) ? known : delivery;
        });
        setQueueRows({ taskId: next.taskId, deliveries });
        return;
      }
      // Each change of the thread sends the empty queue again. The panel closes at the end of its
      // first exit, not after the thread is quiet.
      if (shown.deliveries.length === 0 || queueExitTimer !== undefined) return;
      queueExitTimer = window.setTimeout(() => {
        queueExitTimer = undefined;
        setQueueRows(next);
      }, agentActivityExitDuration());
    },
  );
  onCleanup(() => {
    if (queueExitTimer !== undefined) window.clearTimeout(queueExitTimer);
  });
  const queuePanelOwner = () => (queueRows().deliveries.length > 0 ? queueRows().taskId : undefined);
  const queueOpen = () => (props.queue?.deliveries.length ?? 0) > 0 && queueRows().taskId === props.task?.id;
  const hasRow = () =>
    Boolean(props.onRemoveAttachment) &&
    ((props.rowAttachments?.length ?? 0) > 0 || (props.pendingImages?.length ?? 0) > 0);
  const draftEmpty = () => props.draft.trim().length === 0 && (props.rowAttachments?.length ?? 0) === 0;
  /** As in the agent's own chat: Send, Send what was said while a recording runs, or Stop while the thread works. */
  const sendButton = () => (
    <ComposerSendControl
      stop={active() && draftEmpty() && !recording()}
      onStop={() => props.onStop()}
      label={sendLabel()}
      disabled={sending() || voiceBusy() || (!recording() && draftEmpty())}
      busy={sending()}
    />
  );
  return (
    <>
      <Show when={props.selectionActions}>
        {(actions) => (
          <MessageSelectionActions
            scope={selectionScope()}
            contextKey={props.task?.id}
            // As the message box: a quote waits in a locked box, and could go to the next thread.
            disabled={!props.task || sending() || voicePhase() === "transcribing"}
            onSend={(messageId, body) => actions().onSend(messageId, body)}
            onQuote={quoteSelection}
            quoteShortcut={actions().quoteShortcut}
          />
        )}
      </Show>
      <section
        ref={(element: HTMLElement) => {
          scroller = element;
          setSelectionScope(element);
          fades.bind(element);
          props.scrollRef?.(element);
        }}
        class={["conversation-scroll agent-thread-scroll", fades.classes()]}
        data-selection-scope=""
        aria-label={t("conversation.threads.view.label", { title: title() })}
        onScroll={fades.measure}
      >
        <div class="virtual-chat-list virtual-chat-list-static" ref={fades.watch}>
          <Show when={props.olderMessages}>
            {(older) => (
              <div class="conversation-history-status">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={older().loading}
                  onClick={() => loadOlder(older())}
                >
                  {older().loading ? t("chat.history.loadingOlder") : t("conversation.threads.view.loadOlder")}
                </Button>
              </div>
            )}
          </Show>
          {/* The start of the thread shows once its first message is loaded. */}
          <Show when={props.task?.origin === "agent" && !props.olderMessages}>
            <p class="agent-thread-origin">
              {t("conversation.threads.view.startedByAgent", { name: props.agent.name })}
            </p>
          </Show>
          <For each={props.messages.filter(shownRow)} keyed={(message) => message.id}>
            {(message) => {
              const card = createMemo(() => props.messageCard?.(message()));
              return (
                <div class="virtual-chat-row">
                  <Show when={props.stepsAbove?.(message().id)}>
                    {(steps) => (
                      <AgentStepsDisclosure
                        steps={steps()}
                        defaultOpen={props.stepsOpenByDefault ?? false}
                        facts={props.factsAbove?.(message().id)}
                      />
                    )}
                  </Show>
                  <Show when={message().kind !== "thinking"}>
                    <Show
                      when={card()}
                      fallback={
                        <ChatMessageRow
                          message={message()}
                          author={author(message())}
                          showFull={props.showFullMessage?.(message())}
                          agents={props.agents}
                          skills={props.skills}
                          onSelectAgent={() => undefined}
                          onOpenTag={props.onOpenTag}
                          onOpenLink={props.onOpenLink}
                          onPreview={props.onPreview}
                          onAttachmentAction={props.onAttachmentAction}
                          mediaSource={props.mediaSource}
                          downloads={props.downloads}
                          onDownload={(attachment) => props.onAttachmentAction(attachment, "download")}
                          macWindowControls={props.macWindowControls}
                          referencedMessage={referenced(message())}
                          onOpenReference={() => {
                            const id = message().replyToMessageId;
                            if (id) showMessage(id);
                          }}
                          actions={messageActions(message())}
                          menu={messageMenu(message())}
                          data-chat-search-message={message().id}
                        />
                      }
                    >
                      {card()}
                    </Show>
                  </Show>
                  <Show when={branchDividerAfter(message().id)}>{(source) => <BranchDivider source={source()} />}</Show>
                </div>
              );
            }}
          </For>
          <Show when={running()}>
            {(task) => (
              <div class="virtual-chat-row">
                <AgentActivityIndicator
                  agent={props.agent}
                  label={activityLabel}
                  detail={task().progress}
                  steps={props.activeSteps}
                  stepsOpenByDefault={props.stepsOpenByDefault}
                />
              </div>
            )}
          </Show>
          <Show keyed when={props.approval}>
            {(approval) => (
              <div class="virtual-chat-row">
                <ApprovalCard
                  approval={approval}
                  agentName={props.agent.name}
                  onApprove={() => props.onRespondApproval("accept")}
                  onReject={() => props.onRespondApproval("decline")}
                />
              </div>
            )}
          </Show>
          <Show when={attention.toArray().length > 0}>
            <div class="virtual-chat-row">{attention()}</div>
          </Show>
          <Show when={hold()}>
            {(text) => (
              <div class="virtual-chat-row">
                <p class="agent-queue-hold" role="status">
                  {text()}
                </p>
              </div>
            )}
          </Show>
          <Show when={!props.queue && queued()}>
            {(task) => (
              <section class="agent-thread-queued" aria-label={t("conversation.threads.view.queued")}>
                <For each={task().queuedMessages} keyed={(message) => message.deliveryId}>
                  {(message) => <p class="agent-thread-queued-text">{message().text}</p>}
                </For>
              </section>
            )}
          </Show>
        </div>
      </section>
      <div class="composer-wrap">
        <Show when={failed()}>
          {(task) => (
            <ComposerNotice
              tone="danger"
              title={t("conversation.threads.view.failed")}
              body={task().error || t("conversation.threads.view.failedBody")}
            />
          )}
        </Show>
        <Show when={props.replyTo}>
          {(message) => (
            <ComposerReplyPreview
              message={message()}
              agents={props.agents}
              skills={props.skills}
              disabled={sending() || voicePhase() === "transcribing"}
              onCancel={() => props.onCancelReply?.()}
            />
          )}
        </Show>
        <Show when={props.queue}>
          {(queue) => (
            <div class="composer-stack">
              <div
                class="agent-queue-slot"
                data-open={queueOpen() ? "true" : "false"}
                aria-hidden={queueOpen() ? undefined : "true"}
                inert={queueOpen() ? undefined : true}
              >
                <div class="agent-queue-slot-inner">
                  {/* Each thread gets its own panel, so its rows do not animate in from the thread before. */}
                  <Show when={queuePanelOwner()} keyed>
                    {(_taskId) => (
                      <QueuePanel
                        deliveries={queueRows().deliveries}
                        agents={props.agents}
                        skills={props.skills}
                        editingDeliveryId={queue().editingDeliveryId}
                        canSteer={Boolean(props.task?.activeTurnId)}
                        onSteer={queue().onSteer}
                        onCancel={(deliveryId) => queue().onCancel(deliveryId)}
                        onEdit={(delivery) => queue().onEdit(delivery)}
                        onReorder={(deliveryIds) => queue().onReorder(deliveryIds)}
                      />
                    )}
                  </Show>
                </div>
              </div>
              <Show when={queue().editingDeliveryId}>
                <ComposerNotice
                  body={t("composer.queueEdit.body")}
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={queue().editBusy}
                      onClick={() => queue().onCancelEdit()}
                    >
                      {t("composer.queueEdit.cancel")}
                    </Button>
                  }
                />
              </Show>
            </div>
          )}
        </Show>
        <form
          class="composer agent-thread-composer"
          data-compact={hasRow() ? undefined : "true"}
          data-has-attachments={hasRow() ? "" : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Show when={props.onRemoveAttachment}>
            {(remove) => (
              <ComposerAttachmentRow
                attachments={props.rowAttachments ?? []}
                pending={props.pendingImages}
                removeDisabled={sending() || voicePhase() === "transcribing"}
                onRemove={(attachment) => remove()(attachment)}
              />
            )}
          </Show>
          <div class="composer-input-label">
            <ComposerEditor
              agentId={props.agent.id}
              agents={props.agents}
              skills={props.skills}
              skillsLoadFailed={props.skillsLoadFailed}
              mcpServers={props.mcpServers}
              browserTabs={props.browserTabs}
              threads={otherThreads()}
              onOpenTag={props.onOpenTag}
              attachments={props.draftAttachments}
              value={props.draft}
              placeholder={props.replyTo ? t("composer.placeholder.reply") : placeholder()}
              ariaLabel={placeholder()}
              focusRequest={(props.focusRequest ?? 0) + replyFocus()}
              quoteRequest={quoteRequest()}
              skillPickerRequest={skillPickerRequest()}
              dictation={{ text: props.voice?.liveText ?? "", final: voicePhase() === "transcribing" }}
              disabled={sending() || voicePhase() === "transcribing"}
              sendShortcut={props.sendShortcut}
              onSubmit={() => void send()}
              onValueChange={props.onDraftChange}
              onPasteFiles={props.onPasteFiles}
              onOpenAttachment={props.onOpenDraftAttachment}
            />
          </div>
          <div class="composer-toolbar">
            <ComposerAddMenu
              open={addMenuOpen()}
              onOpenChange={setAddMenuOpen}
              disabled={sending() || voicePhase() === "transcribing"}
              onAttach={props.onAttachFiles}
              onPickSkill={() => setSkillPickerRequest((current) => current + 1)}
              onSideQuestion={props.onSideQuestion}
            />
            <div class="composer-primary-actions">
              {/* One meter for each thread: a pending Compact or an open popover stays with its thread. */}
              <Show when={props.task?.id} keyed>
                {(_taskId) => (
                  <Show when={props.context}>
                    {(usage) => <ContextUsageMeter usage={usage()} compact={props.onCompactContext} />}
                  </Show>
                )}
              </Show>
              <Show when={props.voice} fallback={sendButton()}>
                {(voice) => (
                  <ComposerVoiceControls
                    phase={voice().phase}
                    levels={voice().levels}
                    elapsedSeconds={voice().elapsedSeconds}
                    modelProgress={voice().modelProgress}
                    blocked={voice().blocked || sending()}
                    onStart={() => voice().onStart()}
                    onCancel={() => voice().onCancel()}
                    onFinish={() => voice().onFinish()}
                    send={sendButton()}
                  />
                )}
              </Show>
            </div>
          </div>
        </form>
      </div>
      <DeleteMessageDialog
        messageId={deleteTargetId()}
        onDelete={deleteMessage}
        onClose={() => setDeleteTargetId(null)}
      />
    </>
  );
}
