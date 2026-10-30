import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import type { AnchoredEndSpaceConfig } from "@legendapp/list/react-native";
import { expandAttachmentReferences } from "@openbot/contracts/attachment-references";
import { expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { AttachmentSummary, BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { markdownPlainText } from "@openbot/contracts/markdown-preview-text";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CalendarX2 from "lucide-react-native/icons/calendar-x-2";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CirclePause from "lucide-react-native/icons/circle-pause";
import CircleX from "lucide-react-native/icons/circle-x";
import Clock3 from "lucide-react-native/icons/clock-3";
import CornerUpRight from "lucide-react-native/icons/corner-up-right";
import LoaderCircle from "lucide-react-native/icons/loader-circle";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import X from "lucide-react-native/icons/x";
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
import Animated, {
  Easing,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import { ChatActivityRow, type ChatActivitySpec } from "@/features/chat/components/chat-activity-row";
import { type ApprovalDecision, approvalTitle, ChatApprovalCard } from "@/features/chat/components/chat-approval-card";
import { ChatExchangeGroup, ChatExchangeMarker } from "@/features/chat/components/chat-exchange-marker";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { ChatPlan } from "@/features/chat/components/chat-plan";
import { ChatQuestionPrompt } from "@/features/chat/components/chat-question-prompt";
import { ChatTurnStepsRow } from "@/features/chat/components/chat-turn-steps-row";
import { useActivityPresence } from "@/features/chat/components/use-activity-presence";
import { CHAT_ROW_GAP, type ChatMotion } from "@/features/chat/components/use-chat-motion";
import { useFoldScrollAnchor } from "@/features/chat/components/use-fold-scroll-anchor";
import { useMessageArrivals } from "@/features/chat/components/use-message-arrivals";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import {
  type ChatBubbleMessage,
  type ChatMessage,
  chatRowIndex,
  type ExchangeGroup,
  groupExchangeMarkers,
  indexChatMessages,
  type RoutineMarkerEvent,
} from "@/features/chat/model/chat-messages";
import type { TurnStepsSummary } from "@/features/chat/model/turn-thinking";
import { useAgentColorMessages } from "@/features/settings/model/message-color";
import { useConnectionAppearance } from "@/features/workspace/components/use-connection-appearance";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood, type MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import type { PendingApproval } from "@/features/workspace/model/pending-approvals";
import { useColumnWidth } from "@/shared/components/adaptive-split";
import { haptics } from "@/shared/lib/haptics";
import { useMotionPreference, useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { mentionDraft } from "../model/chat-mentions";
import type { ChatTarget } from "../model/chat-target";
import { nativeTextSelection } from "../model/native-text-selection";
import { isStreamingReply } from "../model/reply-reveal";
import { uploadProgressAt } from "../model/upload-progress";
import { type AttachmentTint, ChatAttachmentView } from "./chat-attachment";
import { ChatImageGallery } from "./chat-image-gallery";
import { ChatImageGeneration, imageGenerationStatus } from "./chat-image-generation";
import { ChatImageViewerProvider, isViewableImage } from "./chat-image-viewer";
import { ChatMessageActions } from "./chat-message-actions";
import { ChatMessageGesture } from "./chat-message-gesture";
import { ChatOutboxStatus, OutboxMessageMenu, type OutboxRowStatus } from "./chat-outbox-status";
import { ChatSelectableText } from "./chat-selectable-text";
import { HistoryShownContext } from "./use-history-shown";
import { useReplyHaptics } from "./use-reply-haptics";

/** The most movement and time of a touch that ends the selection: more is a scroll or a hold. */
const TAP_SLOP = 10;
const TAP_DURATION_MS = 400;
/** The selection handles stand this far out of the row of the selected message. */
const HANDLE_MARGIN = 24;

/** A row of the list. Thinking steps show in the activity row instead. */
type VisibleMessage = Exclude<ChatMessage, { kind: "thinking" }> | ExchangeGroup;
const NO_ROWS: VisibleMessage[] = [];
/**
 * While the chat opens on Android, the list renders only the latest rows, which the reader sees
 * first. The older rows come when the chat is in place, above the rows on screen.
 */
const OPENING_ROWS = 6;
/** The opening rows reach back to the latest user message when it is this near the end. */
const OPENING_ROWS_TO_USER = 12;
const ROW_STYLE = { paddingBottom: CHAT_ROW_GAP };
/** The side padding of the list. */
const LIST_PADDING = 16;
/** A user's message is at most this part of the list width, as `max-w-[88%]` on its row. */
const USER_BUBBLE_WIDTH = 0.88;

/** The list keeps the sizes it measured by message, so rows that stay keep their place when the data changes. */
function rowKey(message: VisibleMessage): string {
  return message.id;
}
/** The size of a user bubble, an agent reply and a marker line differ a lot, so each kind has its own average. */
function rowType(message: VisibleMessage): string {
  return message.kind === "message" ? message.author : message.kind;
}
// A typical row of a mixed chat: a short reply with its action row. It decides how many rows the
// list prepares before it has measured any.
const ESTIMATED_ROW_SIZE = 150;
// The list renders one screen of rows above and below the visible rows, so a row has mounted and
// has its size before it comes into view. Chat rows are tall: the default of 250 pixels often
// prepares less than one row, and a quick scroll showed empty space and rows that grew in place.
const DRAW_SCREENS = 1;
// A scroll faster than about a screen per half second marks the list "light". A row that mounts then
// keeps the space of its previews and media, and draws them when the list slows down. The
// default threshold is three times faster, so an ordinary quick scroll rendered every row in full.
const ADAPTIVE_RENDER = { enterVelocity: 1.5, exitVelocity: 0.5 };
// Older messages that a page adds at the top, and rows that change size above the visible rows, do
// not move the messages that the reader sees.
const KEEP_VISIBLE_POSITION = { data: true, size: true };
const FOLLOW_END = { animated: false, on: { dataChange: true, itemLayout: true, footerLayout: true, layout: true } };

const STARTER_OPTIONS = [
  { id: "plan", label: "mobile.chat.starter.planLabel", detail: "mobile.chat.starter.planDetail" },
  { id: "research", label: "mobile.chat.starter.researchLabel", detail: "mobile.chat.starter.researchDetail" },
  { id: "solve", label: "mobile.chat.starter.solveLabel", detail: "mobile.chat.starter.solveDetail" },
] as const satisfies readonly { id: string; label: MobileTextKey; detail: MobileTextKey }[];

const USER_MESSAGE_ENTRANCE = FadeInDown.duration(240)
  .easing(Easing.bezier(0.23, 1, 0.32, 1))
  .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] })
  .reduceMotion(ReduceMotion.System);
const REPLY_SIZE = { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.System };
// The pill takes over from the activity row, so it fades rather than grows from nothing: its first
// measurement is already the size of the first revealed word.
const REPLY_APPEAR = { duration: 220, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.Never };

function ChatBubble({
  children,
  agent,
  collapsed = false,
  animateSize,
  className,
  style,
}: PropsWithChildren<{
  agent: boolean;
  collapsed?: boolean;
  /** Off when Settings turns reply animation off: the background takes each new size at once. */
  animateSize: boolean;
  className: string;
  style: ComponentProps<typeof Animated.View>["style"];
}>) {
  // An animated size needs a layout event in JS for each new size. Android sends them late enough
  // that the background trails the text, so there, as with the animation off, the background fills
  // the bubble in the same layout pass as the text.
  const sized = agent && animateSize && !isAndroid;
  const size = useSharedValue({ width: 0, height: 0, measured: false });
  const shown = useSharedValue(collapsed ? 0 : 1);
  useEffect(() => {
    shown.set(collapsed ? 0 : withTiming(1, REPLY_APPEAR));
  }, [collapsed, shown]);
  const background = useAnimatedStyle(() => {
    if (!sized) return { opacity: shown.get() };
    const { width, height, measured } = size.get();
    // The first measurement is adopted without motion; only later growth during streaming animates.
    return {
      opacity: shown.get(),
      width: measured ? withTiming(width, REPLY_SIZE) : width,
      height: measured ? withTiming(height, REPLY_SIZE) : height,
    };
  });
  return (
    <Animated.View
      className={className}
      style={style}
      onLayout={
        sized
          ? ({ nativeEvent }) => {
              const previous = size.get();
              size.set({
                width: nativeEvent.layout.width,
                height: nativeEvent.layout.height,
                measured: previous.measured || previous.width > 0,
              });
            }
          : undefined
      }
    >
      {/* Only the childless background resizes. The list measures the actual
          content once, without a layout animation moving its native anchor. */}
      {agent ? (
        <Animated.View
          // A new view when the setting changes, so a filled background keeps no animated size.
          key={sized ? "sized" : "filled"}
          pointerEvents="none"
          className="absolute left-0 top-0 rounded-[30px] bg-control/60"
          style={[{ borderCurve: "circular" }, sized ? null : StyleSheet.absoluteFill, background]}
        />
      ) : null}
      {children}
    </Animated.View>
  );
}

interface ChatMessageListProps {
  target: ChatTarget;
  /** False while the chat opens on Android: the list has only its latest rows until the chat is in place. */
  rowsShown: boolean;
  /** Something covers the list, such as the voice mode, so screen readers skip it. */
  accessibilityHidden?: boolean;
  activity?: MobileAgentActivity;
  /** The activity of each member agent that works in a channel. An agent chat has only `activity`. */
  activities?: MobileAgentActivity[];
  agents: MobileAgent[];
  motion: ChatMotion;
  sending: boolean;
  /** The host accepted the sent message, and its turn does not show yet. */
  awaitingTurn: boolean;
  keyboardOffset: number;
  canSend: boolean;
  online: boolean;
  appActive: boolean;
  activeTurnId: string | null;
  /** The steps row of each finished turn, by the id of its first answer. */
  turnSummaries?: ReadonlyMap<string, TurnStepsSummary>;
  /** Opens the thinking of a turn. Absent where no sheet can show it, such as a channel. */
  onOpenTurn?: (turnId: string) => void;
  questionForm?: QuestionPromptController;
  /** Opens the form of an open question, in a channel where several agents can ask. */
  onSelectQuestion?: (messageId: string) => void;
  /** Rows under the activity, such as the tasks that the agent works on. */
  activityAccessory?: ReactNode;
  /** The approvals that this chat's agents wait on, shown below the activity as on the desktop. */
  approvals?: readonly PendingApproval[];
  /** The browser requests that this chat's agents wait on. The phone shows them above the composer. */
  browserRequests?: readonly BrowserTakeoverRequest[];
  serverName?: string;
  onRespondApproval?: (approval: PendingApproval, decision: ApprovalDecision) => Promise<void>;
  fieldBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  historyState: "ready" | "connecting" | "waiting" | "loading" | "error";
  messages: ChatMessage[];
  messageAliases: ReadonlyMap<string, string>;
  referenceMessages: ChatMessage[];
  hasOlder: boolean;
  olderLoading: boolean;
  olderError: boolean;
  onLoadOlder: () => void;
  muted: ViewStyle["backgroundColor"];
  raised: ViewStyle["backgroundColor"];
  showStarter: boolean;
  topInset: number;
  onDismissStarter: () => void;
  onSelectStarter: (value: string) => void;
  onRetryHistory: () => void;
  onReply?: (message: ChatBubbleMessage) => void;
  /** Sets the reader's reaction on a message. `null` removes it. */
  onReact?: (message: ChatBubbleMessage, emoji: string | null) => Promise<void>;
  /** The message whose text the reader selects in its bubble. */
  selectingMessageId?: string | null;
  onSelectText?: (message: ChatBubbleMessage) => void;
  /** The selected part of the message text, or an empty string. */
  onSelectionChange?: (selected: string) => void;
  /** Native text views report the text selected in a message, or an empty string at its end. */
  onNativeSelection?: (message: ChatBubbleMessage, selected: string) => void;
  /** A tap outside the selected text ends the selection. */
  onDismissSelection?: () => void;
  /** The message whose files are uploading, how many finished, and how to stop the rest. */
  upload?: {
    messageId: string;
    completed: number;
    /** The sent fraction of file number `completed`, from 0 to 1. */
    current: number;
    cancelling: boolean;
    cancel: () => void;
  } | null;
  /** The messages of this chat that wait on the phone or failed, by row id. */
  outboxStatuses?: ReadonlyMap<string, OutboxRowStatus>;
  /** A message from search. The chat opens at its row. */
  focusMessageId?: string | null;
  onFocusPlaced?: () => void;
}

type ChatUpload = NonNullable<ChatMessageListProps["upload"]>;

/**
 * The inputs every row shares. The list keeps this object stable while a reply streams, so a
 * streamed chunk re-renders only the row whose message changed.
 */
interface MessageRowShared {
  agents: MobileAgent[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  serverId: string;
  canSend: boolean;
  muted: ViewStyle["backgroundColor"];
  themeMuted: string;
  foreground: ViewStyle["backgroundColor"];
  userForeground: string;
  /** Unset when the user's messages do not use the agent color. */
  userBubbleStyle: ComponentProps<typeof Animated.View>["style"] | undefined;
  /** The agent color for the controls of an attachment, unset with the same setting. */
  attachmentTint: AttachmentTint | undefined;
  firstMessageStyle: ComponentProps<typeof Animated.View>["style"];
  /** Arriving replies animate: the screen is focused, online, active, and shows the response. */
  animationActive: boolean;
  /** Arriving replies also play back word by word: motion and screen reader settings allow it. */
  playbackActive: boolean;
  /** Replies animate as they arrive: Settings and reduced motion allow it. */
  textReveal: boolean;
  replySession: { progress: Map<string, number>; revealed: Set<string> };
  markRevealed: (id: string) => void;
  replyHaptics: ReturnType<typeof useReplyHaptics>;
  canReply: boolean;
  canReact: boolean;
  canSelectText: boolean;
  canSelectQuestion: boolean;
  /** The width inside the list padding. The iOS menu of a queued message does not limit its width. */
  listWidth: number;
  actions: {
    reply: (message: ChatBubbleMessage) => void;
    selectQuestion: (messageId: string) => void;
    react: (message: ChatBubbleMessage, emoji: string | null) => Promise<void>;
    selectText: (message: ChatBubbleMessage) => void;
    selectionChange: (selected: string) => void;
    nativeSelection: (message: ChatBubbleMessage, selected: string) => void;
    /** The row of the selected message. A tap outside it ends the selection. */
    selectionArea: (view: ViewInstance | null) => void;
  };
}

const ROUTINE_MARKER_ICONS: Record<RoutineMarkerEvent, LucideIcon> = {
  created: CalendarPlus,
  updated: CalendarClock,
  deleted: CalendarX2,
  queued: Clock3,
  running: LoaderCircle,
  "needs-attention": TriangleAlert,
  succeeded: CircleCheck,
  failed: CircleX,
  interrupted: CirclePause,
  cancelled: CirclePause,
};

function RoutineMarkerRow({
  message,
  muted,
}: {
  message: Extract<ChatMessage, { kind: "routine" }>;
  muted: ViewStyle["backgroundColor"];
}) {
  const { t } = useText();
  const [success, danger] = useCSSVariable(["--openbot-success-text", "--openbot-danger-text"]);
  const Icon = ROUTINE_MARKER_ICONS[message.event];
  const color =
    message.event === "succeeded"
      ? String(success)
      : message.event === "failed" || message.event === "needs-attention"
        ? String(danger)
        : String(muted);
  return (
    <View
      accessible
      accessibilityLabel={`${t(message.label)}, ${message.routineName}`}
      className="flex-row flex-wrap items-center justify-center gap-1.5 py-2"
    >
      <Icon size={16} color={color} strokeWidth={1.75} />
      <Typography.Paragraph type="body-sm" style={{ color: muted }}>
        {t(message.label)}
      </Typography.Paragraph>
      <Typography.Paragraph type="body-sm" className="font-medium" style={{ color: muted }}>
        {message.routineName}
      </Typography.Paragraph>
    </View>
  );
}

/** Where a new chat started, as the desktop divider shows it. The agent does not see the messages above. */
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

function playbackEligible(message: VisibleMessage) {
  return (
    message.kind === "message" &&
    message.author === "agent" &&
    (message.streaming || message.status === "completed") &&
    !message.superseded &&
    (!message.speaker || message.speaker.kind === "agent")
  );
}

function playbackEnabled(message: VisibleMessage, shared: MessageRowShared, arriving: boolean) {
  return playbackEligible(message) && shared.playbackActive && arriving;
}

// The activity row stands in for a reply until its first word is played back. Rendering the
// padded bubble before then leaves an empty pill beside the row.
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
  message: VisibleMessage;
  /** The first message of the chat, sent from this phone: it rises from the composer. */
  isFirstUser: boolean;
  arriving: boolean;
  revealed: boolean;
  /** The message this one replies to. */
  source?: ChatMessage;
  /** Set only on the row of the question it controls. */
  questionForm?: QuestionPromptController;
  /** Set only on the row whose files are uploading. */
  upload?: ChatUpload;
  /** Set only on a message that waits on the phone or failed. */
  outbox?: OutboxRowStatus;
  /** The reader selects the text of this message in its bubble. */
  selecting?: boolean;
  shared: MessageRowShared;
}) {
  const { t } = useText();
  const [selectionHeight, setSelectionHeight] = useState(0);
  // Native text views keep a selection until they draw again. When the chat ends the selection
  // from outside, such as with a tap elsewhere, the next generation draws them without it.
  const [selectionGeneration, setSelectionGeneration] = useState(0);
  const wasSelecting = useRef(selecting);
  useEffect(() => {
    if (wasSelecting.current && !selecting) setSelectionGeneration((generation) => generation + 1);
    wasSelecting.current = selecting;
  }, [selecting]);
  const waiting = awaitingFirstWord(message, shared, arriving, revealed);
  // A message that the host does not have yet, or that still streams, has no host ID to act on:
  // it has no actions and no native selection.
  const bubble = message.kind === "message" && !outbox && !message.streaming && !waiting ? message : null;
  const nativeSelect = shared.actions.nativeSelection;
  const nativeSelection = useMemo(
    () =>
      bubble && nativeTextSelection && shared.canSelectText
        ? { generation: selectionGeneration, onSelect: (selected: string) => nativeSelect(bubble, selected) }
        : undefined,
    [bubble, nativeSelect, selectionGeneration, shared.canSelectText],
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
    [eligible, message.id, complete, replySession.progress, enabled, markRevealed, replyHaptics],
  );
  // Native text views select in place, so only the fallback covers the text with a field.
  const overlaySelecting = selecting && !nativeTextSelection;
  // The author of a channel message: its agent, or a person.
  const speaker = message.kind === "message" && message.speaker ? agentsById.get(message.speaker.id) : undefined;
  // Another person in an agent chat: a person's bubble in their own colour, seeded by the member id
  // as on desktop, so it does not read as the reader's own.
  const memberColor =
    message.kind === "message" && message.sender ? getBloubAvatarColor(message.sender.id, null) : undefined;
  const textColor =
    message.kind === "message" && message.author === "user" && userBubbleStyle && !memberColor
      ? userForeground
      : foreground;
  // A generation owns its first attachment, the image; any further files follow in order.
  const files =
    message.kind === "message"
      ? ((message.imageGeneration ? message.attachments?.slice(1) : message.attachments) ?? [])
      : [];
  // Two or more images in an agent's reply show together, as on desktop.
  const gallery =
    message.kind === "message" && message.author === "agent" && !upload ? files.filter(isViewableImage) : [];
  const rendered =
    message.kind === "routine" ? (
      <RoutineMarkerRow key={message.id} message={message} muted={muted} />
    ) : message.kind === "context-reset" ? (
      <ContextResetMarkerRow key={message.id} muted={muted} />
    ) : message.kind === "exchange-group" ? (
      <ChatExchangeGroup key={message.id} group={message} agents={agents} agentsById={agentsById} muted={muted} />
    ) : message.kind === "exchange" || message.kind === "channel-routing" ? (
      <ChatExchangeMarker key={message.id} message={message} agents={agents} agentsById={agentsById} muted={muted} />
    ) : message.kind === "plan" ? (
      <ChatPlan key={message.id} message={message} />
    ) : message.kind === "question" ? (
      <ChatQuestionPrompt
        key={message.id}
        prompt={message.prompt}
        controller={questionForm}
        canSend={canSend}
        onActivate={shared.canSelectQuestion ? () => actions.selectQuestion(message.id) : undefined}
      />
    ) : (
      <Animated.View
        key={message.id}
        entering={
          arriving && !isFirstUser ? (message.author === "user" ? USER_MESSAGE_ENTRANCE : undefined) : undefined
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
        {gallery.length > 1 ? <ChatImageGallery attachments={gallery} serverId={serverId} /> : null}
        {(gallery.length > 1 ? files.filter((attachment) => !isViewableImage(attachment)) : files).map(
          (attachment, index) => (
            <ChatAttachmentView
              key={attachment.id}
              attachment={attachment}
              serverId={serverId}
              alignment={message.author === "user" ? "right" : "left"}
              upload={upload ? uploadProgressAt(index, upload.completed, upload.current) : undefined}
              tint={shared.attachmentTint}
              visual={message.visual}
            />
          ),
        )}
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
          <ChatBubble
            agent={message.author === "agent"}
            collapsed={waiting}
            animateSize={shared.textReveal}
            className={
              message.author === "user"
                ? `self-end rounded-[30px] px-4 py-3 ${userBubbleStyle || memberColor ? "" : "bg-control/60"} ${message.attachments?.length ? "max-w-[88%]" : "max-w-full"}`
                : `max-w-full self-start rounded-[30px] ${waiting ? "" : "px-4 py-3"}`
            }
            style={[
              { borderCurve: "circular", overflow: "hidden" },
              message.author === "user"
                ? memberColor
                  ? { backgroundColor: `${memberColor}38` }
                  : userBubbleStyle
                : undefined,
            ]}
          >
            {/* The message text stays mounted while the reader selects, so it does not change size or
                play its reveal again. Without native text views, the selectable text covers it at
                the same place. */}
            <View style={overlaySelecting ? { minHeight: selectionHeight } : undefined}>
              <View
                style={overlaySelecting ? { opacity: 0 } : undefined}
                accessibilityElementsHidden={overlaySelecting}
                importantForAccessibility={overlaySelecting ? "no-hide-descendants" : "auto"}
              >
                <ChatMarkdown
                  agents={agents}
                  body={message.body}
                  finished={!isStreamingReply(message)}
                  selectable={message.author === "user"}
                  color={textColor}
                  playback={playback}
                  animationEnabled={shared.animationActive && arriving}
                  nativeSelection={nativeSelection}
                />
              </View>
              {overlaySelecting ? (
                <ChatSelectableText
                  text={markdownPlainText(message.body)}
                  color={textColor}
                  onHeight={setSelectionHeight}
                  onSelectionChange={actions.selectionChange}
                />
              ) : null}
            </View>
          </ChatBubble>
        ) : null}
      </Animated.View>
    );
  if (message.kind !== "message") return rendered;
  // The fallback selection starts from Select text or a touch and hold. Native text views select
  // the word under the finger on their own, so they need neither.
  const selectable = shared.canSelectText && !nativeTextSelection && Boolean(message.body.trim());
  const replyPreview =
    source?.kind === "message"
      ? mentionDraft(source.body).text || t("mobile.chat.reply.attachment")
      : t("mobile.chat.reply.unavailable");
  return (
    <View
      key={message.id}
      // The selected text and its action row: a tap here does not end the selection, so the Select
      // text button can end it on its own.
      ref={selecting ? actions.selectionArea : undefined}
      className={
        message.author === "agent"
          ? "max-w-full self-start gap-1"
          : message.attachments?.length
            ? "max-w-full self-end gap-1"
            : "max-w-[88%] self-end gap-1"
      }
    >
      {message.replyToMessageId ? (
        <View className={`flex-row items-center gap-1 ${message.author === "user" ? "self-end" : "self-start"}`}>
          <CornerUpRight size={14} color={themeMuted} />
          <Typography.Paragraph
            type="body-xs"
            numberOfLines={1}
            className="shrink text-muted"
            accessibilityLabel={t("mobile.chat.reply.to", { text: replyPreview })}
          >
            {replyPreview}
          </Typography.Paragraph>
        </View>
      ) : null}
      {message.author === "agent" ? (
        <ChatMessageGesture
          selecting={selecting}
          onReply={shared.canReply ? () => actions.reply(message) : undefined}
          onSelectText={selectable ? () => actions.selectText(message) : undefined}
        >
          {rendered}
        </ChatMessageGesture>
      ) : outbox ? (
        <OutboxMessageMenu
          status={outbox}
          maxWidth={message.attachments?.length ? shared.listWidth : shared.listWidth * USER_BUBBLE_WIDTH}
        >
          {rendered}
        </OutboxMessageMenu>
      ) : (
        rendered
      )}
      {message.author === "user" && message.status === "failed" ? <TurnFailure reason={message.failureReason} /> : null}
      {outbox ? <ChatOutboxStatus status={outbox} /> : null}
      {bubble ? (
        <ChatMessageActions
          align={message.author === "user" ? "end" : "start"}
          copyText={messageCopyText(message)}
          createdAt={message.createdAt}
          reactions={message.reactions}
          agentsById={agentsById}
          onReact={shared.canReact ? (emoji) => actions.react(message, emoji) : undefined}
          onReply={shared.canReply ? () => actions.reply(message) : undefined}
          onSelectText={selectable ? () => actions.selectText(message) : undefined}
          selecting={selecting}
        />
      ) : null}
    </View>
  );
});

