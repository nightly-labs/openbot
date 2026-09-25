import type { AgentExchangeSummary } from "@openbot/contracts/ipc";
import { Link, useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import {
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  CircleCheck,
  CirclePause,
  CircleX,
  Clock3,
  CornerUpRight,
  LoaderCircle,
  type LucideIcon,
  TriangleAlert,
  X,
} from "lucide-react-native";
import {
  type ComponentProps,
  createContext,
  forwardRef,
  memo,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, type CellRendererProps, FlatList, Pressable, View, type ViewStyle } from "react-native";
import { KeyboardChatScrollView, type KeyboardChatScrollViewProps } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { BloubAvatarThumbnail, getBloubAvatarColor } from "@/features/agents/components/bloub-avatar";
import { ChatActivityRow, type ChatActivitySpec } from "@/features/chat/components/chat-activity-row";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { ChatQuestionPrompt } from "@/features/chat/components/chat-question-prompt";
import { useActivityPresence } from "@/features/chat/components/use-activity-presence";
import type { ChatMotion } from "@/features/chat/components/use-chat-motion";
import { useMessageArrivals } from "@/features/chat/components/use-message-arrivals";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { type ChatMessage, indexChatMessages, type RoutineMarkerEvent } from "@/features/chat/model/chat-messages";
import { useConnectionAppearance } from "@/features/workspace/components/use-connection-appearance";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood, type MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import type { ChatBubbleMessage } from "../context/message-actions-context";
import { CHAT_HISTORY_BATCH, type ChatHistoryBoundary, chatHistoryStart } from "../model/chat-layout";
import { mentionDraft } from "../model/chat-mentions";
import type { ChatTarget } from "../model/chat-target";
import { isStreamingReply } from "../model/reply-reveal";
import { uploadProgressAt } from "../model/upload-progress";
import { ChatAttachmentView } from "./chat-attachment";
import { ChatImageGeneration, imageGenerationStatus } from "./chat-image-generation";
import { ChatMessageGesture } from "./chat-message-gesture";
import { useReplyHaptics } from "./use-reply-haptics";

type VisibleMessage = Exclude<ChatMessage, { kind: "thinking" }>;
const TailLayoutContext = createContext<{
  id: string | null;
  onTailStartLayout: ChatMotion["onTailStartLayout"];
} | null>(null);

function MessageCell({ children, item, onLayout, onFocusCapture, style }: CellRendererProps<VisibleMessage>) {
  const tail = useContext(TailLayoutContext);
  const nativeProps = { style, onFocusCapture };
  return (
    <View
      {...nativeProps}
      onLayout={(event) => {
        onLayout?.(event);
        if (item.id === tail?.id) tail.onTailStartLayout(item.id, event);
      }}
    >
      {children}
    </View>
  );
}

const ChatScrollView = forwardRef<Animated.ScrollView, KeyboardChatScrollViewProps & { motion: ChatMotion }>(
  function ChatScrollView({ motion, ...props }, ref) {
    const setRef = useCallback(
      (instance: Animated.ScrollView | null) => {
        motion.setScrollRef(instance);
        if (typeof ref === "function") ref(instance);
        else if (ref) ref.current = instance;
      },
      [motion.setScrollRef, ref],
    );
    return <KeyboardChatScrollView {...props} ref={setRef} />;
  },
);

const STARTER_OPTIONS = [
  { id: "plan", label: "Plan the next steps", detail: "Turn a goal into a clear plan" },
  { id: "research", label: "Research something", detail: "Compare sources and summarize" },
  { id: "solve", label: "Work through a problem", detail: "Think it through together" },
] as const;

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
  className,
  style,
}: PropsWithChildren<{
  agent: boolean;
  collapsed?: boolean;
  className: string;
  style: ComponentProps<typeof Animated.View>["style"];
}>) {
  const size = useSharedValue({ width: 0, height: 0, measured: false });
  const shown = useSharedValue(collapsed ? 0 : 1);
  useEffect(() => {
    shown.set(collapsed ? 0 : withTiming(1, REPLY_APPEAR));
  }, [collapsed, shown]);
  const background = useAnimatedStyle(() => {
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
        agent
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
          pointerEvents="none"
          className="absolute left-0 top-0 rounded-[30px] bg-control/60"
          style={[{ borderCurve: "circular" }, background]}
        />
      ) : null}
      {children}
    </Animated.View>
  );
}

