import { useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import { X } from "lucide-react-native";
import { Pressable, View, type ViewStyle } from "react-native";
import { KeyboardChatScrollView } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
} from "react-native-reanimated";
import { BloubAvatar, getBloubAvatarColor } from "@/features/agents/components/bloub-avatar";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { ChatQuestionPrompt } from "@/features/chat/components/chat-question-prompt";
import type { ChatMotion } from "@/features/chat/components/use-chat-motion";
import { useMessageArrivals } from "@/features/chat/components/use-message-arrivals";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import { useConnectionAppearance } from "@/features/workspace/components/use-connection-appearance";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { StreamingTailText, StreamRevealProvider } from "./streaming-tail-text";
import { ThinkingTextGradient } from "./thinking-text-gradient";

const STARTER_OPTIONS = [
  { id: "plan", label: "Plan the next steps", detail: "Turn a goal into a clear plan" },
  { id: "research", label: "Research something", detail: "Compare sources and summarize" },
  { id: "solve", label: "Work through a problem", detail: "Think it through together" },
] as const;

const USER_MESSAGE_ENTRANCE = FadeInDown.duration(240)
  .easing(Easing.bezier(0.23, 1, 0.32, 1))
  .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] })
  .reduceMotion(ReduceMotion.System);
const AGENT_MESSAGE_ENTRANCE = FadeIn.duration(240).reduceMotion(ReduceMotion.System);

interface ChatMessageListProps {
  agent: MobileAgent;
  motion: ChatMotion;
  sending: boolean;
  keyboardOffset: number;
  canSend: boolean;
  appActive: boolean;
  activeTurnId: string | null;
  questionForm: QuestionPromptController;
  fieldBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  historyState: "ready" | "connecting" | "waiting" | "loading" | "error";
  messages: ChatMessage[];
  muted: ViewStyle["backgroundColor"];
  raised: ViewStyle["backgroundColor"];
  showStarter: boolean;
  topInset: number;
  onDismissStarter: () => void;
  onSelectStarter: (value: string) => void;
  onRetryHistory: () => void;
}

