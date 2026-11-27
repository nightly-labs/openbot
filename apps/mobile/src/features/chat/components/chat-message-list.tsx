import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import type { AnchoredEndSpaceConfig } from "@legendapp/list/react-native";
import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { expandAttachmentReferences } from "@openbot/contracts/attachment-references";
import { expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { AttachmentSummary, BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { markdownInlinePlainText, markdownPlainText } from "@openbot/contracts/markdown-preview-text";
import { useIsFocused } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import CircleX from "lucide-react-native/icons/circle-x";
import CornerUpRight from "lucide-react-native/icons/corner-up-right";
import GitFork from "lucide-react-native/icons/git-fork";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import {
  type ComponentProps,
  createContext,
  memo,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import { GestureDetector, type PanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  interpolate,
  Keyframe,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable, useUniwind } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ChatActivityRow, type ChatActivitySpec } from "@/features/chat/components/chat-activity-row";
import { ChatAppSuggestion, ChatMcpSignIn } from "@/features/chat/components/chat-app-suggestion";
import { type ApprovalDecision, ChatApprovalCard } from "@/features/chat/components/chat-approval-card";
import { ChatExchangeGroup, ChatExchangeMarker } from "@/features/chat/components/chat-exchange-marker";
import { ChatMarkdown, chatMarkdownHasTable } from "@/features/chat/components/chat-markdown";
import { ChatMemoryChanges } from "@/features/chat/components/chat-memory-changes";
import { ChatPlan } from "@/features/chat/components/chat-plan";
import { ChatQuestionPrompt } from "@/features/chat/components/chat-question-prompt";
import {
  RoutineGroupsContext,
  type RoutineGroupsState,
  RoutineMarkerRow,
  RoutineRunGroupRow,
  routineGroupKind,
} from "@/features/chat/components/chat-routine-marker";
import { ChatSubagents } from "@/features/chat/components/chat-subagents";
import { ChatTurnStepsRow } from "@/features/chat/components/chat-turn-steps-row";
import { useActivityPresence } from "@/features/chat/components/use-activity-presence";
import { CHAT_ROW_GAP, type ChatMotion } from "@/features/chat/components/use-chat-motion";
import { useFoldScrollAnchor } from "@/features/chat/components/use-fold-scroll-anchor";
import {
  ArrivalEntrancesContext,
  useArrivalEntrance,
  useMessageArrivals,
} from "@/features/chat/components/use-message-arrivals";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { approvalTitle } from "@/features/chat/model/approval-text";
import {
  type ChatBubbleMessage,
  type ChatMarkerGroup,
  type ChatMessage,
  chatRowHolding,
  chatRowIndex,
  firstChatRowOf,
  groupExchangeMarkers,
  groupRoutineRunMarkers,
  indexChatMessages,
} from "@/features/chat/model/chat-messages";
import type { TurnStepsSummary } from "@/features/chat/model/turn-thinking";
import { readableOn } from "@/features/onboarding/model/onboarding-colors";
import { useRemoteChatContent } from "@/features/servers/model/use-remote-chat-content";
import { useChatBackdrop } from "@/features/settings/model/chat-backdrop";
import { useChatRowShown, useThinkingDisplayPreference } from "@/features/settings/model/chat-details";
import {
  MEMBER_BUBBLE_SHARE,
  mixColor,
  PLAIN_BUBBLE_SHARE,
  tintedMessageColor,
  useMessageColor,
} from "@/features/settings/model/message-color";
import { useRoutineCollapsePreference } from "@/features/settings/model/routine-collapse";
import { stopReadAloud } from "@/features/voice/model/message-reading";
import { useConnectionAppearance } from "@/features/workspace/components/use-connection-appearance";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood, type MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import type { PendingApproval } from "@/features/workspace/model/pending-approvals";
import { useColumnWidth } from "@/shared/components/adaptive-split";
import { haptics } from "@/shared/lib/haptics";
import { useMotionPreference, useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { END_X, lineDirectionStyle, MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { type BubbleTone, bubbleTone } from "../model/bubble-tone";
import { chatDayLabels } from "../model/chat-day-markers";
import { mentionDraft } from "../model/chat-mentions";
import type { ChatTarget } from "../model/chat-target";
import {
  type MessageFileTarget,
  messageChipFileNames,
  messageFileDirectory,
  messageFileTarget,
  messageLinkFileTargets,
  messageTargetFileName,
} from "../model/message-file-target";
import { messageTime } from "../model/message-time";
import { isStreamingReply } from "../model/reply-reveal";
import { uploadProgressAt } from "../model/upload-progress";
import { type AttachmentTint, ChatAttachmentView } from "./chat-attachment";
import { useChatBackdropBase } from "./chat-backdrop-layer";
import { ChatSolidSurfaceProvider } from "./chat-bubble-fill";
import { ChatFileActionsContext, type OpenMessageFile, useMessageFileOpener } from "./chat-file-actions";
import { ChatImageGallery } from "./chat-image-gallery";
import { ChatImageGeneration, imageGenerationStatus } from "./chat-image-generation";
import { ChatImageViewerProvider, isStackImage, isViewableImage } from "./chat-image-viewer";
import { ChatMessageActionsButton, ChatMessageReactions, useMessageActions } from "./chat-message-actions";
import { ChatMessageGesture } from "./chat-message-gesture";
import { ChatOutboxStatus, OutboxMessageMenu, type OutboxRowStatus } from "./chat-outbox-status";
import { ChatSelectableText } from "./chat-selectable-text";
import {
  type ChatSwipeGesture,
  ChatSwipeGestureContext,
  type ChatTimeReveal,
  ChatTimeRevealContext,
  ChatTimesMountedContext,
  MESSAGE_TIME_WIDTH,
} from "./chat-swipe-gesture";
import { ChatTagActionsContext, useTaggedTabOpener } from "./chat-tag-actions";
import { ChatVideoGeneration } from "./chat-video-generation";
import { HistoryShownContext } from "./use-history-shown";
import { KeptOpenContext } from "./use-kept-open";
import { useReplyHaptics } from "./use-reply-haptics";

const TAP_SLOP = 10;
const TAP_DURATION_MS = 400;
const HANDLE_MARGIN = 24;

type ThinkingRow = Extract<ChatMessage, { kind: "thinking" }>;
type MessageRowMessage = Exclude<ChatMessage, ThinkingRow> | ChatMarkerGroup;
type VisibleMessage = MessageRowMessage | ThinkingRow;
const NO_ROWS: VisibleMessage[] = [];
const OPENING_ROWS = 6;
const OPENING_ROWS_TO_USER = 12;
const ROW_STYLE = { paddingBottom: CHAT_ROW_GAP };
const LIST_PADDING = 16;
const ANCHOR_SHOWN_SHARE = 0.25;
const USER_BUBBLE_WIDTH = 0.92;

function rowKey(message: VisibleMessage): string {
  return message.id;
}
function rowType(message: VisibleMessage, routineGroups: RoutineGroupsState): string {
  if (message.kind === "message") return message.author;
  if (message.kind === "routine-run-group") return routineGroupKind(routineGroups, message);
  return message.kind;
}
const ESTIMATED_ROW_SIZE = 150;
const DRAW_SCREENS = 1;
const ADAPTIVE_RENDER = { enterVelocity: 1.5, exitVelocity: 0.5 };
const KEEP_VISIBLE_POSITION = { data: true, size: true };
const FOLLOW_END = { animated: false, on: { dataChange: true, itemLayout: true, footerLayout: true, layout: true } };

const USER_MESSAGE_ENTRANCE = FadeInDown.duration(240)
  .easing(Easing.bezier(0.23, 1, 0.32, 1))
  .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] })
  .reduceMotion(ReduceMotion.System);
const PROGRESS_UPDATE_ENTRANCE = FadeIn.duration(220)
  .easing(Easing.bezier(0.23, 1, 0.32, 1))
  .reduceMotion(ReduceMotion.System);
const REPLY_APPEAR = { duration: 220, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.Never };
const BUBBLE_CORNER = { borderCurve: "circular", borderRadius: 22 } as const;

function ChatBubble({
  children,
  agent,
  collapsed = false,
  className,
  style,
  fill,
}: PropsWithChildren<{
  agent: boolean;
  fill: string | undefined;
  collapsed?: boolean;
  className: string;
  style: ComponentProps<typeof Animated.View>["style"];
}>) {
  const shown = useSharedValue(collapsed ? 0 : 1);
  useEffect(() => {
    shown.set(collapsed ? 0 : withTiming(1, REPLY_APPEAR));
  }, [collapsed, shown]);
  const background = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return (
    <Animated.View className={className} style={[style, BUBBLE_CORNER]}>
      {agent ? (
        <Animated.View
          pointerEvents="none"
          className={fill ? undefined : "bg-control/60"}
          style={[BUBBLE_CORNER, StyleSheet.absoluteFill, fill ? { backgroundColor: fill } : null, background]}
        />
      ) : null}
      {children}
    </Animated.View>
  );
}

interface ChatMessageListProps {
  target: ChatTarget;
  bubbleSurface: string;
  swipeGesture?: ChatSwipeGesture;
  pullShift?: SharedValue<number>;
  pullGesture?: PanGesture;
  rowsShown: boolean;
  accessibilityHidden?: boolean;
  activity?: MobileAgentActivity;
  activities?: MobileAgentActivity[];
  agents: MobileAgent[];
  motion: ChatMotion;
  sending: boolean;
  awaitingTurn: boolean;
  keyboardOffset: number;
  canSend: boolean;
  online: boolean;
  appActive: boolean;
  activeTurnId: string | null;
  turnSummaries?: ReadonlyMap<string, TurnStepsSummary>;
  onOpenTurn?: (turnId: string) => void;
  onOpenSubagents?: (messageId: string) => void;
  onOpenMemoryChanges?: (messageId: string) => void;
  questionForm?: QuestionPromptController;
  onSelectQuestion?: (messageId: string) => void;
  activityAccessory?: ReactNode;
  approvals?: readonly PendingApproval[];
  browserRequests?: readonly BrowserTakeoverRequest[];
  serverName?: string;
  onRespondApproval?: (approval: PendingApproval, decision: ApprovalDecision) => Promise<void>;
  readsWholeApprovals?: boolean;
  onLoadWholeApproval?: (approval: PendingApproval) => Promise<void>;
  foreground: ViewStyle["backgroundColor"];
  historyState: "ready" | "connecting" | "waiting" | "loading" | "error";
  catchingUp?: boolean;
  messages: ChatMessage[];
  messageAliases: ReadonlyMap<string, string>;
  referenceMessages: ChatMessage[];
  hasOlder: boolean;
  olderLoading: boolean;
  olderError: boolean;
  onLoadOlder: () => void;
  muted: ViewStyle["backgroundColor"];
  showStarter: boolean;
  topInset: number;
  onRetryHistory: () => void;
  onReply?: (message: ChatBubbleMessage) => void;
  onBranch?: (message: ChatBubbleMessage) => void;
  onDeleteMessage?: (message: ChatBubbleMessage) => Promise<void>;
  deletesAnyMessage?: boolean;
  onMarkUnread?: (message: ChatBubbleMessage) => void;
  markUnreadMessageIds?: ReadonlySet<string>;
  onTogglePin?: (message: ChatBubbleMessage, pinned: boolean) => Promise<void>;
  pinnedMessageIds?: ReadonlySet<string>;
  unreadLineMessageIds?: ReadonlySet<string> | null;
  sendChannels?: readonly { id: string; name: string }[];
  onSendToChannel?: (message: ChatBubbleMessage, channelId: string) => void;
  branchPoints?: ReadonlySet<string>;
  branchDivider?: { afterId: string; label: string | null } | null;
  onOpenBranchSource?: () => void;
  onReact?: (message: ChatBubbleMessage, emoji: string | null) => Promise<void>;
  selectingMessageId?: string | null;
  onSelectText?: (message: ChatBubbleMessage) => void;
  onSelectionChange?: (selected: string) => void;
  onDismissSelection?: () => void;
  upload?: {
    messageId: string;
    completed: number;
    current: number;
    cancelling: boolean;
    cancel: () => void;
  } | null;
  outboxStatuses?: ReadonlyMap<string, OutboxRowStatus>;
  focusMessageId?: string | null;
  focusUnread?: boolean;
  onFocusPlaced?: () => void;
}

type ChatUpload = NonNullable<ChatMessageListProps["upload"]>;

interface MessageRowShared {
  agents: MobileAgent[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  serverId: string;
  remoteContent: boolean;
  canSend: boolean;
  muted: ViewStyle["backgroundColor"];
  themeMuted: string;
  foreground: ViewStyle["backgroundColor"];
  userForeground: string;
  userBubbleStyle: ComponentProps<typeof Animated.View>["style"] | undefined;
  attachmentTint: AttachmentTint | undefined;
  bubbleTone: BubbleTone | undefined;
  plainBubbleFill: string | undefined;
  solidBubbleSurface: string | undefined;
  firstMessageStyle: ComponentProps<typeof Animated.View>["style"];
  animationActive: boolean;
  playbackActive: boolean;
  playbackPaused: boolean;
  screenReaderEnabled: boolean;
  replySession: { progress: Map<string, number>; revealed: Set<string> };
  markRevealed: (id: string) => void;
  replyHaptics: ReturnType<typeof useReplyHaptics>;
  canReply: boolean;
  canReact: boolean;
  canDelete: boolean;
  deletesAny: boolean;
  canMarkUnread: boolean;
  canPin: boolean;
  pinnedIds: ReadonlySet<string>;
  sendChannels: readonly { id: string; name: string }[];
  canSelectText: boolean;
  canSelectQuestion: boolean;
  branchPoints: ReadonlySet<string>;
  listWidth: number;
  fileAgentId: string | undefined;
  openSubagents: ((messageId: string) => void) | undefined;
  openMemoryChanges: ((messageId: string) => void) | undefined;
  openFile: (
    file: MessageFileTarget,
    written: MessageFileTarget | null,
    attachment: AttachmentSummary | undefined,
  ) => Promise<void>;
  actions: {
    reply: (message: ChatBubbleMessage) => void;
    branch: (message: ChatBubbleMessage) => void;
    selectQuestion: (messageId: string) => void;
    react: (message: ChatBubbleMessage, emoji: string | null) => Promise<void>;
    delete: (message: ChatBubbleMessage) => Promise<void>;
    markUnread: (message: ChatBubbleMessage) => void;
    togglePin: (message: ChatBubbleMessage, pinned: boolean) => Promise<void>;
    marksUnread: (message: ChatBubbleMessage) => boolean;
    sendToChannel: (message: ChatBubbleMessage, channelId: string) => void;
    selectText: (message: ChatBubbleMessage) => void;
    selectionChange: (selected: string) => void;
    selectionArea: (view: ViewInstance | null) => void;
  };
}

function ContextResetMarkerRow({ muted }: { muted: ViewStyle["backgroundColor"] }) {
  const { t } = useText();
  return (
    <View accessible className="flex-row items-center gap-3 py-2">
      <View className="h-px flex-1" style={{ backgroundColor: muted, opacity: 0.35 }} />
      <Typography.Paragraph type="body-sm" style={{ color: muted }}>
        {t("mobile.chat.contextReset")}
      </Typography.Paragraph>
      <View className="h-px flex-1" style={{ backgroundColor: muted, opacity: 0.35 }} />
    </View>
  );
}

const LINE_EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const UNREAD_BADGE_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.9 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: LINE_EASE_OUT },
})
  .duration(200)
  .reduceMotion(ReduceMotion.System);
