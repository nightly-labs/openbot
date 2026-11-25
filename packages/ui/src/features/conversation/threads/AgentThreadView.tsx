import { limitedQuoteText } from "@openbot/contracts/chat-tag-references";
import type {
  AgentApproval,
  AgentTask,
  AgentTaskHold,
  AttachmentSummary,
  DraftAttachment,
  InstalledSkill,
  QueueDelivery,
  ResponseStyle,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { isAgentTaskActive } from "@openbot/team-client/agent-tasks";
import { Button, CopyButton, toast } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { ScrollEdgeBlur } from "@openbot/ui/components/ScrollEdgeBlur";
import type {
  AgentMessage,
  AgentProfile,
  ChatActionMarkerModel,
  ComposerBrowserTab,
  ComposerMcpServer,
  ComposerThread,
} from "@openbot/ui/data";
import {
  AgentActivityIndicator,
  type AgentActivityLabel,
  nextAgentActivityLabel,
} from "@openbot/ui/features/conversation/AgentActivity";
import {
  type AgentStep,
  AgentStepsDisclosure,
  type AgentStepsFacts,
  type AgentStepsTrace,
} from "@openbot/ui/features/conversation/AgentSteps";
import {
  AttachmentCards,
  type AttachmentDownloads,
  type AttachmentMediaSource,
} from "@openbot/ui/features/conversation/AttachmentCards";
import { AwaitingReplies, type AwaitingReplyItem } from "@openbot/ui/features/conversation/AwaitingReplies";
import { agentActivityExitDuration } from "@openbot/ui/features/conversation/activity-timing";
import { branchPointIds } from "@openbot/ui/features/conversation/branch-points";
import { type ChangeMarkerActions, ChatActionMarker } from "@openbot/ui/features/conversation/ChatActionMarker";
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
import { ComposerStackCard } from "@openbot/ui/features/conversation/ComposerStackCard";
import { ContextUsageMeter, type ContextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { dayMarkerLabel } from "@openbot/ui/features/conversation/chat-day-markers";
import { CHAT_TIME_GAP_MS, continuesSenderRun } from "@openbot/ui/features/conversation/chat-grouping";
import type { ImageCopies } from "@openbot/ui/features/conversation/ImageLightbox";
import type { MediaApprovalControls } from "@openbot/ui/features/conversation/MediaApprovalCard";
import {
  preferredMessageScrollBehavior,
  ScrollToLatestButton,
} from "@openbot/ui/features/conversation/MessageNavigation";
import {
  DeleteMessageDialog,
  MessageActions,
  MessageMenu,
  MessageMenuItems,
  type MessageMenuItemsProps,
} from "@openbot/ui/features/conversation/MessageRendering";
import { type ChatBubbleStyle, ownMessageAuthor } from "@openbot/ui/features/conversation/own-bubble";
import { QueuePanel } from "@openbot/ui/features/conversation/QueuePanel";
import {
  MessageSelectionActions,
  type QuoteShortcutModifier,
} from "@openbot/ui/features/conversation/SelectionActions";
import { SubagentGroup } from "@openbot/ui/features/conversation/Subagents";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import { ComposerVoiceControls, type VoicePhase } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { type TextValue, useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import {
  children,
  createEffect,
  createMemo,
  createSignal,
  createStore,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { createComposerRowsResize } from "../createComposerRowsResize";
import { type AgentThreadBranchSource, BranchDivider } from "./BranchDivider";
import { MAIN_THREAD_ID } from "./thread-types";

const HOLD_TEXT = {
  "agent-restarting": "conversation.threads.hold.agentRestarting",
  "usage-limit": "conversation.threads.hold.usageLimit",
  "server-busy": "conversation.threads.hold.serverBusy",
  "agent-busy": "conversation.threads.hold.agentBusy",
  "one-turn": "conversation.threads.hold.oneTurn",
  "sign-in": "conversation.threads.hold.signIn",
} as const satisfies Record<Exclude<AgentTaskHold, "task-limit">, AppTextKey>;

const STICK_DISTANCE = 48;

const MARKER_ROW_KINDS: ReadonlySet<ChatActionMarkerModel["kind"]> = new Set([
  "skill-lifecycle",
  "instructions-change",
  "plan-continuation",
  "no-answer",
  "model-switch",
  "channel-change",
  "vault-change",
  "context-reset",
  "sign-in-failure",
  "routine-run",
]);
const NEAR_SCROLL_VIEWS = 2;
const OLDER_PRELOAD_VIEWS = 1;

function shownInThread(message: AgentMessage): boolean {
  if (message.kind === "thinking" || message.kind === "memory-changes") return false;
  return (
    message.author === "you" ||
    message.streaming === true ||
    message.body.trim().length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    message.imageGeneration !== undefined ||
    message.videoGeneration !== undefined ||
    message.questionPrompt !== undefined ||
    message.plan !== undefined ||
    message.actionMarker !== undefined
  );
}

export function agentThreadHoldText(task: AgentTask, limit: number, t: TextValue["t"]): string | null {
  if (task.state !== "queued" || task.hold === null) return null;
  if (task.hold === "task-limit") return t("conversation.threads.hold.threadLimit", { count: limit });
  return t(HOLD_TEXT[task.hold]);
}

export interface AgentThreadVoice {
  phase: VoicePhase;
  blocked: boolean;
  liveText: string;
  levels: readonly number[];
  elapsedSeconds: number;
  modelProgress: number | null;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  onSend: () => void;
}

export interface AgentThreadOlderMessages {
  loading: boolean;
  onLoad: () => void;
}

export interface AgentThreadQueue {
  deliveries: QueueDelivery[];
  editingDeliveryId: string | null;
  editBusy: boolean;
  onSteer?: ((deliveryId: string) => void) | undefined;
  onCancel: (deliveryId: string) => void;
  onEdit: (delivery: QueueDelivery) => void;
  onCancelEdit: () => void;
  onReorder: (deliveryIds: string[]) => void;
}

export interface AgentThreadViewProps {
  task: AgentTask | null;
  limit: number;
  agent: AgentProfile;
  agents: AgentProfile[];
  messages: readonly AgentMessage[];
  skills?: InstalledSkill[] | undefined;
  skillsLoadFailed?: boolean | undefined;
  mcpServers?: ComposerMcpServer[] | undefined;
  browserTabs?: ComposerBrowserTab[] | undefined;
  threads?: ComposerThread[] | undefined;
  onOpenTag?: ((kind: "tab" | "thread", id: string) => void) | undefined;
  draft: string;
  draftAttachments?: DraftAttachment[] | undefined;
  rowAttachments?: readonly DraftAttachment[] | undefined;
  pendingImages?: readonly ComposerPendingImage[] | undefined;
  onRemoveAttachment?: ((attachment: DraftAttachment) => void) | undefined;
  mediaSource?: AttachmentMediaSource | undefined;
  imageCopies?: ImageCopies | undefined;
  downloads?: AttachmentDownloads | undefined;
  onDraftChange: (text: string) => void;
  onPasteFiles?:
    | ((
        files: File[],
        selection: ComposerSelection,
        text?: string,
      ) => undefined | Promise<ComposerPasteResult | undefined>)
    | undefined;
  onOpenDraftAttachment?: ((attachment: DraftAttachment) => void) | undefined;
  onAttachFiles?: (() => void) | undefined;
  onSideQuestion?: (() => void) | undefined;
  voice?: AgentThreadVoice | undefined;
  focusRequest?: number | undefined;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onOpenLink: (url: string) => void;
  onOpenFile?:
    | ((kind: "shared" | "workspace", agentId: string | undefined, path: string, asWritten?: string) => void)
    | undefined;
  onSelectAgent?: ((agentId: string, tabId?: string) => void) | undefined;
  changeMarkerActions?: ChangeMarkerActions | undefined;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  macWindowControls?: boolean | undefined;
  approval?: AgentApproval | undefined;
  onRespondApproval: (decision: "accept" | "decline") => Promise<boolean>;
  media?: MediaApprovalControls | undefined;
  approvalCard?: ((approval: AgentApproval) => JSX.Element | undefined) | undefined;
  context?: ContextUsageView | undefined;
  onCompactContext?: (() => Promise<void>) | undefined;
  waitsForAnswer?: boolean | undefined;
  attention?: JSX.Element | undefined;
  olderMessages?: AgentThreadOlderMessages | undefined;
  newerMessages?: AgentThreadOlderMessages | undefined;
  messageCard?:
    | ((message: AgentMessage, quote: (messageId: string, text: string) => void) => JSX.Element | undefined)
    | undefined;
  stepsAbove?: ((messageId: string) => AgentStep[] | undefined) | undefined;
  factsAbove?: ((messageId: string) => AgentStepsFacts | undefined) | undefined;
  traceAbove?: ((messageId: string) => AgentStepsTrace) | undefined;
  activeSteps?: readonly AgentStep[] | undefined;
  backgroundWorkSince?: number | undefined;
  stepsOpenByDefault?: boolean | undefined;
  scrollRef?: ((element: HTMLElement) => void) | undefined;
  showFullMessage?: ((message: AgentMessage) => boolean) | undefined;
  sendShortcut?: SendShortcut | undefined;
  onCopyMessage?: ((message: AgentMessage) => void) | undefined;
  copiedMessageId?: string | null | undefined;
  compactMessageActions?: boolean | undefined;
  bubbleStyle?: ChatBubbleStyle | undefined;
  responseStyle?: ResponseStyle | undefined;
  onBranch?: ((messageId: string) => void) | undefined;
  onDeleteMessage?: ((messageId: string) => Promise<void>) | undefined;
  canDeleteMessage?: ((message: AgentMessage) => boolean) | undefined;
  backdropAction?: ((message: AgentMessage) => (() => void) | undefined) | undefined;
  branchSource?: AgentThreadBranchSource | undefined;
  onReply?: ((message: AgentMessage) => void) | undefined;
  replyTo?: AgentMessage | undefined;
  onCancelReply?: (() => void) | undefined;
  focusMessage?: { messageId: string; nonce: number } | undefined;
  messagePins?:
    | { isPinned: (messageId: string) => boolean; onToggle: (messageId: string, pinned: boolean) => void }
    | undefined;
  queue?: AgentThreadQueue | undefined;
  awaiting?: readonly AwaitingReplyItem[] | undefined;
  onOpenWaitingAgent?: ((agentId: string) => void) | undefined;
  selectionActions?: AgentThreadSelectionActions | undefined;
  failureText?: ((error: string) => string) | undefined;
  subagents?: AgentThreadSubagents | undefined;
}

export interface AgentThreadSubagents {
  selectedId: string | null;
  onOpen: (subagentId: string) => void;
}

export interface AgentThreadSelectionActions {
  onSend: (messageId: string, body: string) => Promise<boolean>;
  quoteShortcut: QuoteShortcutModifier;
}

export function AgentThreadView(props: AgentThreadViewProps) {
  const { t, format, errorMessage } = useText();
  const attention = children(() => props.attention);
  const [sending, setSending] = createSignal(false);
  const [addMenuOpen, setAddMenuOpen] = createSignal(false);
  const [skillPickerRequest, setSkillPickerRequest] = createSignal(0);
  const [selectionScope, setSelectionScope] = createSignal<HTMLElement>();
  const [quoteRequest, setQuoteRequest] = createSignal<QuoteRequest>();
  const quoteSelection = (messageId: string, text: string) =>
    setQuoteRequest((current) => ({ id: (current?.id ?? 0) + 1, messageId, text: limitedQuoteText(text) }));
  const otherThreads = createMemo(() => props.threads?.filter((thread) => thread.id !== props.task?.id));
  let scroller: HTMLElement | undefined;
  let messageList: HTMLDivElement | undefined;
  let atEnd = true;
  let olderAnchor: { firstId: string | undefined; content: HTMLElement; top: number } | undefined;
  let autoLoadedFirstId: string | undefined | null = null;
  function firstVisibleRow(element: HTMLElement): HTMLElement | undefined {
    const viewTop = element.getBoundingClientRect().top;
    const rows = element.querySelectorAll<HTMLElement>(".virtual-chat-row");
    for (const row of rows) if (row.getBoundingClientRect().bottom > viewTop) return row;
    return rows[0];
  }
  function contentTop(content: HTMLElement, element: HTMLElement): number {
    return content.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
  }
  function loadOlder(older: AgentThreadOlderMessages): void {
    const row = scroller && firstVisibleRow(scroller);
    const content = row?.lastElementChild instanceof HTMLElement ? row.lastElementChild : row;
    if (scroller && content)
      olderAnchor = { firstId: props.messages[0]?.id, content, top: contentTop(content, scroller) };
    older.onLoad();
  }
  function loadOlderNearTop(element: HTMLElement): void {
    const older = untrack(() => props.olderMessages);
    if (!older || older.loading) return;
    if (element.scrollTop > element.clientHeight * OLDER_PRELOAD_VIEWS) {
      autoLoadedFirstId = null;
      return;
    }
    const firstId = untrack(() => props.messages[0]?.id);
    if (firstId === autoLoadedFirstId) return;
    autoLoadedFirstId = firstId;
    loadOlder(older);
  }
  createEffect(
    () => props.olderMessages?.loading === true,
    (loading) => {
      if (!loading && olderAnchor && untrack(() => props.messages[0]?.id) === olderAnchor.firstId)
        olderAnchor = undefined;
    },
  );
  createEffect(
    () => props.newerMessages?.loading === true,
    (loading) => {
      if (loading) atEnd = true;
    },
  );
  function loadLatest(newer: AgentThreadOlderMessages): void {
    atEnd = true;
    newer.onLoad();
  }
  let shownTaskId = untrack(() => props.task?.id);
  const rotatingActivityLabel = nextAgentActivityLabel();
  const plainActivity = () => props.responseStyle === "natural";
  const activityLabel = (): AgentActivityLabel => (plainActivity() ? "Thinking it through…" : rotatingActivityLabel);
  const fades = createScrollFades();
  createEffect(
    () => props.task?.id,
    (taskId) => {
      if (taskId === shownTaskId) return;
      shownTaskId = taskId;
      atEnd = true;
      olderAnchor = undefined;
      autoLoadedFirstId = null;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    },
  );
  onSettled(() => {
    const element = scroller;
    const list = messageList;
    if (!element || !list) return fades.stop;
    let lastTop = element.scrollTop;
    let lastHeight = element.scrollHeight;
    const onScroll = () => {
      const { scrollTop, scrollHeight } = element;
      if (scrollHeight - scrollTop - element.clientHeight < STICK_DISTANCE) atEnd = true;
      else if (scrollTop < lastTop && scrollHeight >= lastHeight) atEnd = false;
      lastTop = scrollTop;
      lastHeight = scrollHeight;
      loadOlderNearTop(element);
    };
    const follow = new ResizeObserver(() => {
      const anchor = olderAnchor;
      if (anchor && untrack(() => props.messages[0]?.id) !== anchor.firstId) {
        olderAnchor = undefined;
        if (anchor.content.isConnected) element.scrollTop += contentTop(anchor.content, element) - anchor.top;
      } else if (atEnd) element.scrollTop = element.scrollHeight;
      loadOlderNearTop(element);
    });
    follow.observe(list);
    if (atEnd) element.scrollTop = element.scrollHeight;
    loadOlderNearTop(element);
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      follow.disconnect();
      element.removeEventListener("scroll", onScroll);
      fades.stop();
    };
  });
  function showMessage(messageId: string): boolean {
    const message = scroller?.querySelector<HTMLElement>(`[data-chat-search-message="${CSS.escape(messageId)}"]`);
    const row = message?.closest<HTMLElement>(".virtual-chat-row");
    if (!row || !scroller) return false;
    atEnd = false;
    const view = scroller.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    const distance = Math.abs(bounds.top + bounds.height / 2 - (view.top + view.height / 2));
    const behavior = distance <= view.height * NEAR_SCROLL_VIEWS ? preferredMessageScrollBehavior() : "auto";
    row.scrollIntoView({ behavior, block: "center", inline: "nearest" });
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
  createEffect(
    () => ({
      focus: props.focusMessage,
      count: props.messages.length,
      first: props.messages[0]?.id,
      last: props.messages.at(-1)?.id,
      taskId: props.task?.id,
    }),
    ({ focus }) => {
      if (!focus || focus.nonce === focusedNonce) return;
      if (showMessage(focus.messageId)) focusedNonce = focus.nonce;
    },
  );
  const messagesById = createMemo(() => new Map(props.messages.map((message) => [message.id, message])));
  const referenced = (message: AgentMessage) => {
    const id = message.replyToMessageId;
    return id ? messagesById().get(id) : undefined;
  };
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
  const branchPoints = createMemo(() => branchPointIds(props.messages, props.task?.activeTurnId));
  const branchBusy = () => props.task?.activeTurnId != null;
  const branchAction = (message: AgentMessage) => {
    const onBranch = props.onBranch;
    if (!onBranch || !branchPoints().has(message.id)) return undefined;
    return () => onBranch(message.id);
  };
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
      ? // The tab already names the thread, and a title can be a whole message.
        t("conversation.threads.view.placeholder", { name: props.agent.name })
      : t("conversation.threads.view.newPlaceholder", { name: props.agent.name });
  const voicePhase = () => props.voice?.phase ?? "idle";
  const recording = () => voicePhase() === "recording";
  const voiceBusy = () => voicePhase() !== "idle" && !recording();
  const send = async () => {
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
  const author = (message: AgentMessage): ChatMessageAuthor => {
    if (message.author === "you")
      return ownMessageAuthor({
        name: t("chat.message.you"),
        style: props.bubbleStyle ?? "classic",
        agent: props.agent,
        chatColor: undefined,
      });
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
  const [openAgentMessages, setOpenAgentMessages] = createSignal<ReadonlySet<string>>(new Set());
  const toggleAgentMessage = (messageId: string) =>
    setOpenAgentMessages((open) => {
      const next = new Set(open);
      if (!next.delete(messageId)) next.add(messageId);
      return next;
    });
  const agentMessageMarker = (message: AgentMessage) => {
    const marker = message.actionMarker;
    if (marker?.kind !== "agent-message" || !props.onSelectAgent) return undefined;
    if (message.body.trim() === "") return marker;
    return { ...marker, expanded: openAgentMessages().has(marker.messageId) };
  };
  const changeMarker = (message: AgentMessage) => {
    const marker = message.actionMarker;
    return marker && MARKER_ROW_KINDS.has(marker.kind) ? marker : undefined;
  };
  const sharedFileOpener = (agentId: string | undefined) => {
    const open = props.onOpenFile;
    return open ? (path: string, asWritten?: string) => open("shared", agentId, path, asWritten) : undefined;
  };
  const workspaceFileOpener = (agentId: string | undefined) => {
    const open = props.onOpenFile;
    return open && agentId
      ? (path: string, asWritten?: string) => open("workspace", agentId, path, asWritten)
      : undefined;
  };
  const agentMessageText = (messageId: string) => {
    const message = () => props.messages.find((candidate) => candidate.exchange?.messageId === messageId);
    return (
      <Show when={message()}>
        {(current) => (
          <ChatMessageRow
            message={{
              id: current().id,
              author: "agent",
              body: current().body,
              time: current().time,
              ...(current().createdAt === undefined ? {} : { createdAt: current().createdAt }),
              kind: "text",
            }}
            author={author(current())}
            showAuthor
            showTime
            agents={props.agents}
            skills={props.skills}
            onSelectAgent={(agentId) =>
              agentId === current().exchange?.senderAgentId
                ? props.onSelectAgent?.(agentId, current().exchange?.senderTaskId ?? MAIN_THREAD_ID)
                : props.onSelectAgent?.(agentId)
            }
            onOpenTag={props.onOpenTag}
            onOpenLink={props.onOpenLink}
            onPreview={props.onPreview}
            onAttachmentAction={props.onAttachmentAction}
            onOpenSharedFile={sharedFileOpener(current().exchange?.senderAgentId)}
            onOpenWorkspaceFile={workspaceFileOpener(current().exchange?.senderAgentId)}
            macWindowControls={props.macWindowControls}
          />
        )}
      </Show>
    );
  };
  function pinAction(message: AgentMessage) {
    const pins = props.messagePins;
    if (!pins || message.streaming) return undefined;
    const pinned = pins.isPinned(message.id);
    return { pinned, onToggle: () => pins.onToggle(message.id, !pinned) };
  }
  function menuItems(message: AgentMessage, onCopy: (message: AgentMessage) => void): MessageMenuItemsProps {
    return {
      message,
      reactions: false,
      onReact: () => undefined,
      onReply: replyAction(message),
      onCopy: () => onCopy(message),
      onBranch: branchAction(message),
      branchDisabled: branchBusy(),
      pin: pinAction(message),
      onUseAsBackdrop: props.backdropAction?.(message),
      onDelete: deleteAction(message),
    };
  }
  function messageActions(message: AgentMessage): JSX.Element | undefined {
    const onCopy = props.onCopyMessage;
    if (!onCopy || message.streaming || message.itemType === "commentary") return undefined;
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
  function messageMenu(message: AgentMessage): (() => JSX.Element) | undefined {
    const onCopy = props.onCopyMessage;
    if (!onCopy || message.streaming || message.itemType === "commentary") return undefined;
    return () => <MessageMenu {...menuItems(message, onCopy)} authorName={author(message).name} />;
  }
  const shownRow = (message: AgentMessage) =>
    shownInThread(message) || (message.kind === "thinking" && props.stepsAbove?.(message.id) !== undefined);
  const shownRows = createMemo(() => props.messages.filter(shownRow));
  const turnOutputShown = (turnId: string | null) =>
    turnId !== null &&
    shownRows().some(
      (message) => message.turnId === turnId && message.author === "agent" && message.kind !== "thinking",
    );
  const holdsSenderRun = (message: AgentMessage) =>
    message.kind !== "thinking" &&
    message.kind !== "plan" &&
    message.kind !== "subagents" &&
    message.kind !== "memory-changes" &&
    message.questionPrompt === undefined &&
    !agentMessageMarker(message) &&
    !changeMarker(message);
  const senderRunRow = (message: AgentMessage) => ({
    author: message.author === "agent" ? `agent:${message.senderAgentId ?? props.agent.id}` : message.author,
    ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
    ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
  });
  const timeMarkers = createMemo(() => {
    const labels = new Map<string, string>();
    const gap = props.compactMessageActions === false ? {} : { gapMs: CHAT_TIME_GAP_MS };
    let previous: AgentMessage | undefined;
    for (const message of shownRows()) {
      const label =
        message.createdAt === undefined
          ? previous === undefined
            ? (message.time ?? t("chat.day.now"))
            : null
          : dayMarkerLabel(previous?.createdAt, message.createdAt, { t, format, ...gap });
      if (label !== null) labels.set(message.id, label);
      previous = message;
    }
    return labels;
  });
  const continuesRunIds = createMemo(() => {
    const ids = new Set<string>();
    const markers = timeMarkers();
    let previous: AgentMessage | undefined;
    for (const message of shownRows()) {
      if (
        holdsSenderRun(message) &&
        continuesSenderRun(previous && senderRunRow(previous), senderRunRow(message), {
          previousDrawsTime: previous !== undefined && holdsSenderRun(previous),
          startsDay: markers.has(message.id),
        })
      )
        ids.add(message.id);
      previous = message;
    }
    return ids;
  });
  const [runOpeners, setRunOpeners] = createStore<Record<string, "agent" | "user">>({});
  const branchDividerId = createMemo(() => {
    const source = props.branchSource;
    if (!source) return undefined;
    const shown = shownRows();
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
  const failure = (error: string | null) => {
    const reason = error?.trim() ?? "";
    if (!reason) return { body: t("conversation.threads.view.failedBody"), details: null };
    const fallback = t("agent.error.continueFailed");
    const body = errorMessage(props.failureText?.(reason) ?? reason, fallback);
    return { body, details: body === fallback ? reason : null };
  };
  const running = () =>
    props.task?.state === "running" && !props.approval && !props.waitsForAnswer ? props.task : undefined;
  const queued = () => (props.task && props.task.queuedMessages.length > 0 ? props.task : undefined);
  const backgroundWorkSince = () => (props.task?.state === "running" ? undefined : props.backgroundWorkSince);
  const hold = () => (props.task ? agentThreadHoldText(props.task, props.limit, t) : null);
  const editingQueued = () => Boolean(props.queue?.editingDeliveryId);
  const sendLabel = () =>
    t(recording() ? "composer.send.voice" : editingQueued() ? "composer.send.saveQueued" : "composer.send.message");
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
        const previous = new Map(shown.deliveries.map((delivery) => [delivery.id, delivery]));
        const deliveries = next.deliveries.map((delivery) => {
          const known = previous.get(delivery.id);
          return known && JSON.stringify(known) === JSON.stringify(delivery) ? known : delivery;
        });
        setQueueRows({ taskId: next.taskId, deliveries });
        return;
      }
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
  const draftRows = createComposerRowsResize(() => props.task?.id ?? "");
  const hasRow = () =>
    Boolean(props.onRemoveAttachment) &&
    ((props.rowAttachments?.length ?? 0) > 0 || (props.pendingImages?.length ?? 0) > 0);
  const draftEmpty = () => props.draft.trim().length === 0 && (props.rowAttachments?.length ?? 0) === 0;
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
        <div
          class="virtual-chat-list virtual-chat-list-static"
          ref={(element: HTMLDivElement) => {
            messageList = element;
            fades.watch(element);
          }}
        >
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
          <Show when={props.task?.origin === "agent" && !props.olderMessages}>
            <p class="agent-thread-origin">
              {t("conversation.threads.view.startedByAgent", { name: props.agent.name })}
            </p>
          </Show>
          <For each={shownRows()} keyed={(message) => message.id}>
            {(message, index) => {
              const card = createMemo(() => props.messageCard?.(message(), quoteSelection));
              const subagentGroup = () =>
                props.subagents && message().kind === "subagents" ? message().subagents : undefined;
              const stepsInRow = () =>
                props.traceAbove !== undefined &&
                !props.stepsOpenByDefault &&
                message().kind !== "thinking" &&
                message().questionPrompt === undefined &&
                !agentMessageMarker(message()) &&
                !changeMarker(message()) &&
                !card() &&
                !subagentGroup() &&
                author(message()).kind === "agent";
              const stepsDisclosure = () => (
                <Show when={props.stepsAbove?.(message().id)}>
                  {(steps) => (
                    <AgentStepsDisclosure
                      steps={steps()}
                      defaultOpen={props.stepsOpenByDefault ?? false}
                      list={!stepsInRow()}
                      trace={message().kind === "thinking" ? undefined : props.traceAbove?.(message().id)}
                      facts={props.factsAbove?.(message().id)}
                    />
                  )}
                </Show>
              );
              const opensRun = createMemo((): "agent" | "user" | undefined => {
                const current = message();
                if (card() || !continuesRunIds().has(current.id)) return undefined;
                if (!stepsInRow() && props.stepsAbove?.(current.id)) return undefined;
                return author(current).kind === "agent" ? "agent" : "user";
              });
              createEffect(
                () => ({ id: message().id, kind: opensRun() }),
                ({ id, kind }) => {
                  if (!kind) return;
                  setRunOpeners((draft) => {
                    draft[id] = kind;
                  });
                  return () =>
                    setRunOpeners((draft) => {
                      delete draft[id];
                    });
                },
              );
              const nextOpensRun = () => {
                const next = shownRows()[index() + 1];
                return next ? runOpeners[next.id] : undefined;
              };
              return (
                <div
                  class="virtual-chat-row"
                  data-grouped={!card() && continuesRunIds().has(message().id) ? "sender" : undefined}
                  data-next-grouped={nextOpensRun()}
                >
                  <Show when={timeMarkers().get(message().id)}>
                    {(label) => (
                      <div class="time-marker">
                        <span>{label()}</span>
                      </div>
                    )}
                  </Show>
                  <Show when={!stepsInRow()}>{stepsDisclosure()}</Show>
                  <Show when={message().kind !== "thinking" && agentMessageMarker(message())}>
                    {(marker) => (
                      <article data-chat-search-message={message().id}>
                        <ChatActionMarker
                          marker={marker()}
                          agents={props.agents}
                          onSelectAgent={(agentId, tabId) => props.onSelectAgent?.(agentId, tabId)}
                          onToggleAgentMessage={toggleAgentMessage}
                          agentMessageText={agentMessageText}
                        />
                        <Show when={marker().direction === "incoming" && (message().attachments?.length ?? 0) > 0}>
                          <div class="chat-action-attachments">
                            <AttachmentCards
                              attachments={message().attachments ?? []}
                              mediaSource={props.mediaSource}
                              downloads={props.downloads}
                              onPreview={(attachment) => props.onPreview(attachment)}
                              onAction={props.onAttachmentAction}
                            />
                          </div>
                        </Show>
                      </article>
                    )}
                  </Show>
                  <Show when={message().kind !== "thinking" && changeMarker(message())}>
                    {(marker) => (
                      <article data-chat-search-message={message().id}>
                        <ChatActionMarker
                          marker={marker()}
                          agents={props.agents}
                          onSelectAgent={(agentId, tabId) => props.onSelectAgent?.(agentId, tabId)}
                          onOpenSkill={props.changeMarkerActions?.onOpenSkill}
                          onOpenInstructions={props.changeMarkerActions?.onOpenInstructions}
                        />
                      </article>
                    )}
                  </Show>
                  <Show when={subagentGroup()}>
                    {(subagents) => (
                      <article data-chat-search-message={message().id}>
                        <SubagentGroup
                          subagents={subagents()}
                          selectedId={props.subagents?.selectedId}
                          onOpen={(subagentId) => props.subagents?.onOpen(subagentId)}
                        />
                      </article>
                    )}
                  </Show>
                  <Show
                    when={
                      message().kind !== "thinking" &&
                      !subagentGroup() &&
                      !agentMessageMarker(message()) &&
                      !changeMarker(message())
                    }
                  >
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
                          onOpenSharedFile={sharedFileOpener(props.agent.id)}
                          onOpenWorkspaceFile={workspaceFileOpener(props.agent.id)}
                          mediaSource={props.mediaSource}
                          imageCopies={props.imageCopies}
                          downloads={props.downloads}
                          onDownload={(attachment) => props.onAttachmentAction(attachment, "download")}
                          macWindowControls={props.macWindowControls}
                          referencedMessage={referenced(message())}
                          onOpenReference={() => {
                            const id = message().replyToMessageId;
                            if (id) showMessage(id);
                          }}
                          actions={messageActions(message())}
                          steps={stepsInRow() ? stepsDisclosure() : undefined}
                          actionTime={props.compactMessageActions === false}
                          actionsBeside={stepsInRow() || author(message()).kind === "you"}
                          menu={messageMenu(message())}
                          textAtOnce={plainActivity()}
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
              <div class="virtual-chat-row virtual-chat-row-activity">
                <AgentActivityIndicator
                  agent={props.agent}
                  label={activityLabel()}
                  detail={task().progress}
                  steps={props.activeSteps}
                  stepsOpenByDefault={props.stepsOpenByDefault}
                  plain={plainActivity()}
                  outputShown={turnOutputShown(task().activeTurnId)}
                />
              </div>
            )}
          </Show>
          <Show when={backgroundWorkSince()}>
            {(since) => (
              <div class="virtual-chat-row virtual-chat-row-activity">
                <AgentActivityIndicator
                  agent={props.agent}
                  label={rotatingActivityLabel}
                  detail={t("chat.activity.backgroundWork")}
                  since={since()}
                />
              </div>
            )}
          </Show>
          <Show keyed when={props.approval}>
            {(approval) => (
              <div class="virtual-chat-row">
                {props.approvalCard?.(approval) ?? (
                  <ApprovalCard
                    approval={approval}
                    agentName={props.agent.name}
                    onApprove={() => props.onRespondApproval("accept")}
                    onReject={() => props.onRespondApproval("decline")}
                    media={props.media}
                  />
                )}
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
      <ScrollEdgeBlur fades={fades} />
      <Show when={props.newerMessages}>{(newer) => <ScrollToLatestButton onClick={() => loadLatest(newer())} />}</Show>
      <div class="composer-wrap">
        <div class="composer-stack">
          <ComposerStackCard when={failed()}>
            {(task) => {
              const shown = () => failure(task().error);
              return (
                <ComposerNotice
                  tone="danger"
                  title={t("conversation.threads.view.failed")}
                  body={shown().body}
                  action={
                    <Show when={shown().details}>
                      {(details) => (
                        <CopyButton
                          value={details()}
                          variant="outline"
                          size="sm"
                          label={t("agent.error.copyDetails")}
                          onCopyError={() => toast.error(t("app.clipboard.copyFailed"))}
                        />
                      )}
                    </Show>
                  }
                />
              );
            }}
          </ComposerStackCard>
          <ComposerStackCard when={props.awaiting?.length ? props.awaiting : undefined}>
            {(items) => (
              <AwaitingReplies items={items()} onOpenAgent={props.onOpenWaitingAgent ?? props.onSelectAgent} />
            )}
          </ComposerStackCard>
          <Show when={props.queue}>
            {(queue) => (
              <>
                <div
                  class="agent-queue-slot"
                  data-open={queueOpen() ? "true" : "false"}
                  aria-hidden={queueOpen() ? undefined : "true"}
                  inert={queueOpen() ? undefined : true}
                >
                  <div class="agent-queue-slot-inner">
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
                <ComposerStackCard when={queue().editingDeliveryId}>
                  {() => (
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
                  )}
                </ComposerStackCard>
              </>
            )}
          </Show>
          <ComposerStackCard when={props.replyTo}>
            {(message) => (
              <ComposerReplyPreview
                message={message()}
                agents={props.agents}
                skills={props.skills}
                disabled={sending() || voicePhase() === "transcribing"}
                onCancel={() => props.onCancelReply?.()}
              />
            )}
          </ComposerStackCard>
        </div>
        <form
          ref={draftRows.form}
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
                macWindowControls={props.macWindowControls}
              />
            )}
          </Show>
          <div class="composer-input-label" ref={draftRows.label}>
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
                    onSend={() => void send()}
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
