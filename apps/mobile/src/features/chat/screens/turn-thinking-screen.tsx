import { Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import Puzzle from "lucide-react-native/icons/puzzle";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type NativeScrollEvent, type NativeSyntheticEvent, View } from "react-native";
import type { KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  ReduceMotion,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useTurnStepLines } from "@/features/workspace/components/use-agent-activity";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { ChatMarkdown } from "../components/chat-markdown";
import { turnDuration } from "../components/chat-turn-steps-row";
import { type TurnThinkingStep, turnThinkingSteps, turnTimes } from "../model/turn-thinking";

/** How near the end, in points, the reader counts as at the end, so the sheet follows new text. */
const FOLLOW_SLACK = 48;
const NO_MESSAGES: never[] = [];

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
// The fade shows that a step arrived, so it stays with reduced motion. The rise and the dot's pop
// are decoration and stop with the system setting.
const STEP_FADE = { duration: 280, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };
const STEP_MOVE = { duration: 360, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const DOT_POP = { duration: 320, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** A new step fades in and rises into place. It runs on the UI thread. */
function stepEntering() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 12 }] },
    animations: {
      opacity: withTiming(1, STEP_FADE),
      transform: [{ translateY: withTiming(0, STEP_MOVE) }],
    },
  };
}

/** A step with motion off in Settings: the fade only. */
function stepFading() {
  "worklet";
  return {
    initialValues: { opacity: 0 },
    animations: { opacity: withTiming(1, STEP_FADE) },
  };
}