const UNREAD_LINE_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scaleX: 0 }] },
  100: { opacity: 1, transform: [{ scaleX: 1 }], easing: LINE_EASE_OUT },
})
  .duration(340)
  .delay(60)
  .reduceMotion(ReduceMotion.System);
const LINE_BEFORE_ORIGIN = END_X === 1 ? "100% 50%" : "0% 50%";
const LINE_AFTER_ORIGIN = END_X === 1 ? "0% 50%" : "100% 50%";

function UnreadLineRow({
  rowId,
  color,
  animated,
}: {
  rowId: string;
  color: string | undefined;
  animated: Set<string>;
}) {
  const { t } = useText();
  const [arrives] = useState(() => !animated.has(rowId));
  useEffect(() => {
    animated.add(rowId);
  }, [animated, rowId]);
  const line = color ? { backgroundColor: color } : undefined;
  return (
    <View
      accessible
      accessibilityLabel={t("mobile.chat.unread.lineLabel")}
      className="flex-row items-center gap-2 pt-1 pb-3"
    >
      <Animated.View
        entering={arrives ? UNREAD_LINE_IN : undefined}
        className="h-px flex-1 bg-accent"
        style={[{ transformOrigin: LINE_BEFORE_ORIGIN }, line]}
      />
      <Animated.View entering={arrives ? UNREAD_BADGE_IN : undefined}>
        <Typography.Paragraph
          type="body-xs"
          className="font-semibold text-accent"
          style={color ? { color } : undefined}
        >
          {t("mobile.chat.unread.line")}
        </Typography.Paragraph>
      </Animated.View>
      <Animated.View
        entering={arrives ? UNREAD_LINE_IN : undefined}
        className="h-px flex-1 bg-accent"
        style={[{ transformOrigin: LINE_AFTER_ORIGIN }, line]}
      />
    </View>
  );
}

function BranchDividerRow({
  label,
  onOpen,
  muted,
}: {
  label: string | null;
  onOpen: (() => void) | undefined;
  muted: ViewStyle["backgroundColor"];
}) {
  const { t } = useText();
  const text =
    label === null
      ? t("mobile.chat.threads.branchedFromDeleted")
      : t("mobile.chat.threads.branchedFrom", { title: label });
  const content = (
    <>
      <View className="h-px flex-1" style={{ backgroundColor: muted, opacity: 0.35 }} />
      <GitFork size={14} color={String(muted)} />
      <Typography.Paragraph type="body-sm" numberOfLines={1} className="shrink" style={{ color: muted }}>
        {text}
      </Typography.Paragraph>
      <View className="h-px flex-1" style={{ backgroundColor: muted, opacity: 0.35 }} />
    </>
  );
  if (label === null || !onOpen)
    return (
      <View accessible accessibilityLabel={text} className="flex-row items-center gap-2 pt-4 pb-2">
        {content}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={text}
      onPress={() => {
        void haptics.selection();
        onOpen();
      }}
      className="flex-row items-center gap-2 pt-4 pb-2"
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
    >
      {content}
    </Pressable>
  );
}

function playbackEligible(message: VisibleMessage) {
  return (
    message.kind === "message" &&
    message.author === "agent" &&
    (message.streaming || message.status === "completed") &&
    !message.superseded &&
    !message.progress &&
    (!message.speaker || message.speaker.kind === "agent")
  );
}

function playbackEnabled(message: VisibleMessage, shared: MessageRowShared, arriving: boolean) {
  return playbackEligible(message) && shared.playbackActive && arriving;
}

function awaitingFirstWord(message: VisibleMessage, shared: MessageRowShared, arriving: boolean, revealed: boolean) {
  return (
    message.kind === "message" &&
    message.body.trim().length > 0 &&
    playbackEnabled(message, shared, arriving) &&
    !revealed &&
    (shared.replySession.progress.get(message.id) ?? 0) === 0
  );
}

