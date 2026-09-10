import { userErrorMessage } from "@openbot/user-errors";
import { GlassView } from "expo-glass-effect";
import { Button, Typography } from "heroui-native";
import { ChevronDown, ChevronUp, CornerDownRight, ListOrdered, Pencil, Trash2 } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { ChatMessage } from "@/features/chat/model/chat-messages";

const QUEUE_VIEWPORT_HEIGHT = 192;

export type QueueMessage = Extract<ChatMessage, { kind: "message" }>;

interface ChatQueueProps {
  messages: QueueMessage[];
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  muted: ViewStyle["backgroundColor"];
  canManage: boolean;
  canSteer: boolean;
  onSteer: (deliveryId: string) => Promise<void>;
  onEdit: (message: QueueMessage) => Promise<void>;
  onAnimatingChange: (animating: boolean) => void;
  onDelete: (deliveryId: string) => Promise<void>;
}

export function ChatQueue({
  messages,
  liquidGlassAvailable,
  fallbackBackground,
  foreground,
  muted,
  canManage,
  canSteer,
  onSteer,
  onEdit,
  onDelete,
  onAnimatingChange,
}: ChatQueueProps) {
  const multiple = messages.length > 1;
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const showMessages = !multiple || expanded;
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const animatedHeight = useSharedValue(0);
  useEffect(() => {
    onAnimatingChange(true);
    animatedHeight.set(
      withTiming(
        showMessages ? measuredHeight : 0,
        { duration: 200, reduceMotion: ReduceMotion.System },
        (finished) => {
          if (finished) scheduleOnRN(onAnimatingChange, false);
        },
      ),
    );
    return () => cancelAnimation(animatedHeight);
  }, [showMessages, measuredHeight, animatedHeight, onAnimatingChange]);
  useEffect(() => () => onAnimatingChange(false), [onAnimatingChange]);
  const contentStyle = useAnimatedStyle(() => ({ height: animatedHeight.get() }));
  const Chevron = showMessages ? ChevronUp : ChevronDown;

  async function run(action: () => Promise<void>) {
    if (busy.current || !canManage) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(userErrorMessage(cause, "The host could not change this queued message. It may already have started."));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (messages.length === 0 && !error) return null;
  return (
    <View className="mx-4 mb-2">
      <GlassView
        glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
        style={{
          backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
          borderCurve: "continuous",
          borderRadius: 24,
          overflow: "hidden",
          paddingHorizontal: 16,
          paddingVertical: 10,
        }}
      >
        <View className="flex-row items-center gap-2 px-1">
          <ListOrdered color={String(muted)} size={14} strokeWidth={1.8} />
          <Typography.Paragraph type="body-xs" weight="medium" className="flex-1" style={{ color: muted }}>
            Up next
          </Typography.Paragraph>
          {multiple ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-h-8 gap-2 px-1"
              accessibilityLabel={`${showMessages ? "Collapse" : "Expand"} ${messages.length} queued messages`}
              accessibilityState={{ expanded: showMessages }}
              isDisabled={pending}
              onPress={() => setExpanded(!showMessages)}
            >
              <Typography.Paragraph type="body-xs" style={{ color: muted }} accessibilityLiveRegion="polite">
                {messages.length} queued
              </Typography.Paragraph>
              <Chevron color={String(muted)} size={14} strokeWidth={1.8} />
            </Button>
          ) : (
            <Typography.Paragraph type="body-xs" style={{ color: muted }} accessibilityLiveRegion="polite">
              {messages.length} queued
            </Typography.Paragraph>
          )}
        </View>
        {/* Keep the rows mounted while clipping them. Only this height changes; the
            keyboard container and its input must not have a layout transition. */}
        <Animated.View
          style={[{ overflow: "hidden" }, contentStyle]}
          pointerEvents={showMessages ? "auto" : "none"}
          accessibilityElementsHidden={!showMessages}
          importantForAccessibility={showMessages ? "auto" : "no-hide-descendants"}
        >
          <ScrollView
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: QUEUE_VIEWPORT_HEIGHT }}
            onContentSizeChange={(_width, height) => setMeasuredHeight(Math.min(height, QUEUE_VIEWPORT_HEIGHT))}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            bounces={false}
          >
            {messages.map((message, index) => {
              const delivery = message.delivery;
              const position = delivery?.position ?? index + 1;
              const disabled = !canManage || pending || delivery?.status !== "queued";
              return (
                <View key={message.id} className="min-h-10 flex-row items-center gap-3 px-1 py-1">
                  <Typography.Paragraph type="body-xs" className="min-w-3" style={{ color: muted }}>
                    {position}
                  </Typography.Paragraph>
                  <View className="min-w-0 flex-1 gap-1">
                    {message.body ? (
                      <Typography.Paragraph type="body-sm" numberOfLines={1} style={{ color: foreground }}>
                        {message.body}
                      </Typography.Paragraph>
                    ) : null}
                    {message.attachments?.length ? (
                      <Typography.Paragraph type="body-xs" numberOfLines={1} style={{ color: muted }}>
                        {message.attachments.map((attachment) => attachment.name).join(" · ")}
                      </Typography.Paragraph>
                    ) : null}
                    {message.awaitingQueueReceipt || delivery?.status === "starting" ? (
                      <Typography.Paragraph type="body-xs" style={{ color: muted }}>
                        {message.awaitingQueueReceipt ? "Sending…" : "Starting…"}
                      </Typography.Paragraph>
                    ) : null}
                  </View>
                  <View className="flex-row">
                    <Button
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      accessibilityLabel={`Steer queued message ${position}`}
                      isDisabled={disabled || !canSteer}
                      onPress={() => {
                        if (delivery) void run(() => onSteer(delivery.id));
                      }}
                    >
                      <CornerDownRight color={String(muted)} size={16} strokeWidth={1.8} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      accessibilityLabel={`Edit queued message ${position}`}
                      isDisabled={disabled}
                      onPress={() => {
                        void run(() => onEdit(message));
                      }}
                    >
                      <Pencil color={String(muted)} size={16} strokeWidth={1.8} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      accessibilityLabel={`Delete queued message ${position}`}
                      isDisabled={disabled}
                      onPress={() => {
                        if (delivery) void run(() => onDelete(delivery.id));
                      }}
                    >
                      <Trash2 color={String(muted)} size={16} strokeWidth={1.8} />
                    </Button>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>
        {error ? (
          <View className="gap-1 pt-2">
            <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="text-danger">
              {error}
            </Typography.Paragraph>
            <Button variant="ghost" size="sm" onPress={() => setError(null)}>
              Dismiss error
            </Button>
          </View>
        ) : null}
      </GlassView>
    </View>
  );
}