/**
 * Matches the desktop marker. An absent mark means a request: that is what a host older than the
 * mark reports, and what every message stored before it meant.
 */
function exchangeLabel(exchange: AgentExchangeSummary) {
  if (exchange.expectsReply === false) return exchange.direction === "outgoing" ? "Informed" : "Update from";
  return exchange.direction === "outgoing" ? "Messaged" : "Message from";
}

interface ChatMessageListProps {
  target: ChatTarget;
  activity?: MobileAgentActivity;
  activities?: MobileAgentActivity[];
  agents: MobileAgent[];
  motion: ChatMotion;
  sending: boolean;
  keyboardOffset: number;
  canSend: boolean;
  online: boolean;
  appActive: boolean;
  activeTurnId: string | null;
  questionForm?: QuestionPromptController;
  onSelectQuestion?: (messageId: string) => void;
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
  onOpenActions: (message: ChatBubbleMessage) => void;
  /** The message whose files are uploading, how many finished, and how to stop the rest. */
  upload?: {
    messageId: string;
    completed: number;
    /** The sent fraction of file number `completed`, from 0 to 1. */
    current: number;
    cancelling: boolean;
    cancel: () => void;
  } | null;
}

type ChatUpload = NonNullable<ChatMessageListProps["upload"]>;

/**
 * The inputs every row shares. The list keeps this object stable while a reply streams, so a
 * streamed chunk re-renders only the row whose message changed.
 */