const MessageRow = memo(function MessageRow({
  message,
  isFirstUser,
  source,
  questionForm,
  upload,
  outbox,
  selecting = false,
  arriving,
  revealed,
  shared,
}: {
  message: MessageRowMessage;
  isFirstUser: boolean;
  arriving: boolean;
  revealed: boolean;
  source?: ChatMessage;
  questionForm?: QuestionPromptController;
  upload?: ChatUpload;
  outbox?: OutboxRowStatus;
  selecting?: boolean;
  shared: MessageRowShared;
}) {
  const { t } = useText();
  const [selectionHeight, setSelectionHeight] = useState(0);
  const waiting = awaitingFirstWord(message, shared, arriving, revealed);
  const entrance = useArrivalEntrance(message.id, arriving);
  const bubble = message.kind === "message" && !outbox && !message.streaming && !waiting ? message : null;
  const selectable = Boolean(bubble?.body.trim()) && shared.canSelectText;
  const messageActions = useMessageActions(
    bubble?.progress
      ? // A progress update is a step of its turn, as on desktop: no reply, reaction or delete.
        {
          messageId: bubble.id,
          copyText: messageCopyText(bubble),
          createdAt: bubble.createdAt,
          onSelectText: selectable ? () => shared.actions.selectText(bubble) : undefined,
          readAloudId: bubble.id,
        }
      : bubble
        ? {
            messageId: bubble.id,
            copyText: messageCopyText(bubble),
            createdAt: bubble.createdAt,
            reactions: bubble.reactions,
            onReact: shared.canReact ? (emoji) => shared.actions.react(bubble, emoji) : undefined,
            onReply: shared.canReply ? () => shared.actions.reply(bubble) : undefined,
            onBranch: shared.branchPoints.has(bubble.id) ? () => shared.actions.branch(bubble) : undefined,
            onSelectText: selectable ? () => shared.actions.selectText(bubble) : undefined,
            onDelete:
              shared.canDelete && (shared.deletesAny || bubble.mine) ? () => shared.actions.delete(bubble) : undefined,
            onMarkUnread:
              shared.canMarkUnread && bubble.author === "agent" && shared.actions.marksUnread(bubble)
                ? () => shared.actions.markUnread(bubble)
                : undefined,
            pinned: shared.pinnedIds.has(bubble.id),
            onTogglePin: shared.canPin
              ? () => shared.actions.togglePin(bubble, !shared.pinnedIds.has(bubble.id))
              : undefined,
            sendToChannel:
              shared.sendChannels.length > 0 && bubble.body.trim()
                ? {
                    channels: shared.sendChannels,
                    onSend: (channelId) => shared.actions.sendToChannel(bubble, channelId),
                  }
                : undefined,
            readAloudId: bubble.author === "agent" ? bubble.id : undefined,
            files: bubble.attachments?.length
              ? { serverId: shared.serverId, attachments: bubble.attachments }
              : undefined,
          }
        : null,
  );
  const {
    agents,
    agentsById,
    serverId,
    canSend,
    muted,
    themeMuted,
    foreground,
    userForeground,
    userBubbleStyle,
    plainBubbleFill,
    solidBubbleSurface,
    firstMessageStyle,
    replySession,
    markRevealed,
    replyHaptics,
    actions,
  } = shared;
  const eligible = playbackEligible(message);
  const enabled = playbackEnabled(message, shared, arriving);
  const complete = message.kind === "message" && message.status === "completed";
  const playback = useMemo(
    () =>
      eligible
        ? {
            id: message.id,
            complete,
            progress: replySession.progress,
            enabled,
            active: shared.playbackActive,
            paused: shared.playbackPaused,
            revealed,
            onWord: (word: string, index: number) => {
              markRevealed(message.id);
              replyHaptics.onWord(word, index);
            },
            onFlush: () => {
              markRevealed(message.id);
              replyHaptics.onFlush();
            },
            onComplete: replyHaptics.onComplete,
          }
        : undefined,
    [
      eligible,
      message.id,
      complete,
      replySession.progress,
      enabled,
      shared.playbackActive,
      shared.playbackPaused,
      revealed,
      markRevealed,
      replyHaptics,
    ],
  );
  const speaker = message.kind === "message" && message.speaker ? agentsById.get(message.speaker.id) : undefined;
  const fileAgentId = message.kind !== "message" ? undefined : message.speaker ? speaker?.id : shared.fileAgentId;
  const fileBody = message.kind === "message" ? message.body : "";
  const finishedBody = message.kind !== "message" || !isStreamingReply(message);
  const tableOutside = useMemo(() => chatMarkdownHasTable(fileBody, finishedBody), [fileBody, finishedBody]);
  const openFile = shared.openFile;
  const fileAttachments = message.kind === "message" && message.author === "agent" ? message.attachments : undefined;
  const openMessageFile = useMemo<OpenMessageFile>(() => {
    const directory = messageFileDirectory(fileBody);
    const attachmentOf = (file: MessageFileTarget) => {
      const name = messageTargetFileName(file);
      return fileAttachments?.find((attachment) => attachment.name === name);
    };
    return {
      code: (text) => {
        const target = messageFileTarget(text, directory, fileAgentId);
        return target ? () => void openFile(target.file, target.written, attachmentOf(target.file)) : null;
      },
      link: (href) => {
        const target = messageLinkFileTargets(href, fileAgentId);
        if (!target) return null;
        return () =>
          void openFile(
            target.file,
            target.written,
            (target.written && attachmentOf(target.written)) || attachmentOf(target.file),
          );
      },
    };
  }, [fileBody, fileAgentId, fileAttachments, openFile]);
  const memberColor =
    message.kind === "message" && message.sender ? avatarHeadColor(message.sender.id, null) : undefined;
  const tone =
    message.kind === "message" && message.author === "user" && userBubbleStyle && !memberColor
      ? shared.bubbleTone
      : undefined;
  const textColor = tone ? userForeground : foreground;
  const chipFiles = useMemo(
    () =>
      message.kind === "message" && message.author === "agent" && finishedBody && message.attachments?.length
        ? messageChipFileNames(fileBody, fileAgentId)
        : null,
    [message, finishedBody, fileBody, fileAgentId],
  );
  const files =
    message.kind === "message"
      ? (
          (message.imageGeneration || message.videoGeneration ? message.attachments?.slice(1) : message.attachments) ??
          []
        ).filter((attachment) => !chipFiles?.has(attachment.name))
      : [];
  const gallery = message.kind === "message" ? files.filter(isStackImage) : [];
  const fileUpload = (attachment: AttachmentSummary) =>
    upload ? uploadProgressAt(files.indexOf(attachment), upload.completed, upload.current) : undefined;
  const markdownProps = {
    agents,
    body: fileBody,
    finished: finishedBody,
    selectable: message.kind === "message" && message.author === "user" && !bubble,
    color: textColor,
    tone,
    playback,
    animationEnabled: shared.animationActive && (arriving || revealed),
    align: message.kind === "message" && message.author === "user" ? ("end" as const) : ("start" as const),
    literalWordStars: message.kind === "message" && message.author === "user",
    remoteContent: shared.remoteContent,
  };
  const bubbleFor = useCallback(
    (children: ReactNode, key?: string) =>
      message.kind === "message" ? (
        <ChatBubble
          key={key}
          agent={message.author === "agent"}
          fill={plainBubbleFill}
          collapsed={waiting}
          className={
            message.author === "user"
              ? `max-w-full self-end px-4 py-3 ${userBubbleStyle || memberColor || plainBubbleFill ? "" : "bg-control/60"}`
              : `max-w-full self-start ${waiting ? "" : "px-4 py-3"}`
          }
          style={[
            { borderCurve: "circular", overflow: "hidden" },
            message.author === "user" && message.attachments?.length
              ? { maxWidth: shared.listWidth * USER_BUBBLE_WIDTH }
              : undefined,
            message.author === "user"
              ? memberColor
                ? {
                    backgroundColor:
                      (solidBubbleSurface && mixColor(solidBubbleSurface, memberColor, MEMBER_BUBBLE_SHARE)) ||
                      `${memberColor}38`,
                  }
                : (userBubbleStyle ?? (plainBubbleFill ? { backgroundColor: plainBubbleFill } : undefined))
              : undefined,
          ]}
        >
          {children}
        </ChatBubble>
      ) : null,
    [message, waiting, shared.listWidth, userBubbleStyle, memberColor, plainBubbleFill, solidBubbleSurface],
  );
  const sentTable = useCallback(
    (table: ReactNode, key: string) => (
      <View key={key} className="self-end" style={{ width: shared.listWidth * USER_BUBBLE_WIDTH }}>
        {table}
      </View>
    ),
    [shared.listWidth],
  );
  const tableOnColor = useCallback(
    (card: ReactNode) => (
      <Animated.View style={[{ borderRadius: 16, borderCurve: "continuous", overflow: "hidden" }, userBubbleStyle]}>
        {card}
      </Animated.View>
    ),
    [userBubbleStyle],
  );
  const rendered =
    message.kind === "routine" ? (
      <RoutineMarkerRow key={message.id} message={message} />
    ) : message.kind === "routine-run-group" ? (
      <RoutineRunGroupRow key={message.id} group={message} />
    ) : message.kind === "context-reset" ? (
      <ContextResetMarkerRow key={message.id} muted={muted} />
    ) : message.kind === "no-answer" ? (
      <NoAnswerNotice key={message.id} text={message.text} />
    ) : message.kind === "app-suggestion" ? (
      <ChatAppSuggestion key={message.id} serverId={serverId} messageId={message.id} appId={message.appId} />
    ) : message.kind === "mcp-sign-in" ? (
      <ChatMcpSignIn key={message.id} serverId={serverId} messageId={message.id} mcpServerId={message.mcpServerId} />
    ) : message.kind === "exchange-group" ? (
      <ChatExchangeGroup key={message.id} group={message} agents={agents} agentsById={agentsById} />
    ) : message.kind === "exchange" || message.kind === "channel-routing" ? (
      <ChatExchangeMarker key={message.id} message={message} agents={agents} agentsById={agentsById} />
    ) : message.kind === "plan" ? (
      <ChatPlan key={message.id} message={message} />
    ) : message.kind === "subagents" ? (
      <ChatSubagents key={message.id} message={message} onOpen={shared.openSubagents} />
    ) : message.kind === "memory-changes" ? (
      <ChatMemoryChanges key={message.id} message={message} onOpen={shared.openMemoryChanges} />
    ) : message.kind === "question" ? (
      <ChatQuestionPrompt
        key={message.id}
        serverId={serverId}
        prompt={message.prompt}
        uiBlock={message.uiBlock}
        controller={questionForm}
        canSend={canSend}
        onActivate={shared.canSelectQuestion ? () => actions.selectQuestion(message.id) : undefined}
      />
    ) : (
      <Animated.View
        key={message.id}
        entering={
          entrance && !isFirstUser
            ? message.author === "user"
              ? USER_MESSAGE_ENTRANCE
              : message.progress && shared.playbackActive
                ? PROGRESS_UPDATE_ENTRANCE
                : undefined
            : undefined
        }
        className={
          message.author === "user" ? "max-w-full items-end self-end gap-2" : "max-w-full items-start self-start gap-2"
        }
        style={[{ borderCurve: "circular" }, isFirstUser ? firstMessageStyle : undefined]}
      >
        {memberColor && message.sender ? (
          <Typography.Paragraph type="body-xs" className="shrink px-1" numberOfLines={1} style={{ color: memberColor }}>
            {message.sender.name.trim() || t("mobile.chat.speaker.memberFallback")}
          </Typography.Paragraph>
        ) : null}
        {message.speaker && message.author !== "user" ? (
          <View className="flex-row items-center gap-1 px-1">
            {message.speaker.kind === "agent" ? (
              <BloubAvatarThumbnail
                agentId={speaker?.id}
                serverId={speaker?.serverId}
                seed={speaker?.avatarSeed ?? message.speaker.id}
                hue={speaker?.avatarHue ?? null}
                color={speaker?.avatarColor ?? null}
                size={20}
              />
            ) : null}
            <Typography.Paragraph type="body-xs" className="shrink text-muted" numberOfLines={1}>
              {message.superseded
                ? t("mobile.chat.speaker.superseded", { name: message.speaker.name })
                : message.speaker.name}
            </Typography.Paragraph>
          </View>
        ) : null}
        {message.imageGeneration ? (
          <ChatImageGeneration
            generation={message.imageGeneration}
            status={imageGenerationStatus(message.streaming, message.status)}
            attachment={message.attachments?.[0]}
            serverId={serverId}
          />
        ) : null}
        {message.videoGeneration ? (
          <ChatVideoGeneration
            generation={message.videoGeneration}
            status={imageGenerationStatus(message.streaming, message.status)}
            attachment={message.attachments?.[0]}
            serverId={serverId}
          />
        ) : null}
        {gallery.length > 1 ? (
          <ChatImageGallery
            attachments={gallery}
            uploads={upload ? gallery.map(fileUpload) : undefined}
            serverId={serverId}
            alignment={message.author === "user" ? "right" : "left"}
          />
        ) : null}
        {(gallery.length > 1 ? files.filter((attachment) => !isStackImage(attachment)) : files).map((attachment) => (
          <ChatAttachmentView
            key={attachment.id}
            attachment={attachment}
            serverId={serverId}
            alignment={message.author === "user" ? "right" : "left"}
            upload={fileUpload(attachment)}
            tint={shared.attachmentTint}
            visual={message.visual}
          />
        ))}
        {upload && upload.completed < (message.attachments?.length ?? 0) ? (
          <Button variant="ghost" size="sm" className="self-end" isDisabled={upload.cancelling} onPress={upload.cancel}>
            <Button.Label>
              {upload.cancelling
                ? t("mobile.chat.upload.cancelling")
                : t("mobile.chat.upload.cancel", {
                    completed: upload.completed,
                    total: message.attachments?.length ?? 0,
                  })}
            </Button.Label>
          </Button>
        ) : null}
        {message.body.trim() ? (
          tableOutside && !selecting ? (
            <ChatFileActionsContext value={openMessageFile}>
              <ChatMarkdown
                {...markdownProps}
                renderText={bubbleFor}
                renderTable={message.kind === "message" && message.author === "user" ? sentTable : undefined}
                tableFrame={tone ? tableOnColor : undefined}
              />
            </ChatFileActionsContext>
          ) : (
            bubbleFor(
              <View style={selecting ? { minHeight: selectionHeight } : undefined}>
                <View
                  style={selecting ? { opacity: 0 } : undefined}
                  accessibilityElementsHidden={selecting}
                  importantForAccessibility={selecting ? "no-hide-descendants" : "auto"}
                >
                  <ChatFileActionsContext value={openMessageFile}>
                    <ChatMarkdown {...markdownProps} />
                  </ChatFileActionsContext>
                </View>
                {selecting ? (
                  <ChatSelectableText
                    text={markdownPlainText(message.body)}
                    color={textColor}
                    onHeight={setSelectionHeight}
                    onSelectionChange={actions.selectionChange}
                  />
                ) : null}
              </View>,
            )
          )
        ) : null}
      </Animated.View>
    );
  if (message.kind !== "message") return rendered;
  const withReactions =
    messageActions.open && messageActions.shown.length > 0 ? (
      <View className="mb-5">
        {rendered}
        <ChatMessageReactions
          align={message.author === "user" ? "end" : "start"}
          reactions={messageActions.shown}
          agentsById={agentsById}
          onReact={messageActions.react}
        />
      </View>
    ) : (
      rendered
    );
  const replyPreview =
    source?.kind === "message"
      ? mentionDraft(source.body).text || t("mobile.chat.reply.attachment")
      : t("mobile.chat.reply.unavailable");
  return (
    <View
      key={message.id}
      ref={selecting ? actions.selectionArea : undefined}
      className={
        message.author === "agent"
          ? "max-w-full self-start gap-1"
          : message.attachments?.length
            ? "max-w-full self-end gap-1"
            : "max-w-[92%] self-end gap-1"
      }
    >
      {message.replyToMessageId ? (
        <View className={`flex-row items-center gap-1 ${message.author === "user" ? "self-end" : "self-start"}`}>
          <CornerUpRight size={14} color={themeMuted} style={MIRROR_IN_RTL} />
          <Typography.Paragraph
            type="body-xs"
            numberOfLines={1}
            className="shrink text-muted"
            style={lineDirectionStyle(replyPreview)}
            accessibilityLabel={t("mobile.chat.reply.to", { text: replyPreview })}
          >
            {replyPreview}
          </Typography.Paragraph>
        </View>
      ) : null}
      {message.author === "agent" ? (
        <ChatMessageGesture
          selecting={selecting}
          onReply={shared.canReply && !message.progress ? () => actions.reply(message) : undefined}
          onHold={messageActions.open}
        >
          {withReactions}
        </ChatMessageGesture>
      ) : outbox ? (
        <OutboxMessageMenu
          status={outbox}
          maxWidth={message.attachments?.length ? shared.listWidth : shared.listWidth * USER_BUBBLE_WIDTH}
        >
          {rendered}
        </OutboxMessageMenu>
      ) : (
        <ChatMessageGesture
          align="end"
          selecting={selecting}
          onReply={shared.canReply ? () => actions.reply(message) : undefined}
          onHold={messageActions.open}
        >
          {withReactions}
        </ChatMessageGesture>
      )}
      {message.author === "user" && message.status === "failed" ? <TurnFailure reason={message.failureReason} /> : null}
      {outbox ? <ChatOutboxStatus status={outbox} /> : null}
      {messageActions.open && shared.screenReaderEnabled ? (
        <ChatMessageActionsButton align={message.author === "user" ? "end" : "start"} onOpen={messageActions.open} />
      ) : null}
    </View>
  );
});

