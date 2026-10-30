import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { markdownPlainText } from "@openbot/contracts/markdown-preview-text";
import { serializeSelectionInstruction } from "@openbot/contracts/selection-instruction";
import { type CauseCode, classifyFailure, type FailureProperties } from "@openbot/telemetry";
import { useQueryClient } from "@tanstack/react-query";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, useIsFocused } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Keyboard, useColorScheme, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import { MobileConversationAnalytics } from "@/features/analytics/conversation";
import { reportMobileNotification } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { channelRecipient } from "@/features/channels/model/channel-draft";
import type { ApprovalDecision } from "@/features/chat/components/chat-approval-card";
import { ChatComposer, type MentionSkill, VOICE_BUTTON_SIZE } from "@/features/chat/components/chat-composer";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import type { ChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import { useChatAttachments } from "@/features/chat/components/use-chat-attachments";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { VoiceAgentAvatar } from "@/features/chat/components/voice-call-bar";
import { useOutbox } from "@/features/chat/context/outbox-context";
import { usePublishedQueuedChat } from "@/features/chat/context/queued-messages-context";
import {
  type ChatBubbleMessage,
  type ChatMessage,
  type PendingChatMessage,
  presentChatMessages,
} from "@/features/chat/model/chat-messages";
import { finishedTurnSummaries, type TurnStepsSummary } from "@/features/chat/model/turn-thinking";
import { replyVoiceReady } from "@/features/voice/model/reply-voice";
import { ConnectionStatus } from "@/features/workspace/components/connection-status";
import { useTurnStepLines } from "@/features/workspace/components/use-agent-activity";
import { useBrowserRequests } from "@/features/workspace/components/use-live-workspace";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import type { PendingApproval } from "@/features/workspace/model/pending-approvals";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { useReducedTransparency } from "@/shared/lib/use-reduced-transparency";
import { mentionDraft } from "../model/chat-mentions";
import type { ChatTarget } from "../model/chat-target";
import {
  deleteComposerFiles,
  takeComposerFocus,
  takeComposerRequest,
  useComposerRequest,
} from "../model/composer-requests";
import { type OutboxMessage, outboxChatKey, outboxChatMessage, outboxRowId, outboxTargetKey } from "../model/outbox";
import type { OutboxDraft, OutboxStore } from "../model/outbox-store";
import { queueReceiptMessages, queueRowsWithHeldEdit } from "../model/queue-edit-draft";
import { retainConfirmedAttachments } from "../model/upload-chat-attachments";
import { voiceAccent, voicePalette } from "../model/voice-palette";
import { rememberImageDimensions } from "./attachment-preview";
import { asksForSecret, BrowserSecretComposer, BrowserTakeoverCard } from "./browser-secret-card";
import { ChatAttachmentPanel } from "./chat-attachment-panel";
import type { OutboxRowStatus } from "./chat-outbox-status";
import { ChatQueueButton } from "./chat-queue-button";
import { ChatSelectionBar } from "./chat-selection-bar";
import { type ComposerVoice, dictationVoice, liveVoice } from "./composer-voice";
import type { ChatQueueController } from "./use-chat-queue";
import { type LiveChannel, useLiveConversation } from "./use-live-conversation";
import { useVoiceMode } from "./use-voice-mode";
import { VoiceOverlay } from "./voice-overlay";

export interface ChatViewProps {
  target: ChatTarget;
  queue?: ChatQueueController;
  agents: MobileAgent[];
  mentionAgents: MobileAgent[];
  /** The skills of the chat's agent, for `@` and for Use skill in the plus menu. */
  mentionSkills?: readonly MentionSkill[];
  projectedMessages: ChatMessage[];
  referenceMessages: ChatMessage[];
  ready: boolean;
  historyLoadFailed: boolean;
  /** Whether the person can write here. A message waits on this phone while the server is offline. */
  canSend: boolean;
  /** A note in place of the composer that says why the person cannot write here. */
  notice?: string | null;
  /** The chat only shows its history, such as a deleted channel: no replies, answers or browser steps. */
  readOnly?: boolean;
  activity?: MobileAgentActivity;
  /** The activity of each member agent that works in a channel. */
  activities?: MobileAgentActivity[];
  activeTurnId: string | null;
  /** The agent's conversation, for the live voice conversation. Absent for a channel. */
  conversation?: { messages: readonly ConversationMessage[]; activeTurnId: string | null } | null;
  /** The channel's messages and leader, for the live voice conversation. Absent for an agent chat. */
  liveChannel?: LiveChannel | null;
  /** Absent for a chat that cannot stop a turn, such as a channel. */
  stopTurn?: (turnId: string) => Promise<void>;
  questionForm?: QuestionPromptController;
  /** Opens the form of an open question, in a channel where several agents can ask. */
  onSelectQuestion?: (messageId: string) => void;
  /** A channel task needs the user. */
  needsAction?: boolean;
  /** The lead of a channel. Its browser opens when no member asks for a browser step. */
  channelLeadAgentId?: string | null;
  /** Rows under the agent's activity, such as the tasks that the agent works on. */
  activityAccessory?: ReactNode;
  /** The agent's threads, in the menu of the agent's name in the header. */
  threadMenu?: ChatThreadMenu;
  /** This chat's thread. Browser requests of the agent's other threads, such as its tasks, do not show here. */
  threadId?: string | null;
  /** The threads of a channel's member agents, from a host with `channel-attention-v1`. */
  channelThreadIds?: ReadonlySet<string> | null;
  /** The approvals of this chat's agents, from the caller that knows which thread is this chat's. */
  approvals?: readonly PendingApproval[];
  readBoundary: string | null;
  markRead: () => void;
  fetchHistory: () => void;
  hasOlder: boolean;
  olderLoading: boolean;
  olderError: boolean;
  loadOlder: () => void;
  /** A message from search that the chat opens at, once its page is loaded. */
  focusMessageId?: string | null;
  /** True while the chat opens at a message from search, also before its page loads. */
  holdOpening?: boolean;
  /** True while the chat shows the messages that the phone kept and reads its latest page. */
  catchingUp?: boolean;
  onFocusPlaced?: () => void;
  /** The loaded messages are a window around a searched message and do not reach the latest message. */
  detached?: boolean;
  /** Loads the latest messages in place of the window around a searched message. */
  showLatestMessages?: () => Promise<void>;
  /** Leaves the chat, from the back button and the Android edge swipe. */
  onLeave: () => void;
}

const CHAT_BACK_EDGE_WIDTH = 24;
const NO_DELIVERIES: ChatQueueController["deliveries"] = [];
/** A host starts a turn within a second or two; this only ends a wait for a turn that never shows. */
const AWAIT_TURN_MS = 10_000;

// One row object per outbox message state, so a list row draws again only when its message changes.
const outboxRows = new WeakMap<OutboxMessage, ChatBubbleMessage>();

function outboxRow(outbox: OutboxStore, message: OutboxMessage): ChatBubbleMessage {
  let row = outboxRows.get(message);
  if (!row) {
    // The row draws these images before the host knows them, at their real shape.
    for (const file of message.files) if (file.dimensions) rememberImageDimensions(file.id, file.dimensions);
    row = outboxChatMessage(message, (file) => outbox.previewUri(message, file));
    outboxRows.set(message, row);
  }
  return row;
}

/** The longest wait for the open transition, for a chat that opens without one. */
const OPEN_TRANSITION_DEADLINE_MS = 700;

/**
 * Whether the message rows render. Android starts the push animation of a screen only after the
 * screen's first commit, and the rows made that commit long: the chat came seconds after the tap.
 * There the first commit has no rows. The list renders its latest rows while the chat slides in,
 * and the older rows when it is in place. iOS animates the screen while it renders, so it renders
 * them all at once.
 */
export function useRowsAfterOpenTransition(): boolean {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [shown, setShown] = useState(!isAndroid);
  useEffect(() => {
    if (shown) return;
    const unsubscribe = navigation.addListener("transitionEnd", (event) => {
      if (!event.data.closing) setShown(true);
    });
    const deadline = setTimeout(() => setShown(true), OPEN_TRANSITION_DEADLINE_MS);
    return () => {
      unsubscribe();
      clearTimeout(deadline);
    };
  }, [navigation, shown]);
  return shown;
}

export function ChatView({
  target,
  queue,
  agents: serverAgents,
  mentionAgents,
  mentionSkills,
  projectedMessages,
  referenceMessages,
  ready,
  historyLoadFailed,
  canSend,
  notice = null,
  readOnly = false,
  activity,
  activities,
  activeTurnId,
  conversation = null,
  liveChannel = null,
  stopTurn,
  questionForm,
  onSelectQuestion,
  needsAction = false,
  channelLeadAgentId = null,
  activityAccessory,
  threadMenu,
  threadId = null,
  channelThreadIds = null,
  approvals,
  readBoundary,
  markRead,
  fetchHistory,
  hasOlder,
  olderLoading,
  olderError,
  loadOlder,
  focusMessageId = null,
  holdOpening = false,
  catchingUp = false,
  onFocusPlaced,
  detached = false,
  showLatestMessages,
  onLeave: leaveConversation,
}: ChatViewProps) {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspaceReader();
  const browserViewAvailable = useMobileWorkspaceSelector(
    (current) => current.browserViewSupport(target.serverId).view,
  );
  const browserRequests = useBrowserRequests(target.serverId);
  const chatBrowserRequests = useMemo(
    () =>
      browserRequests.filter((request) =>
        target.kind === "agent"
          ? request.agentId === target.id && (threadId === null || request.threadId === threadId)
          : // A host with channel-attention-v1 names the channel's threads; an older host only its members.
            channelThreadIds?.size
            ? channelThreadIds.has(request.threadId)
            : target.members.some((member) => member.id === request.agentId),
      ),
    [browserRequests, target, threadId, channelThreadIds],
  );
  const browserAllowed = useBrowserFeature();
  // A channel always has the browser of one member: the member that asks for a browser step, else
  // the lead, else the first member. The browser screen switches to the browser of any member.
  const channelBrowser = useMemo(() => {
    if (target.kind !== "channel") return null;
    const memberIds = target.members.map((member) => member.id);
    const request = chatBrowserRequests.find((item) => memberIds.includes(item.agentId));
    const agentId =
      request?.agentId ??
      (channelLeadAgentId && memberIds.includes(channelLeadAgentId) ? channelLeadAgentId : memberIds[0]);
    if (!agentId) return null;
    return { agentId, agentIds: memberIds, ...(request ? { tabId: request.tabId } : {}) };
  }, [target, chatBrowserRequests, channelLeadAgentId]);
  const isFocused = useIsFocused();
  const foregroundVisit = useAppForeground();
  const [conversationAnalytics] = useState(() => new MobileConversationAnalytics(mobileAnalytics));
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const reducedTransparency = useReducedTransparency();
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === target.serverId));
  const insets = useSafeAreaInsets();
  const keyboardOffset = Math.max(insets.bottom, 10) - 10;
  const [foreground, muted, fieldBackground, raised, action, actionForeground, background] = useThemeColor([
    "foreground",
    "muted",
    "default",
    "surface-tertiary",
    "accent",
    "accent-foreground",
    "background",
  ]);
  const [replyTarget, setReplyTarget] = useState<ChatBubbleMessage | null>(null);
  // The message whose text the reader selects in its bubble, and the selected part of it.
  const [selection, setSelection] = useState<{ message: ChatBubbleMessage; selected: string } | null>(null);
  const selectionQuote = selection ? selection.selected.trim() || markdownPlainText(selection.message.body) : "";
  const [replyFocusVersion, setReplyFocusVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<{
    agentId: string;
    message: string;
    cause: CauseCode;
    context: Partial<Pick<FailureProperties, "provider" | "model">>;
  } | null>(null);
  const failureAgent = target.kind === "agent" ? serverAgents.find((agent) => agent.id === target.id) : undefined;
  const failureContext = useMemo(
    () => (failureAgent ? { provider: failureAgent.provider, model: failureAgent.model } : {}),
    [failureAgent],
  );
  const reportedError = useRef<typeof sendError>(null);
  useEffect(() => {
    if (!isFocused || !sendError || sendError.agentId !== target.id || reportedError.current === sendError) return;
    reportedError.current = sendError;
    reportMobileNotification({ code: sendError.cause }, "turn", "banner", sendError.context);
  }, [isFocused, sendError, target.id]);
  const [sendRetryVersion, setSendRetryVersion] = useState(0);
  const queryClient = useQueryClient();
  // Use skill in the plus menu bumps it; the composer then writes `@` and offers the skills.
  const [skillPickerVersion, setSkillPickerVersion] = useState(0);
  // On Android a drag in the open `@` list was also the swipe that hides the keyboard: the composer
  // followed the finger down behind the keyboard, which stayed. iOS keeps the swipe.
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const composerAttachments = useChatAttachments([], undefined, () => workspace().attachmentSupport(target.serverId));
  const attachments = composerAttachments;
  const [messageAliases, setMessageAliases] = useState<ReadonlyMap<string, string>>(new Map());
  // A message sent from this phone keeps its local row ID after the host names it. The host knows
  // only its own ID, so a reaction or a reply sends that one.
  const hostMessageIds = useMemo(
    () => new Map([...messageAliases].map(([hostId, rowId]) => [rowId, hostId])),
    [messageAliases],
  );
  const hostMessageId = (id: string) => hostMessageIds.get(id) ?? id;
  const [showStarter, setShowStarter] = useState(true);
  // The messages of this chat that the host has not drawn yet. They wait for the connection, in order.
  const { store: outbox, snapshot: outboxSnapshot } = useOutbox();
  const outboxKey = outboxChatKey(target);
  const outboxMessages = useMemo(
    () =>
      outboxSnapshot.messages.filter(
        (message) =>
          outboxTargetKey(message.target) === outboxKey && !outboxSnapshot.editing.has(message.clientMessageId),
      ),
    [outboxSnapshot.messages, outboxSnapshot.editing, outboxKey],
  );
  const sendingMessage = outboxMessages.find((message) => message.state === "sending") ?? null;
  const sendingUpload = sendingMessage ? outboxSnapshot.uploads.get(sendingMessage.clientMessageId) : undefined;
  // While the agent works, the host queues a sent message: the queue sheet shows it, not the chat.
  const sendsToQueue = Boolean(queue && (activeTurnId || queue.queued.length || queue.replies.length));
  const queuePending = useMemo(
    () =>
      sendsToQueue && sendingMessage
        ? {
            message: outboxRow(outbox, sendingMessage),
            progress: sendingUpload?.completed ?? 0,
            total: sendingMessage.files.length,
            cancel: () => outbox.cancelUpload(sendingMessage.clientMessageId),
          }
        : null,
    [sendsToQueue, sendingMessage, sendingUpload?.completed, outbox],
  );
  // The sheet keeps a held edit in its rows when the host hides it. Count it here as
  // well, so a saved edit with a lost response stays reachable after a restart.
  const queued = queue?.queued;
  const heldQueueEdit = queue?.edit?.delivery ?? null;
  const queueCount = useMemo(
    () => (queued ? queueRowsWithHeldEdit(queued, heldQueueEdit).length : 0) + (queuePending ? 1 : 0),
    [queued, heldQueueEdit, queuePending],
  );
  usePublishedQueuedChat(queue?.chatId ?? `${target.serverId}:${target.id}`, queue ?? null, queuePending);
  // The thinking sheet reads the agent's conversation, so only an agent chat opens it.
  const turnLines = useTurnStepLines(target.serverId);
  const conversationMessages = conversation?.messages;
  const conversationTurnId = conversation?.activeTurnId ?? null;
  const lastTurnSummaries = useRef<ReadonlyMap<string, TurnStepsSummary> | undefined>(undefined);
  const turnSummaries = useMemo(() => {
    lastTurnSummaries.current =
      conversationMessages && target.kind === "agent"
        ? finishedTurnSummaries(conversationMessages, conversationTurnId, turnLines, lastTurnSummaries.current)
        : undefined;
    return lastTurnSummaries.current;
  }, [conversationMessages, conversationTurnId, turnLines, target.kind]);
  const thinkingAgentId = target.kind === "agent" ? target.id : null;
  const openTurn = useCallback(
    (turnId: string) => {
      if (thinkingAgentId) router.push({ pathname: "/turn-thinking", params: { agentId: thinkingAgentId, turnId } });
    },
    [thinkingAgentId],
  );
  const queuedMessageIds = useMemo(
    () =>
      new Set(
        queue?.deliveries
          // Like desktop, a routine instruction stays in the chat below its marker.
          .filter((item) => (item.status === "queued" || item.status === "cancelled") && item.sender.kind !== "routine")
          .map((item) => item.id) ?? [],
      ),
    [queue?.deliveries],
  );
  // The host rows drawn when the request that stores a message started. Rows that arrive before its
  // receipt wait for it: one of them can be the same message. An upload stores nothing yet.
  const sendBaselines = useRef(new Map<string, ReadonlySet<string>>());
  if (
    sendingMessage &&
    outboxSnapshot.storing.has(sendingMessage.clientMessageId) &&
    !sendBaselines.current.has(sendingMessage.clientMessageId)
  )
    sendBaselines.current.set(sendingMessage.clientMessageId, new Set(projectedMessages.map((message) => message.id)));
  // A message sent while the agent works stays in the queue sheet until the chat draws the host row.
  const queueSends = useRef(new Set<string>());
  if (sendingMessage && sendsToQueue) queueSends.current.add(sendingMessage.clientMessageId);
  const pendingMessages = useMemo(
    () =>
      outboxMessages.flatMap((message): PendingChatMessage[] =>
        (message.state === "sending" && sendsToQueue) ||
        (message.state === "sent" && queueSends.current.has(message.clientMessageId)) ||
        (message.messageId !== null && queuedMessageIds.has(message.messageId))
          ? []
          : [
              {
                message: outboxRow(outbox, message),
                baseline: outboxSnapshot.storing.has(message.clientMessageId)
                  ? (sendBaselines.current.get(message.clientMessageId) ?? null)
                  : null,
                serverId: message.messageId,
              },
            ],
      ),
    [outboxMessages, outboxSnapshot.storing, sendsToQueue, queuedMessageIds, outbox],
  );
  const messages = useMemo(
    () =>
      presentChatMessages(
        projectedMessages.filter((item) => !queuedMessageIds.has(item.id)),
        pendingMessages,
        messageAliases,
      ),
    [projectedMessages, pendingMessages, messageAliases, queuedMessageIds],
  );
  useEffect(() => {
    for (const id of sendBaselines.current.keys())
      if (!outboxSnapshot.storing.has(id)) sendBaselines.current.delete(id);
    for (const id of queueSends.current)
      if (!outboxMessages.some((message) => message.clientMessageId === id)) queueSends.current.delete(id);
    // Replies and the list key keep the local row after the host names the message.
    const received = outboxMessages.filter((message) => message.messageId !== null);
    if (received.some((message) => message.messageId !== null && !messageAliases.has(message.messageId)))
      setMessageAliases((current) => {
        const next = new Map(current);
        for (const message of received) if (message.messageId) next.set(message.messageId, outboxRowId(message));
        return next;
      });
    const drawn = [...projectedMessages, ...queueReceiptMessages(queue?.deliveries ?? [])];
    const settled = received.filter(
      (message) =>
        message.messageId !== null &&
        retainConfirmedAttachments(
          drawn,
          message.messageId,
          [...outbox.filesInMemory(message.clientMessageId)],
          (id, file) => {
            queryClient.setQueryData(queryKeys.chatAttachment(target.serverId, id), file);
          },
        ),
    );
    if (settled.length) outbox.settle(settled.map((message) => message.clientMessageId));
  }, [
    outboxMessages,
    outboxSnapshot.storing,
    messageAliases,
    projectedMessages,
    queue?.deliveries,
    outbox,
    queryClient,
    target.serverId,
  ]);
  // The composer answers only after the person chooses it in the form. A private answer has its
  // own masked field in the form, never the composer.
  const answersQuestion = Boolean(
    questionForm?.question && !questionForm.question.isSecret && questionForm.replyInChat,
  );
  const [answerFocusVersion, setAnswerFocusVersion] = useState(0);
  useEffect(() => {
    if (answersQuestion) setAnswerFocusVersion((version) => version + 1);
  }, [answersQuestion]);
  // Another screen, such as Agent info > Skills or a share from another app, can put text and files
  // in this composer and close itself. Only a chat in front takes it: a chat under that screen is not
  // the one the user returns to.
  const composerRequest = useComposerRequest((state) => state.request);
  useEffect(() => {
    if (!isFocused || !composerRequest || target.kind !== "agent") return;
    const request = takeComposerRequest(target.serverId, target.id);
    if (!request) return;
    const files = request.files ?? [];
    void composerAttachments
      .addShared(request.text, files, (text) => setDraft((current) => (current ? `${current}\n${text}` : text)))
      .finally(() => deleteComposerFiles(files));
  }, [isFocused, composerRequest, target.kind, target.serverId, target.id, composerAttachments.addShared]);
  const composerFocus = useComposerRequest((state) => state.focus);
  const [handoffFocusVersion, setHandoffFocusVersion] = useState(0);
  useEffect(() => {
    if (!isFocused || !composerFocus || target.kind !== "agent") return;
    if (takeComposerFocus(target.serverId, target.id)) setHandoffFocusVersion((version) => version + 1);
  }, [isFocused, composerFocus, target.kind, target.serverId, target.id]);
  const lastUserId =
    messages.findLast((message) => message.kind === "message" && message.author === "user")?.id ?? null;
  // The host accepted a message to an idle agent, and nothing shows its turn yet. Turn events can
  // arrive after the read that holds the reply, so the activity row waits for the turn, the reply or
  // a failure in the conversation. The deadline only ends a turn that never shows.
  const [awaitingTurn, setAwaitingTurn] = useState(false);
  const tailUserIndex = messages.findLastIndex((message) => message.kind === "message" && message.author === "user");
  const tailUser = messages[tailUserIndex];
  const turnShown =
    Boolean(activity || activeTurnId) ||
    tailUserIndex < messages.length - 1 ||
    (tailUser?.kind === "message" && tailUser.status === "failed");
  useEffect(() => {
    if (awaitingTurn && turnShown) setAwaitingTurn(false);
  }, [awaitingTurn, turnShown]);
  useEffect(() => {
    if (!awaitingTurn) return;
    const timer = setTimeout(() => setAwaitingTurn(false), AWAIT_TURN_MS);
    return () => clearTimeout(timer);
  }, [awaitingTurn]);
  // Each receipt starts the wait once. A message that the host queues behind a turn has its own row.
  const awaitedReceipts = useRef(new Set<string>());
  useEffect(() => {
    // A channel message gets no receipt with a message ID, and its routing can start no turn.
    if (target.kind !== "agent") return;
    for (const message of outboxMessages)
      if (
        message.messageId !== null &&
        !queueSends.current.has(message.clientMessageId) &&
        !awaitedReceipts.current.has(message.clientMessageId)
      ) {
        awaitedReceipts.current.add(message.clientMessageId);
        setAwaitingTurn(true);
      }
  }, [outboxMessages, target.kind]);
  const rowsShown = useRowsAfterOpenTransition();
  const motion = useChatMotion(
    insets.top + 84,
    keyboardOffset,
    // The list takes its place at the latest message once its rows render.
    ready && rowsShown,
    // The list draws a row for each message except the thinking steps, which the activity row shows.
    rowsShown && messages.some((message) => message.kind !== "thinking"),
    lastUserId,
    questionForm?.question ? (questionForm.messageId ?? null) : null,
    holdOpening,
    catchingUp,
  );
  const atLatest = motion.atLatest;
  // The end of a window around a searched message is not the latest message.
  const showLatest = () => {
    if (!detached || !showLatestMessages) {
      motion.scrollToLatest();
      return;
    }
    void showLatestMessages().then(motion.returnToLatest, () => undefined);
  };
  const liquidGlassAvailable = isLiquidGlassAvailable() && !reducedTransparency;
  // A quiet return to the app counts as online: the chat keeps its look, and its requests wait.
  const serverOnline = showsOnline(server);
  // Speech goes to the voice mode's own transcript, and only Send makes it a
  // message. Leaving the chat or losing the server stops listening and keeps it.
  const voice = useVoiceMode({
    enabled: isFocused && serverOnline && canSend && !readOnly && !notice,
    focused: isFocused,
    sendable: serverOnline && canSend,
    onSend: sendMessage,
  });
  const writable = canSend && !readOnly && !notice;
  // Hands-free, as the voice pane on desktop: the agent hears a pause as the end of a turn, and its
  // reply is read aloud. In a channel the leader answers, or the member the words name.
  const live = useLiveConversation({
    enabled: isFocused && writable,
    online: serverOnline,
    focused: isFocused,
    foreground: foregroundVisit,
    conversation,
    channel: liveChannel,
    deliveries: queue?.deliveries ?? NO_DELIVERIES,
    outboxMessages,
    send: (text) => (writable ? deliver(text, null, []) : null),
  });
  // The agent who speaks in a voice conversation: the agent of the chat, or the channel's leader, who
  // gives out the channel's tasks.
  const voiceAgent =
    target.kind === "agent"
      ? target
      : (target.members.find((member) => member.id === (live.speakerId ?? channelLeadAgentId)) ?? null);
  // Not gated on `appActive`. Notification Center and other system overlays make iOS report the app
  // inactive, and a request must stay with its typed value. It goes when the app leaves.
  const showBrowserRequests = serverOnline && foregroundVisit && isFocused && !readOnly;
  // The mic of the composer: a live conversation in an agent chat, as on desktop. A channel has no
  // one conversation to follow, so its mic dictates a message for review.
  // With no voice ready, the mic opens Settings > Voice, where the user downloads Supertonic 3 or adds
  // an ElevenLabs key.
  const composerVoice: ComposerVoice =
    live.available || live.open
      ? {
          ...liveVoice(live, voiceAgent?.name ?? target.name, t),
          start: () => (replyVoiceReady() ? live.start() : router.push("/settings/voice")),
        }
      : dictationVoice(voice, t);
  const voiceOpen = voice.stage !== "closed" || live.open;
  // Dictation covers the chat with its overlay. A live conversation keeps the chat in view and turns
  // the composer into a call bar.
  const dictating = voice.stage !== "closed";
  // A password or a code is typed where the composer is, so the screen has one field. The voice
  // mode and the attachment card keep the composer until they close. Other secret requests wait.
  const secretRequest =
    showBrowserRequests && !voiceOpen && !attachments.menuOpen ? chatBrowserRequests.find(asksForSecret) : undefined;
  const dark = useColorScheme() === "dark";
  // The glow and the filled voice controls take that agent's colour. A channel with no leader mixes
  // the colours of its first members.
  const voiceColors = useMemo(
    () =>
      voiceAgent
        ? [getBloubAvatarColor(voiceAgent.avatarSeed, voiceAgent.avatarHue)]
        : target.kind === "channel"
          ? target.members.slice(0, 4).map((member) => getBloubAvatarColor(member.avatarSeed, member.avatarHue))
          : [],
    [voiceAgent, target],
  );
  const palette = useMemo(() => voicePalette(voiceColors, dark), [voiceColors, dark]);
  const accent = useMemo(() => voiceAccent(palette), [palette]);
  useEffect(() => {
    conversationAnalytics.update(
      isFocused && foregroundVisit,
      ready,
      historyLoadFailed || (!serverOnline && server?.initialConnectionPending === false),
    );
  }, [
    conversationAnalytics,
    isFocused,
    foregroundVisit,
    ready,
    historyLoadFailed,
    serverOnline,
    server?.initialConnectionPending,
  ]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);

  // Opening a chat reads it, as on desktop. After the user scrolls away, only the latest message in view reads it.
  const seesLatest = !detached && (atLatest || (motion.historyVisible && !motion.userScrolled));
  useEffect(() => {
    if (!sendingMessage && isFocused && appActive && seesLatest && serverOnline && readBoundary) markRead();
  }, [sendingMessage, isFocused, appActive, seesLatest, serverOnline, readBoundary, markRead]);

  // The attachment card must not rebuild this gesture. A new gesture object
  // makes GestureDetector re-attach around the whole chat, the input inside it
  // is recreated, and the keyboard goes with it. Read the card's state in the
  // gesture instead, so opening the card leaves the detector untouched.
  const menuOpenValue = useSharedValue(false);
  // The card's own open progress, shared with the composer: the plus fades
  // back in on the frames the card fades out, so the corner is never empty.
  const menuProgress = useSharedValue(0);
  useEffect(() => {
    menuOpenValue.set(attachments.menuOpen);
  }, [attachments.menuOpen, menuOpenValue]);
  // The same for the voice mode: the edge swipe stops or cancels it, as the
  // back button does, instead of leaving the chat with the spoken text.
  const voiceOpenValue = useSharedValue(false);
  useEffect(() => {
    voiceOpenValue.set(voiceOpen);
  }, [voiceOpen, voiceOpenValue]);
  const voiceBack = useRef(voice.back);
  useEffect(() => {
    voiceBack.current = live.open ? live.end : voice.back;
  });
  const leaveVoiceMode = useCallback(() => voiceBack.current(), []);
  const edgeBackGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isIOS)
        .hitSlop({ left: 0, width: CHAT_BACK_EDGE_WIDTH })
        .activeOffsetX(12)
        .failOffsetX(-8)
        .failOffsetY([-16, 16])
        .onEnd((event) => {
          if (menuOpenValue.get()) return;
          if (event.translationX < 48 && event.velocityX < 650) return;
          scheduleOnRN(voiceOpenValue.get() ? leaveVoiceMode : leaveConversation);
        }),
    [menuOpenValue, voiceOpenValue, leaveVoiceMode, leaveConversation],
  );

  // Hold the turn the stop was asked for, not a flag: the host clears the turn
  // when the stop lands, and the next turn must not inherit a pending state.
  const [stoppingTurnId, setStoppingTurnId] = useState<string | null>(null);
  const stopping = stoppingTurnId !== null && stoppingTurnId === activeTurnId;

  const requestStop = useMemo(() => {
    if (!stopTurn || !activeTurnId) return undefined;
    const turnId = activeTurnId;
    return () => {
      setStoppingTurnId(turnId);
      setSendError(null);
      void haptics.impact();
      stopTurn(turnId).catch((error: unknown) => {
        void haptics.notification("error");
        setStoppingTurnId((current) => (current === turnId ? null : current));
        setSendError({
          cause: classifyFailure(error),
          context: failureContext,
          agentId: target.id,
          message: errorMessage(error, t("mobile.chat.composer.stopFailed")),
        });
      });
    };
  }, [stopTurn, activeTurnId, target.id, errorMessage, t, failureContext]);

  function sendMessage(value: string): void {
    if (!canSend) return;
    const body = value.trim();
    const files = attachments.items;
    if (!body && files.length === 0) return;
    // Files given back by Edit can add up to more than one message takes.
    if (files.length > INPUT_LIMITS.attachments) {
      const message = t("mobile.chat.attachment.limit", { limit: INPUT_LIMITS.attachments });
      void haptics.notification("error");
      setSendError({
        cause: classifyFailure(new Error(message)),
        context: failureContext,
        agentId: target.id,
        message,
      });
      return;
    }
    // While the agent asks a question, the composer text is the answer. Files still go as a message.
    if (answersQuestion && questionForm && files.length === 0) {
      if (!body || questionForm.disabled) return;
      Keyboard.dismiss();
      void haptics.impact();
      setDraft("");
      questionForm.answer([mentionDraft(body).text]);
      for (const id of takeEditedMessages()) void outbox.cancel(id);
      return;
    }

    setDraft("");
    const submittedReply = replyTarget;
    setReplyTarget(null);
    const replaces = takeEditedMessages();
    // While text of a message is selected, the composer text says how to change it, as Describe
    // edits on desktop. A message with files goes as a usual message.
    if (selection && body && files.length === 0) {
      deliver(
        serializeSelectionInstruction(body, selectionQuote),
        hostMessageId(selection.message.id),
        files,
        replaces,
      );
    } else {
      deliver(body, submittedReply ? hostMessageId(submittedReply.id) : null, files, replaces);
    }
    attachments.clear();
  }

  /** The composer sends what Edit gave it: the messages it came from are replaced. */
  function takeEditedMessages(): string[] {
    const ids = [...editedMessages.current];
    editedMessages.current.clear();
    return ids;
  }

  function deliver(
    text: string,
    replyToMessageId: string | null,
    files: typeof attachments.items,
    replaces: readonly string[] = [],
  ): OutboxMessage {
    setSendError(null);
    setSelection(null);
    // The reply comes at the latest message, which a window around a searched message does not show.
    if (detached) showLatest();
    // The send animation starts from the loaded history. Without it, as offline, the row shows at once:
    // the animation would hide the first message until a history that does not load.
    if (!sendsToQueue && ready) motion.beginSend();
    Keyboard.dismiss();
    void haptics.impact();
    setShowStarter(false);
    // The outbox keeps the message on this phone and sends it while the server is online.
    return outbox.add(
      target.kind === "agent"
        ? { kind: "agent", serverId: target.serverId, agentId: target.id }
        : {
            kind: "channel",
            serverId: target.serverId,
            channelId: target.id,
            recipientAgentId: channelRecipient(
              text,
              target.members.map((member) => ({ agentId: member.id })),
            ),
          },
      { text, replyToMessageId, files },
      replaces,
    );
  }

  /** Explain, Improve and the other selection actions send at once, as on desktop. */
  function sendSelectionAction(instruction: string): void {
    if (!canSend || !selection) return;
    deliver(serializeSelectionInstruction(instruction, selectionQuote), hostMessageId(selection.message.id), []);
  }

  // The messages whose text and files are in the composer. The composer draft is not saved, so the
  // outbox keeps them until it sends, and they come back stopped when the chat closes.
  const editedMessages = useRef(new Set<string>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const edited = editedMessages.current;
    return () => {
      mounted.current = false;
      outbox.stopEditing(edited);
    };
  }, [outbox]);
  /**
   * Puts the text, reply and files of an outbox message in the composer. A ref, so that a streamed
   * reply does not draw the pending rows again.
   */
  const editOutboxMessage = useRef<(clientMessageId: string) => Promise<void>>(async () => {});
  editOutboxMessage.current = async (clientMessageId) => {
    let restored: OutboxDraft | null;
    try {
      restored = await outbox.edit(clientMessageId);
    } catch (error) {
      void haptics.notification("error");
      setSendError({
        cause: classifyFailure(error),
        context: failureContext,
        agentId: target.id,
        message: errorMessage(error, t("mobile.chat.outbox.editFailed")),
      });
      return;
    }
    if (!restored) return;
    // The chat closed while Edit read the message: no composer has it.
    if (!mounted.current) {
      outbox.stopEditing([clientMessageId]);
      return;
    }
    editedMessages.current.add(clientMessageId);
    const { text: body, replyToMessageId, files } = restored;
    if (body) setDraft((current) => (current ? `${body}\n${current}` : body));
    const reply = projectedMessages.find(
      (message): message is ChatBubbleMessage => message.kind === "message" && message.id === replyToMessageId,
    );
    if (reply) setReplyTarget((current) => current ?? reply);
    if (files.length) attachments.restore(files);
    setSendRetryVersion((version) => version + 1);
  };
  const cancelSend = useRef(motion.cancelSend);
  useEffect(() => {
    cancelSend.current = motion.cancelSend;
  });
  // A stopped upload is the person's own choice: the text and files go back to the composer, and no
  // error is needed to explain it.
  useEffect(() => {
    const returned = outboxMessages.filter((message) => message.returned);
    if (!returned.length) return;
    cancelSend.current();
    for (const message of returned) void editOutboxMessage.current(message.clientMessageId);
  }, [outboxMessages]);
  const outboxStatuses = useMemo(() => {
    const statuses = new Map<string, OutboxRowStatus>();
    // The waiting messages share one status line, under the last of them.
    const lastWaiting = outboxMessages.findLast((message) => message.state === "waiting");
    for (const message of outboxMessages)
      if (message.state === "waiting" || message.state === "failed")
        statuses.set(outboxRowId(message), {
          message,
          online: serverOnline,
          showStatus: message.state === "failed" || message === lastWaiting,
          retry: () => outbox.retry(message.clientMessageId),
          edit: () => void editOutboxMessage.current(message.clientMessageId),
          cancel: () => void outbox.cancel(message.clientMessageId),
        });
    return statuses;
  }, [outboxMessages, serverOnline, outbox]);

  const replyToMessage = useCallback((message: ChatBubbleMessage) => {
    setReplyTarget(message);
    setReplyFocusVersion((version) => version + 1);
  }, []);
  const latestSend = useRef(sendMessage);
  latestSend.current = sendMessage;
  const send = useCallback((value: string) => latestSend.current(value), []);
  const cancelReply = useCallback(() => setReplyTarget(null), []);
  const dismissStarter = useCallback(() => setShowStarter(false), []);
  const respondToApproval = useCallback(
    (approval: PendingApproval, decision: ApprovalDecision) =>
      workspace().respondToApproval(target.serverId, { requestId: approval.requestId, decision }),
    [workspace, target.serverId],
  );
  const react = useCallback(
    (message: ChatBubbleMessage, emoji: string | null) =>
      workspace().setMessageReaction(target.id, target.serverId, hostMessageIds.get(message.id) ?? message.id, emoji),
    [workspace, target.id, target.serverId, hostMessageIds],
  );
  // The reaction route is an agent route. A channel message has no reaction.
  const canReact = target.kind === "agent";
  // Select text starts the selection, and a second tap on it ends the selection.
  const selectText = useCallback((message: ChatBubbleMessage) => {
    Keyboard.dismiss();
    setSelection((current) => (current?.message.id === message.id ? null : { message, selected: "" }));
  }, []);
  const changeSelection = useCallback(
    (selected: string) =>
      setSelection((current) => (current && current.selected !== selected ? { ...current, selected } : current)),
    [],
  );
  const selectNatively = useCallback(
    (message: ChatBubbleMessage, selected: string) =>
      setSelection((current) => {
        if (selected) {
          return current?.message.id === message.id && current.selected === selected ? current : { message, selected };
        }
        // An empty selection ends only the selection of its own message.
        return current?.message.id === message.id ? null : current;
      }),
    [],
  );
  const dismissSelection = useCallback(() => setSelection(null), []);
  const listUpload = useMemo(
    () =>
      sendingMessage && sendingUpload && !sendsToQueue
        ? {
            messageId: outboxRowId(sendingMessage),
            ...sendingUpload,
            cancel: () => outbox.cancelUpload(sendingMessage.clientMessageId),
          }
        : null,
    [sendingMessage, sendingUpload, sendsToQueue, outbox],
  );

  return (
    <GestureDetector gesture={edgeBackGesture}>
      <View className="flex-1" style={{ backgroundColor: background }}>
        <View
          className="flex-1"
          // Nothing here may switch on the card: this view is an ancestor of
          // the focused input, and each of pointerEvents and
          // accessibilityElementsHidden can take first responder with it, and
          // the keyboard with that. The card's own backdrop absorbs the taps,
          // and its accessibilityViewIsModal hides this from VoiceOver on iOS.
          // Android has no such flag, so it keeps the one prop that is its own.
          importantForAccessibility={attachments.menuOpen ? "no-hide-descendants" : "auto"}
        >
          <KeyboardGestureArea
            style={{ flex: 1 }}
            textInputNativeID="chat-composer-input"
            interpolator="ios"
            // No offset. KeyboardGestureArea turns one into an invisible
            // inputAccessoryView on the focused input, which makes the strip
            // over the composer part of the keyboard: iOS then refuses to put
            // the attachment menu on the plus it belongs to and floats it above
            // that strip instead. A swipe down still dismisses the keyboard
            // from the message list, only not from the composer itself.
            enableSwipeToDismiss={!(isAndroid && suggestionsOpen)}
          >
            <ChatHeader
              target={target}
              needsAction={needsAction && !readOnly}
              channelBrowser={readOnly ? null : channelBrowser}
              fallbackBackground={fieldBackground}
              foreground={foreground}
              liquidGlassAvailable={liquidGlassAvailable}
              topInset={insets.top}
              onBack={leaveConversation}
              threadMenu={threadMenu}
              // The dictation overlay covers the chat. It blocks touches, and this
              // keeps screen readers on the transcript and the voice controls.
              accessibilityHidden={dictating}
            />
            <ChatMessageList
              agents={serverAgents}
              rowsShown={rowsShown}
              target={target}
              accessibilityHidden={dictating}
              motion={motion}
              sending={Boolean(sendingMessage)}
              awaitingTurn={awaitingTurn}
              keyboardOffset={keyboardOffset}
              canSend={serverOnline && canSend}
              online={serverOnline}
              activity={activity}
              activities={activities}
              historyState={
                ready
                  ? "ready"
                  : server?.initialConnectionPending
                    ? "connecting"
                    : !serverOnline
                      ? "waiting"
                      : historyLoadFailed
                        ? "error"
                        : "loading"
              }
              appActive={appActive}
              activeTurnId={activeTurnId}
              turnSummaries={turnSummaries}
              onOpenTurn={thinkingAgentId ? openTurn : undefined}
              // The form is a new object on each render. Without a question the list does not read it,
              // so it is left out and does not draw the list again.
              questionForm={questionForm?.messageId ? questionForm : undefined}
              onSelectQuestion={readOnly ? undefined : onSelectQuestion}
              activityAccessory={activityAccessory}
              approvals={readOnly ? undefined : approvals}
              browserRequests={chatBrowserRequests}
              serverName={server?.name ?? ""}
              onRespondApproval={respondToApproval}
              fieldBackground={fieldBackground}
              foreground={foreground}
              messages={messages}
              messageAliases={messageAliases}
              referenceMessages={referenceMessages}
              hasOlder={hasOlder}
              olderLoading={olderLoading}
              olderError={olderError}
              onLoadOlder={loadOlder}
              onReply={readOnly ? undefined : replyToMessage}
              onReact={canReact && !readOnly ? react : undefined}
              selectingMessageId={selection?.message.id ?? null}
              onSelectText={selectText}
              onSelectionChange={changeSelection}
              onNativeSelection={selectNatively}
              onDismissSelection={dismissSelection}
              muted={muted}
              raised={raised}
              showStarter={
                showStarter && serverOnline && canSend && ready && !activity && projectedMessages.length === 0
              }
              topInset={insets.top}
              onDismissStarter={dismissStarter}
              onSelectStarter={send}
              onRetryHistory={fetchHistory}
              focusMessageId={focusMessageId}
              onFocusPlaced={onFocusPlaced}
              upload={listUpload}
              outboxStatuses={outboxStatuses}
            />
            {dictating ? (
              <VoiceOverlay
                voice={voice}
                hint={voice.phase === "listening" ? t("mobile.chat.voice.listening") : ""}
                reply={replyTarget ? mentionDraft(replyTarget.body).text || t("mobile.chat.reply.attachment") : null}
                muted={muted}
                topInset={insets.top}
                controlsHeight={Math.max(insets.bottom, 10) + VOICE_BUTTON_SIZE + 48}
                reducedTransparency={reducedTransparency}
              />
            ) : null}
            <Animated.View
              style={[
                // Above the voice overlay, which covers the header, while the voice mode is open.
                { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: voiceOpen ? 31 : undefined },
                motion.composerStyle,
              ]}
              pointerEvents="box-none"
              onLayout={motion.onComposerLayout}
            >
              {!voiceOpen && (detached || !atLatest) && motion.historyVisible && messages.length > 0 ? (
                <View className="absolute -top-14 self-center">
                  <ChatGlassIconButton
                    accessibilityLabel={t("mobile.chat.scrollToLatest")}
                    fallbackBackground={fieldBackground}
                    liquidGlassAvailable={liquidGlassAvailable}
                    onPress={showLatest}
                  >
                    <ArrowDown color={String(foreground)} size={22} />
                  </ChatGlassIconButton>
                </View>
              ) : null}
              <View style={{ paddingLeft: insets.left, paddingRight: insets.right }}>
                <ConnectionStatus
                  server={server}
                  // The history waits for the server: the chat says so under the reconnect status.
                  note={
                    !ready && !server?.initialConnectionPending && !serverOnline
                      ? t("mobile.chat.history.waiting")
                      : null
                  }
                />
              </View>
              {showBrowserRequests
                ? chatBrowserRequests
                    .filter((request) => !asksForSecret(request))
                    .map((request) => (
                      <BrowserTakeoverCard
                        key={`${target.serverId}:${request.requestId}`}
                        request={request}
                        respondToTakeover={(decision) =>
                          workspace().respondToBrowserTakeover(target.serverId, {
                            requestId: request.requestId,
                            decision,
                          })
                        }
                        openBrowser={
                          browserAllowed && browserViewAvailable
                            ? () =>
                                router.push({
                                  pathname: "/browser/[agentId]",
                                  params: {
                                    agentId: request.agentId,
                                    serverId: target.serverId,
                                    tabId: request.tabId,
                                  },
                                })
                            : undefined
                        }
                      />
                    ))
                : null}
              {sendError?.agentId === target.id ? (
                <Typography.Paragraph
                  accessibilityRole="alert"
                  className="bg-background py-2 text-danger-text"
                  style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
                >
                  {sendError.message}
                </Typography.Paragraph>
              ) : null}
              {outboxSnapshot.storageFailed && outboxMessages.length ? (
                <Typography.Paragraph
                  accessibilityRole="alert"
                  className="bg-background py-2 text-danger-text"
                  style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
                >
                  {t("mobile.chat.outbox.saveFailed")}
                </Typography.Paragraph>
              ) : null}
              {queue && !notice ? (
                <ChatQueueButton
                  chatId={queue.chatId}
                  count={queueCount}
                  error={Boolean(queue.error)}
                  waiting={queue.waiting.length > 0}
                  liquidGlassAvailable={liquidGlassAvailable}
                  fallbackBackground={fieldBackground}
                />
              ) : null}
              {/* Mounted while it leaves, so its capsules can animate out. */}
              <ChatSelectionBar
                visible={Boolean(selection) && !voiceOpen}
                canSend={canSend}
                liquidGlassAvailable={liquidGlassAvailable}
                fallbackBackground={fieldBackground}
                onAction={sendSelectionAction}
              />
              {notice ? (
                // As a closed task: the chat takes no messages, and a note takes the place of the composer.
                <Typography.Paragraph
                  type="body-xs"
                  align="center"
                  className="pt-2 text-text-secondary"
                  style={{
                    paddingLeft: insets.left + 24,
                    paddingRight: insets.right + 24,
                    paddingBottom: Math.max(insets.bottom, 10) + 6,
                  }}
                >
                  {notice}
                </Typography.Paragraph>
              ) : secretRequest ? (
                <BrowserSecretComposer
                  key={`${target.serverId}:${secretRequest.requestId}`}
                  request={secretRequest}
                  respond={(input) => workspace().respondToBrowserSecret(target.serverId, input)}
                  bottomInset={insets.bottom}
                  liquidGlassAvailable={liquidGlassAvailable}
                  fallbackBackground={fieldBackground}
                  foreground={foreground}
                  muted={muted}
                  action={action}
                  actionForeground={actionForeground}
                />
              ) : (
                <ChatComposer
                  sendRetryVersion={sendRetryVersion}
                  replyTarget={replyTarget}
                  replyFocusVersion={replyFocusVersion}
                  focusVersion={answerFocusVersion}
                  handoffFocusVersion={handoffFocusVersion}
                  onCancelReply={cancelReply}
                  mentionAgents={mentionAgents}
                  mentionSkills={mentionSkills}
                  skillPickerVersion={skillPickerVersion}
                  onSuggestionsVisibleChange={setSuggestionsOpen}
                  key={target.id}
                  action={action}
                  actionForeground={actionForeground}
                  agentName={target.name}
                  placeholder={
                    answersQuestion
                      ? t("mobile.chat.question.answerPlaceholder")
                      : selection
                        ? t("mobile.chat.selection.describe")
                        : undefined
                  }
                  bottomInset={insets.bottom}
                  disabled={!canSend}
                  attachments={attachments}
                  draft={draft}
                  fallbackBackground={fieldBackground}
                  foreground={foreground}
                  liquidGlassAvailable={liquidGlassAvailable}
                  muted={muted}
                  raised={raised}
                  onChangeDraft={setDraft}
                  onSend={send}
                  onStop={requestStop}
                  keyboardProgress={motion.keyboardProgress}
                  menuOpen={attachments.menuOpen}
                  menuProgress={menuProgress}
                  stopping={stopping}
                  voice={composerVoice}
                  // An agent's own colour; a channel keeps the default controls.
                  voiceAccent={target.kind === "agent" ? accent : undefined}
                  voicePalette={palette}
                  voiceAvatar={
                    voiceAgent ? (
                      <VoiceAgentAvatar
                        agentId={voiceAgent.id}
                        serverId={target.serverId}
                        seed={voiceAgent.avatarSeed}
                        hue={voiceAgent.avatarHue}
                      />
                    ) : undefined
                  }
                />
              )}
            </Animated.View>
          </KeyboardGestureArea>
        </View>
        {/* Not gated on `appActive`. The camera permission prompt makes iOS
            report the app inactive, and unmounting the card under it lost the
            selection that asked for the prompt: the card came back on the
            options and the first Camera never opened. The card stays and stops
            its preview instead. */}
        {attachments.menuAnchor && isFocused ? (
          <ChatAttachmentPanel
            anchor={attachments.menuAnchor}
            appActive={appActive}
            attachments={attachments}
            fallbackBackground={fieldBackground}
            foreground={foreground}
            keyboardHeight={motion.keyboardHeight}
            keyboardOffset={keyboardOffset}
            liquidGlassAvailable={liquidGlassAvailable}
            onClose={attachments.closeMenu}
            onUseSkill={mentionSkills?.length ? () => setSkillPickerVersion((version) => version + 1) : undefined}
            progress={menuProgress}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}