export function ChatMessageList({
  agent,
  motion,
  sending,
  keyboardOffset,
  canSend,
  appActive,
  activeTurnId,
  questionForm,
  fieldBackground,
  foreground,
  historyState,
  messages,
  muted,
  raised,
  showStarter,
  topInset,
  onDismissStarter,
  onSelectStarter,
  onRetryHistory,
}: ChatMessageListProps) {
  const isFocused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const animateMessages = isFocused && canSend && appActive;
  const arrivals = useMessageArrivals(agent.id, messages, animateMessages && historyState === "ready");
  const activity = useAgentActivity(agent.id);
  const latestThinking = messages.findLast(
    (message) => message.kind === "thinking" && message.turnId === activity?.turnId,
  );
  const thinkingDetail =
    latestThinking?.kind === "thinking" &&
    !messages.some((message) => message.kind === "message" && message.author === "agent" && message.streaming)
      ? latestThinking.steps.at(-1)?.text
      : null;
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
            : activity?.detail || "Thinking…";
  const userBubbleColor = getBloubAvatarColor(agent.avatarSeed, agent.avatarHue);
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

  const visibleMessages = messages.filter((message) => message.kind !== "thinking");
  const groups: { id: string; user?: (typeof visibleMessages)[number]; replies: typeof visibleMessages }[] = [];
  for (const message of visibleMessages) {
    if (message.kind === "message" && message.author === "user") {
      groups.push({ id: message.id, user: message, replies: [] });
    } else {
      if (groups.length === 0) groups.push({ id: "preamble", replies: [] });
      groups[groups.length - 1].replies.push(message);
    }
  }
  const renderMessage = (message: (typeof visibleMessages)[number], isTailUser: boolean, isFirstUser: boolean) =>
    message.kind === "question" ? (
      <ChatQuestionPrompt
        key={message.id}
        prompt={message.prompt}
        controller={message.id === questionForm.messageId ? questionForm : undefined}
        canSend={canSend}
      />
    ) : (
      <Animated.View
        key={message.id}
        onLayout={isTailUser ? motion.onUserLayout : undefined}
        entering={
          arrivals.has(message.id) && !isFirstUser
            ? message.author === "user"
              ? USER_MESSAGE_ENTRANCE
              : AGENT_MESSAGE_ENTRANCE
            : undefined
        }
        className={`max-w-[88%] rounded-[30px] px-4 py-3 ${message.author === "user" ? "self-end" : "self-start bg-control/60"}`}
        style={[
          { borderCurve: "circular" },
          message.author === "user" ? userBubbleStyle : undefined,
          isFirstUser ? motion.firstMessageStyle : undefined,
        ]}
      >
        {message.attachments?.map((attachment) => (
          <Typography.Paragraph
            key={attachment.id}
            type="body-sm"
            style={{ color: message.author === "user" ? "#0a0a0c" : foreground }}
          >
            {attachment.name}
          </Typography.Paragraph>
        ))}
        <ChatMarkdown
          body={message.body}
          color={message.author === "user" ? "#0a0a0c" : foreground}
          streaming={message.author === "agent" && message.streaming}
          animationEnabled={animateMessages && arrivals.has(message.id) && motion.responseVisible}
        />
      </Animated.View>
    );
  const renderActivity = () =>
    activity || sending ? (
      <View
        className="flex-row items-center gap-2 px-1 py-2"
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
        accessibilityLabel={`${agent.name}: ${activityLabel}`}
      >
        <BloubAvatar agentId={agent.id} hue={agent.avatarHue} seed={agent.avatarSeed} size={36} />
        <StreamRevealProvider>
          <ThinkingTextGradient
            text={activityLabel}
            foreground={foreground ?? "#ffffff"}
            muted={muted ?? "#888888"}
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

  return (
    <Animated.View
      style={[{ flex: 1 }, historyState === "ready" ? motion.historyStyle : undefined]}
      accessibilityElementsHidden={historyState === "ready" && !motion.historyVisible}
      importantForAccessibility={historyState !== "ready" || motion.historyVisible ? "auto" : "no-hide-descendants"}
    >
      <KeyboardChatScrollView
        ref={motion.setScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          gap: 10,
          paddingHorizontal: 16,
          paddingTop: topInset + 84,
        }}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustKeyboardInsets={false}
        keyboardLiftBehavior="whenAtEnd"
        offset={keyboardOffset}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        // RN Fabric otherwise ignores drags that start in the contentInset area.
        applyWorkaroundForContentInsetHitTestBug
        alwaysBounceVertical
        blankSpace={motion.blankSpace}
        extraContentPadding={motion.composerHeight}
        onContentInsetChange={motion.onContentInsetChange}
        onContentSizeChange={motion.onContentSizeChange}
        onLayout={motion.onViewportLayout}
        onScroll={motion.onScroll}
        onScrollBeginDrag={motion.cancelSend}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
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
              <Typography.Paragraph type="body-xs" align="center" className="text-text-dim">
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

        {groups.map((group, index) => {
          const last = index === groups.length - 1;
          return (
            <View
              key={group.id}
              style={{ gap: 10 }}
              onLayout={last && group.user ? (event) => motion.onTailLayout(group.id, event) : undefined}
            >
              {group.user ? renderMessage(group.user, last, index === 0) : null}
              <Animated.View
                style={[{ gap: 10 }, last ? motion.responseStyle : undefined]}
                accessibilityElementsHidden={last && !motion.responseVisible}
                importantForAccessibility={last && !motion.responseVisible ? "no-hide-descendants" : "auto"}
              >
                {group.replies.map((message) => renderMessage(message, false, false))}
                {last ? renderActivity() : null}
              </Animated.View>
            </View>
          );
        })}
        {groups.length === 0 ? renderActivity() : null}

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
      </KeyboardChatScrollView>
    </Animated.View>
  );
}
