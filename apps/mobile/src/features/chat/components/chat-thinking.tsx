import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ChevronDown, ChevronUp, Sparkle } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";

const DETAIL_ENTER = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

export function ChatThinking({ steps, working }: { steps: { id: string; text: string }[]; working: boolean }) {
  const [open, setOpen] = useState<boolean>();
  const [seconds, setSeconds] = useState<number>();
  const startedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (working) {
      startedAt.current = Date.now();
      setSeconds(undefined);
    } else if (startedAt.current !== undefined) {
      setSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1_000)));
      startedAt.current = undefined;
    }
  }, [working]);
  const muted = useThemeColor("muted");
  const expanded = open ?? working;
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <View className="self-stretch gap-2 px-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide thinking details" : "Show thinking details"}
        accessibilityState={{ expanded }}
        className="min-h-11 flex-row items-center gap-2 self-start"
        onPress={() => setOpen(!expanded)}
      >
        <Sparkle size={14} color={muted} fill={muted} strokeWidth={0} />
        <Typography.Paragraph className="text-text-secondary" type="body-sm">
          {working
            ? "Thinking"
            : seconds === undefined
              ? "Thought it through"
              : `Thought for ${seconds} ${seconds === 1 ? "second" : "seconds"}`}
        </Typography.Paragraph>
        <Chevron size={15} color={muted} />
      </Pressable>
      {expanded ? (
        <Animated.View entering={DETAIL_ENTER} className="ml-1.5 gap-3 border-l border-separator pl-4 pb-2">
          {steps.map((step) => (
            <ChatMarkdown key={step.id} body={step.text} color={muted} compact />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}