/**
 * What the rows read besides their message. The list renders a row again only when its message
 * changes, so the rows read the rest from this context and render again when it changes.
 */
interface RowContextValue {
  shared: MessageRowShared;
  arrivals: ReadonlySet<string>;
  revealedIds: ReadonlySet<string>;
  /** The rows after the latest user message, which hide while the first message rises. */
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
}

const RowContext = createContext<RowContextValue | null>(null);

function ChatRow({ message }: { message: VisibleMessage }) {
  const row = useContext(RowContext);
  if (!row) return null;
  const response = row.responseIds.has(message.id);
  const turn = row.turnSummaries?.get(message.id);
  const openTurn = row.onOpenTurn;
  return (
    <Animated.View
      style={[ROW_STYLE, response ? row.responseStyle : undefined]}
      accessibilityElementsHidden={response && !row.responseVisible}
      importantForAccessibility={response && !row.responseVisible ? "no-hide-descendants" : "auto"}
    >
      {turn && openTurn ? (
        <ChatTurnStepsRow summary={turn} muted={row.shared.themeMuted} onPress={() => openTurn(turn.turnId)} />
      ) : null}
      <MessageRow
        message={message}
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
    </Animated.View>
  );
}

function renderRow({ item }: { item: VisibleMessage }) {
  return <ChatRow message={item} />;
}