interface RowContextValue {
  shared: MessageRowShared;
  rowsById: ReadonlyMap<string, VisibleMessage>;
  arrivals: ReadonlySet<string>;
  revealedIds: ReadonlySet<string>;
  responseIds: ReadonlySet<string>;
  responseVisible: boolean;
  responseStyle: ComponentProps<typeof Animated.View>["style"];
  firstUserId: string | null;
  messagesById: ReadonlyMap<string, ChatMessage>;
  promptController: QuestionPromptController | undefined;
  upload: ChatUpload | null | undefined;
  outboxStatuses: ReadonlyMap<string, OutboxRowStatus> | undefined;
  selectingMessageId: string | null;
  turnSummaries: ReadonlyMap<string, TurnStepsSummary> | undefined;
  onOpenTurn: ((turnId: string) => void) | undefined;
  dayLabels: ReadonlyMap<string, string>;
  branchDivider: { rowId: string; label: string | null; onOpen: (() => void) | undefined } | null;
  unreadLineRowId: string | null;
  unreadLine: { color: string | undefined; animated: Set<string> };
  highlightedRowId: string | null;
  highlight: { color: string; shown: Set<string> };
}

const FOCUS_HIGHLIGHT_OPACITY = 0.16;
const FOCUS_HIGHLIGHT_IN_MS = 180;
const FOCUS_HIGHLIGHT_HOLD_MS = 900;
const FOCUS_HIGHLIGHT_OUT_MS = 700;
const FOCUS_HIGHLIGHT_IN = {
  duration: FOCUS_HIGHLIGHT_IN_MS,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.Never,
};
const FOCUS_HIGHLIGHT_OUT = {
  duration: FOCUS_HIGHLIGHT_OUT_MS,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.Never,
};

function FocusHighlight({ rowId, color, shown }: { rowId: string; color: string; shown: Set<string> }) {
  const opacity = useSharedValue(0);
  const [first] = useState(() => !shown.has(rowId));
  useEffect(() => {
    if (!first) return;
    shown.add(rowId);
    opacity.set(
      withSequence(
        withTiming(FOCUS_HIGHLIGHT_OPACITY, FOCUS_HIGHLIGHT_IN),
        withDelay(FOCUS_HIGHLIGHT_HOLD_MS, withTiming(0, FOCUS_HIGHLIGHT_OUT)),
      ),
    );
  }, [first, rowId, shown, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  if (!first) return null;
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute -inset-x-2 -top-1 rounded-2xl"
      style={[{ backgroundColor: color, bottom: CHAT_ROW_GAP - 4, borderCurve: "continuous" }, style]}
    />
  );
}

const RowContext = createContext<RowContextValue | null>(null);

const MESSAGE_TIME = { hour: "numeric", minute: "2-digit" } as const;

function MessageTime({ createdAt, reveal }: { createdAt: string; reveal: SharedValue<number> }) {
  const mounted = useContext(ChatTimesMountedContext);
  return mounted ? <MessageTimeLabel createdAt={createdAt} reveal={reveal} /> : null;
}

function MessageTimeLabel({ createdAt, reveal }: { createdAt: string; reveal: SharedValue<number> }) {
  const { format } = useText();
  const label = useMemo(() => {
    const at = messageTime(createdAt);
    return Number.isNaN(at) ? null : format.date(new Date(at), MESSAGE_TIME);
  }, [createdAt, format]);
  const style = useAnimatedStyle(() => {
    const distance = reveal.get();
    return {
      opacity: interpolate(distance, [MESSAGE_TIME_WIDTH * 0.25, MESSAGE_TIME_WIDTH], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateX: Math.max(0, MESSAGE_TIME_WIDTH - distance) * END_X }],
    };
  });
  if (!label) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute top-0 bottom-0 items-end justify-center"
      style={[{ end: -(LIST_PADDING - 12), width: MESSAGE_TIME_WIDTH }, style]}
    >
      <Typography.Paragraph type="body-xs" numberOfLines={1} className="text-muted">
        {label}
      </Typography.Paragraph>
    </Animated.View>
  );
}

