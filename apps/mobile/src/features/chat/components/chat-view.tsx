import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
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
import { type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, useColorScheme, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { MobileConversationAnalytics } from "@/features/analytics/conversation";
import { reportMobileNotification } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { channelRecipient } from "@/features/channels/model/channel-draft";
import type { ApprovalDecision } from "@/features/chat/components/chat-approval-card";
import { ChatComposer, type MentionReference, type MentionSkill } from "@/features/chat/components/chat-composer";
import { ChatEndPullRing, useChatEndPull } from "@/features/chat/components/chat-end-pull";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import type { ChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import type { ComposerContextMeter } from "@/features/chat/components/composer-context-ring";
import { type ChatAttachment, useChatAttachments } from "@/features/chat/components/use-chat-attachments";
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
import {
  answerlessTurnSummaries,
  finishedTurnSummaries,
  type TurnStepsSummary,
} from "@/features/chat/model/turn-thinking";
import { useChatBackgroundColor } from "@/features/settings/model/chat-background";
import { useChatRowShown, useThinkingDisplayPreference } from "@/features/settings/model/chat-details";
import { liveVoiceWebRtc } from "@/features/voice/model/live-voice-webrtc";
import { replyVoiceReady } from "@/features/voice/model/reply-voice";
import { speechNative } from "@/features/voice/model/speech-native";
import { useVoiceSettings } from "@/features/voice/model/voice-settings";
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
import { END_X } from "@/shared/lib/text-direction";
import { useAppActive } from "@/shared/lib/use-app-active";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { useReducedTransparency } from "@/shared/lib/use-reduced-transparency";
import { mentionDraft } from "../model/chat-mentions";
import type { ChatTarget } from "../model/chat-target";
import { getComposerDraft, useComposerDraft } from "../model/composer-drafts";
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
import {
  asksForSecret,
  BrowserSecretComposer,
  BrowserTakeoverCard,
  QuestionSecretComposer,
} from "./browser-secret-card";
import { ChatBackdropLayer, useChatBackdropBase } from "./chat-backdrop-layer";
import { ChatBackdropUndo } from "./chat-backdrop-undo";
import type { OutboxRowStatus } from "./chat-outbox-status";
import { ChatQueueButton } from "./chat-queue-button";
import { ChatSelectionBar } from "./chat-selection-bar";
import { addPastedFiles, ChatDropTarget } from "./composer-paste-target";
import { type ComposerVoice, liveVoice } from "./composer-voice";
import { useAttachSheet } from "./use-attach-sheet";
import type { ChatQueueController } from "./use-chat-queue";
import { useComposerDictation, useComposerDictationWithSettings } from "./use-composer-dictation";
import { useGptLiveConversation } from "./use-gpt-live-conversation";
import { type LiveChannel, useLiveConversation } from "./use-live-conversation";

export interface ChatViewProps {
  target: ChatTarget;
  queue?: ChatQueueController;
  agents: MobileAgent[];
  mentionAgents: MobileAgent[];
  mentionSkills?: readonly MentionSkill[];
  mentionReferences?: readonly MentionReference[];
  projectedMessages: ChatMessage[];
  referenceMessages: ChatMessage[];
  ready: boolean;
  historyLoadFailed: boolean;
  canSend: boolean;
  notice?: string | null;
  statusNotes?: readonly string[];
  readOnly?: boolean;
  activity?: MobileAgentActivity;
  activities?: MobileAgentActivity[];
  activeTurnId: string | null;
  conversation?: { messages: readonly ConversationMessage[]; activeTurnId: string | null } | null;
  liveChannel?: LiveChannel | null;
  stopTurn?: (turnId: string) => Promise<void>;
  branchPoints?: ReadonlySet<string>;
  onBranch?: (messageId: string) => Promise<void>;
  deleteMessage?: (messageId: string) => Promise<void>;
  deletesAnyMessage?: boolean;
  markUnread?: (messageId: string) => void;
  markUnreadMessageIds?: ReadonlySet<string>;
  togglePin?: (messageId: string, pinned: boolean) => Promise<void>;
  pinnedMessageIds?: ReadonlySet<string>;
  unreadLineMessageIds?: ReadonlySet<string> | null;
  sendToChannel?: {
    channels: readonly { id: string; name: string }[];
    onSend: (channelId: string, text: string) => void;
  };
  questionForm?: QuestionPromptController;
  onSelectQuestion?: (messageId: string) => void;
  needsAction?: boolean;
  channelLeadAgentId?: string | null;
  channelTurnSummaries?: ReadonlyMap<string, TurnStepsSummary>;
  activityAccessory?: ReactNode;
  threadMenu?: ChatThreadMenu;
  contextMeter?: ComposerContextMeter;
  threadId?: string | null;
  channelThreadIds?: ReadonlySet<string> | null;
  approvals?: readonly PendingApproval[];
  readBoundary: string | null;
  markRead: () => void;
  fetchHistory: () => void;
  hasOlder: boolean;
  olderLoading: boolean;
  olderError: boolean;
  loadOlder: () => void;
  focusMessageId?: string | null;
  focusUnread?: boolean;
  holdOpening?: boolean;
  catchingUp?: boolean;
  onFocusPlaced?: () => void;
  detached?: boolean;
  showLatestMessages?: () => Promise<void>;
  onLeave: () => void;
  onSwipeForward?: (() => void) | null;
  onPullPastEnd?: (() => void) | null;
}

const CHAT_BACK_EDGE_WIDTH = 24;
const BACKDROP_UNDO_TOP = 64;
const SWIPE_FORWARD_DISTANCE = 72;
const SWIPE_FORWARD_FLICK_DISTANCE = 32;
const SWIPE_FORWARD_FLICK_VELOCITY = 650;
const NO_DELIVERIES: ChatQueueController["deliveries"] = [];
const AWAIT_TURN_MS = 10_000;

const outboxRows = new WeakMap<OutboxMessage, ChatBubbleMessage>();

function outboxRow(outbox: OutboxStore, message: OutboxMessage): ChatBubbleMessage {
  let row = outboxRows.get(message);
  if (!row) {
    for (const file of message.files) if (file.dimensions) rememberImageDimensions(file.id, file.dimensions);
    row = outboxChatMessage(message, (file) => outbox.previewUri(message, file));
    outboxRows.set(message, row);
  }
  return row;
}

const OPEN_TRANSITION_DEADLINE_MS = 700;

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
  mentionReferences,
  projectedMessages,
  referenceMessages,
  ready,
  historyLoadFailed,
  canSend,
  notice = null,
  statusNotes,
  readOnly = false,
  activity,
  activities,
  activeTurnId,
  conversation = null,
  liveChannel = null,
  stopTurn,
  branchPoints,
  onBranch,
  deleteMessage,
  deletesAnyMessage = false,
  markUnread,
  markUnreadMessageIds,
  togglePin,
  pinnedMessageIds,
  unreadLineMessageIds = null,
  sendToChannel,
  questionForm,
  onSelectQuestion,
  needsAction = false,
  channelLeadAgentId = null,
  channelTurnSummaries,
  activityAccessory,
  threadMenu,
  contextMeter,
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
  focusUnread = false,
  holdOpening = false,
  catchingUp = false,
  onFocusPlaced,
  detached = false,
  showLatestMessages,
  onLeave: leaveConversation,
  onSwipeForward = null,
  onPullPastEnd = null,
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
          : channelThreadIds?.size
            ? channelThreadIds.has(request.threadId)
            : target.members.some((member) => member.id === request.agentId),
      ),
    [browserRequests, target, threadId, channelThreadIds],
  );
  const browserAllowed = useBrowserFeature();
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
  const appActive = useAppActive();
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
  const [selection, setSelection] = useState<{ message: ChatBubbleMessage; selected: string } | null>(null);
  const selectionQuote = selection ? selection.selected.trim() || markdownPlainText(selection.message.body) : "";
  const [replyFocusVersion, setReplyFocusVersion] = useState(0);
  const draftChat = useMemo(
    () => ({ kind: target.kind, serverId: target.serverId, id: target.id }),
    [target.kind, target.serverId, target.id],
  );
  const [sharedDraft, setSharedDraft] = useComposerDraft(draftChat);
  const editedMessages = useRef(new Set<string>());
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const draftBeforeEdit = useRef("");
  const draft = editDraft ?? sharedDraft;
  const setDraft = useCallback(
    (value: SetStateAction<string>) => {
      if (!editedMessages.current.size) return setSharedDraft(value);
      setEditDraft((current) => (typeof value === "function" ? value(current ?? "") : value));
    },
    [setSharedDraft],
  );
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
  const [skillPickerVersion, setSkillPickerVersion] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const composerAttachments = useChatAttachments([], undefined, () => workspace().attachmentSupport(target.serverId));
  const attachments = composerAttachments;
  const [messageAliases, setMessageAliases] = useState<ReadonlyMap<string, string>>(new Map());
  const hostMessageIds = useMemo(
    () => new Map([...messageAliases].map(([hostId, rowId]) => [rowId, hostId])),
    [messageAliases],
  );
  const hostMessageId = (id: string) => hostMessageIds.get(id) ?? id;
  const [showStarter, setShowStarter] = useState(true);
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
  const sendsToQueue = Boolean(queue && (activeTurnId || queue.queued.length || queue.replies.length));
  const queueSends = useRef(new Set<string>());
  if (sendingMessage && sendsToQueue) queueSends.current.add(sendingMessage.clientMessageId);
  const queueDeliveries = queue?.deliveries;
  const sentToQueue =
    outboxMessages.find(
      (message) =>
        message.state === "sent" &&
        queueSends.current.has(message.clientMessageId) &&
        !queueDeliveries?.some((delivery) => delivery.id === message.messageId),
    ) ?? null;
  const queuePending = useMemo(() => {
    if (sendsToQueue && sendingMessage)
      return {
        message: outboxRow(outbox, sendingMessage),
        progress: sendingUpload?.completed ?? 0,
        total: sendingMessage.files.length,
        cancel: () => outbox.cancelUpload(sendingMessage.clientMessageId),
      };
    return sentToQueue ? { message: outboxRow(outbox, sentToQueue), progress: 0, total: 0, cancel: () => {} } : null;
  }, [sentToQueue, sendsToQueue, sendingMessage, sendingUpload?.completed, outbox]);
  const queued = queue?.queued;
  const heldQueueEdit = queue?.edit?.delivery ?? null;
  const queueRows = useMemo(
    () => (queued ? queueRowsWithHeldEdit(queued, heldQueueEdit) : []),
    [queued, heldQueueEdit],
  );
  const queueCount = queueRows.length + (queuePending ? 1 : 0);
  usePublishedQueuedChat(queue?.chatId ?? `${target.serverId}:${target.id}`, queue ?? null, queuePending);
  const turnLines = useTurnStepLines(target.serverId);
  const conversationMessages = conversation?.messages;
  const conversationTurnId = conversation?.activeTurnId ?? null;
  const lastTurnSummaries = useRef<ReadonlyMap<string, TurnStepsSummary> | undefined>(undefined);
  const agentTurnSummaries = useMemo(() => {
    lastTurnSummaries.current =
      conversationMessages && target.kind === "agent"
        ? finishedTurnSummaries(conversationMessages, conversationTurnId, turnLines, lastTurnSummaries.current)
        : undefined;
    return lastTurnSummaries.current;
  }, [conversationMessages, conversationTurnId, turnLines, target.kind]);
  const showThinking = useThinkingDisplayPreference((state) => state.enabled);
  const agentAnswerlessSummaries = useMemo(() => answerlessTurnSummaries(agentTurnSummaries), [agentTurnSummaries]);
  const turnSummaries = showThinking
    ? (agentTurnSummaries ?? channelTurnSummaries)
    : (agentAnswerlessSummaries ?? channelTurnSummaries);
  const rowShown = useChatRowShown(turnSummaries);
  const thinkingAgentId = target.kind === "agent" ? target.id : null;
  const openTurn = useCallback(
    (turnId: string) => {
      if (thinkingAgentId) router.push({ pathname: "/turn-thinking", params: { agentId: thinkingAgentId, turnId } });
    },
    [thinkingAgentId],
  );
  const openMemoryChanges = useCallback(
    (messageId: string) => {
      if (thinkingAgentId)
        router.push({ pathname: "/memory-changes", params: { agentId: thinkingAgentId, messageId } });
    },
    [thinkingAgentId],
  );
  const openSubagents = useCallback(
    (messageId: string) => {
      if (thinkingAgentId)
        router.push({
          pathname: "/subagent",
          params: { agentId: thinkingAgentId, serverId: target.serverId, messageId },
        });
    },
    [thinkingAgentId, target.serverId],
  );
  const queuedMessageIds = useMemo(
    () =>
      new Set(
        queue?.deliveries
          .filter((item) => (item.status === "queued" || item.status === "cancelled") && item.sender.kind !== "routine")
          .map((item) => item.id) ?? [],
      ),
    [queue?.deliveries],
  );
  const sendBaselines = useRef(new Map<string, ReadonlySet<string>>());
  if (
    sendingMessage &&
    outboxSnapshot.storing.has(sendingMessage.clientMessageId) &&
    !sendBaselines.current.has(sendingMessage.clientMessageId)
  )
    sendBaselines.current.set(sendingMessage.clientMessageId, new Set(projectedMessages.map((message) => message.id)));
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
        queuedMessageIds.size ? projectedMessages.filter((item) => !queuedMessageIds.has(item.id)) : projectedMessages,
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
    const received = outboxMessages.filter((message) => message.messageId !== null);
    if (received.some((message) => message.messageId !== null && !messageAliases.has(message.messageId)))
      setMessageAliases((current) => {
        const next = new Map(current);
        for (const message of received) if (message.messageId) next.set(message.messageId, outboxRowId(message));
        return next;
      });
    if (!received.length) return;
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
  const answersQuestion = Boolean(
    questionForm?.question && !questionForm.question.isSecret && questionForm.replyInChat,
  );
  const [answerFocusVersion, setAnswerFocusVersion] = useState(0);
  useEffect(() => {
    if (answersQuestion) setAnswerFocusVersion((version) => version + 1);
  }, [answersQuestion]);
  const composerRequest = useComposerRequest((state) => state.request);
  useEffect(() => {
    if (!isFocused || !composerRequest) return;
    const request = takeComposerRequest({ kind: target.kind, serverId: target.serverId, id: target.id });
    if (!request) return;
    const files = request.files ?? [];
    void composerAttachments
      .addShared(request.text, files, (text) => setDraft((current) => (current ? `${current}\n${text}` : text)))
      .finally(() => deleteComposerFiles(files));
  }, [isFocused, composerRequest, target.kind, target.serverId, target.id, composerAttachments.addShared, setDraft]);
  const composerFocus = useComposerRequest((state) => state.focus);
  const [handoffFocusVersion, setHandoffFocusVersion] = useState(0);
  useEffect(() => {
    if (!isFocused || !composerFocus) return;
    if (takeComposerFocus({ kind: target.kind, serverId: target.serverId, id: target.id }))
      setHandoffFocusVersion((version) => version + 1);
  }, [isFocused, composerFocus, target.kind, target.serverId, target.id]);
  const lastUserId =
    messages.findLast((message) => message.kind === "message" && message.author === "user")?.id ?? null;
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
  const awaitedReceipts = useRef(new Set<string>());
  useEffect(() => {
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
    ready && rowsShown,
    rowsShown && messages.some(rowShown),
    lastUserId,
    questionForm?.question ? (questionForm.messageId ?? null) : null,
    holdOpening,
    catchingUp,
  );
  const atLatest = motion.atLatest;
  const showLatest = (pin: boolean) => {
    if (!detached || !showLatestMessages) {
      if (pin) motion.pinToLatest();
      else motion.scrollToLatest();
      return;
    }
    void showLatestMessages().then(
      () => motion.returnToLatest(pin),
      () => undefined,
    );
  };
  const liquidGlassAvailable = isLiquidGlassAvailable() && !reducedTransparency;
  const serverOnline = showsOnline(server);
  const dictation = useComposerDictation({
    enabled: isFocused && serverOnline && canSend && !readOnly && !notice,
    focused: isFocused,
    draft,
    onDraft: setDraft,
  });
  const writable = canSend && !readOnly && !notice;
  const voiceMissing = !speechNative;
  const composerDictation = useComposerDictationWithSettings(dictation);
  const gptLiveChosen = useVoiceSettings((state) => state.gptLive);
  const gptLiveVoice = useVoiceSettings((state) => state.gptLiveVoice);
  const serverLiveVoice = useMobileWorkspaceSelector((current) => current.canUseLiveVoice(target.serverId));
  const gptLive = useGptLiveConversation({
    active: target.kind === "agent" && gptLiveChosen && serverLiveVoice && liveVoiceWebRtc !== null,
    enabled: isFocused && writable,
    online: serverOnline,
    focused: isFocused,
    foreground: foregroundVisit,
    agentId: target.id,
    voice: gptLiveVoice,
    serverId: target.serverId,
    startSession: (input) => workspace().startLiveVoice(input, target.serverId),
    stopSession: (sessionId) => workspace().stopLiveVoice(sessionId, target.serverId),
  });
  const phoneLive = useLiveConversation({
    enabled: isFocused && writable && !gptLive.open,
    online: serverOnline,
    focused: isFocused,
    foreground: foregroundVisit,
    conversation,
    provider: failureAgent?.provider,
    channel: liveChannel,
    deliveries: queue?.deliveries ?? NO_DELIVERIES,
    outboxMessages,
    send: (text) => (writable ? deliver(text, null, []) : null),
  });
  const usesGptLive = gptLive.open || (gptLive.available && !phoneLive.open);
  const live = usesGptLive ? gptLive : phoneLive;
  const voiceAgent =
    target.kind === "agent"
      ? target
      : (target.members.find((member) => member.id === (live.speakerId ?? channelLeadAgentId)) ?? null);
  const showBrowserRequests = serverOnline && foregroundVisit && isFocused && !readOnly;
  const {
    available: liveAvailable,
    open: liveOpen,
    exit: liveExit,
    phase: livePhase,
    muted: liveMuted,
    micOpen: liveMicOpen,
    level: liveLevel,
    presence: livePresence,
    start: liveStart,
    toggleMute: liveToggleMute,
    interrupt: liveInterrupt,
    end: liveEnd,
    error: liveError,
    caption: liveCaption,
  } = live;
  const voiceName = voiceAgent?.name ?? target.name;
  const liveVoiceMissing = voiceMissing && (conversation !== null || liveChannel !== null);
  const composerVoice = useMemo((): ComposerVoice | undefined => {
    if (!liveAvailable && !liveOpen && !liveVoiceMissing) return undefined;
    const source = {
      available: liveAvailable,
      open: liveOpen,
      exit: liveExit,
      phase: livePhase,
      muted: liveMuted,
      micOpen: liveMicOpen,
      level: liveLevel,
      presence: livePresence,
      start: liveStart,
      toggleMute: liveToggleMute,
      interrupt: liveInterrupt,
      end: liveEnd,
      error: liveError,
      caption: liveCaption,
    };
    const openSettings = () => router.push("/settings/voice");
    if (!liveAvailable && !liveOpen)
      return { ...liveVoice(source, voiceName, t), available: true, start: openSettings };
    return {
      ...liveVoice(source, voiceName, t),
      start: () => (usesGptLive || replyVoiceReady() ? liveStart() : openSettings()),
    };
  }, [
    liveAvailable,
    liveOpen,
    liveExit,
    livePhase,
    liveMuted,
    liveMicOpen,
    liveLevel,
    livePresence,
    liveStart,
    liveToggleMute,
    liveInterrupt,
    liveEnd,
    liveError,
    liveCaption,
    voiceName,
    usesGptLive,
    liveVoiceMissing,
    t,
  ]);
  const voiceAgentId = voiceAgent?.id;
  const voiceAvatarSeed = voiceAgent?.avatarSeed;
  const voiceAvatarHue = voiceAgent?.avatarHue;
  const voiceAvatarColor = voiceAgent?.avatarColor;
  const voiceAvatar = useMemo(
    () =>
      voiceAgentId !== undefined && voiceAvatarSeed !== undefined ? (
        <VoiceAgentAvatar
          agentId={voiceAgentId}
          serverId={target.serverId}
          seed={voiceAvatarSeed}
          hue={voiceAvatarHue ?? null}
          color={voiceAvatarColor ?? null}
        />
      ) : undefined,
    [voiceAgentId, target.serverId, voiceAvatarSeed, voiceAvatarHue, voiceAvatarColor],
  );
  const voiceOpen = live.open;
  const dictating = dictation.active;
  const secretRequest =
    showBrowserRequests && !voiceOpen && !dictating && !attachments.menuOpen
      ? chatBrowserRequests.find(asksForSecret)
      : undefined;
  const secretQuestion =
    !secretRequest && !voiceOpen && !dictating && !attachments.menuOpen && questionForm?.question?.isSecret
      ? questionForm
      : undefined;
  const dark = useColorScheme() === "dark";
  const backdropBase = useChatBackdropBase();
  const pickedBackground = useChatBackgroundColor();
  const chatBackground = backdropBase ?? pickedBackground ?? background;
  const voiceColors = useMemo(
    () =>
      voiceAgent
        ? [avatarHeadColor(voiceAgent.avatarSeed, voiceAgent.avatarHue, voiceAgent.avatarColor)]
        : target.kind === "channel"
          ? target.members
              .slice(0, 4)
              .map((member) => avatarHeadColor(member.avatarSeed, member.avatarHue, member.avatarColor))
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

  const seesLatest = !detached && (atLatest || (motion.historyVisible && !motion.userScrolled));
  useEffect(() => {
    if (!sendingMessage && isFocused && appActive && seesLatest && serverOnline && readBoundary) markRead();
  }, [sendingMessage, isFocused, appActive, seesLatest, serverOnline, readBoundary, markRead]);

  const menuOpenValue = useSharedValue(false);
  const menuProgress = useSharedValue(0);
  useEffect(() => {
    menuOpenValue.set(attachments.menuOpen);
  }, [attachments.menuOpen, menuOpenValue]);
  const voiceOpenValue = useSharedValue(false);
  useEffect(() => {
    voiceOpenValue.set(voiceOpen || dictating);
  }, [voiceOpen, dictating, voiceOpenValue]);
  const voiceBack = useRef(live.end);
  useEffect(() => {
    voiceBack.current = live.open ? live.end : dictation.finish;
  });
  const leaveVoiceMode = useCallback(() => voiceBack.current(), []);
  const edgeBackGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isIOS)
        .hitSlop(END_X === 1 ? { left: 0, width: CHAT_BACK_EDGE_WIDTH } : { right: 0, width: CHAT_BACK_EDGE_WIDTH })
        .activeOffsetX(12 * END_X)
        .failOffsetX(-8 * END_X)
        .failOffsetY([-16, 16])
        .onEnd((event) => {
          if (menuOpenValue.get()) return;
          if (event.translationX * END_X < 48 && event.velocityX * END_X < 650) return;
          scheduleOnRN(voiceOpenValue.get() ? leaveVoiceMode : leaveConversation);
        }),
    [menuOpenValue, voiceOpenValue, leaveVoiceMode, leaveConversation],
  );

  const swipeForwardOn = useSharedValue(onSwipeForward !== null && !selection);
  const swipeForwardAction = useRef(onSwipeForward);
  const selecting = Boolean(selection);
  useEffect(() => {
    swipeForwardAction.current = onSwipeForward;
    swipeForwardOn.set(onSwipeForward !== null && !selecting);
  }, [onSwipeForward, selecting, swipeForwardOn]);
  const swipeForward = useCallback(() => {
    const action = swipeForwardAction.current;
    if (!action) return;
    void haptics.impact("soft");
    action();
  }, []);
  const swipeForwardGesture = useMemo(
    () =>
      Gesture.Pan()
        .onTouchesDown((_event, manager) => {
          if (!swipeForwardOn.get() || menuOpenValue.get() || voiceOpenValue.get()) manager.fail();
        })
        .activeOffsetX(-24 * END_X)
        .failOffsetX(8 * END_X)
        .failOffsetY([-12, 12])
        .onEnd((event) => {
          const distance = -event.translationX * END_X;
          const velocity = -event.velocityX * END_X;
          if (
            distance >= SWIPE_FORWARD_DISTANCE ||
            (distance >= SWIPE_FORWARD_FLICK_DISTANCE && velocity >= SWIPE_FORWARD_FLICK_VELOCITY)
          )
            scheduleOnRN(swipeForward);
        }),
    [swipeForwardOn, menuOpenValue, voiceOpenValue, swipeForward],
  );

  const pullPastEnd = useRef(onPullPastEnd);
  pullPastEnd.current = onPullPastEnd;
  const openPastEnd = useCallback(() => pullPastEnd.current?.(), []);
  const endPull = useChatEndPull({
    motion,
    enabled: onPullPastEnd !== null && !selecting && !attachments.menuOpen && !voiceOpen && !dictating,
    onOpen: openPastEnd,
  });

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

  function sendMessage(value: string, extraFiles: readonly ChatAttachment[] = []): void {
    if (!canSend) return;
    const body = value.trim();
    const files = [...attachments.items, ...extraFiles];
    if (!body && files.length === 0) return;
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

  function takeEditedMessages(): string[] {
    const ids = [...editedMessages.current];
    if (!ids.length) return ids;
    editedMessages.current.clear();
    setEditDraft(null);
    const before = draftBeforeEdit.current;
    setSharedDraft((current) => (current === before ? "" : current));
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
    if (detached) showLatest(false);
    if (!sendsToQueue && ready) motion.beginSend();
    Keyboard.dismiss();
    void haptics.impact();
    setShowStarter(false);
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

  function sendSelectionAction(instruction: string): void {
    if (!canSend || !selection) return;
    deliver(serializeSelectionInstruction(instruction, selectionQuote), hostMessageId(selection.message.id), []);
  }

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const edited = editedMessages.current;
    return () => {
      mounted.current = false;
      outbox.stopEditing(edited);
      edited.clear();
    };
  }, [outbox]);
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
    if (!mounted.current) {
      outbox.stopEditing([clientMessageId]);
      return;
    }
    const { text: body, replyToMessageId, files } = restored;
    if (!editedMessages.current.size) draftBeforeEdit.current = getComposerDraft(draftChat);
    editedMessages.current.add(clientMessageId);
    setEditDraft((current) => {
      const base = current ?? draftBeforeEdit.current;
      return body ? (base ? `${body}\n${base}` : body) : base;
    });
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
  useEffect(() => {
    if (!isFocused) return;
    const returned = outboxMessages.filter((message) => message.returned);
    if (!returned.length) return;
    cancelSend.current();
    for (const message of returned) void editOutboxMessage.current(message.clientMessageId);
  }, [outboxMessages, isFocused]);
  const outboxStatuses = useMemo(() => {
    const statuses = new Map<string, OutboxRowStatus>();
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
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const sendRecentPhoto = useCallback((photo: ChatAttachment) => latestSend.current(latestDraft.current, [photo]), []);
  useAttachSheet(
    attachments,
    {
      context: contextMeter,
      onSendPhoto: sendRecentPhoto,
      onUseSkill: mentionSkills?.length ? () => setSkillPickerVersion((version) => version + 1) : undefined,
    },
    isFocused,
  );
  const cancelReply = useCallback(() => setReplyTarget(null), []);
  const respondToApproval = useCallback(
    (approval: PendingApproval, decision: ApprovalDecision) =>
      workspace().respondToApproval(target.serverId, { requestId: approval.requestId, decision }),
    [workspace, target.serverId],
  );
  const loadWholeApproval = useCallback(
    (approval: PendingApproval) => workspace().readWholeApproval(target.serverId, approval),
    [workspace, target.serverId],
  );
  const react = useCallback(
    (message: ChatBubbleMessage, emoji: string | null) =>
      workspace().setMessageReaction(target.id, target.serverId, hostMessageIds.get(message.id) ?? message.id, emoji),
    [workspace, target.id, target.serverId, hostMessageIds],
  );
  const canReact = target.kind === "agent";
  const branchMessage = useCallback(
    (message: ChatBubbleMessage) => void onBranch?.(hostMessageIds.get(message.id) ?? message.id),
    [onBranch, hostMessageIds],
  );
  const onSendToChannel = sendToChannel?.onSend;
  const sendMessageToChannel = useCallback(
    (message: ChatBubbleMessage, channelId: string) => onSendToChannel?.(channelId, message.body),
    [onSendToChannel],
  );
  const deleteListMessage = useCallback(
    async (message: ChatBubbleMessage) => deleteMessage?.(hostMessageIds.get(message.id) ?? message.id),
    [deleteMessage, hostMessageIds],
  );
  const markListMessageUnread = useCallback(
    (message: ChatBubbleMessage) => markUnread?.(hostMessageIds.get(message.id) ?? message.id),
    [markUnread, hostMessageIds],
  );
  const togglePinListMessage = useCallback(
    async (message: ChatBubbleMessage, pinned: boolean) =>
      togglePin?.(hostMessageIds.get(message.id) ?? message.id, pinned),
    [togglePin, hostMessageIds],
  );
  const pinnedRowIds = useMemo(
    () => (pinnedMessageIds ? new Set([...pinnedMessageIds].map((id) => messageAliases.get(id) ?? id)) : undefined),
    [pinnedMessageIds, messageAliases],
  );
  const selectText = useCallback((message: ChatBubbleMessage) => {
    Keyboard.dismiss();
    setSelection((current) => (current?.message.id === message.id ? null : { message, selected: "" }));
  }, []);
  const changeSelection = useCallback(
    (selected: string) =>
      setSelection((current) => (current && current.selected !== selected ? { ...current, selected } : current)),
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
      <View className="flex-1" style={{ backgroundColor: chatBackground }}>
        <ChatBackdropLayer variant="chat" active={isFocused} />
        <ChatDropTarget
          enabled={isFocused && writable && !secretRequest && !secretQuestion && !voiceOpen && !dictating}
          onDropFiles={(dropped) => addPastedFiles(attachments, dropped)}
        >
          <View className="flex-1" importantForAccessibility={attachments.menuOpen ? "no-hide-descendants" : "auto"}>
            <KeyboardGestureArea
              style={{ flex: 1 }}
              textInputNativeID="chat-composer-input"
              interpolator="ios"
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
              />
              {target.kind === "agent" ? (
                <ChatBackdropUndo
                  serverId={target.serverId}
                  agentId={target.id}
                  agentName={target.name}
                  top={insets.top + BACKDROP_UNDO_TOP}
                  liquidGlass={liquidGlassAvailable}
                  fallbackBackground={fieldBackground}
                  foreground={String(foreground)}
                />
              ) : null}
              <ChatMessageList
                bubbleSurface={String(chatBackground)}
                swipeGesture={target.kind === "agent" ? swipeForwardGesture : undefined}
                pullGesture={endPull.gesture}
                pullShift={endPull.shift}
                agents={serverAgents}
                rowsShown={rowsShown}
                target={target}
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
                catchingUp={catchingUp}
                appActive={appActive}
                activeTurnId={activeTurnId}
                turnSummaries={turnSummaries}
                onOpenTurn={thinkingAgentId ? openTurn : undefined}
                onOpenSubagents={thinkingAgentId ? openSubagents : undefined}
                onOpenMemoryChanges={thinkingAgentId ? openMemoryChanges : undefined}
                questionForm={questionForm?.messageId ? questionForm : undefined}
                onSelectQuestion={readOnly ? undefined : onSelectQuestion}
                activityAccessory={activityAccessory}
                approvals={readOnly ? undefined : approvals}
                browserRequests={chatBrowserRequests}
                serverName={server?.name ?? ""}
                onRespondApproval={respondToApproval}
                readsWholeApprovals={workspace().readsWholeApprovals(target.serverId)}
                onLoadWholeApproval={loadWholeApproval}
                foreground={foreground}
                messages={messages}
                messageAliases={messageAliases}
                referenceMessages={referenceMessages}
                hasOlder={hasOlder}
                olderLoading={olderLoading}
                olderError={olderError}
                onLoadOlder={loadOlder}
                onReply={readOnly ? undefined : replyToMessage}
                onBranch={onBranch && !readOnly ? branchMessage : undefined}
                branchPoints={branchPoints}
                onReact={canReact && !readOnly ? react : undefined}
                onDeleteMessage={deleteMessage && !readOnly ? deleteListMessage : undefined}
                deletesAnyMessage={deletesAnyMessage}
                onMarkUnread={markUnread ? markListMessageUnread : undefined}
                markUnreadMessageIds={markUnreadMessageIds}
                onTogglePin={togglePin ? togglePinListMessage : undefined}
                pinnedMessageIds={pinnedRowIds}
                unreadLineMessageIds={unreadLineMessageIds}
                sendChannels={sendToChannel?.channels}
                onSendToChannel={sendToChannel && !readOnly ? sendMessageToChannel : undefined}
                selectingMessageId={selection?.message.id ?? null}
                onSelectText={selectText}
                onSelectionChange={changeSelection}
                onDismissSelection={dismissSelection}
                muted={muted}
                showStarter={
                  showStarter && serverOnline && canSend && ready && !activity && projectedMessages.length === 0
                }
                topInset={insets.top}
                onRetryHistory={fetchHistory}
                focusMessageId={focusMessageId}
                focusUnread={focusUnread}
                onFocusPlaced={onFocusPlaced}
                upload={listUpload}
                outboxStatuses={outboxStatuses}
              />
              <Animated.View
                style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, motion.composerStyle]}
                pointerEvents="box-none"
                onLayout={motion.onComposerLayout}
              >
                {onPullPastEnd !== null ? (
                  <ChatEndPullRing pull={endPull} target={target} leadAgentId={channelLeadAgentId} />
                ) : null}
                {!voiceOpen && (detached || !atLatest) && motion.historyVisible && messages.length > 0 ? (
                  <View className="absolute -top-14 self-center">
                    <ChatGlassIconButton
                      accessibilityLabel={t("mobile.chat.scrollToLatest")}
                      fallbackBackground={fieldBackground}
                      liquidGlassAvailable={liquidGlassAvailable}
                      onPress={() => showLatest(true)}
                    >
                      <ArrowDown color={String(foreground)} size={22} />
                    </ChatGlassIconButton>
                  </View>
                ) : null}
                <View style={{ paddingLeft: insets.left, paddingRight: insets.right }}>
                  <ConnectionStatus
                    server={server}
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
                    className="py-2 text-danger-text"
                    style={{
                      backgroundColor: chatBackground,
                      paddingLeft: insets.left + 16,
                      paddingRight: insets.right + 16,
                    }}
                  >
                    {sendError.message}
                  </Typography.Paragraph>
                ) : null}
                {outboxSnapshot.storageFailed && outboxMessages.length ? (
                  <Typography.Paragraph
                    accessibilityRole="alert"
                    className="py-2 text-danger-text"
                    style={{
                      backgroundColor: chatBackground,
                      paddingLeft: insets.left + 16,
                      paddingRight: insets.right + 16,
                    }}
                  >
                    {t("mobile.chat.outbox.saveFailed")}
                  </Typography.Paragraph>
                ) : null}
                {notice
                  ? null
                  : statusNotes?.map((note) => (
                      <Typography.Paragraph
                        key={note}
                        type="body-xs"
                        numberOfLines={2}
                        accessibilityLiveRegion="polite"
                        className="py-1.5 text-text-secondary"
                        style={{
                          backgroundColor: chatBackground,
                          paddingLeft: insets.left + 16,
                          paddingRight: insets.right + 16,
                        }}
                      >
                        {note}
                      </Typography.Paragraph>
                    ))}
                {queue && !notice ? (
                  <ChatQueueButton
                    queue={queue}
                    count={queueCount}
                    rows={queueRows}
                    pending={queuePending}
                    liquidGlassAvailable={liquidGlassAvailable}
                    fallbackBackground={fieldBackground}
                  />
                ) : null}
                <ChatSelectionBar
                  visible={Boolean(selection) && !voiceOpen}
                  canSend={canSend}
                  liquidGlassAvailable={liquidGlassAvailable}
                  fallbackBackground={fieldBackground}
                  onAction={sendSelectionAction}
                />
                {notice ? (
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
                ) : secretQuestion ? (
                  <QuestionSecretComposer
                    key={`${target.serverId}:${secretQuestion.messageId}:${secretQuestion.question?.id}`}
                    controller={secretQuestion}
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
                    mentionReferences={mentionReferences}
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
                    dictation={composerDictation}
                    voiceAccent={target.kind === "agent" ? accent : undefined}
                    voicePalette={palette}
                    voiceAvatar={voiceAvatar}
                    contextMeter={contextMeter}
                  />
                )}
              </Animated.View>
            </KeyboardGestureArea>
          </View>
        </ChatDropTarget>
      </View>
    </GestureDetector>
  );
}
