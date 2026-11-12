import type { AgentTasksSnapshot, ConversationSnapshot } from "@openbot/contracts/ipc";
import { skipToken, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import Puzzle from "lucide-react-native/icons/puzzle";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, View } from "react-native";
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
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useTurnStepLines } from "@/features/workspace/components/use-agent-activity";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useReducedMotion } from "@/shared/lib/motion";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { ChatMarkdown } from "../components/chat-markdown";
import { turnDuration } from "../components/chat-turn-steps-row";
import { type TurnThinkingStep, turnStartLoaded, turnThinkingSteps, turnTimes } from "../model/turn-thinking";

/** How near the end, in points, the reader counts as at the end, so the sheet follows new text. */
const FOLLOW_SLACK = 48;
/** How many more steps show when the reader gets near the top or the end of the window. */
const STEP_PAGE = 30;
/** How near the top or the end, in points, the window grows. */
const WINDOW_EDGE = 600;
/** How long, in milliseconds, the window waits for the steps it added above to lay out. */
const ANCHOR_WAIT_MS = 1000;
/** A running turn that the reader follows keeps at most this many steps drawn. */
const FOLLOW_STEPS = STEP_PAGE * 2;
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

interface TimelineStepProps {
  step: TurnThinkingStep;
  last: boolean;
  /** True for a step that came while the sheet was open. Only these animate. */
  arrived: boolean;
  foreground: string;
  muted: string;
  accent: string;
  rail: string;
  reducedMotion: boolean;
  onLayout: (id: string, y: number) => void;
}

function sameStep(left: TurnThinkingStep, right: TurnThinkingStep): boolean {
  if (left.id !== right.id || left.kind !== right.kind || left.text !== right.text) return false;
  return left.kind !== "thought" || right.kind !== "thought" || left.streaming === right.streaming;
}