function MessageWithTime({
  createdAt,
  reveal,
  children,
}: PropsWithChildren<{ createdAt: string | undefined; reveal: SharedValue<number> }>) {
  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: -reveal.get() * END_X }] }));
  return (
    <View>
      <Animated.View style={moved}>{children}</Animated.View>
      {createdAt ? <MessageTime createdAt={createdAt} reveal={reveal} /> : null}
    </View>
  );
}

interface ChatRowBodyProps {
  message: VisibleMessage;
  hidden: boolean;
  responseStyle: RowContextValue["responseStyle"] | undefined;
  highlight: { color: string; shown: Set<string> } | null;
  day: string | undefined;
  unreadLine: { color: string | undefined; animated: Set<string> } | null;
  turn: TurnStepsSummary | undefined;
  onOpenTurn: ((turnId: string) => void) | undefined;
  branchDivider: RowContextValue["branchDivider"];
  isFirstUser: boolean;
  source: ChatMessage | undefined;
  questionForm: QuestionPromptController | undefined;
  upload: ChatUpload | undefined;
  outbox: OutboxRowStatus | undefined;
  selecting: boolean;
  arriving: boolean;
  revealed: boolean;
  shared: MessageRowShared;
}

const ChatRowBody = memo(function ChatRowBody({
  message,
  hidden,
  responseStyle,
  highlight,
  day,
  unreadLine,
  turn,
  onOpenTurn,
  branchDivider,
  isFirstUser,
  source,
  questionForm,
  upload,
  outbox,
  selecting,
  arriving,
  revealed,
  shared,
}: ChatRowBodyProps) {
  const timeReveal = useContext(ChatTimeRevealContext);
  const turnId = turn?.turnId;
  const openTurn = useMemo(() => (onOpenTurn && turnId ? () => onOpenTurn(turnId) : undefined), [onOpenTurn, turnId]);
  const messageRow =
    message.kind === "thinking" ? null : (
      <MessageRow
        message={message}
        isFirstUser={isFirstUser}
        source={source}
        questionForm={questionForm}
        upload={upload}
        outbox={outbox}
        selecting={selecting}
        arriving={arriving}
        revealed={revealed}
        shared={shared}
      />
    );
  return (
    <Animated.View
      style={[ROW_STYLE, responseStyle]}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
    >
      {highlight ? <FocusHighlight rowId={message.id} color={highlight.color} shown={highlight.shown} /> : null}
      {day ? (
        <Typography.Paragraph type="body-xs" align="center" className="pb-3 pt-1 text-muted">
          {day}
        </Typography.Paragraph>
      ) : null}
      {unreadLine ? <UnreadLineRow rowId={message.id} color={unreadLine.color} animated={unreadLine.animated} /> : null}
      {turn ? <ChatTurnStepsRow summary={turn} muted={shared.themeMuted} onPress={openTurn} /> : null}
      {message.kind === "message" && timeReveal ? (
        <MessageWithTime createdAt={message.createdAt} reveal={timeReveal.offset}>
          {messageRow}
        </MessageWithTime>
      ) : (
        messageRow
      )}
      {branchDivider ? (
        <BranchDividerRow label={branchDivider.label} onOpen={branchDivider.onOpen} muted={shared.muted} />
      ) : null}
    </Animated.View>
  );
});

function ChatRow({ item }: { item: VisibleMessage }) {
  const row = useContext(RowContext);
  if (!row) return null;
  const message = row.rowsById.get(item.id) ?? item;
  const response = row.responseIds.has(message.id);
  return (
    <ChatRowBody
      message={message}
      hidden={response && !row.responseVisible}
      responseStyle={response ? row.responseStyle : undefined}
      highlight={message.id === row.highlightedRowId ? row.highlight : null}
      day={row.dayLabels.get(message.id)}
      unreadLine={message.id === row.unreadLineRowId ? row.unreadLine : null}
      turn={row.turnSummaries?.get(message.id)}
      onOpenTurn={row.onOpenTurn}
      branchDivider={row.branchDivider?.rowId === message.id ? row.branchDivider : null}
      isFirstUser={message.id === row.firstUserId}
      source={
        message.kind === "message" && message.replyToMessageId
          ? row.messagesById.get(message.replyToMessageId)
          : undefined
      }
      questionForm={message.id === row.promptController?.messageId ? row.promptController : undefined}
      upload={row.upload?.messageId === message.id ? row.upload : undefined}
      outbox={row.outboxStatuses?.get(message.id)}
      selecting={message.id === row.selectingMessageId}
      arriving={row.arrivals.has(message.id)}
      revealed={row.revealedIds.has(message.id)}
      shared={row.shared}
    />
  );
}

function renderRow({ item }: { item: VisibleMessage }) {
  return <ChatRow item={item} />;
}

function sameRowStructure(
  previous: readonly VisibleMessage[],
  next: readonly VisibleMessage[],
  type: (message: VisibleMessage) => string,
): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (before === after) continue;
    if (!before || !after || before.id !== after.id || type(before) !== type(after)) return false;
  }
  return true;
}

function useListRows(rows: VisibleMessage[], type: (message: VisibleMessage) => string): VisibleMessage[] {
  const kept = useRef(rows);
  if (kept.current !== rows && !sameRowStructure(kept.current, rows, type)) kept.current = rows;
  return kept.current;
}

const ListHeaderContext = createContext<ReactNode>(null);
const ListFooterContext = createContext<ReactNode>(null);

function ChatListHeader() {
  return useContext(ListHeaderContext);
}

function ChatListFooter() {
  return useContext(ListFooterContext);
}

const LIST_HEADER = <ChatListHeader />;
const LIST_FOOTER = <ChatListFooter />;
const LIST_STYLE = { flex: 1 } as const;

function openingRows(rows: VisibleMessage[]): VisibleMessage[] {
  const start = Math.max(0, rows.length - OPENING_ROWS);
  const user = rows.findLastIndex((message) => message.kind === "message" && message.author === "user");
  const from = user >= 0 && user >= rows.length - OPENING_ROWS_TO_USER ? Math.min(start, user) : start;
  return from === 0 ? rows : rows.slice(from);
}

function conversationImages(messages: readonly VisibleMessage[]): AttachmentSummary[] {
  return messages.flatMap((message) =>
    message.kind === "message" ? (message.attachments ?? []).filter(isViewableImage) : [],
  );
}

function messageCopyText(message: ChatBubbleMessage): string {
  const attachmentNames = new Map((message.attachments ?? []).map((attachment) => [attachment.id, attachment.name]));
  return expandAttachmentReferences(expandChatTagReferences(message.body), (reference) =>
    attachmentNames.get(reference.attachmentId),
  ).trim();
}