interface MessageRowShared {
  agents: MobileAgent[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  targetKind: ChatTarget["kind"];
  serverId: string;
  canSend: boolean;
  muted: ViewStyle["backgroundColor"];
  themeMuted: string;
  foreground: ViewStyle["backgroundColor"];
  userForeground: string;
  userBubbleStyle: ComponentProps<typeof Animated.View>["style"];
  firstMessageStyle: ComponentProps<typeof Animated.View>["style"];
  onUserLayout: ChatMotion["onUserLayout"];
  screenReaderEnabled: boolean;
  arrivals: ReadonlySet<string>;
  /** Arriving replies animate: the screen is focused, online, active, and shows the response. */
  animationActive: boolean;
  /** Arriving replies also play back word by word: motion and screen reader settings allow it. */
  playbackActive: boolean;
  replySession: { progress: Map<string, number>; revealed: Set<string> };
  /** Changes when a reply reveals its first word, so a waiting row renders its bubble. */
  revealedCount: number;
  markRevealed: (id: string) => void;
  replyHaptics: ReturnType<typeof useReplyHaptics>;
  canReply: boolean;
  canSelectQuestion: boolean;
  actions: {
    reply: (message: ChatBubbleMessage) => void;
    openActions: (message: ChatBubbleMessage) => void;
    selectQuestion: (messageId: string) => void;
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
      accessibilityLabel={`${message.label}, ${message.routineName}`}
      className="flex-row flex-wrap items-center justify-center gap-1.5 py-2"
    >
      <Icon size={16} color={color} strokeWidth={1.75} />
      <Typography.Paragraph type="body-sm" style={{ color: muted }}>
        {message.label}
      </Typography.Paragraph>
      <Typography.Paragraph type="body-sm" className="font-medium" style={{ color: muted }}>
        {message.routineName}
      </Typography.Paragraph>
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

function playbackEnabled(message: VisibleMessage, shared: MessageRowShared) {
  return playbackEligible(message) && shared.playbackActive && shared.arrivals.has(message.id);
}

// The activity row stands in for a reply until its first word is played back. Rendering the
// padded bubble before then leaves an empty pill beside the row.
function awaitingFirstWord(message: VisibleMessage, shared: MessageRowShared) {
  return (
    message.kind === "message" &&
    message.body.trim().length > 0 &&
    playbackEnabled(message, shared) &&
    !shared.replySession.revealed.has(message.id) &&
    (shared.replySession.progress.get(message.id) ?? 0) === 0
  );
}

const MessageRow = memo(function MessageRow({
  message,
  isTailUser,
  isFirstUser,
  source,
  questionForm,
  upload,
  shared,
}: {
  message: VisibleMessage;
  isTailUser: boolean;
  isFirstUser: boolean;
  /** The message this one replies to. */
  source?: ChatMessage;
  /** Set only on the row of the question it controls. */
  questionForm?: QuestionPromptController;
  /** Set only on the row whose files are uploading. */
  upload?: ChatUpload;
  shared: MessageRowShared;
}) {
  const {
    agents,
    agentsById,
    targetKind,
    serverId,
    canSend,
    muted,
    themeMuted,
    foreground,
    userForeground,
    userBubbleStyle,
    firstMessageStyle,
    onUserLayout,
    screenReaderEnabled,
    arrivals,
    replySession,
    markRevealed,
    replyHaptics,
    actions,
  } = shared;
  const eligible = playbackEligible(message);
  const enabled = playbackEnabled(message, shared);
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
            onComplete: replyHaptics.onComplete,
          }
        : undefined,
    [eligible, message.id, complete, replySession.progress, enabled, markRevealed, replyHaptics],
  );
  const waiting = awaitingFirstWord(message, shared);
  const speaker = message.kind === "message" && message.speaker ? agentsById.get(message.speaker.id) : undefined;
  const rendered =
    message.kind === "routine" ? (
      <RoutineMarkerRow key={message.id} message={message} muted={muted} />
    ) : message.kind === "exchange" || message.kind === "channel-routing" ? (
      <View key={message.id} className="flex-row flex-wrap items-center justify-center gap-2 py-2">
        <Typography.Paragraph type="body-sm" style={{ color: muted }}>
          {message.kind === "channel-routing"
            ? message.event.action === "assigned"
              ? "Assigned to"
              : "Continuing with"
            : exchangeLabel(message.exchange)}
        </Typography.Paragraph>
        {(message.kind === "channel-routing"
          ? [message.event.agentId]
          : message.exchange.direction === "incoming"
            ? [message.exchange.senderAgentId]
            : message.exchange.recipientAgentIds
        ).map((id) => {
          const legacyName =
            message.kind === "channel-routing" && message.event.agentId === null ? message.event.agentName : null;
          const legacyMatches = legacyName ? agents.filter((agent) => agent.name === legacyName) : [];
          const participant = id ? agentsById.get(id) : legacyMatches.length === 1 ? legacyMatches[0] : undefined;
          const badge = (
            <View key={id ?? legacyName} className="flex-row items-center gap-1">
              {participant ? (
                <BloubAvatarThumbnail
                  agentId={participant.id}
                  serverId={participant.serverId}
                  hue={participant.avatarHue}
                  seed={participant.avatarSeed}
                  size={22}
                />
              ) : null}
              <Typography.Paragraph type="body-sm" style={{ color: muted }}>
                {participant?.name ??
                  (message.kind === "channel-routing" ? (legacyName ?? "Unavailable agent") : "Unknown agent")}
              </Typography.Paragraph>
            </View>
          );
          return message.kind === "channel-routing" && participant ? (
            <Link
              key={participant.id}
              href={{ pathname: "/chat/[agentId]", params: { agentId: participant.id } }}
              asChild
            >
              <Pressable accessibilityRole="link" accessibilityLabel={`Open chat with ${participant.name}`}>
                {badge}
              </Pressable>
            </Link>
          ) : (
            <View key={id ?? legacyName}>{badge}</View>
          );
        })}
      </View>
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
          arrivals.has(message.id) && !isFirstUser
            ? message.author === "user"
              ? USER_MESSAGE_ENTRANCE
              : undefined
            : undefined
        }
        className={
          message.author === "user" ? "max-w-full items-end self-end gap-2" : "max-w-full items-start self-start gap-2"
        }
        style={[{ borderCurve: "circular" }, isFirstUser ? firstMessageStyle : undefined]}
      >
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
            <Typography.Paragraph type="body-xs" className="text-muted">
              {message.speaker.name}
              {message.superseded ? " · Superseded" : ""}
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
        {/* A generation owns its first attachment, the image; any further files follow in order. */}
        {(message.imageGeneration ? message.attachments?.slice(1) : message.attachments)?.map((attachment, index) => (
          <ChatAttachmentView
            key={attachment.id}
            attachment={attachment}
            serverId={serverId}
            alignment={message.author === "user" ? "right" : "left"}
            upload={upload ? uploadProgressAt(index, upload.completed, upload.current) : undefined}
          />
        ))}
        {upload && upload.completed < (message.attachments?.length ?? 0) ? (
          <Button variant="ghost" size="sm" className="self-end" isDisabled={upload.cancelling} onPress={upload.cancel}>
            <Button.Label>
              {upload.cancelling
                ? "Cancelling…"
                : `Cancel upload · ${upload.completed} of ${message.attachments?.length ?? 0}`}
            </Button.Label>
          </Button>
        ) : null}
        {message.body.trim() ? (
          <ChatBubble
            agent={message.author === "agent"}
            collapsed={waiting}
            className={
              message.author === "user"
                ? `self-end rounded-[30px] px-4 py-3 ${targetKind === "channel" ? "bg-control/60" : ""} ${message.attachments?.length ? "max-w-[88%]" : "max-w-full"}`
                : `max-w-full self-start rounded-[30px] ${waiting ? "" : "px-4 py-3"}`
            }
            style={[
              { borderCurve: "circular", overflow: "hidden" },
              message.author === "user" && targetKind === "agent" ? userBubbleStyle : undefined,
            ]}
          >
            <ChatMarkdown
              agents={agents}
              body={message.body}
              selectable={message.author === "user"}
              color={message.author === "user" && targetKind === "agent" ? userForeground : foreground}
              playback={playback}
              animationEnabled={shared.animationActive && arrivals.has(message.id)}
            />
          </ChatBubble>
        ) : null}
      </Animated.View>
    );
  if (message.kind !== "message") return rendered;
  return (
    <View
      key={message.id}
      className={
        message.author === "agent"
          ? "max-w-full self-start gap-1"
          : message.attachments?.length
            ? "max-w-full self-end gap-1"
            : "max-w-[88%] self-end gap-1"
      }
      onLayout={isTailUser ? onUserLayout : undefined}
    >
      {message.replyToMessageId ? (
        <View className={`flex-row items-center gap-1 ${message.author === "user" ? "self-end" : "self-start"}`}>
          <CornerUpRight size={14} color={themeMuted} />
          <Typography.Paragraph
            type="body-xs"
            numberOfLines={1}
            className="shrink text-muted"
            accessibilityLabel={`Reply to: ${source?.kind === "message" ? mentionDraft(source.body).text || "Attachment" : "Message unavailable"}`}
          >
            {source?.kind === "message" ? mentionDraft(source.body).text || "Attachment" : "Message unavailable"}
          </Typography.Paragraph>
        </View>
      ) : null}
      {message.author === "agent" ? (
        <ChatMessageGesture
          screenReaderEnabled={screenReaderEnabled}
          onReply={shared.canReply ? () => actions.reply(message) : undefined}
          onOpenActions={() => actions.openActions(message)}
        >
          {rendered}
        </ChatMessageGesture>
      ) : (
        rendered
      )}
    </View>
  );
});