/**
 * The latest rows of the chat. They include the latest user message when it is near, so the list
 * keeps the same space under that message when the older rows come.
 */
function openingRows(rows: VisibleMessage[]): VisibleMessage[] {
  const start = Math.max(0, rows.length - OPENING_ROWS);
  const user = rows.findLastIndex((message) => message.kind === "message" && message.author === "user");
  const from = user >= 0 && user >= rows.length - OPENING_ROWS_TO_USER ? Math.min(start, user) : start;
  return from === 0 ? rows : rows.slice(from);
}

/** Every image the chat can show itself in the loaded messages, in chat order. */
function conversationImages(messages: readonly VisibleMessage[]): AttachmentSummary[] {
  return messages.flatMap((message) =>
    message.kind === "message" ? (message.attachments ?? []).filter(isViewableImage) : [],
  );
}

/** The text that Copy puts on the clipboard: tags and file references show their names. */
function messageCopyText(message: ChatBubbleMessage): string {
  const attachmentNames = new Map((message.attachments ?? []).map((attachment) => [attachment.id, attachment.name]));
  return expandAttachmentReferences(expandChatTagReferences(message.body), (reference) =>
    attachmentNames.get(reference.attachmentId),
  ).trim();
}

/** Under a user message whose turn failed. A reason that is missing or not safe to show uses the fallback. */
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

