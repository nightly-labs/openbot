import type { AgentExchangeSummary } from "@openbot/contracts/ipc";
import { Link, useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import { CornerUpRight, X } from "lucide-react-native";
import {
  type ComponentProps,
  createContext,
  forwardRef,
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
import {
  BloubAvatarPreview,
  BloubAvatarThumbnail,
  getBloubAvatarColor,
} from "@/features/agents/components/bloub-avatar";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { ChatQuestionPrompt } from "@/features/chat/components/chat-question-prompt";
import type { ChatMotion } from "@/features/chat/components/use-chat-motion";
import { useMessageArrivals } from "@/features/chat/components/use-message-arrivals";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { type ChatMessage, indexChatMessages } from "@/features/chat/model/chat-messages";
import { useConnectionAppearance } from "@/features/workspace/components/use-connection-appearance";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood, type MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import type { ChatBubbleMessage } from "../context/message-actions-context";
import { CHAT_HISTORY_BATCH, type ChatHistoryBoundary, chatHistoryStart } from "../model/chat-layout";
import { mentionDraft } from "../model/chat-mentions";
import type { ChatTarget } from "../model/chat-target";
import { isStreamingReply } from "../model/reply-reveal";
import { ChatAttachmentView } from "./chat-attachment";
import { ChatMessageGesture } from "./chat-message-gesture";
import { StreamingTailText, StreamRevealProvider } from "./streaming-tail-text";
import { ThinkingTextGradient } from "./thinking-text-gradient";
import { useReplyHaptics } from "./use-reply-haptics";

type VisibleMessage = Exclude<ChatMessage, { kind: "thinking" }>;
const TailLayoutContext = createContext<{ id: string | null; motion: ChatMotion } | null>(null);

function MessageCell({ children, item, onLayout, onFocusCapture, style }: CellRendererProps<VisibleMessage>) {
  const tail = useContext(TailLayoutContext);
  const nativeProps = { style, onFocusCapture };
  return (
    <View
      {...nativeProps}
      onLayout={(event) => {
        onLayout?.(event);
        if (item.id === tail?.id) tail.motion.onTailStartLayout(item.id, event);
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

function ChatBubble({
  children,
  agent,
  className,
  style,
}: PropsWithChildren<{ agent: boolean; className: string; style: ComponentProps<typeof Animated.View>["style"] }>) {
  const size = useSharedValue({ width: 0, height: 0 });
  const background = useAnimatedStyle(() => ({
    width: withTiming(size.get().width, REPLY_SIZE),
    height: withTiming(size.get().height, REPLY_SIZE),
  }));
  return (
    <Animated.View
      className={className}
      style={style}
      onLayout={
        agent
          ? ({ nativeEvent }) => size.set({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
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
}

export function ChatMessageList({
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
  const [userForeground, themeForeground, themeMuted] = useCSSVariable([
    "--openbot-text-on-light",
    "--openbot-text-primary",
    "--openbot-text-muted",
  ]).map(String);
  const reducedMotion = useReducedMotion();
  const animateMessages = isFocused && online && appActive;
  const replyHaptics = useReplyHaptics(animateMessages && historyState === "ready" && motion.responseVisible);
  const conversationKey = JSON.stringify([target.serverId, target.kind, target.id]);
  const replySession = useMemo(
    () => ({ key: conversationKey, progress: new Map<string, number>() }),
    [conversationKey],
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
      setBoundary({ firstId: visibleMessages[Math.max(0, windowStart - CHAT_HISTORY_BATCH)].id, headId });
    } else if (canLoadOlder) onLoadOlder();
  };
  const listRef = useRef<FlatList<VisibleMessage>>(null);
  const tailLayout = useMemo(() => ({ id: tailId, motion }), [tailId, motion]);
  const seekLatest = useCallback(() => {
    if (motion.needsInitialPosition() && visibleMessages.length) listRef.current?.scrollToEnd({ animated: false });
  }, [motion.needsInitialPosition, visibleMessages.length]);
  useEffect(() => {
    if (tailId && motion.needsSendPosition() && !motion.atLatest) listRef.current?.scrollToEnd({ animated: false });
  }, [tailId, motion.needsSendPosition, motion.atLatest]);
  const renderMessage = (message: (typeof visibleMessages)[number], isTailUser: boolean, isFirstUser: boolean) => {
    const speaker = message.kind === "message" && message.speaker ? agentsById.get(message.speaker.id) : undefined;
    const rendered =
      message.kind === "exchange" || message.kind === "channel-routing" ? (
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
          controller={message.id === questionForm?.messageId ? questionForm : undefined}
          canSend={canSend}
          onActivate={onSelectQuestion ? () => onSelectQuestion(message.id) : undefined}
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
            message.author === "user"
              ? "max-w-full items-end self-end gap-2"
              : "max-w-full items-start self-start gap-2"
          }
          style={[{ borderCurve: "circular" }, isFirstUser ? motion.firstMessageStyle : undefined]}
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
          {message.attachments?.map((attachment) => (
            <ChatAttachmentView
              key={attachment.id}
              attachment={attachment}
              serverId={target.serverId}
              alignment={message.author === "user" ? "right" : "left"}
            />
          ))}
          {message.body.trim() ? (
            <ChatBubble
              agent={message.author === "agent"}
              className={
                message.author === "user"
                  ? `self-end rounded-[30px] px-4 py-3 ${target.kind === "channel" ? "bg-control/60" : ""} ${message.attachments?.length ? "max-w-[88%]" : "max-w-full"}`
                  : "max-w-full self-start rounded-[30px] px-4 py-3"
              }
              style={[
                { borderCurve: "circular", overflow: "hidden" },
                message.author === "user" && target.kind === "agent" ? userBubbleStyle : undefined,
              ]}
            >
              <ChatMarkdown
                agents={agents}
                body={message.body}
                selectable={message.author === "user"}
                color={message.author === "user" && target.kind === "agent" ? userForeground : foreground}
                playback={
                  message.author === "agent" &&
                  (message.streaming || message.status === "completed") &&
                  !message.superseded &&
                  (!message.speaker || message.speaker.kind === "agent")
                    ? {
                        id: message.id,
                        complete: message.status === "completed",
                        progress: replySession.progress,
                        enabled:
                          animateMessages &&
                          arrivals.has(message.id) &&
                          motion.responseVisible &&
                          !reducedMotion &&
                          !screenReaderEnabled,
                        ...replyHaptics,
                      }
                    : undefined
                }
                animationEnabled={animateMessages && arrivals.has(message.id) && motion.responseVisible}
              />
            </ChatBubble>
          ) : null}
        </Animated.View>
      );
    if (message.kind !== "message") return rendered;
    const source = message.replyToMessageId ? messagesById.get(message.replyToMessageId) : undefined;
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
        onLayout={isTailUser ? motion.onUserLayout : undefined}
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
            onReply={onReply ? () => onReply(message) : undefined}
            onOpenActions={() => onOpenActions(message)}
          >
            {rendered}
          </ChatMessageGesture>
        ) : (
          rendered
        )}
      </View>
    );
  };
  const renderActivity = (activity?: MobileAgentActivity) => {
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
    return activity || sending || messages.some(isStreamingReply) ? (
      <View
        className="flex-row items-center gap-2 px-1 py-2"
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
        key={activity?.agentId ?? "sending"}
        accessibilityLabel={`${activityAgent?.name ?? target.name}: ${activityLabel}`}
      >
        {activityAgent ? (
          <BloubAvatarPreview
            agentId={activityAgent.id}
            serverId={activityAgent.serverId}
            hue={activityAgent.avatarHue}
            seed={activityAgent.avatarSeed}
            size={36}
            disconnected={!online}
            mood={animateMessages ? agentActivityMood(activity) : "idle"}
            animateIdle={animateMessages}
          />
        ) : null}
        <StreamRevealProvider>
          <ThinkingTextGradient
            text={activityLabel}
            foreground={foreground ?? themeForeground}
            muted={muted ?? themeMuted}
            enabled={
              animateMessages &&
              motion.historyVisible &&
              motion.responseVisible &&
              !reducedMotion &&
              activity?.phase !== "waiting"
            }
          >
            <Typography.Paragraph type="body-sm" style={{ color: muted }}>
              <StreamingTailText
                key={
                  thinkingDetail && latestThinking?.kind === "thinking"
                    ? latestThinking.steps.at(-1)?.id
                    : activityLabel
                }
                body={activityLabel}
                type="body-sm"
                style={{ color: muted }}
                enabled={animateMessages && motion.historyVisible && motion.responseVisible && !reducedMotion}
              />
            </Typography.Paragraph>
          </ThinkingTextGradient>
        </StreamRevealProvider>
      </View>
    ) : null;
  };

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
          renderItem={({ item, index }) => (
            <Animated.View
              style={[{ paddingBottom: 10 }, index + windowStart > tailIndex ? motion.responseStyle : undefined]}
              accessibilityElementsHidden={index + windowStart > tailIndex && !motion.responseVisible}
              importantForAccessibility={
                index + windowStart > tailIndex && !motion.responseVisible ? "no-hide-descendants" : "auto"
              }
            >
              {renderMessage(item, index + windowStart === tailIndex, index === 0 && !hasOlder && !hasCachedOlder)}
            </Animated.View>
          )}
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
                {activities?.length ? activities.map(renderActivity) : renderActivity(activity)}
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