export function ChatMessageList({
  upload,
  target,
  activity,
  activities,
  agents,
  motion,
  sending,
  keyboardOffset,
  canSend,
  online,
  appActive,
  activeTurnId,
  questionForm,
  onSelectQuestion,
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
  onOpenActions,
}: ChatMessageListProps) {
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
    AccessibilityInfo.announceForAccessibility(`Input required. ${questionForm.question.question}`);
  }, [questionForm?.messageId, questionForm?.question]);
  const [userForegroundColor, themeForegroundColor, themeMutedColor] = useCSSVariable([
    "--openbot-text-on-light",
    "--openbot-text-primary",
    "--openbot-text-muted",
  ]);
  const userForeground = String(userForegroundColor);
  const themeForeground = String(themeForegroundColor);
  const themeMuted = String(themeMutedColor);
  const reducedMotion = useReducedMotion();
  const animateMessages = isFocused && online && appActive;
  const replyHaptics = useReplyHaptics(animateMessages && historyState === "ready" && motion.responseVisible);
  const conversationKey = JSON.stringify([target.serverId, target.kind, target.id]);
  const replySession = useMemo(
    () => ({ key: conversationKey, progress: new Map<string, number>(), revealed: new Set<string>() }),
    [conversationKey],
  );
  const [revealedCount, setRevealedCount] = useState(0);
  const markRevealed = useCallback(
    (id: string) => {
      if (replySession.revealed.has(id)) return;
      replySession.revealed.add(id);
      setRevealedCount((count) => count + 1);
    },
    [replySession],
  );
  const arrivals = useMessageArrivals(replySession.key, messages, animateMessages && historyState === "ready");
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

  const visibleMessages = useMemo(() => messages.filter((message) => message.kind !== "thinking"), [messages]);
  const tailIndex = visibleMessages.findLastIndex((message) => message.kind === "message" && message.author === "user");
  const tailId = visibleMessages[tailIndex]?.id ?? null;
  const [boundary, setBoundary] = useState<ChatHistoryBoundary>({ firstId: null, headId: null });
  const promptIndex = visibleMessages.findIndex((message) => message.id === questionForm?.messageId);
  const historyStart = chatHistoryStart(visibleMessages, tailIndex, boundary);
  const windowStart = promptIndex >= 0 ? Math.min(historyStart, promptIndex) : historyStart;
  const firstId = visibleMessages[windowStart]?.id ?? null;
  const headId = visibleMessages[0]?.id ?? null;
  if (boundary.firstId !== firstId || boundary.headId !== headId) setBoundary({ firstId, headId });
  const windowMessages = useMemo(() => visibleMessages.slice(windowStart), [visibleMessages, windowStart]);
  const hasCachedOlder = windowStart > 0;
  const canLoadOlder = hasCachedOlder || (online && hasOlder && !olderLoading);
  const loadPrevious = () => {
    if (hasCachedOlder) {
      const first = visibleMessages[Math.max(0, windowStart - CHAT_HISTORY_BATCH)];
      if (first) setBoundary({ firstId: first.id, headId });
    } else if (canLoadOlder) onLoadOlder();
  };
  const actionHandlers = useRef({ onReply, onOpenActions, onSelectQuestion });
  actionHandlers.current = { onReply, onOpenActions, onSelectQuestion };
  const actions = useMemo<MessageRowShared["actions"]>(
    () => ({
      reply: (message) => actionHandlers.current.onReply?.(message),
      openActions: (message) => actionHandlers.current.onOpenActions(message),
      selectQuestion: (messageId) => actionHandlers.current.onSelectQuestion?.(messageId),
    }),
    [],
  );
  const animationActive = animateMessages && motion.responseVisible;
  const shared = useMemo<MessageRowShared>(
    () => ({
      agents,
      agentsById,
      targetKind: target.kind,
      serverId: target.serverId,
      canSend,
      muted,
      themeMuted,
      foreground,
      userForeground,
      userBubbleStyle,
      firstMessageStyle: motion.firstMessageStyle,
      onUserLayout: motion.onUserLayout,
      screenReaderEnabled,
      arrivals,
      animationActive,
      playbackActive: animationActive && !reducedMotion && !screenReaderEnabled,
      replySession,
      revealedCount,
      markRevealed,
      replyHaptics,
      canReply: Boolean(onReply),
      canSelectQuestion: Boolean(onSelectQuestion),
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
      motion.firstMessageStyle,
      motion.onUserLayout,
      screenReaderEnabled,
      arrivals,
      animationActive,
      reducedMotion,
      replySession,
      revealedCount,
      markRevealed,
      replyHaptics,
      onReply,
      onSelectQuestion,
      actions,
    ],
  );
  const listRef = useRef<FlatList<VisibleMessage>>(null);
  const tailLayout = useMemo(
    () => ({ id: tailId, onTailStartLayout: motion.onTailStartLayout }),
    [tailId, motion.onTailStartLayout],
  );
  const seekLatest = useCallback(() => {
    if (motion.needsInitialPosition() && visibleMessages.length) listRef.current?.scrollToEnd({ animated: false });
  }, [motion.needsInitialPosition, visibleMessages.length]);
  useEffect(() => {
    if (tailId && motion.needsSendPosition() && !motion.atLatest) listRef.current?.scrollToEnd({ animated: false });
  }, [tailId, motion.needsSendPosition, motion.atLatest]);
  const pendingReveal = visibleMessages.some((message) => awaitingFirstWord(message, shared));
  const { responseStyle, responseVisible } = motion;
  const firstRowIsHead = !hasOlder && !hasCachedOlder;
  const renderItem = useCallback(
    ({ item, index }: { item: VisibleMessage; index: number }) => {
      const response = index + windowStart > tailIndex;
      return (
        <Animated.View
          style={[{ paddingBottom: 10 }, response ? responseStyle : undefined]}
          accessibilityElementsHidden={response && !responseVisible}
          importantForAccessibility={response && !responseVisible ? "no-hide-descendants" : "auto"}
        >
          <MessageRow
            message={item}
            isTailUser={index + windowStart === tailIndex}
            isFirstUser={index === 0 && firstRowIsHead}
            source={
              item.kind === "message" && item.replyToMessageId ? messagesById.get(item.replyToMessageId) : undefined
            }
            questionForm={item.id === questionForm?.messageId ? questionForm : undefined}
            upload={upload?.messageId === item.id ? upload : undefined}
            shared={shared}
          />
        </Animated.View>
      );
    },
    [
      windowStart,
      tailIndex,
      responseStyle,
      responseVisible,
      firstRowIsHead,
      messagesById,
      questionForm,
      upload,
      shared,
    ],
  );
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
    const thinkingDetail = !replying && latestThinking?.kind === "thinking" ? latestThinking.steps.at(-1)?.text : null;
    const activityLabel =
      sending && !activity
        ? "Sending…"
        : activity?.phase === "waiting"
          ? messages.some(
              (message) => message.kind === "question" && !message.prompt.resolution && message.turnId === activeTurnId,
            )
            ? "Waiting for your answer"
            : "Waiting for your input on desktop"
          : thinkingDetail
            ? thinkingDetail
            : activity?.phase === "responding"
              ? "Responding…"
              : activity?.detail || (replying ? "Responding…" : "Thinking…");
    const activityAgent = activity?.agentId
      ? agentsById.get(activity.agentId)
      : target.kind === "agent"
        ? target
        : undefined;
    if (!(activity || sending || messages.some(isStreamingReply) || pendingReveal)) return null;
    return {
      // The agent, not the signal that reported it: a turn moves from the local send flag to the
      // host's activity to the reply without remounting the avatar.
      key: activity?.agentId ?? activityAgent?.id ?? target.id,
      label: activityLabel,
      labelKey:
        (thinkingDetail && latestThinking?.kind === "thinking" ? latestThinking.steps.at(-1)?.id : activityLabel) ??
        activityLabel,
      accessibilityLabel: `${activityAgent?.name ?? target.name}: ${activityLabel}`,
      agent: activityAgent,
      mood: animateMessages ? agentActivityMood(activity) : "idle",
      online,
      animateAvatar: animateMessages,
      shimmer:
        animateMessages &&
        motion.historyVisible &&
        motion.responseVisible &&
        !reducedMotion &&
        activity?.phase !== "waiting",
      reveal: animateMessages && motion.historyVisible && motion.responseVisible && !reducedMotion,
    };
  };
  const activityRows = useActivityPresence(
    (activities?.length ? activities : [activity]).flatMap((entry) => activitySpec(entry) ?? []),
  );

  return (
    <Animated.View
      style={[{ flex: 1 }, historyState === "ready" ? motion.historyStyle : undefined]}
      accessibilityElementsHidden={historyState === "ready" && !motion.historyVisible}
      importantForAccessibility={historyState !== "ready" || motion.historyVisible ? "auto" : "no-hide-descendants"}
    >
      <TailLayoutContext.Provider value={tailLayout}>
        <FlatList
          ref={listRef}
          data={windowMessages}
          keyExtractor={(message) => message.id}
          CellRendererComponent={MessageCell}
          initialNumToRender={CHAT_HISTORY_BATCH}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews={false}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onStartReached={() => {
            if (motion.historyVisible && canLoadOlder && (hasCachedOlder || !olderError)) loadPrevious();
          }}
          onStartReachedThreshold={0.5}
          renderItem={renderItem}
          renderScrollComponent={(props) => (
            <ChatScrollView
              {...props}
              motion={motion}
              automaticallyAdjustKeyboardInsets={false}
              keyboardLiftBehavior={motion.keyboardLiftBehavior}
              offset={keyboardOffset}
              applyWorkaroundForContentInsetHitTestBug
              blankSpace={motion.blankSpace}
              extraContentPadding={motion.composerHeight}
              onContentInsetChange={motion.onContentInsetChange}
            />
          )}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: topInset + 84 }}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          alwaysBounceVertical
          onContentSizeChange={(width, height) => {
            motion.onContentSizeChange(width, height);
            seekLatest();
          }}
          onLayout={(event) => {
            motion.onViewportLayout(event);
            seekLatest();
          }}
          onScroll={motion.onScroll}
          onScrollBeginDrag={motion.onScrollBeginDrag}
          onScrollEndDrag={motion.onScrollEndDrag}
          onMomentumScrollEnd={motion.onScrollEndDrag}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {hasOlder || hasCachedOlder ? (
                <View className="items-center pb-3">
                  <Button variant="tertiary" isDisabled={!canLoadOlder} onPress={loadPrevious}>
                    <Button.Label>
                      {!hasCachedOlder && olderLoading
                        ? "Loading older messages…"
                        : !hasCachedOlder && olderError
                          ? "Try loading older messages again"
                          : "Load older messages"}
                    </Button.Label>
                  </Button>
                </View>
              ) : null}
              {historyState === "connecting" || historyState === "loading" ? (
                <View
                  className="flex-1"
                  accessible
                  accessibilityLabel={historyState === "connecting" ? "Connecting to server" : "Loading chat history"}
                  accessibilityState={{ busy: true }}
                />
              ) : historyState !== "ready" ? (
                <View className="flex-1 items-center justify-center gap-2">
                  <Typography.Paragraph align="center" className="text-text-secondary">
                    {historyState === "waiting" ? "Waiting for connection" : "Could not load chat history"}
                  </Typography.Paragraph>
                  {historyState === "waiting" ? (
                    <Typography.Paragraph type="body-xs" align="center" className="text-muted">
                      Your chat history will load when the server reconnects.
                    </Typography.Paragraph>
                  ) : null}
                  {historyState === "error" ? (
                    <Button variant="tertiary" onPress={onRetryHistory}>
                      <Button.Label>Try again</Button.Label>
                    </Button>
                  ) : null}
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
              {showStarter ? (
                <View
                  className="gap-4 rounded-[26px] p-4"
                  style={{ backgroundColor: fieldBackground, borderCurve: "continuous" }}
                >
                  <View className="flex-row items-start gap-3">
                    <View className="min-w-0 flex-1 gap-1">
                      <Typography.Heading type="h4">What should we work on first?</Typography.Heading>
                      <Typography.Paragraph className="text-text-secondary">
                        Pick one, or type your own — we can change course anytime.
                      </Typography.Paragraph>
                    </View>
                    <Pressable
                      accessibilityLabel="Dismiss suggestions"
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={onDismissStarter}
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
                        onPress={() => onSelectStarter(option.label)}
                      >
                        <View className="size-7 items-center justify-center rounded-lg bg-control">
                          <Typography.Paragraph type="body-xs" className="text-text-secondary">
                            {String.fromCharCode(65 + index)}
                          </Typography.Paragraph>
                        </View>
                        <View className="min-w-0 flex-1">
                          <Typography.Paragraph weight="medium">{option.label}</Typography.Paragraph>
                          <Typography.Paragraph type="body-xs" className="text-text-secondary">
                            {option.detail}
                          </Typography.Paragraph>
                        </View>
                      </Pressable>
                    ))}
                  </View>

                  <Typography.Paragraph type="body-xs" className="text-text-secondary">
                    Or answer in the chat below
                  </Typography.Paragraph>
                </View>
              ) : null}
            </>
          }
        />
      </TailLayoutContext.Provider>
    </Animated.View>
  );
}