/** The motion state that only the screen reads. It changes while the reader scrolls. */
const SCREEN_MOTION = new Set(["atLatest", "userScrolled"]);

/** Whether the props or the motion state hold the same values, apart from the keys in `ignored`. */
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

/**
 * The list draws again when a prop changes, but not when only the motion state that the screen
 * reads changes. Remove a key from `SCREEN_MOTION` before the list reads it.
 */
function sameListProps(previous: ChatMessageListProps, next: ChatMessageListProps): boolean {
  const { motion: previousMotion, ...previousRest } = previous;
  const { motion: nextMotion, ...nextRest } = next;
  return sameValues(previousRest, nextRest) && sameValues(previousMotion, nextMotion, SCREEN_MOTION);
}

const NO_APPROVALS: readonly PendingApproval[] = [];
const NO_BROWSER_REQUESTS: readonly BrowserTakeoverRequest[] = [];
const NO_IDS: ReadonlySet<string> = new Set();

export const ChatMessageList = memo(function ChatMessageList({
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
  questionForm,
  onSelectQuestion,
  activityAccessory,
  approvals = NO_APPROVALS,
  browserRequests = NO_BROWSER_REQUESTS,
  serverName = "",
  onRespondApproval,
  fieldBackground,
  foreground,
  historyState,
  messages,
  messageAliases,
  referenceMessages,
  hasOlder,
  olderLoading,
  olderError,
  onLoadOlder,
  muted,
  raised,
  showStarter,
  topInset,
  onDismissStarter,
  onSelectStarter,
  onRetryHistory,
  onReply,
  onReact,
  selectingMessageId = null,
  onSelectText,
  onSelectionChange,
  onNativeSelection,
  onDismissSelection,
  focusMessageId = null,
  onFocusPlaced,
}: ChatMessageListProps) {
  const { t, sourceText } = useText();
  const isFocused = useIsFocused();
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const messagesById = useMemo(
    () => indexChatMessages(messages, messageAliases, referenceMessages),
    [messages, messageAliases, referenceMessages],
  );
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
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
      t("mobile.chat.question.inputRequired", { question: questionForm.question.question }),
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
  const [userForegroundColor, themeForegroundColor, themeMutedColor] = useCSSVariable([
    "--openbot-text-on-light",
    "--openbot-text-primary",
    "--openbot-text-muted",
  ]);
  const userForeground = String(userForegroundColor);
  const themeForeground = String(themeForegroundColor);
  const themeMuted = String(themeMutedColor);
  const reducedMotion = useReducedMotion();
  const textReveal = useMotionPreference("textReveal");
  const animateMessages = isFocused && online && appActive;
  const replyHaptics = useReplyHaptics(animateMessages && historyState === "ready" && motion.responseVisible);
  const conversationKey = JSON.stringify([target.serverId, target.kind, target.id]);
  const replySession = useMemo(
    () => ({ key: conversationKey, progress: new Map<string, number>(), revealed: new Set<string>() }),
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
  const arrivals = useMessageArrivals(replySession.key, messages, animateMessages && historyState === "ready");
  const agentColorMessages = useAgentColorMessages((state) => state.enabled);
  const userBubbleColor = getBloubAvatarColor(
    target.kind === "agent" ? target.avatarSeed : target.id,
    target.kind === "agent" ? target.avatarHue : null,
  );
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
    // Fade the color while keeping message text fully readable.
    return { backgroundColor: `rgb(${r}, ${g}, ${b})` };
  });

  const visibleMessages = useMemo(
    () => groupExchangeMarkers(messages.filter((message) => message.kind !== "thinking")),
    [messages],
  );
  // Every image of the loaded messages, in chat order, for the viewer's carousel.
  const images = useMemo(() => conversationImages(visibleMessages), [visibleMessages]);
  // On Android the first commit of the chat has no rows, so the open animation starts at once. The
  // latest rows render after it, while the chat slides in, so the list can take its place before
  // the chat is in place. A chat that opens at a message from search waits for all of its rows.
  const [openingShown, setOpeningShown] = useState(false);
  useEffect(() => {
    if (rowsShown || openingShown) return;
    const frame = requestAnimationFrame(() => setOpeningShown(true));
    return () => cancelAnimationFrame(frame);
  }, [rowsShown, openingShown]);
  const startsAtEnd = motion.startsAtEnd;
  // The list renders only the rows in and near the view, so it gets every loaded message.
  const rows = useMemo(
    () => (rowsShown ? visibleMessages : openingShown && startsAtEnd ? openingRows(visibleMessages) : NO_ROWS),
    [rowsShown, openingShown, startsAtEnd, visibleMessages],
  );
  const tailIndex = rows.findLastIndex((message) => message.kind === "message" && message.author === "user");
  const focusIndex = focusMessageId ? chatRowIndex(rows, focusMessageId) : -1;
  const canLoadOlder = online && hasOlder && !olderLoading;
  useFoldScrollAnchor(motion.listRef);
  // The chat opens at the row of a message from search after the list has its rows in place.
  const placedFocus = useRef<string | null>(null);
  const focusId = historyState === "ready" && rowsShown && focusIndex >= 0 ? (rows[focusIndex]?.id ?? null) : null;
  const focusHandlers = useRef({ openAt: motion.openAt, onFocusPlaced });
  focusHandlers.current = { openAt: motion.openAt, onFocusPlaced };
  useEffect(() => {
    if (!focusId || !motion.listPlaced || placedFocus.current === focusId) return;
    placedFocus.current = focusId;
    // The search hold ends after the row is in view, so the chat does not move to the latest message first.
    void focusHandlers.current.openAt(focusIndex).then(() => focusHandlers.current.onFocusPlaced?.());
  }, [focusId, focusIndex, motion.listPlaced]);
  const header = topInset + 84;
  // The latest user message can always move to the top of the chat: the list adds blank space
  // under it while the rows after it are shorter than the screen.
  const anchoredEndSpace = useMemo<AnchoredEndSpaceConfig | undefined>(
    () =>
      tailIndex >= 0 ? { anchorIndex: tailIndex, anchorOffset: header, onReady: motion.onAnchorReady } : undefined,
    [tailIndex, header, motion.onAnchorReady],
  );
  const sharedValues = useMemo(() => ({ scrollOffset: motion.scrollOffset }), [motion.scrollOffset]);
  const screen = useWindowDimensions();
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
    onReact,
    onSelectText,
    onSelectionChange,
    onNativeSelection,
    onSelectQuestion,
  });
  actionHandlers.current = { onReply, onReact, onSelectText, onSelectionChange, onNativeSelection, onSelectQuestion };
  const actions = useMemo<MessageRowShared["actions"]>(
    () => ({
      reply: (message) => actionHandlers.current.onReply?.(message),
      selectQuestion: (messageId) => actionHandlers.current.onSelectQuestion?.(messageId),
      react: async (message, emoji) => actionHandlers.current.onReact?.(message, emoji),
      selectText: (message) => actionHandlers.current.onSelectText?.(message),
      selectionChange: (selected) => actionHandlers.current.onSelectionChange?.(selected),
      nativeSelection: (message, selected) => actionHandlers.current.onNativeSelection?.(message, selected),
      selectionArea: (view) => {
        selectionArea.current = view;
      },
    }),
    [],
  );
  // A tap, not a scroll, outside the selected text ends the selection. Touch events only listen, so
  // the tap still reaches the button or the text under it.
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
      // The selection handles stand out of the row, so a touch near it is still on the selection.
      const inside =
        pageX >= x - HANDLE_MARGIN &&
        pageX <= x + width + HANDLE_MARGIN &&
        pageY >= y - HANDLE_MARGIN &&
        pageY <= y + height + HANDLE_MARGIN;
      if (!inside) dismissSelection.current?.();
    });
  };
  const animationActive = animateMessages && motion.responseVisible;
  // The parent passes new handler functions on each render. The rows call them through
  // `actionHandlers`, so only their presence keeps `shared`, and every row, from rendering again.
  const canReply = Boolean(onReply);
  const canReact = Boolean(onReact);
  const canSelectText = Boolean(onSelectText);
  const canSelectQuestion = Boolean(onSelectQuestion);
  // The rows keep clear of the side insets: the rail of iPhone Duo and the edges in landscape.
  const listWidth = columnWidth - insets.left - insets.right - LIST_PADDING * 2;
  const shared = useMemo<MessageRowShared>(
    () => ({
      agents,
      agentsById,
      serverId: target.serverId,
      canSend,
      muted,
      themeMuted,
      foreground,
      userForeground,
      // A channel has no one agent color for the reader's messages.
      userBubbleStyle: target.kind === "agent" && agentColorMessages ? userBubbleStyle : undefined,
      attachmentTint:
        target.kind === "agent" && agentColorMessages
          ? { color: userBubbleColor, foreground: userForeground }
          : undefined,
      firstMessageStyle: motion.firstMessageStyle,
      animationActive,
      playbackActive: animationActive && textReveal && !screenReaderEnabled,
      textReveal,
      replySession,
      markRevealed,
      replyHaptics,
      canReply,
      canReact,
      canSelectText,
      canSelectQuestion,
      listWidth,
      actions,
    }),
    [
      agents,
      agentsById,
      target.kind,
      target.serverId,
      canSend,
      muted,
      themeMuted,
      foreground,
      userForeground,
      userBubbleStyle,
      userBubbleColor,
      agentColorMessages,
      motion.firstMessageStyle,
      screenReaderEnabled,
      animationActive,
      textReveal,
      replySession,
      markRevealed,
      replyHaptics,
      canReply,
      canReact,
      canSelectText,
      canSelectQuestion,
      listWidth,
      actions,
    ],
  );
  const pendingReveal = visibleMessages.some((message) =>
    awaitingFirstWord(message, shared, arrivals.has(message.id), revealedIds.has(message.id)),
  );
  const { responseStyle, responseVisible } = motion;
  // The prompt controller is a new object on each render. Without a prompt it is left out, so the
  // list does not render every row again.
  const promptController = questionForm?.messageId ? questionForm : undefined;
  const responseIds = useMemo(() => new Set(rows.slice(tailIndex + 1).map((row) => row.id)), [rows, tailIndex]);
  // The opening rows do not start at the first message of the chat.
  const firstUserId = rowsShown && tailIndex === 0 && !hasOlder ? (rows[0]?.id ?? null) : null;
  const rowContext = useMemo<RowContextValue>(
    () => ({
      shared,
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
    }),
    [
      shared,
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
    ],
  );
  const activitySpec = (activity?: MobileAgentActivity): ChatActivitySpec | null => {
    const latestThinking = messages.findLast(
      (message) => message.kind === "thinking" && message.turnId === (activity?.turnId ?? activeTurnId),
    );
    // In a channel, only the reply of this activity's agent counts.
    const replying = messages.some(
      (message) =>
        isStreamingReply(message) &&
        message.kind === "message" &&
        message.body.trim() &&
        (!activity?.agentId || !message.speaker || message.speaker.id === activity.agentId),
    );
    // One run of text, as desktop shows it: the row clamps the label, and blank lines would fill it.
    const thinkingDetail =
      !replying && latestThinking?.kind === "thinking"
        ? latestThinking.steps.at(-1)?.text.replace(/\s+/gu, " ").trim()
        : null;
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
    // As on desktop, the conversation's own turn keeps the row: turn events can arrive late.
    if (!(activity || sending || awaitingTurn || activeTurnId || messages.some(isStreamingReply) || pendingReveal))
      return null;
    return {
      // The agent, not the signal that reported it: a turn moves from the local send flag to the
      // host's activity to the reply without remounting the avatar.
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
  const activityRows = useActivityPresence(
    (activities?.length ? activities : [activity]).flatMap((entry) => activitySpec(entry) ?? []),
  );

  return (
    <Animated.View
      onTouchStart={selectingMessageId ? onTouchStart : undefined}
      onTouchEnd={selectingMessageId ? onTouchEnd : undefined}
      style={[{ flex: 1 }, historyState === "ready" ? motion.historyStyle : undefined]}
      accessibilityElementsHidden={accessibilityHidden || (historyState === "ready" && !motion.historyVisible)}
      importantForAccessibility={
        !accessibilityHidden && (historyState !== "ready" || motion.historyVisible) ? "auto" : "no-hide-descendants"
      }
    >
      <ChatImageViewerProvider serverId={target.serverId} images={images}>
        {/* The history hides only once it is ready: a loading list shows what it has. */}
        <HistoryShownContext value={historyState !== "ready" || motion.historyVisible}>
          <RowContext value={rowContext}>
            <KeyboardAwareLegendList
              ref={motion.listRef}
              data={rows}
              // A new data set when the latest messages replace a window around a searched message.
              dataKey={`${conversationKey}:${motion.latestGeneration}`}
              keyExtractor={rowKey}
              getItemType={rowType}
              renderItem={renderRow}
              // Rows hold their own state: reveal progress, selection, media and animated sizes. A row
              // reused for another message would show the state of the message before it.
              recycleItems={false}
              estimatedItemSize={ESTIMATED_ROW_SIZE}
              estimatedListSize={estimatedListSize}
              drawDistance={Math.round(screen.height * DRAW_SCREENS)}
              experimental_adaptiveRender={ADAPTIVE_RENDER}
              // A reply can be many times taller than the estimate. Until the list has its size, the row
              // is laid out but not drawn, so the reader never sees it cut by the next row.
              experimental_hideItemsUntilMeasured
              initialScrollAtEnd={motion.startsAtEnd}
              anchoredEndSpace={anchoredEndSpace}
              maintainVisibleContentPosition={KEEP_VISIBLE_POSITION}
              maintainScrollAtEnd={motion.followsEnd ? FOLLOW_END : false}
              sharedValues={sharedValues}
              contentInsetEndAdjustment={motion.composerHeight}
              keyboardOffset={keyboardOffset}
              keyboardLiftBehavior={motion.keyboardLiftBehavior}
              applyWorkaroundForContentInsetHitTestBug
              automaticallyAdjustKeyboardInsets={false}
              onReady={onReady}
              onStartReached={() => {
                if (motion.historyVisible && canLoadOlder && !olderError) onLoadOlder();
              }}
              onStartReachedThreshold={0.5}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingLeft: insets.left + LIST_PADDING,
                paddingRight: insets.right + LIST_PADDING,
                paddingTop: header,
              }}
              contentInsetAdjustmentBehavior="never"
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              alwaysBounceVertical
              onContentSizeChange={motion.onContentSizeChange}
              onLayout={motion.onViewportLayout}
              onScrollBeginDrag={motion.onScrollBeginDrag}
              onScrollEndDrag={motion.onScrollEndDrag}
              onMomentumScrollEnd={motion.onScrollEndDrag}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <>
                  {hasOlder ? (
                    <View className="items-center pb-3">
                      <Button variant="tertiary" isDisabled={!canLoadOlder} onPress={onLoadOlder}>
                        <Button.Label>
                          {olderLoading
                            ? t("mobile.chat.history.loadingOlder")
                            : olderError
                              ? t("mobile.chat.history.retryOlder")
                              : t("mobile.chat.history.loadOlder")}
                        </Button.Label>
                      </Button>
                    </View>
                  ) : null}
                  {historyState === "connecting" || historyState === "loading" ? (
                    <View
                      className="flex-1"
                      accessible
                      accessibilityLabel={
                        historyState === "connecting"
                          ? t("mobile.chat.history.connecting")
                          : t("mobile.chat.history.loading")
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
              }
              ListFooterComponent={
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
                        />
                      ))}
                    </View>
                  ) : null}
                  {showStarter ? (
                    <View
                      className="gap-4 rounded-[26px] p-4"
                      style={{ backgroundColor: fieldBackground, borderCurve: "continuous" }}
                    >
                      <View className="flex-row items-start gap-3">
                        <View className="min-w-0 flex-1 gap-1">
                          <Typography.Heading type="h4">{t("mobile.chat.starter.title")}</Typography.Heading>
                          <Typography.Paragraph className="text-text-secondary">
                            {t("mobile.chat.starter.body")}
                          </Typography.Paragraph>
                        </View>
                        <Pressable
                          accessibilityLabel={t("mobile.chat.starter.dismiss")}
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() => {
                            void haptics.selection();
                            onDismissStarter();
                          }}
                        >
                          <X color={String(muted)} size={21} strokeWidth={1.8} />
                        </Pressable>
                      </View>

                      <View className="overflow-hidden rounded-[18px]" style={{ backgroundColor: raised }}>
                        {STARTER_OPTIONS.map((option, index) => (
                          <Pressable
                            key={option.id}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !canSend }}
                            disabled={!canSend}
                            className="flex-row gap-3 px-3 py-3"
                            style={({ pressed }) => ({
                              borderBottomColor: index < STARTER_OPTIONS.length - 1 ? String(muted) : "transparent",
                              borderBottomWidth: index < STARTER_OPTIONS.length - 1 ? 0.5 : 0,
                              opacity: !canSend ? 0.45 : pressed ? 0.55 : 1,
                            })}
                            onPress={() => onSelectStarter(t(option.label))}
                          >
                            <View className="size-7 items-center justify-center rounded-lg bg-control">
                              <Typography.Paragraph type="body-xs" className="text-text-secondary">
                                {String.fromCharCode(65 + index)}
                              </Typography.Paragraph>
                            </View>
                            <View className="min-w-0 flex-1">
                              <Typography.Paragraph weight="medium">{t(option.label)}</Typography.Paragraph>
                              <Typography.Paragraph type="body-xs" className="text-text-secondary">
                                {t(option.detail)}
                              </Typography.Paragraph>
                            </View>
                          </Pressable>
                        ))}
                      </View>

                      <Typography.Paragraph type="body-xs" className="text-text-secondary">
                        {t("mobile.chat.starter.orAnswer")}
                      </Typography.Paragraph>
                    </View>
                  ) : null}
                </>
              }
            />
          </RowContext>
        </HistoryShownContext>
      </ChatImageViewerProvider>
    </Animated.View>
  );
}, sameListProps);