/** The dot of a new thought grows a little after its text starts to show. */
function dotEntering() {
  "worklet";
  return {
    initialValues: { transform: [{ scale: 0.3 }] },
    animations: { transform: [{ scale: withDelay(80, withTiming(1, DOT_POP)) }] },
  };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The seconds since `startedAt`, again each second while `running`. */
function useElapsedSeconds(startedAt: number | null, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  // The host and the phone clocks can differ, so a host start can be after the phone's now.
  return startedAt === null ? null : Math.max(0, Math.round((now - startedAt) / 1000));
}

function TimelineStep({
  step,
  last,
  foreground,
  muted,
  accent,
  rail,
  reducedMotion,
}: {
  step: TurnThinkingStep;
  last: boolean;
  foreground: string;
  muted: string;
  accent: string;
  rail: string;
  reducedMotion: boolean;
}) {
  const { sourceText } = useText();
  return (
    <Animated.View entering={reducedMotion ? stepFading : stepEntering} className="flex-row gap-3">
      <View className="w-5 items-center">
        {step.kind === "thought" ? (
          <Animated.View
            entering={reducedMotion ? undefined : dotEntering}
            className="mt-1.5 size-2.5 rounded-full border-2"
            style={{ borderColor: accent }}
          />
        ) : (
          <View className="mt-0.5">
            <Puzzle size={14} color={muted} />
          </View>
        )}
        {last ? null : <View className="mt-1.5 w-px flex-1" style={{ backgroundColor: rail }} />}
      </View>
      <View className={step.kind === "thought" ? "min-w-0 flex-1 pb-5" : "min-w-0 flex-1 pb-4"}>
        {step.kind === "thought" ? (
          <ChatMarkdown
            body={step.text}
            color={foreground}
            streaming={step.streaming}
            finished={!step.streaming}
            animationEnabled={step.streaming}
            selectable
            linkFavicons={false}
          />
        ) : (
          <Typography.Paragraph type="body-sm" className="text-muted">
            {sourceText(step.text)}
          </Typography.Paragraph>
        )}
      </View>
    </Animated.View>
  );
}

/**
 * Each thought of one turn in full, with the progress lines between them, in the order they came.
 * While the turn runs, the sheet shows new text as it comes and keeps the newest text in view,
 * until the reader scrolls up. "Latest" then goes back to it.
 */
export function TurnThinkingScreen() {
  const text = useText();
  const { t } = text;
  const params = useLocalSearchParams<{ agentId: string; turnId: string }>();
  const agentId = firstParam(params.agentId) ?? "";
  const turnId = firstParam(params.turnId) ?? "";
  const agent = useMobileWorkspaceSelector((current) => current.agents.find((candidate) => candidate.id === agentId));
  const conversationStore = useMobileWorkspaceSelector((current) => current.conversationStore);
  const subscribe = useCallback(
    (notify: () => void) => conversationStore.subscribe(agentId, notify),
    [agentId, conversationStore],
  );
  const conversation = useSyncExternalStore(
    subscribe,
    useCallback(() => conversationStore.get(agentId), [agentId, conversationStore]),
  );
  const messages = conversation?.messages ?? NO_MESSAGES;
  const lines = useTurnStepLines(agent?.serverId ?? "")[turnId];
  const steps = useMemo(() => turnThinkingSteps(messages, turnId, lines), [messages, turnId, lines]);
  const times = useMemo(() => turnTimes(messages, turnId), [messages, turnId]);
  const running = conversation?.activeTurnId === turnId;
  const elapsed = useElapsedSeconds(times?.startedAt ?? null, running);
  const seconds = running ? elapsed : times ? Math.round((times.endedAt - times.startedAt) / 1000) : null;
  const reducedMotion = useReducedMotion();
  const [foreground, muted, accent, rail] = useThemeColor(["foreground", "muted", "accent", "separator"]);

  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const following = useRef(true);
  const [behind, setBehind] = useState(false);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - FOLLOW_SLACK;
    following.current = atEnd;
    if (atEnd) setBehind(false);
  }, []);
  // A finished turn opens at its first thought. A running turn opens at its newest text.
  const opened = useRef(false);
  const onContentSizeChange = useCallback(() => {
    const first = !opened.current;
    if (first) {
      opened.current = true;
      following.current = running;
    }
    if (!running) return;
    // The first scroll puts the sheet at the end at once. After it, a new step slides into view.
    if (following.current) scroll.current?.scrollToEnd({ animated: !first && !reducedMotion });
    else setBehind(true);
  }, [running, reducedMotion]);
  const toLatest = useCallback(() => {
    following.current = true;
    setBehind(false);
    scroll.current?.scrollToEnd({ animated: true });
  }, []);

  const stepCount = t("mobile.chat.thinking.steps", { count: steps.length });
  const title = running
    ? t("mobile.chat.thinking.titleLive")
    : seconds !== null
      ? t("mobile.chat.thinking.titleDone", { duration: turnDuration(seconds, text) })
      : t("mobile.app.route.thinking");
  const status = running
    ? t("mobile.chat.thinking.statusLive", {
        steps: stepCount,
        duration: elapsed === null ? "" : turnDuration(elapsed, text),
      })
    : stepCount;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title }} />
      <SheetScrollView
        scrollRef={scroll}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
        contentContainerClassName="px-5 pb-safe-offset-8 pt-5"
        keyboardAware={false}
      >
        {/* The steps that are there when the sheet opens show at once. Only new steps animate. */}
        <LayoutAnimationConfig skipEntering>
          <View className="mb-4 flex-row items-center gap-2">
            {running ? <View className="size-2 rounded-full bg-success" /> : null}
            <Typography.Paragraph type="body-xs" className="text-muted">
              {agent ? `${agent.name} · ${status}` : status}
            </Typography.Paragraph>
          </View>
          {steps.length === 0 ? (
            <Typography.Paragraph type="body-sm" className="text-muted">
              {running ? t("mobile.chat.activity.thinking") : t("mobile.chat.thinking.empty")}
            </Typography.Paragraph>
          ) : (
            steps.map((step, index) => (
              <TimelineStep
                key={step.id}
                step={step}
                last={index === steps.length - 1}
                foreground={foreground}
                muted={muted}
                accent={accent}
                rail={rail}
                reducedMotion={reducedMotion}
              />
            ))
          )}
        </LayoutAnimationConfig>
      </SheetScrollView>
      {behind ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
          className="absolute inset-x-0 bottom-safe-offset-4 items-center"
          pointerEvents="box-none"
        >
          <Button size="sm" variant="secondary" onPress={toLatest} className="rounded-full">
            <ArrowDown size={14} color={foreground} />
            <Button.Label>{t("mobile.chat.thinking.latest")}</Button.Label>
          </Button>
        </Animated.View>
      ) : null}
    </View>
  );
}