/** A streamed word draws only its own step again, also when the sheet holds many steps. */
const TimelineStep = memo(
  function TimelineStep({
    step,
    last,
    arrived,
    foreground,
    muted,
    accent,
    rail,
    reducedMotion,
    onLayout,
  }: TimelineStepProps) {
    const { sourceText } = useText();
    return (
      <Animated.View
        entering={arrived ? (reducedMotion ? stepFading : stepEntering) : undefined}
        onLayout={(event) => onLayout(step.id, event.nativeEvent.layout.y)}
        className="flex-row gap-3"
      >
        <View className="w-5 items-center">
          {step.kind === "thought" ? (
            <Animated.View
              entering={arrived && !reducedMotion ? dotEntering : undefined}
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
  },
  (left, right) =>
    sameStep(left.step, right.step) &&
    left.last === right.last &&
    left.arrived === right.arrived &&
    left.foreground === right.foreground &&
    left.muted === right.muted &&
    left.accent === right.accent &&
    left.rail === right.rail &&
    left.reducedMotion === right.reducedMotion &&
    left.onLayout === right.onLayout,
);

/**
 * The messages and the running turn of the agent's chat, or of one thread with `taskId`. The thread
 * screen under the sheet loads the thread and keeps it current, so the sheet only reads its cache.
 */
function useTurnConversation(agentId: string, serverId: string, taskId: string | undefined) {
  const queryScope = useQueryScope();
  const conversationStore = useMobileWorkspaceSelector((current) => current.conversationStore);
  const subscribe = useCallback(
    (notify: () => void) => conversationStore.subscribe(agentId, notify),
    [agentId, conversationStore],
  );
  const conversation = useSyncExternalStore(
    subscribe,
    useCallback(() => conversationStore.get(agentId), [agentId, conversationStore]),
  );
  const taskConversation = useQuery<ConversationSnapshot>({
    queryKey: queryKeys.agentTaskConversation(queryScope, serverId, taskId ?? ""),
    queryFn: skipToken,
  });
  const tasks = useQuery<AgentTasksSnapshot>({
    queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
    queryFn: skipToken,
  });
  // A thread loads whole. The agent's chat loads by pages, and the sheet can read the older ones.
  if (taskId === undefined)
    return {
      messages: conversation?.messages ?? NO_MESSAGES,
      activeTurnId: conversation?.activeTurnId ?? null,
      hasOlder: Boolean(conversation?.pageInfo.hasOlder && !conversation.detached),
      olderLoading: conversation?.olderLoading ?? false,
      olderError: conversation?.olderError ?? false,
    };
  return {
    messages: taskConversation.data?.messages ?? NO_MESSAGES,
    activeTurnId: tasks.data?.tasks.find((task) => task.id === taskId)?.activeTurnId ?? null,
    hasOlder: false,
    olderLoading: false,
    olderError: false,
  };
}

interface StepWindow {
  /** The first step that shows, or null for the first step that the phone holds. */
  topId: string | null;
  /** The last step that shows, or null for the newest step. */
  bottomId: string | null;
}

/**
 * Each thought of one turn in full, with the progress lines between them, in the order they came.
 * While the turn runs, the sheet shows new text as it comes and keeps the newest text in view,
 * until the reader scrolls up. "Latest" then goes back to it.
 */
export function TurnThinkingScreen() {
  const text = useText();
  const { t } = text;
  const params = useLocalSearchParams<{ agentId: string; turnId: string; serverId?: string; taskId?: string }>();
  const agentId = firstParam(params.agentId) ?? "";
  const turnId = firstParam(params.turnId) ?? "";
  const taskId = firstParam(params.taskId);
  const serverParam = firstParam(params.serverId);
  const agent = useMobileWorkspaceSelector((current) =>
    current.agents.find(
      (candidate) => candidate.id === agentId && (serverParam === undefined || candidate.serverId === serverParam),
    ),
  );
  const serverId = serverParam ?? agent?.serverId ?? "";
  const { messages, activeTurnId, hasOlder, olderLoading, olderError } = useTurnConversation(agentId, serverId, taskId);
  const loadOlderMessages = useMobileWorkspaceSelector((current) => current.loadOlderMessages);
  const lines = useTurnStepLines(serverId)[turnId];
  const steps = useMemo(() => turnThinkingSteps(messages, turnId, lines), [messages, turnId, lines]);
  const times = useMemo(() => turnTimes(messages, turnId), [messages, turnId]);
  const running = activeTurnId === turnId;
  const elapsed = useElapsedSeconds(times?.startedAt ?? null, running);
  const seconds = running ? elapsed : times ? Math.round((times.endedAt - times.startedAt) / 1000) : null;
  const reducedMotion = useReducedMotion();
  const [foreground, muted, accent, rail] = useThemeColor(["foreground", "muted", "accent", "separator"]);
  // The start of a long turn can be in an older page, which the sheet reads when the reader gets to the top.
  const needsEarlier = hasOlder && !turnStartLoaded(messages, turnId);

  // A long run has thousands of steps. Each one is Markdown, and all of them at once stop the app
  // (#5554), so the sheet shows a window of them that grows as the reader scrolls.
  const openWindow = (): StepWindow =>
    running
      ? { topId: steps.length > STEP_PAGE ? (steps.at(-STEP_PAGE)?.id ?? null) : null, bottomId: null }
      : { topId: null, bottomId: steps.length > STEP_PAGE ? (steps[STEP_PAGE - 1]?.id ?? null) : null };
  const [stepWindow, setStepWindow] = useState<StepWindow | null>(null);
  const shownWindow = stepWindow ?? openWindow();
  useEffect(() => {
    if (stepWindow === null && steps.length > 0) setStepWindow(shownWindow);
  });
  // A progress line can leave the phone's memory. The window then keeps its last place.
  const lastIndices = useRef({ top: 0, bottom: STEP_PAGE });
  const indexOf = (id: string | null, empty: number, fallback: number) => {
    if (id === null) return empty;
    const index = steps.findIndex((step) => step.id === id);
    return index >= 0 ? index : Math.min(fallback, steps.length);
  };
  const topIndex = indexOf(shownWindow.topId, 0, lastIndices.current.top);
  const endIndex = Math.max(topIndex, indexOf(shownWindow.bottomId, steps.length - 1, lastIndices.current.bottom) + 1);
  const shownSteps = steps.slice(topIndex, endIndex);

  // Steps that come after the newest step that the sheet already showed animate in. Steps above the
  // window and steps of older pages do not.
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(steps.map((step) => step.id));
  let newestSeen = steps.length - 1;
  while (newestSeen >= 0 && !seen.current.has(steps[newestSeen]?.id ?? "")) newestSeen -= 1;
  const arrivedFrom = newestSeen + 1;
  useLayoutEffect(() => {
    lastIndices.current = { top: topIndex, bottom: endIndex - 1 };
    for (const step of steps) seen.current?.add(step.id);
  }, [steps, topIndex, endIndex]);

  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const following = useRef(true);
  const [behind, setBehind] = useState(false);
  // Steps that show above the reader keep the reader's step in place: the offset moves as much as it.
  const offset = useRef(0);
  const atTop = useRef(true);
  const positions = useRef(new Map<string, number>()).current;
  const anchor = useRef<{ id: string; y: number; at: number } | null>(null);
  const onStepLayout = useCallback(
    (id: string, y: number) => {
      positions.set(id, y);
      const held = anchor.current;
      if (held?.id !== id || held.y === y) return;
      anchor.current = null;
      scroll.current?.scrollTo({ y: offset.current + y - held.y, animated: false });
    },
    [positions],
  );
  // A step that is not laid out yet keeps the anchor of the last call, which then moves by both.
  const holdFirstStep = () => {
    const first = shownSteps[0];
    const y = first && positions.get(first.id);
    if (first && y !== undefined) anchor.current = { id: first.id, y, at: Date.now() };
  };
  const loadEarlier = () => {
    // A failed read stops here, as in the chat. The next page that the host sends clears the error.
    if (topIndex !== 0 || !needsEarlier || olderLoading || olderError) return;
    holdFirstStep();
    void loadOlderMessages(agentId, serverId).catch(() => undefined);
  };
  const showEarlier = () => {
    if (topIndex === 0) return loadEarlier();
    // The steps of the last call are not laid out yet. An anchor that never moves, such as of a step
    // that left the phone, stops blocking after a short time.
    if (anchor.current && Date.now() - anchor.current.at < ANCHOR_WAIT_MS) return;
    holdFirstStep();
    const top = Math.max(0, topIndex - STEP_PAGE);
    setStepWindow({ ...shownWindow, topId: top === 0 ? null : (steps[top]?.id ?? null) });
  };
  const showLater = () => {
    if (shownWindow.bottomId === null) return;
    const bottom = endIndex - 1 + STEP_PAGE;
    setStepWindow({ ...shownWindow, bottomId: bottom >= steps.length - 1 ? null : (steps[bottom]?.id ?? null) });
  };
  // A sheet that stays open on a run of hours gets new steps at the end. While the reader follows
  // them, the steps far above leave the window, and they come back when the reader scrolls up.
  const followTopId =
    running && shownWindow.bottomId === null && endIndex - topIndex > FOLLOW_STEPS
      ? (steps[endIndex - STEP_PAGE]?.id ?? null)
      : null;
  useEffect(() => {
    if (followTopId !== null && following.current && !atTop.current)
      setStepWindow({ topId: followTopId, bottomId: null });
  }, [followTopId]);
  // A sheet that opens at the top, or whose steps all fit, reads the older page of the turn at once.
  const loadEarlierNow = useRef(loadEarlier);
  loadEarlierNow.current = loadEarlier;
  useEffect(() => {
    if (needsEarlier && atTop.current) loadEarlierNow.current();
  }, [needsEarlier]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentInset, contentSize, layoutMeasurement } = event.nativeEvent;
    offset.current = contentOffset.y;
    const atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - FOLLOW_SLACK;
    following.current = atEnd;
    if (atEnd) setBehind(false);
    atTop.current = contentOffset.y + (contentInset?.top ?? 0) < WINDOW_EDGE;
    if (atTop.current) showEarlier();
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - WINDOW_EDGE) showLater();
  };
  // iOS `scrollToEnd` sets an offset of 0 when the content is shorter than the sheet, and that puts
  // the content under the transparent header. Content that fits below the header stays where the
  // inset puts it. The sheet and the content can measure in either order, so both run the same check.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  // iOS: the transparent header covers the top of the sheet. Android: the header is above the sheet.
  const coveredTop = isIOS ? headerHeight : 0;
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  // A finished turn opens at its first thought. A running turn opens at its newest text.
  const opened = useRef(false);
  const placed = useRef(false);
  const follow = useCallback(() => {
    if (!running || viewportHeight.current === 0 || contentHeight.current === 0) return;
    // The first measured pass puts the sheet at the end at once. After it, a new step slides into view.
    const first = !placed.current;
    placed.current = true;
    if (contentHeight.current <= viewportHeight.current - coveredTop) return;
    if (following.current) scroll.current?.scrollToEnd({ animated: !first && !reducedMotion });
    else setBehind(true);
  }, [running, reducedMotion, coveredTop]);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeight.current = event.nativeEvent.layout.height;
      if (following.current) follow();
    },
    [follow],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeight.current = height;
      if (!opened.current) {
        opened.current = true;
        following.current = running;
      }
      follow();
    },
    [running, follow],
  );
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
    <View style={{ flex: 1 }} onLayout={onLayout}>
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
            shownSteps.map((step, index) => (
              <TimelineStep
                key={step.id}
                step={step}
                last={topIndex + index === steps.length - 1}
                arrived={topIndex + index >= arrivedFrom}
                foreground={foreground}
                muted={muted}
                accent={accent}
                rail={rail}
                reducedMotion={reducedMotion}
                onLayout={onStepLayout}
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