function TurnFailure({ reason }: { reason: string | undefined }) {
  const { t, errorMessage } = useText();
  const [danger] = useCSSVariable(["--openbot-danger-text"]);
  const text = errorMessage(reason, t("mobile.chat.failure.fallback"));
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${t("mobile.chat.failure.title")}. ${text}`}
      className="flex-row items-start gap-1.5 self-end px-1"
    >
      <CircleX size={14} color={String(danger)} strokeWidth={2} style={{ marginTop: 2 }} />
      <Typography.Paragraph type="body-xs" numberOfLines={6} className="shrink text-danger-text">
        {text}
      </Typography.Paragraph>
    </View>
  );
}

function NoAnswerNotice({ text }: { text: string }) {
  const { sourceText } = useText();
  const [warning] = useCSSVariable(["--openbot-warning-text"]);
  const notice = sourceText(text);
  return (
    <View accessible accessibilityLabel={notice} className="flex-row items-start gap-1.5 self-start px-1">
      <TriangleAlert size={14} color={String(warning)} strokeWidth={2} style={{ marginTop: 2 }} />
      <Typography.Paragraph type="body-xs" numberOfLines={6} className="shrink text-warning-text">
        {notice}
      </Typography.Paragraph>
    </View>
  );
}

const SCREEN_MOTION = new Set(["atLatest", "userScrolled"]);

function sameValues<T extends Omit<ChatMessageListProps, "motion"> | ChatMotion>(
  a: T,
  b: T,
  ignored?: ReadonlySet<string>,
): boolean {
  const before = new Map<string, unknown>(Object.entries(a));
  const after = Object.entries(b);
  return (
    after.length === before.size &&
    after.every(([key, value]) => ignored?.has(key) || (before.has(key) && Object.is(before.get(key), value)))
  );
}

function sameListProps(previous: ChatMessageListProps, next: ChatMessageListProps): boolean {
  const { motion: previousMotion, ...previousRest } = previous;
  const { motion: nextMotion, ...nextRest } = next;
  return sameValues(previousRest, nextRest) && sameValues(previousMotion, nextMotion, SCREEN_MOTION);
}

const NO_APPROVALS: readonly PendingApproval[] = [];
const NO_BROWSER_REQUESTS: readonly BrowserTakeoverRequest[] = [];
const NO_IDS: ReadonlySet<string> = new Set();
const NO_CHANNELS: readonly { id: string; name: string }[] = [];

export const ChatMessageList = memo(function ChatMessageList({
  bubbleSurface,
  upload,
  outboxStatuses,
  target,
  rowsShown,
  accessibilityHidden = false,
  activity,
  activities,
  agents,
  motion,
  sending,
  awaitingTurn,
  keyboardOffset,
  canSend,
  online,
  appActive,
  activeTurnId,
  turnSummaries,
  onOpenTurn,
  onOpenSubagents,
  onOpenMemoryChanges,
  questionForm,
  onSelectQuestion,
  activityAccessory,
  approvals = NO_APPROVALS,
  browserRequests = NO_BROWSER_REQUESTS,
  serverName = "",
  onRespondApproval,
  readsWholeApprovals = false,
  onLoadWholeApproval,
  foreground,
  historyState,
  catchingUp = false,
  messages,
  messageAliases,
  referenceMessages,
  hasOlder,
  olderLoading,
  olderError,
  onLoadOlder,
  muted,
  showStarter,
  topInset,
  onRetryHistory,
  onReply,
  onBranch,
  onDeleteMessage,
  deletesAnyMessage = false,
  onMarkUnread,
  markUnreadMessageIds,
  onTogglePin,
  pinnedMessageIds = NO_IDS,
  unreadLineMessageIds = null,
  sendChannels = NO_CHANNELS,
  onSendToChannel,
  branchPoints = NO_IDS,
  branchDivider = null,
  onOpenBranchSource,
  onReact,
  selectingMessageId = null,
  onSelectText,
  onSelectionChange,
  onDismissSelection,
  focusMessageId = null,
  focusUnread = false,
  onFocusPlaced,
  swipeGesture,
  pullShift,
  pullGesture,
}: ChatMessageListProps) {
  const { t, format, sourceText } = useText();
  const isFocused = useIsFocused();
  const timeOffset = useSharedValue(0);
  const [timesMounted, setTimesMounted] = useState(false);
  const timeReveal = useMemo<ChatTimeReveal>(
    () => ({ offset: timeOffset, mount: () => setTimesMounted(true) }),
    [timeOffset],
  );
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const messagesById = useMemo(
    () => indexChatMessages(messages, messageAliases, referenceMessages),
    [messages, messageAliases, referenceMessages],
  );
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  useEffect(() => stopReadAloud, []);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active) setScreenReaderEnabled(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReaderEnabled);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const announcedPromptId = useRef<string | null>(null);
  useEffect(() => {
    const promptId = questionForm?.messageId ?? null;
    if (!questionForm?.question || !promptId || announcedPromptId.current === promptId) return;
    announcedPromptId.current = promptId;
    AccessibilityInfo.announceForAccessibility(
      t("mobile.chat.question.inputRequired", { question: markdownInlinePlainText(questionForm.question.question) }),
    );
  }, [questionForm?.messageId, questionForm?.question, t]);
  const announcedApprovals = useRef(new Set<string>());
  useEffect(() => {
    for (const approval of approvals) {
      const key = String(approval.requestId);
      if (announcedApprovals.current.has(key)) continue;
      announcedApprovals.current.add(key);
      AccessibilityInfo.announceForAccessibility(
        t("mobile.chat.approval.inputRequired", {
          name: agentsById.get(approval.agentId)?.name ?? target.name,
          title: approvalTitle(approval, t),
        }),
      );
    }
  }, [approvals, agentsById, target.name, t]);
  const [themeForegroundColor, themeMutedColor] = useCSSVariable(["--openbot-text-primary", "--openbot-text-muted"]);
  const themeForeground = String(themeForegroundColor);
  const themeMuted = String(themeMutedColor);
  const reducedMotion = useReducedMotion();
  const textReveal = useMotionPreference("textReveal");
  const animateMessages = isFocused && online && appActive;
  const watchesArrivals = animateMessages && historyState === "ready" && !catchingUp;
  const replyHaptics = useReplyHaptics(watchesArrivals && motion.responseVisible);
  const conversationKey = JSON.stringify([target.serverId, target.kind, target.id]);
  const replySession = useMemo(
    () => ({
      key: conversationKey,
      progress: new Map<string, number>(),
      revealed: new Set<string>(),
      keptOpen: new Map<string, boolean>(),
    }),
    [conversationKey],
  );
  const [revealedState, setRevealedState] = useState<{ session: typeof replySession; ids: ReadonlySet<string> }>({
    session: replySession,
    ids: NO_IDS,
  });
  const revealedIds = revealedState.session === replySession ? revealedState.ids : NO_IDS;
  const markRevealed = useCallback(
    (id: string) => {
      if (replySession.revealed.has(id)) return;
      replySession.revealed.add(id);
      setRevealedState({ session: replySession, ids: new Set(replySession.revealed) });
    },
    [replySession],
  );
  const { arriving: arrivals, entrances } = useMessageArrivals(replySession.key, messages, watchesArrivals);
  const messageColorMode = useMessageColor((state) => state.mode);
  const customMessageColor = useMessageColor((state) => state.customColor);
  const messageColorStyle = useMessageColor((state) => state.style);
  const backdropBubbleColor = useChatBackdrop((state) =>
    state.choice === "agent" ? state.agentPage?.bubbles?.yours : undefined,
  );
  const [themeSurface, controlFill] = useCSSVariable(["--openbot-bg-surface", "--openbot-bg-control"]);
  const seeThroughSetting = useMessageColor((state) => state.seeThrough);
  const backdropShown = useChatBackdropBase() !== null;
  const seeThrough = seeThroughSetting && backdropShown;
  const solidBubbleSurface = seeThrough ? undefined : bubbleSurface;
  const plainBubbleFill = seeThrough
    ? undefined
    : (mixColor(bubbleSurface, String(controlFill), PLAIN_BUBBLE_SHARE) ?? String(controlFill));
  const dark = useUniwind().theme === "dark";
  const solidBubbleColor =
    backdropBubbleColor ??
    (messageColorMode === "custom"
      ? customMessageColor
      : avatarHeadColor(
          target.kind === "agent" ? target.avatarSeed : target.id,
          target.kind === "agent" ? target.avatarHue : null,
          target.kind === "agent" ? target.avatarColor : null,
        ));
  const userBubbleColor =
    messageColorStyle === "tint" ? tintedMessageColor(solidBubbleColor, String(themeSurface), dark) : solidBubbleColor;
  const coloredMessages = messageColorMode === "custom" || (messageColorMode === "agent" && target.kind === "agent");
  const userForeground = readableOn(userBubbleColor);
  const appearance = useConnectionAppearance(!canSend);
  const red = Number.parseInt(userBubbleColor.slice(1, 3), 16);
  const green = Number.parseInt(userBubbleColor.slice(3, 5), 16);
  const blue = Number.parseInt(userBubbleColor.slice(5, 7), 16);
  const gray = red * 0.213 + green * 0.715 + blue * 0.072;
  const userBubbleStyle = useAnimatedStyle(() => {
    const { saturation } = appearance.get();
    const r = Math.round(gray + (red - gray) * saturation);
    const g = Math.round(gray + (green - gray) * saturation);
    const b = Math.round(gray + (blue - gray) * saturation);
    return { backgroundColor: `rgb(${r}, ${g}, ${b})` };
  });

  const rowShown = useChatRowShown(turnSummaries);
  const visibleMessages = useMemo(
    () =>
      groupRoutineRunMarkers(
        groupExchangeMarkers(
          messages.filter(
            (message) =>
              rowShown(message) ||
              (message.kind !== "thinking" && (message.id === focusMessageId || message.id === branchDivider?.afterId)),
          ),
        ),
        {
          unreadMessageIds: unreadLineMessageIds,
          focusMessageId: focusUnread ? null : focusMessageId,
          branchRowId: branchDivider?.afterId,
        },
      ),
    [messages, rowShown, unreadLineMessageIds, focusMessageId, focusUnread, branchDivider?.afterId],
  );
  const dayLabels = useMemo(
    () => chatDayLabels(visibleMessages, { t, format }, { hasOlder }),
    [visibleMessages, t, format, hasOlder],
  );
  const images = useMemo(() => conversationImages(visibleMessages), [visibleMessages]);
  const [openingShown, setOpeningShown] = useState(false);
  useEffect(() => {
    if (rowsShown || openingShown) return;
    const frame = requestAnimationFrame(() => setOpeningShown(true));
    return () => cancelAnimationFrame(frame);
  }, [rowsShown, openingShown]);
  const startsAtEnd = motion.startsAtEnd;
  const rows = useMemo(
    () => (rowsShown ? visibleMessages : openingShown && startsAtEnd ? openingRows(visibleMessages) : NO_ROWS),
    [rowsShown, openingShown, startsAtEnd, visibleMessages],
  );
  const tailIndex = rows.findLastIndex((message) => message.kind === "message" && message.author === "user");
  const focusIndex = !focusMessageId
    ? -1
    : focusUnread
      ? unreadLineMessageIds
        ? firstChatRowOf(rows, unreadLineMessageIds)
        : -1
      : chatRowIndex(rows, focusMessageId);
  const canLoadOlder = online && hasOlder && !olderLoading;
  useFoldScrollAnchor(motion.listRef);
  const placedFocus = useRef<string | null>(null);
  const focusId = historyState === "ready" && rowsShown && focusIndex >= 0 ? (rows[focusIndex]?.id ?? null) : null;
  const focusHandlers = useRef({ openAt: motion.openAt, onFocusPlaced });
  focusHandlers.current = { openAt: motion.openAt, onFocusPlaced };
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const highlightShown = useRef(new Set<string>());
  const highlightColor = String(useCSSVariable("--openbot-accent"));
  useEffect(() => {
    if (!focusId || !motion.listPlaced || placedFocus.current === focusId) return;
    placedFocus.current = focusId;
    void focusHandlers.current.openAt(focusIndex, focusUnread).then(() => {
      if (!focusUnread) setHighlightedRowId(focusId);
      focusHandlers.current.onFocusPlaced?.();
    });
  }, [focusId, focusIndex, focusUnread, motion.listPlaced]);
  const unreadRowMissing =
    focusUnread && Boolean(focusMessageId) && historyState === "ready" && rowsShown && focusIndex < 0;
  const shownWithoutUnread = focusUnread && motion.historyVisible && placedFocus.current === null;
  useEffect(() => {
    if (unreadRowMissing || shownWithoutUnread) focusHandlers.current.onFocusPlaced?.();
  }, [unreadRowMissing, shownWithoutUnread]);
  const header = topInset + 84;
  const screen = useWindowDimensions();
  const tailRow = rows[tailIndex];
  const tailHasImages = tailRow?.kind === "message" && Boolean(tailRow.attachments?.some(isStackImage));
  const anchorMaxSize = tailHasImages ? undefined : Math.round(screen.height * ANCHOR_SHOWN_SHARE);
  const onAnchorReady = motion.onAnchorReady;
  const anchoredEndSpace = useMemo<AnchoredEndSpaceConfig | undefined>(
    () =>
      tailIndex >= 0
        ? {
            anchorIndex: tailIndex,
            anchorOffset: header,
            anchorMaxSize,
            onReady: (info) => onAnchorReady(info, anchorMaxSize),
          }
        : undefined,
    [tailIndex, header, anchorMaxSize, onAnchorReady],
  );
  const sharedValues = useMemo(
    () => ({ scrollOffset: motion.scrollOffset, isAtEnd: motion.atEnd }),
    [motion.scrollOffset, motion.atEnd],
  );
  const columnWidth = useColumnWidth();
  const insets = useSafeAreaInsets();
  const estimatedListSize = useMemo(
    () => ({ width: columnWidth, height: screen.height }),
    [columnWidth, screen.height],
  );
  const onListReady = motion.onListReady;
  const hasRows = rows.length > 0;
  const onReady = useCallback(() => onListReady(hasRows), [onListReady, hasRows]);
  const selectionArea = useRef<ViewInstance | null>(null);
  const actionHandlers = useRef({
    onReply,
    onBranch,
    onReact,
    onDeleteMessage,
    onMarkUnread,
    markUnreadMessageIds,
    onTogglePin,
    onSendToChannel,
    onSelectText,
    onSelectionChange,
    onSelectQuestion,
  });
  actionHandlers.current = {
    onReply,
    onBranch,
    onReact,
    onDeleteMessage,
    onMarkUnread,
    markUnreadMessageIds,
    onTogglePin,
    onSendToChannel,
    onSelectText,
    onSelectionChange,
    onSelectQuestion,
  };
  const actions = useMemo<MessageRowShared["actions"]>(
    () => ({
      reply: (message) => actionHandlers.current.onReply?.(message),
      branch: (message) => actionHandlers.current.onBranch?.(message),
      selectQuestion: (messageId) => actionHandlers.current.onSelectQuestion?.(messageId),
      react: async (message, emoji) => actionHandlers.current.onReact?.(message, emoji),
      delete: async (message) => actionHandlers.current.onDeleteMessage?.(message),
      markUnread: (message) => actionHandlers.current.onMarkUnread?.(message),
      togglePin: async (message, pinned) => actionHandlers.current.onTogglePin?.(message, pinned),
      marksUnread: (message) => actionHandlers.current.markUnreadMessageIds?.has(message.id) ?? true,
      sendToChannel: (message, channelId) => actionHandlers.current.onSendToChannel?.(message, channelId),
      selectText: (message) => actionHandlers.current.onSelectText?.(message),
      selectionChange: (selected) => actionHandlers.current.onSelectionChange?.(selected),
      selectionArea: (view) => {
        selectionArea.current = view;
      },
    }),
    [],
  );
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const dismissSelection = useRef(onDismissSelection);
  dismissSelection.current = onDismissSelection;
  const onTouchStart = ({ nativeEvent }: GestureResponderEvent) => {
    touchStart.current = { x: nativeEvent.pageX, y: nativeEvent.pageY, time: nativeEvent.timestamp };
  };
  const onTouchEnd = ({ nativeEvent }: GestureResponderEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const area = selectionArea.current;
    if (!start || !area || !dismissSelection.current) return;
    const moved = Math.hypot(nativeEvent.pageX - start.x, nativeEvent.pageY - start.y);
    if (moved > TAP_SLOP || nativeEvent.timestamp - start.time > TAP_DURATION_MS) return;
    const { pageX, pageY } = nativeEvent;
    area.measureInWindow((x, y, width, height) => {
      const inside =
        pageX >= x - HANDLE_MARGIN &&
        pageX <= x + width + HANDLE_MARGIN &&
        pageY >= y - HANDLE_MARGIN &&
        pageY <= y + height + HANDLE_MARGIN;
      if (!inside) dismissSelection.current?.();
    });
  };
  const animationActive = animateMessages && motion.responseVisible;
  const canReply = Boolean(onReply);
  const canReact = Boolean(onReact);
  const canDelete = Boolean(onDeleteMessage);
  const canMarkUnread = Boolean(onMarkUnread);
  const canPin = Boolean(onTogglePin);
  const shownPinnedIds = onTogglePin ? pinnedMessageIds : NO_IDS;
  const shownSendChannels = onSendToChannel ? sendChannels : NO_CHANNELS;
  const canSelectText = Boolean(onSelectText);
  const canSelectQuestion = Boolean(onSelectQuestion);
  const shownBranchPoints = onBranch ? branchPoints : NO_IDS;
  const listWidth = columnWidth - insets.left - insets.right - LIST_PADDING * 2;
  const messageFiles = useMessageFileOpener(target.serverId);
  const remoteContent = useRemoteChatContent(target.serverId);
  const shared = useMemo<MessageRowShared>(
    () => ({
      agents,
      agentsById,
      serverId: target.serverId,
      remoteContent,
      canSend,
      muted,
      themeMuted,
      foreground,
      userForeground,
      userBubbleStyle: coloredMessages ? userBubbleStyle : undefined,
      plainBubbleFill,
      solidBubbleSurface,
      attachmentTint: coloredMessages ? { color: userBubbleColor, foreground: userForeground } : undefined,
      bubbleTone: coloredMessages ? bubbleTone(userForeground) : undefined,
      firstMessageStyle: motion.firstMessageStyle,
      animationActive,
      playbackActive: animationActive && textReveal && !screenReaderEnabled,
      playbackPaused: !animationActive && textReveal && !screenReaderEnabled,
      screenReaderEnabled,
      replySession,
      markRevealed,
      replyHaptics,
      canReply,
      canReact,
      canDelete,
      deletesAny: deletesAnyMessage,
      canMarkUnread,
      canPin,
      pinnedIds: shownPinnedIds,
      sendChannels: shownSendChannels,
      canSelectText,
      canSelectQuestion,
      branchPoints: shownBranchPoints,
      listWidth,
      fileAgentId: target.kind === "agent" ? target.id : undefined,
      openSubagents: onOpenSubagents,
      openMemoryChanges: onOpenMemoryChanges,
      openFile: messageFiles.open,
      actions,
    }),
    [
      agents,
      agentsById,
      target.kind,
      target.serverId,
      remoteContent,
      canSend,
      muted,
      themeMuted,
      foreground,
      userForeground,
      userBubbleStyle,
      userBubbleColor,
      coloredMessages,
      plainBubbleFill,
      solidBubbleSurface,
      motion.firstMessageStyle,
      screenReaderEnabled,
      animationActive,
      textReveal,
      replySession,
      markRevealed,
      replyHaptics,
      canReply,
      canReact,
      canDelete,
      deletesAnyMessage,
      canMarkUnread,
      canPin,
      shownPinnedIds,
      shownSendChannels,
      canSelectText,
      canSelectQuestion,
      shownBranchPoints,
      listWidth,
      target.id,
      onOpenSubagents,
      onOpenMemoryChanges,
      messageFiles.open,
      actions,
    ],
  );
  const pendingReveal = visibleMessages.some((message) =>
    awaitingFirstWord(message, shared, arrivals.has(message.id), revealedIds.has(message.id)),
  );
  const { responseStyle, responseVisible } = motion;
  const promptController = questionForm?.messageId ? questionForm : undefined;
  const responseIds = useMemo(() => new Set(rows.slice(tailIndex + 1).map((row) => row.id)), [rows, tailIndex]);
  const firstUserId = rowsShown && tailIndex === 0 && !hasOlder ? (rows[0]?.id ?? null) : null;
  const openBranchSource = useRef(onOpenBranchSource);
  openBranchSource.current = onOpenBranchSource;
  const canOpenBranchSource = Boolean(onOpenBranchSource);
  const dividerRowId = useMemo(() => {
    const afterId = branchDivider?.afterId;
    if (!afterId) return null;
    return visibleMessages[chatRowHolding(visibleMessages, afterId)]?.id ?? null;
  }, [branchDivider?.afterId, visibleMessages]);
  const unreadLineColor = coloredMessages ? userBubbleColor : undefined;
  const unreadLineAnimated = useRef(new Set<string>());
  const unreadLineRowId = useMemo(() => {
    if (!unreadLineMessageIds) return null;
    return visibleMessages[firstChatRowOf(visibleMessages, unreadLineMessageIds)]?.id ?? null;
  }, [unreadLineMessageIds, visibleMessages]);
  const rowBranchDivider = useMemo<RowContextValue["branchDivider"]>(
    () =>
      dividerRowId && branchDivider
        ? {
            rowId: dividerRowId,
            label: branchDivider.label,
            onOpen: canOpenBranchSource ? () => openBranchSource.current?.() : undefined,
          }
        : null,
    [dividerRowId, branchDivider, canOpenBranchSource],
  );
  const [routineGroupsState] = useState<RoutineGroupsState>(() => ({
    collapse: useRoutineCollapsePreference.getState().enabled,
    groups: new Map(),
  }));
  const routineRowType = useCallback(
    (message: VisibleMessage) => rowType(message, routineGroupsState),
    [routineGroupsState],
  );
  const listRows = useListRows(rows, routineRowType);
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const unreadLine = useMemo(
    () => ({ color: unreadLineColor, animated: unreadLineAnimated.current }),
    [unreadLineColor],
  );
  const highlight = useMemo(() => ({ color: highlightColor, shown: highlightShown.current }), [highlightColor]);
  const rowContext = useMemo<RowContextValue>(
    () => ({
      shared,
      rowsById,
      arrivals,
      revealedIds,
      responseIds,
      responseVisible,
      responseStyle,
      firstUserId,
      messagesById,
      promptController,
      upload,
      outboxStatuses,
      selectingMessageId,
      turnSummaries,
      onOpenTurn,
      dayLabels,
      branchDivider: rowBranchDivider,
      unreadLineRowId,
      unreadLine,
      highlightedRowId,
      highlight,
    }),
    [
      shared,
      rowsById,
      arrivals,
      revealedIds,
      responseIds,
      responseVisible,
      responseStyle,
      firstUserId,
      messagesById,
      promptController,
      upload,
      outboxStatuses,
      selectingMessageId,
      turnSummaries,
      onOpenTurn,
      dayLabels,
      rowBranchDivider,
      unreadLineRowId,
      unreadLine,
      highlightedRowId,
      highlight,
    ],
  );
  const showThinking = useThinkingDisplayPreference((state) => state.enabled);
  const activitySpec = (activity?: MobileAgentActivity): ChatActivitySpec | null => {
    const latestThinking = messages.findLast(
      (message) => message.kind === "thinking" && message.turnId === (activity?.turnId ?? activeTurnId),
    );
    const replying = messages.some(
      (message) =>
        isStreamingReply(message) &&
        message.kind === "message" &&
        message.body.trim() &&
        (!activity?.agentId || !message.speaker || message.speaker.id === activity.agentId),
    );
    const latestStep =
      showThinking && !replying && latestThinking?.kind === "thinking" ? latestThinking.steps.at(-1) : undefined;
    const thinkingDetail = latestStep && !latestStep.progress ? latestStep.text.replace(/\s+/gu, " ").trim() : null;
    const activityLabel =
      sending && !activity
        ? t("common.sending")
        : activity?.phase === "waiting"
          ? // The reason of the wait names it first. A channel has no active turn of its own.
            activity.reason === "question" ||
            messages.some(
              (message) =>
                message.kind === "question" &&
                !message.prompt.resolution &&
                message.turnId === (activity.turnId ?? activeTurnId),
            )
            ? t("mobile.chat.activity.waitingForAnswer")
            : activity.reason === "approval" ||
                approvals.some((approval) => approval.agentId === (activity.agentId ?? target.id))
              ? t("mobile.chat.activity.waitingForApproval")
              : activity.reason === "takeover" ||
                  browserRequests.some((request) => request.agentId === (activity.agentId ?? target.id))
                ? t("mobile.chat.activity.waitingForBrowser")
                : t("mobile.chat.activity.waitingOnDesktop")
          : thinkingDetail
            ? thinkingDetail
            : activity?.phase === "responding"
              ? t("mobile.chat.activity.responding")
              : activity?.detail
                ? sourceText(activity.detail)
                : replying
                  ? t("mobile.chat.activity.responding")
                  : t("mobile.chat.activity.thinking");
    const activityAgent = activity?.agentId
      ? agentsById.get(activity.agentId)
      : target.kind === "agent"
        ? target
        : undefined;
    const turnId = activity?.turnId ?? activeTurnId;
    if (!(activity || sending || awaitingTurn || activeTurnId || messages.some(isStreamingReply) || pendingReveal))
      return null;
    return {
      key: activity?.agentId ?? activityAgent?.id ?? target.id,
      label: activityLabel,
      accessibilityLabel: `${activityAgent?.name ?? target.name}: ${activityLabel}`,
      agent: activityAgent,
      mood: animateMessages ? agentActivityMood(activity) : "idle",
      online,
      animateAvatar: animateMessages,
      onPress: onOpenTurn && turnId ? () => onOpenTurn(turnId) : undefined,
      shimmer:
        animateMessages &&
        motion.historyVisible &&
        motion.responseVisible &&
        !reducedMotion &&
        activity?.phase !== "waiting",
    };
  };
  const openTaggedTab = useTaggedTabOpener(target.serverId);
  const activityRows = useActivityPresence(
    (activities?.length ? activities : [activity]).flatMap((entry) => activitySpec(entry) ?? []),
    motion.sendSettling,
  );

  const startReached = useRef(() => {});
  startReached.current = () => {
    if (motion.historyVisible && canLoadOlder && !olderError) onLoadOlder();
  };
  const onStartReached = useCallback(() => startReached.current(), []);
  const historyVisible = motion.historyVisible;
  const startListRef = motion.listRef;
  useEffect(() => {
    if (historyVisible && online && startListRef.current?.getState().isNearStart) startReached.current();
  }, [historyVisible, online, startListRef]);
  const contentContainerStyle = useMemo(
    () => ({
      paddingLeft: insets.left + LIST_PADDING,
      paddingRight: insets.right + LIST_PADDING,
      paddingTop: header,
    }),
    [insets.left, insets.right, header],
  );
  const dataKey = `${conversationKey}:${motion.latestGeneration}`;
  const drawDistance = Math.round(screen.height * DRAW_SCREENS);
  const {
    listRef,
    startsAtEnd: listStartsAtEnd,
    followsEnd,
    composerHeight,
    keyboardLiftBehavior,
    onContentSizeChange,
    onViewportLayout,
    onScrollBeginDrag,
    onScrollEndDrag,
  } = motion;
  const list = useMemo(
    () => (
      <KeyboardAwareLegendList
        ref={listRef}
        data={listRows}
        dataKey={dataKey}
        keyExtractor={rowKey}
        getItemType={routineRowType}
        renderItem={renderRow}
        recycleItems={false}
        estimatedItemSize={ESTIMATED_ROW_SIZE}
        estimatedListSize={estimatedListSize}
        drawDistance={drawDistance}
        experimental_adaptiveRender={ADAPTIVE_RENDER}
        experimental_hideItemsUntilMeasured
        initialScrollAtEnd={listStartsAtEnd}
        anchoredEndSpace={anchoredEndSpace}
        maintainVisibleContentPosition={KEEP_VISIBLE_POSITION}
        maintainScrollAtEnd={followsEnd ? FOLLOW_END : false}
        sharedValues={sharedValues}
        contentInsetEndAdjustment={composerHeight}
        keyboardOffset={keyboardOffset}
        keyboardLiftBehavior={keyboardLiftBehavior}
        applyWorkaroundForContentInsetHitTestBug
        automaticallyAdjustKeyboardInsets={false}
        onReady={onReady}
        onStartReached={onStartReached}
        onStartReachedThreshold={0.5}
        style={LIST_STYLE}
        contentContainerStyle={contentContainerStyle}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical
        onContentSizeChange={onContentSizeChange}
        onLayout={onViewportLayout}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollEnd={onScrollEndDrag}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={LIST_HEADER}
        ListFooterComponent={LIST_FOOTER}
      />
    ),
    [
      listRef,
      listRows,
      dataKey,
      routineRowType,
      estimatedListSize,
      drawDistance,
      listStartsAtEnd,
      anchoredEndSpace,
      followsEnd,
      sharedValues,
      composerHeight,
      keyboardOffset,
      keyboardLiftBehavior,
      onReady,
      onStartReached,
      contentContainerStyle,
      onContentSizeChange,
      onViewportLayout,
      onScrollBeginDrag,
      onScrollEndDrag,
    ],
  );
  const listHeader = (
    <>
      {hasOlder ? (
        <View className="h-13 items-center justify-center">
          {olderLoading ? (
            <View
              accessible
              accessibilityLabel={t("mobile.chat.history.loadingOlder")}
              accessibilityState={{ busy: true }}
            >
              <Spinner size="sm" color={themeMuted} />
            </View>
          ) : olderError ? (
            <Button size="sm" variant="tertiary" isDisabled={!canLoadOlder} onPress={onLoadOlder}>
              <Button.Label>{t("mobile.chat.history.retryOlder")}</Button.Label>
            </Button>
          ) : null}
        </View>
      ) : null}
      {historyState === "connecting" || historyState === "loading" ? (
        <View
          className="flex-1"
          accessible
          accessibilityLabel={
            historyState === "connecting" ? t("mobile.chat.history.connecting") : t("mobile.chat.history.loading")
          }
          accessibilityState={{ busy: true }}
        />
      ) : historyState === "error" ? (
        <View className="flex-1 items-center justify-center gap-2">
          <Typography.Paragraph align="center" className="text-text-secondary">
            {t("mobile.chat.history.loadFailed")}
          </Typography.Paragraph>
          <Button variant="tertiary" onPress={onRetryHistory}>
            <Button.Label>{t("common.tryAgain")}</Button.Label>
          </Button>
        </View>
      ) : null}
    </>
  );
  const listFooter = (
    <>
      <Animated.View style={motion.responseStyle}>
        {activityRows.map((spec) => (
          <ChatActivityRow
            key={spec.key}
            spec={spec}
            foreground={foreground ?? themeForeground}
            muted={muted ?? themeMuted}
          />
        ))}
      </Animated.View>
      {activityAccessory}
      {onRespondApproval && approvals.length ? (
        <View className="gap-3 pb-3">
          {approvals.map((approval) => (
            <ChatApprovalCard
              key={String(approval.requestId)}
              approval={approval}
              agentName={agentsById.get(approval.agentId)?.name ?? target.name}
              showAgentName={target.kind === "channel"}
              serverName={serverName}
              canAnswer={canSend}
              respond={(decision) => onRespondApproval(approval, decision)}
              readsWhole={readsWholeApprovals && onLoadWholeApproval !== undefined}
              loadWhole={() => onLoadWholeApproval?.(approval) ?? Promise.resolve()}
            />
          ))}
        </View>
      ) : null}
      {showStarter ? (
        <View className="gap-1 px-1 py-4">
          <Typography.Heading type="h4">{t("mobile.chat.starter.title")}</Typography.Heading>
          <Typography.Paragraph className="text-text-secondary">{t("mobile.chat.starter.body")}</Typography.Paragraph>
        </View>
      ) : null}
    </>
  );

  const pullStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -(pullShift?.get() ?? 0) }] }));
  const body = (
    <Animated.View
      onTouchStart={selectingMessageId ? onTouchStart : undefined}
      onTouchEnd={selectingMessageId ? onTouchEnd : undefined}
      style={[{ flex: 1 }, historyState === "ready" ? motion.historyStyle : undefined, pullStyle]}
      accessibilityElementsHidden={accessibilityHidden || (historyState === "ready" && !motion.historyVisible)}
      importantForAccessibility={
        !accessibilityHidden && (historyState !== "ready" || motion.historyVisible) ? "auto" : "no-hide-descendants"
      }
    >
      <ChatSolidSurfaceProvider surface={solidBubbleSurface}>
        <ChatImageViewerProvider serverId={target.serverId} images={images}>
          <ChatTagActionsContext value={openTaggedTab}>
            <HistoryShownContext value={historyState !== "ready" || motion.historyVisible}>
              <RoutineGroupsContext value={routineGroupsState}>
                <KeptOpenContext value={replySession.keptOpen}>
                  <ArrivalEntrancesContext value={entrances}>
                    <RowContext value={rowContext}>
                      <ChatSwipeGestureContext value={swipeGesture ?? null}>
                        <ChatTimeRevealContext value={timeReveal}>
                          <ChatTimesMountedContext value={timesMounted}>
                            <ListHeaderContext value={listHeader}>
                              <ListFooterContext value={listFooter}>{list}</ListFooterContext>
                            </ListHeaderContext>
                          </ChatTimesMountedContext>
                        </ChatTimeRevealContext>
                      </ChatSwipeGestureContext>
                    </RowContext>
                  </ArrivalEntrancesContext>
                </KeptOpenContext>
              </RoutineGroupsContext>
            </HistoryShownContext>
          </ChatTagActionsContext>
        </ChatImageViewerProvider>
      </ChatSolidSurfaceProvider>
      {messageFiles.sheet}
    </Animated.View>
  );
  const pulled = pullGesture ? <GestureDetector gesture={pullGesture}>{body}</GestureDetector> : body;
  return swipeGesture ? (
    <GestureDetector gesture={swipeGesture}>
      <View style={{ flex: 1 }}>{pulled}</View>
    </GestureDetector>
  ) : (
    pulled
  );
}, sameListProps);
