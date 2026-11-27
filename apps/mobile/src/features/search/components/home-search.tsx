import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { isAgentTaskOpen, taskNeedsYou } from "@openbot/team-client/agent-tasks";
import { type Href, router, useFocusEffect } from "expo-router";
import { useNavigation } from "expo-router/react-navigation";
import { Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartArea from "lucide-react-native/icons/chart-area";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import CircleX from "lucide-react-native/icons/circle-x";
import EyeOff from "lucide-react-native/icons/eye-off";
import ListChecks from "lucide-react-native/icons/list-checks";
import ListRestart from "lucide-react-native/icons/list-restart";
import Plus from "lucide-react-native/icons/plus";
import Search from "lucide-react-native/icons/search";
import Settings from "lucide-react-native/icons/settings";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import UsersRound from "lucide-react-native/icons/users-round";
import {
  memo,
  type PropsWithChildren,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  type TextInputInstance,
  View,
} from "react-native";
import { KeyboardAwareScrollView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  cubicBezier,
  Easing,
  type EntryExitAnimationFunction,
  Extrapolation,
  interpolate,
  LinearTransition,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import { reportMobileNotification } from "@/features/analytics/failure-reports";
import { MobileSearchResults, SearchCaption } from "@/features/search/components/mobile-search-results";
import { setHomeSearchOpener } from "@/features/search/model/home-search-request";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { TaskListRow } from "@/features/servers/components/task-list-row";
import { taskStartId } from "@/features/servers/model/task-start-id";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { BlurSwap } from "@/shared/components/blur-swap";
import { useBottomFieldMetrics } from "@/shared/components/bottom-field-metrics";
import { GLASS_CAPSULE_HEIGHT, GlassCapsule } from "@/shared/components/glass-capsule";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion, useTransitionMode } from "@/shared/lib/motion";
import { selectionColorProps } from "@/shared/lib/selection-color";
import { currentText, useText } from "@/shared/lib/text";
import { fieldDirectionStyle } from "@/shared/lib/text-direction";
import { typeScale } from "@/shared/lib/type-scale";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

function openSearchedChat(pane: ReturnType<typeof useChatListPane>, agent: MobileAgent): void {
  const open = () =>
    router.push({ pathname: "/chat/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } });
  if (pane) openChatFromPane(pane, agent.id, open);
  else open();
}

export const HOME_SEARCH_HEIGHT = GLASS_CAPSULE_HEIGHT;
const KEYBOARD_GAP = 8;
const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const EASE_SMOOTH = Easing.bezier(0.32, 0.72, 0, 1);
const CSS_EASE_SMOOTH = cubicBezier(0.32, 0.72, 0, 1);
const OPEN = { duration: 340, easing: EASE_SMOOTH };
const CLOSE = { duration: 360, easing: EASE_SMOOTH };
const FIELD_LAYOUT = LinearTransition.duration(340).easing(EASE_SMOOTH);
const RESULT_DURATION = 2_000;
const RESULT_IN = 380;
const RESULT_OUT = 280;
const RESULT_STAGGER = 40;
const PRESS_SCALE = {
  transitionProperty: "transform",
  transitionDuration: 120,
  transitionTimingFunction: CSS_EASE_OUT,
} as const;

const closeButtonGrow: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { transform: [{ scale: 0.9 }] },
    animations: { transform: [{ scale: withTiming(1, OPEN) }] },
  };
};
const closeButtonEnter: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: {
      opacity: withTiming(1, { duration: 260, easing: EASE_SMOOTH }),
      transform: [{ scale: withTiming(1, OPEN) }],
    },
  };
};
const closeButtonExit: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 200, easing: EASE_SMOOTH }),
      transform: [{ scale: withTiming(0.9, CLOSE) }],
    },
  };
};

interface TaskStartResult {
  id: number;
  agent: MobileAgent;
  text: string;
  ok: boolean;
}

export interface HomeSearch {
  open: boolean;
  mounted: boolean;
  prepared: boolean;
  settled: boolean;
  query: string;
  setQuery: (query: string) => void;
  prepare: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  leave: () => void;
  input: RefObject<TextInputInstance | null>;
  progress: SharedValue<number>;
  closing: SharedValue<number>;
  canUseTasks: boolean;
  target: MobileAgent | null;
  chooseTarget: (agent: MobileAgent, text?: SetStateAction<string>) => void;
  clearTarget: () => void;
  fillTask: (text: string) => void;
  targetMatches: MobileAgent[] | null;
  startTask: (agent: MobileAgent, text: string) => void;
  submit: () => void;
  sending: boolean;
  result: TaskStartResult | null;
  dismissResult: () => void;
}

function matchTargets(agents: readonly MobileAgent[], query: string): MobileAgent[] | null {
  const trimmed = query.trimStart();
  if (!trimmed.startsWith("@")) return null;
  const needle = trimmed.slice(1).trim().toLocaleLowerCase();
  return agents.filter(
    (agent) =>
      !needle ||
      agent.name.toLocaleLowerCase().startsWith(needle) ||
      agent.title.trim().toLocaleLowerCase().startsWith(needle),
  );
}

export function useHomeSearch(): HomeSearch {
  const { setOpeningBlocked } = useAppDrawer();
  const workspace = useMobileWorkspaceReader();
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const agents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const canUseTasks = useMobileWorkspaceSelector((current) => current.canUseTasks(current.activeServer.id));
  const input = useRef<TextInputInstance>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [settled, setSettled] = useState(false);
  const [target, setTarget] = useState<MobileAgent | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TaskStartResult | null>(null);
  const draft = useRef("");
  const progress = useSharedValue(0);
  const closing = useSharedValue(0);
  const targetMatches = canUseTasks && !target ? matchTargets(agents, query) : null;

  const openNow = useRef(false);
  const prepare = useCallback(() => setPrepared(true), []);
  const openSearch = useCallback(() => {
    openNow.current = true;
    setOpen(true);
    setMounted(true);
    setOpeningBlocked(true);
    setSettled(false);
  }, [setOpeningBlocked]);
  useEffect(() => {
    if (!open) return;
    closing.set(0);
    progress.set(
      withTiming(1, OPEN, (finished) => {
        if (finished) scheduleOnRN(setSettled, true);
      }),
    );
  }, [open, progress, closing]);
  const finishClose = useCallback(() => {
    if (openNow.current) return;
    setMounted(false);
    setPrepared(false);
  }, []);
  const closeSearch = useCallback(() => {
    openNow.current = false;
    input.current?.blur();
    Keyboard.dismiss();
    setOpen(false);
    setSettled(false);
    setQuery("");
    setTarget(null);
    draft.current = "";
    setOpeningBlocked(false);
    closing.set(1);
    progress.set(
      withTiming(0, CLOSE, (finished) => {
        if (finished) scheduleOnRN(finishClose);
      }),
    );
  }, [progress, closing, setOpeningBlocked, finishClose]);
  const chooseTarget = useCallback((agent: MobileAgent, text?: SetStateAction<string>) => {
    void haptics.selection();
    setTarget(agent);
    setQuery(text ?? draft.current);
    draft.current = "";
    input.current?.focus();
  }, []);
  const clearTarget = useCallback(() => {
    setQuery((current) => {
      draft.current = current;
      return "@";
    });
    setTarget(null);
    input.current?.focus();
  }, []);
  const fillTask = useCallback((text: string) => {
    void haptics.selection();
    setQuery(text);
    input.current?.focus();
  }, []);
  const startTask = useCallback(
    (agent: MobileAgent, text: string) => {
      const task = text.trim();
      if (!task || sending) return;
      setSending(true);
      const attempt = taskStartId(agent.serverId, agent.id, task);
      workspace()
        .startAgentTask({ agentId: agent.id, text: task, clientMessageId: attempt.id }, agent.serverId)
        .then(
          () => {
            void haptics.notification("success");
            closeSearch();
            setResult({ id: Date.now(), agent, text: task, ok: true });
          },
          (error: unknown) => {
            attempt.failed();
            reportMobileNotification(error, "agent", "banner");
            void haptics.notification("error");
            closeSearch();
            setResult({ id: Date.now(), agent, text: task, ok: false });
          },
        )
        .finally(() => setSending(false));
    },
    [workspace, sending, closeSearch],
  );
  const submit = useCallback(() => {
    if (targetMatches) {
      const first = targetMatches[0];
      if (first) chooseTarget(first);
      return;
    }
    if (target) startTask(target, query);
  }, [targetMatches, target, query, chooseTarget, startTask]);

  useEffect(() => () => setOpeningBlocked(false), [setOpeningBlocked]);
  const finishResult = useCallback(
    (ended: TaskStartResult, reopen: boolean) => {
      setResult((current) => (current?.id === ended.id ? null : current));
      if (ended.ok || ended.agent.serverId !== serverId) return;
      setTarget(ended.agent);
      setQuery(ended.text);
      if (reopen) {
        openSearch();
        input.current?.focus();
      }
    },
    [openSearch, serverId],
  );
  const dismissResult = useCallback(() => {
    if (result) finishResult(result, true);
  }, [result, finishResult]);
  useEffect(() => {
    if (!result) return;
    const { t } = currentText();
    AccessibilityInfo.announceForAccessibility(
      result.ok
        ? t("mobile.search.thread.startedBy", { name: result.agent.name })
        : t("mobile.search.thread.failedFor", { name: result.agent.name }),
    );
    const timer = setTimeout(() => finishResult(result, false), RESULT_DURATION);
    return () => clearTimeout(timer);
  }, [result, finishResult]);
  useEffect(() => {
    if (serverId) setTarget(null);
  }, [serverId]);
  useFocusEffect(
    useCallback(() => {
      if (!open) return;
      const back = BackHandler.addEventListener("hardwareBackPress", () => {
        closeSearch();
        return true;
      });
      return () => back.remove();
    }, [open, closeSearch]),
  );

  return {
    open,
    mounted,
    prepared,
    settled,
    query,
    setQuery,
    prepare,
    openSearch,
    closeSearch,
    leave: closeSearch,
    input,
    progress,
    closing,
    canUseTasks,
    target,
    chooseTarget,
    clearTarget,
    fillTask,
    targetMatches,
    startTask,
    submit,
    sending,
    result,
    dismissResult,
  };
}

const RESULTS_TOP_GAP = 8;

export function HomeSearchList({
  search,
  barHeight,
  children,
}: PropsWithChildren<{
  search: HomeSearch;
  barHeight: number;
}>) {
  const reduced = useReducedMotion();
  const { progress, closing } = search;
  const style = useAnimatedStyle(() => {
    const value = progress.get();
    const leaving = closing.get() === 1;
    return {
      opacity: interpolate(value, [0, leaving ? 0.7 : 0.5], [1, 0], Extrapolation.CLAMP),
      transform: reduced
        ? []
        : [{ translateY: leaving ? 0 : -value * barHeight }, { scale: interpolate(value, [0, 1], [1, 0.98]) }],
    };
  });
  return (
    <Animated.View className="flex-1" style={search.mounted && !search.settled ? style : undefined}>
      {children}
    </Animated.View>
  );
}

export function HomeSearchResults({ search, barHeight }: { search: HomeSearch; barHeight: number }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { progress, closing } = search;
  const style = useAnimatedStyle(() => {
    const value = progress.get();
    const leaving = closing.get() === 1;
    return {
      opacity: interpolate(value, leaving ? [0.15, 0.9] : [0, 0.6], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: reduced ? 0 : (1 - value) * (leaving ? 12 : barHeight) }],
    };
  });
  if (!search.mounted && !search.prepared) return null;
  return (
    <Animated.View
      className="absolute inset-0 bg-background"
      pointerEvents={search.open ? "auto" : "none"}
      accessibilityElementsHidden={!search.open}
      importantForAccessibility={search.open ? "auto" : "no-hide-descendants"}
      style={search.settled ? undefined : style}
    >
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingTop: insets.top + RESULTS_TOP_GAP,
          paddingBottom: HOME_SEARCH_HEIGHT + Math.max(insets.bottom, 12) + 24,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
        mode="insets"
        bottomOffset={HOME_SEARCH_HEIGHT + KEYBOARD_GAP}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HomeSearchBody search={search} />
      </KeyboardAwareScrollView>
      <SheetScrollEdgeEffect style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top }} />
    </Animated.View>
  );
}

function trimmedQuery(query: string) {
  return query.trim();
}

function HomeSearchBody({ search }: { search: HomeSearch }) {
  const { t } = useText();
  const motion = useTransitionMode("searchTransitions");
  const text = search.query.trim();
  const { target, targetMatches, chooseTarget } = search;
  const chooseWithText = useCallback((agent: MobileAgent) => chooseTarget(agent, trimmedQuery), [chooseTarget]);
  const agents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const idle = <HomeSearchIdle onLeave={search.leave} canUseTasks={search.canUseTasks} />;
  return (
    <BlurSwap swapKey={targetMatches ? "targets" : "search"} mode={motion}>
      {targetMatches ? (
        <View className="pb-2">
          <SearchCaption label={t("mobile.search.thread.giveTo")} />
          {targetMatches.length > 0 ? (
            targetMatches.map((agent) => (
              <TaskTargetRow key={agent.id} agent={agent} onPress={() => search.chooseTarget(agent)} />
            ))
          ) : (
            <SearchHint text={t("mobile.search.thread.noAgent")} />
          )}
        </View>
      ) : (
        <>
          {target ? <TaskEditorPage agent={target} search={search} /> : null}
          {!target && text && search.canUseTasks && agents.length > 0 ? (
            <>
              <SearchCaption label={t("mobile.search.thread.newTextFor", { text })} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerClassName="gap-3.5 px-5 pt-1 pb-1.5"
              >
                {agents.map((agent) => (
                  <AgentChip key={agent.id} agent={agent} onPress={chooseWithText} />
                ))}
              </ScrollView>
            </>
          ) : null}
          {!target && text && search.canUseTasks ? <SearchTasks query={text} onLeave={search.leave} /> : null}
          {target ? null : (
            <MobileSearchResults query={search.query} active={search.open} idle={idle} onLeave={search.leave} />
          )}
        </>
      )}
    </BlurSwap>
  );
}

function SearchHint({ text }: { text: string }) {
  return (
    <Typography.Paragraph className="px-5 py-4 text-muted" style={typeScale.preview}>
      {text}
    </Typography.Paragraph>
  );
}

function TaskTargetRow({ agent, onPress }: { agent: MobileAgent; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={agent.name}
      className="flex-row items-center gap-3 px-5 py-2.5"
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
      onPress={onPress}
    >
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        color={agent.avatarColor}
        seed={agent.avatarSeed}
        size={36}
        animateIdle={false}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Typography.Paragraph className="font-medium" numberOfLines={1} style={typeScale.body}>
          {agent.name}
        </Typography.Paragraph>
        {agent.title.trim() ? (
          <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>
            {agent.title.trim()}
          </Typography.Paragraph>
        ) : null}
      </View>
    </Pressable>
  );
}

export function HomeSearchBar({ search }: { search: HomeSearch }) {
  const { t } = useText();
  const { input } = search;
  const touched = useRef(false);
  const navigation = useNavigation();
  useEffect(() => {
    let removeFocusListener: (() => void) | null = null;
    const focusField = () => {
      touched.current = false;
      input.current?.focus();
    };
    setHomeSearchOpener(() => {
      removeFocusListener?.();
      removeFocusListener = null;
      if (navigation.isFocused()) {
        focusField();
        return;
      }
      const remove = navigation.addListener("focus", () => {
        remove();
        removeFocusListener = null;
        focusField();
      });
      removeFocusListener = remove;
    });
    return () => {
      removeFocusListener?.();
      setHomeSearchOpener(null);
    };
  }, [input, navigation]);
  const insets = useSafeAreaInsets();
  const liquidGlass = useLiquidGlass();
  const reduced = useReducedMotion();
  const [foreground, muted, fieldBackground, background] = useThemeColor([
    "foreground",
    "muted",
    "default",
    "background",
  ]);
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const [shownResult, setShownResult] = useState(search.result);
  if (search.result && search.result !== shownResult) setShownResult(search.result);
  const showsResult = search.result !== null;
  const resultColor = shownResult?.ok
    ? avatarHeadColor(shownResult.agent.avatarSeed, shownResult.agent.avatarHue, shownResult.agent.avatarColor)
    : danger;
  const resultTint = `${resultColor}2e`;
  const { height: fieldHeight, bottomGap } = useBottomFieldMetrics();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, Math.abs(keyboardHeight.get()) - (bottomGap - KEYBOARD_GAP)) }],
  }));
  const layout = reduced ? undefined : FIELD_LAYOUT;
  const enter = reduced ? undefined : closeButtonEnter;
  const exit = reduced ? undefined : closeButtonExit;
  const { target } = search;
  const prepareFromTouch = () => {
    if (search.open) return;
    touched.current = true;
    search.prepare();
  };
  const openFromFocus = () => {
    if (search.open) return;
    if (touched.current) void haptics.impact("soft");
    touched.current = false;
    search.openSearch();
  };
  const canSend = Boolean(target && search.query.trim()) && !search.sending;
  const placeholder = target
    ? t("mobile.search.thread.placeholder")
    : search.canUseTasks
      ? t("mobile.search.placeholder")
      : t("common.search");

  return (
    <Animated.View
      className="absolute flex-row items-center gap-2"
      pointerEvents="box-none"
      style={[{ bottom: bottomGap, left: insets.left + 16, right: insets.right + 16 }, barStyle]}
    >
      {search.mounted ? (
        <Animated.View
          entering={reduced ? undefined : closeButtonGrow}
          pointerEvents={search.open ? "auto" : "none"}
          accessibilityElementsHidden={!search.open}
          importantForAccessibility={search.open ? "auto" : "no-hide-descendants"}
          style={search.open ? undefined : { position: "absolute", left: 0, zIndex: 1 }}
        >
          <Animated.View
            style={{
              opacity: search.open || liquidGlass ? 1 : 0,
              transform: [{ scale: search.open || reduced ? 1 : 0.9 }],
              transitionProperty: ["opacity", "transform"],
              transitionDuration: CLOSE.duration,
              transitionTimingFunction: CSS_EASE_SMOOTH,
            }}
          >
            <GlassCapsule
              liquidGlass={liquidGlass}
              fallbackBackground={fieldBackground}
              width={fieldHeight}
              height={fieldHeight}
              animateGlass
              glassHidden={!search.open}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.search.close")}
                className="flex-1 items-center justify-center"
                hitSlop={4}
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
                onPress={() => {
                  void haptics.impact("soft");
                  search.closeSearch();
                }}
              >
                <Animated.View
                  style={{
                    opacity: search.open ? 1 : 0,
                    transitionProperty: "opacity",
                    transitionDuration: 240,
                    transitionTimingFunction: CSS_EASE_SMOOTH,
                  }}
                >
                  <ChevronDown color={String(foreground)} size={22} strokeWidth={2.2} />
                </Animated.View>
              </Pressable>
            </GlassCapsule>
          </Animated.View>
        </Animated.View>
      ) : null}
      <Animated.View className="min-w-0 flex-1" layout={layout}>
        <GlassCapsule
          height={fieldHeight}
          liquidGlass={liquidGlass}
          fallbackBackground={fieldBackground}
          tint={resultTint}
          tintShown={showsResult}
        >
          <Animated.View
            className="flex-1"
            pointerEvents={showsResult ? "none" : "auto"}
            accessibilityElementsHidden={showsResult}
            importantForAccessibility={showsResult ? "no-hide-descendants" : "auto"}
            style={{
              opacity: showsResult ? 0 : 1,
              transitionProperty: "opacity",
              transitionDuration: showsResult ? RESULT_OUT : RESULT_IN,
              transitionDelay: showsResult ? 0 : RESULT_STAGGER,
              transitionTimingFunction: CSS_EASE_SMOOTH,
            }}
          >
            <Pressable
              accessible={false}
              className="flex-1 flex-row items-center gap-2 pr-2 pl-4"
              onPressIn={prepareFromTouch}
              onPress={() => search.input.current?.focus()}
            >
              {target ? (
                <Animated.View entering={enter} exiting={exit} layout={layout}>
                  <TargetChip agent={target} onPress={search.clearTarget} />
                </Animated.View>
              ) : (
                <Search color={String(muted)} size={18} strokeWidth={2} />
              )}
              <TextInput
                ref={search.input}
                accessibilityLabel={target ? t("mobile.search.thread.fieldLabel", { name: target.name }) : placeholder}
                autoCapitalize={target ? "sentences" : "none"}
                autoCorrect={Boolean(target)}
                className="h-10 min-w-0 flex-1 font-sans text-foreground"
                placeholder={placeholder}
                placeholderTextColor={muted}
                returnKeyType={target ? "send" : "search"}
                submitBehavior="submit"
                {...selectionColorProps(foreground)}
                style={{
                  fontSize: 16,
                  lineHeight: 20,
                  paddingBottom: 0,
                  paddingTop: 0,
                  textAlignVertical: "center",
                  ...fieldDirectionStyle(search.query),
                }}
                value={search.query}
                onChangeText={search.setQuery}
                onSubmitEditing={search.submit}
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === "Backspace" && !search.query && target) search.clearTarget();
                }}
                onPressIn={prepareFromTouch}
                onFocus={openFromFocus}
              />
              {search.query && !target ? (
                <Animated.View entering={enter} exiting={exit}>
                  <Pressable
                    accessibilityLabel={t("mobile.search.clear")}
                    accessibilityRole="button"
                    className="size-9 items-center justify-center"
                    hitSlop={6}
                    onPress={() => {
                      void haptics.selection();
                      search.setQuery("");
                    }}
                  >
                    <CircleX color={String(background)} fill={String(muted)} size={20} strokeWidth={2} />
                  </Pressable>
                </Animated.View>
              ) : null}
              {target ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.search.thread.send")}
                  accessibilityState={{ disabled: !canSend, busy: search.sending }}
                  className="size-9 items-center justify-center rounded-full"
                  hitSlop={4}
                  style={{
                    backgroundColor: String(foreground),
                    opacity: canSend || search.sending ? 1 : 0.35,
                  }}
                  onPress={() => {
                    if (canSend) search.submit();
                    else search.input.current?.focus();
                  }}
                >
                  {search.sending ? (
                    <Spinner size="sm" color={String(background)} />
                  ) : (
                    <ArrowUp color={String(background)} size={18} strokeWidth={2.2} />
                  )}
                </Pressable>
              ) : null}
            </Pressable>
          </Animated.View>
          <Animated.View
            className="absolute inset-0"
            pointerEvents={showsResult ? "auto" : "none"}
            accessibilityElementsHidden={!showsResult}
            importantForAccessibility={showsResult ? "auto" : "no-hide-descendants"}
            style={{
              opacity: showsResult ? 1 : 0,
              transform: [{ scale: showsResult || reduced ? 1 : 0.97 }],
              transitionProperty: ["opacity", "transform"],
              transitionDuration: showsResult ? RESULT_IN : RESULT_OUT,
              transitionDelay: showsResult ? RESULT_STAGGER : 0,
              transitionTimingFunction: CSS_EASE_SMOOTH,
            }}
          >
            {shownResult ? (
              <TaskResultContent
                result={shownResult}
                color={resultColor}
                onPress={() => {
                  touched.current = false;
                  search.dismissResult();
                }}
              />
            ) : null}
          </Animated.View>
        </GlassCapsule>
      </Animated.View>
    </Animated.View>
  );
}

function TaskResultContent({
  result,
  color,
  onPress,
}: {
  result: TaskStartResult;
  color: string;
  onPress: () => void;
}) {
  const { t } = useText();
  const { agent, ok } = result;
  const label = ok
    ? t("mobile.search.thread.startedBy", { name: agent.name })
    : t("mobile.search.thread.failedFor", { name: agent.name });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={ok ? undefined : t("mobile.search.thread.tryAgain")}
      className="flex-1 flex-row items-center gap-2.5 pr-4 pl-3"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        color={agent.avatarColor}
        seed={agent.avatarSeed}
        size={26}
        animateIdle={false}
      />
      <Typography.Paragraph
        className="min-w-0 flex-1 font-semibold"
        numberOfLines={1}
        style={[typeScale.body, { color }]}
      >
        {label}
      </Typography.Paragraph>
      {ok ? (
        <Check color={color} size={18} strokeWidth={2.4} />
      ) : (
        <Typography.Paragraph className="font-medium" style={[typeScale.caption, { color, opacity: 0.8 }]}>
          {t("mobile.search.thread.tryAgain")}
        </Typography.Paragraph>
      )}
    </Pressable>
  );
}

const TARGET_NAME_WIDTH = 80;

function TargetChip({ agent, onPress }: { agent: MobileAgent; onPress: () => void }) {
  const { t } = useText();
  const color = avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.search.thread.changeAgent")}
      className="-ml-2.5 h-10 flex-row items-center gap-1 rounded-full pr-2.5 pl-1"
      style={{ backgroundColor: `${color}2e` }}
      onPress={onPress}
    >
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        color={agent.avatarColor}
        seed={agent.avatarSeed}
        size={28}
        animateIdle={false}
      />
      <Typography.Paragraph
        className="font-semibold"
        numberOfLines={1}
        style={[typeScale.preview, { color, maxWidth: TARGET_NAME_WIDTH }]}
      >
        {agent.name}
      </Typography.Paragraph>
    </Pressable>
  );
}

interface Shortcut {
  id: string;
  label: string;
  icon: LucideIcon;
  href: Href;
}

function HomeSearchIdle({ onLeave, canUseTasks }: { onLeave: () => void; canUseTasks: boolean }) {
  const { t } = useText();
  const pane = useChatListPane();
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const hasServer = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === current.activeServer.id),
  );
  const agents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const hasHiddenChats = useMobileWorkspaceSelector((current) => current.hiddenAgents.length > 0);
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      ...(hasServer && canUseTasks
        ? [
            {
              id: "tasks",
              label: t("mobile.app.route.threads"),
              icon: ListChecks,
              href: { pathname: "/server-tasks", params: { serverId } } as const,
            },
          ]
        : []),
      ...(hasServer
        ? [
            {
              id: "routines",
              label: t("mobile.app.route.schedule"),
              icon: CalendarClock,
              href: { pathname: "/server-routines", params: { serverId } } as const,
            },
            {
              id: "usage",
              label: t("mobile.app.route.usage"),
              icon: ChartArea,
              href: { pathname: "/server-usage", params: { serverId } } as const,
            },
            {
              id: "members",
              label: t("mobile.app.route.members"),
              icon: UsersRound,
              href: { pathname: "/server-settings/members", params: { serverId } } as const,
            },
            {
              id: "server",
              label: t("mobile.server.drawer.serverSettings"),
              icon: SlidersHorizontal,
              href: { pathname: "/server-settings", params: { serverId } } as const,
            },
            { id: "add-agent", label: t("mobile.agent.home.addAgent"), icon: Plus, href: "/add-agent" as const },
          ]
        : []),
      ...(hasHiddenChats
        ? [{ id: "hidden", label: t("mobile.agent.hidden.title"), icon: EyeOff, href: "/hidden-chats" as const }]
        : []),
      { id: "settings", label: t("mobile.app.route.settings"), icon: Settings, href: "/settings" as const },
    ],
    [t, hasServer, hasHiddenChats, serverId, canUseTasks],
  );
  const openChat = useCallback(
    (agent: MobileAgent) => {
      onLeave();
      openSearchedChat(pane, agent);
    },
    [onLeave, pane],
  );
  return (
    <View className="pb-2">
      {canUseTasks ? <SearchTasks onLeave={onLeave} /> : null}
      <SearchCaption label={t("mobile.search.goTo")} />
      <View className="flex-row flex-wrap gap-2 px-4 pt-1.5">
        {shortcuts.map((shortcut) => (
          <ShortcutChip
            key={shortcut.id}
            shortcut={shortcut}
            onPress={() => {
              onLeave();
              router.push(shortcut.href);
            }}
          />
        ))}
      </View>
      {agents.length > 0 ? (
        <>
          <SearchCaption label={t("mobile.search.filter.agents")} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="gap-3.5 px-5 pt-1 pb-1.5"
          >
            {agents.map((agent) => (
              <AgentChip key={agent.id} agent={agent} onPress={openChat} />
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

const IDEA_LIMIT = 4;
const NAME_MARK = "\u2063";

function TaskEditorPage({ agent, search }: { agent: MobileAgent; search: HomeSearch }) {
  const { t } = useText();
  const pane = useChatListPane();
  const muted = String(useThemeColor("muted"));
  const color = avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor);
  const { tasks } = useServerTasks(agent.serverId, { agentId: agent.id });
  const sorted = newestFirst(tasks);
  const ideas = [...new Set(sorted.filter((task) => !isAgentTaskOpen(task)).map((task) => task.title.trim()))]
    .filter(Boolean)
    .slice(0, IDEA_LIMIT);
  const open = sorted.filter((task) => task.state === "running" || taskNeedsYou(task));
  const [before = "", after = ""] = t("mobile.search.thread.newFor", { name: NAME_MARK }).split(NAME_MARK);
  const message = () => {
    search.leave();
    openSearchedChat(pane, agent);
  };
  return (
    <View className="pb-2">
      <View className="gap-2.5 px-5 pt-1">
        <View className="flex-row items-center gap-2">
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            color={agent.avatarColor}
            seed={agent.avatarSeed}
            size={40}
            animateIdle={false}
          />
          <Typography.Paragraph
            accessibilityRole="header"
            className="min-w-0 flex-1 font-semibold"
            numberOfLines={2}
            style={typeScale.taskHeading}
          >
            {before}
            <Typography.Paragraph className="font-bold" style={typeScale.taskHeading}>
              {agent.name}
            </Typography.Paragraph>
            {after}
          </Typography.Paragraph>
        </View>
        <View className="flex-row items-start gap-2">
          <View className="pt-0.5">
            <ListChecks color={muted} size={16} strokeWidth={1.8} />
          </View>
          <Typography.Paragraph className="min-w-0 flex-1 text-muted" style={typeScale.caption}>
            {t("mobile.search.thread.how", { name: agent.name })}{" "}
            <Typography.Paragraph
              accessibilityRole="link"
              className="font-medium"
              style={[typeScale.caption, { color }]}
              onPress={message}
            >
              {t("mobile.search.thread.message", { name: agent.name })}
            </Typography.Paragraph>
          </Typography.Paragraph>
        </View>
      </View>
      {ideas.length > 0 ? (
        <View className="pt-1.5">
          <SearchCaption label={t("mobile.search.thread.ideas")} />
          {ideas.map((idea) => (
            <Pressable
              key={idea}
              accessibilityRole="button"
              accessibilityHint={t("mobile.search.thread.ideaHint")}
              className="flex-row items-center gap-3 px-5 py-[9px]"
              style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
              onPress={() => search.fillTask(idea)}
            >
              <ListRestart color={muted} size={18} strokeWidth={1.8} />
              <Typography.Paragraph className="min-w-0 flex-1" numberOfLines={1} style={typeScale.body}>
                {idea}
              </Typography.Paragraph>
              <Typography.Paragraph className="text-muted" style={typeScale.small}>
                {t("mobile.search.thread.again")}
              </Typography.Paragraph>
            </Pressable>
          ))}
        </View>
      ) : null}
      {open.length > 0 ? (
        <View className="pt-1.5">
          <SearchCaption label={t("mobile.search.thread.openWith", { name: agent.name })} />
          {open.map((task) => (
            <TaskListRow
              key={task.id}
              task={task}
              onPress={() => {
                search.leave();
                router.push({
                  pathname: "/task/[taskId]",
                  params: { serverId: agent.serverId, agentId: agent.id, taskId: task.id },
                });
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const SEARCH_TASK_LIMIT = 5;

function newestFirst<Task extends { updatedAt: string }>(tasks: readonly Task[]): Task[] {
  return tasks
    .map((task) => ({ task, updated: Date.parse(task.updatedAt) }))
    .sort((a, b) => b.updated - a.updated)
    .map(({ task }) => task);
}

function SearchTasks({ query, onLeave }: { query?: string; onLeave: () => void }) {
  const { t } = useText();
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const { agents, tasks } = useServerTasks(serverId);
  const needle = query?.toLocaleLowerCase();
  const shown = newestFirst(
    tasks.filter((task) =>
      needle ? task.title.toLocaleLowerCase().includes(needle) : isAgentTaskOpen(task) && taskNeedsYou(task),
    ),
  ).slice(0, SEARCH_TASK_LIMIT);
  if (shown.length === 0) return null;
  return (
    <View>
      <SearchCaption label={t(needle ? "mobile.app.route.threads" : "mobile.server.threads.section.needsYou")} />
      {shown.map((task) => (
        <TaskListRow
          key={task.id}
          task={task}
          agent={agents.find((agent) => agent.id === task.agentId)}
          dimmed={!isAgentTaskOpen(task)}
          onPress={() => {
            onLeave();
            router.push({
              pathname: "/task/[taskId]",
              params: { serverId, agentId: task.agentId, taskId: task.id },
            });
          }}
        />
      ))}
    </View>
  );
}

function ShortcutChip({ shortcut, onPress }: { shortcut: Shortcut; onPress: () => void }) {
  const secondary = String(useThemeColor("muted"));
  const Icon = shortcut.icon;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      {({ pressed }) => (
        <Animated.View
          className="h-9 flex-row items-center gap-1.5 rounded-full bg-control px-3.5"
          style={[{ transform: [{ scale: pressed ? 0.97 : 1 }] }, PRESS_SCALE]}
        >
          <Icon color={secondary} size={16} strokeWidth={1.9} />
          <Typography.Paragraph className="font-medium" style={typeScale.preview}>
            {shortcut.label}
          </Typography.Paragraph>
        </Animated.View>
      )}
    </Pressable>
  );
}

const AgentChip = memo(function AgentChip({
  agent,
  onPress,
}: {
  agent: MobileAgent;
  onPress: (agent: MobileAgent) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={agent.name}
      onPress={() => {
        void haptics.impact("soft");
        onPress(agent);
      }}
    >
      {({ pressed }) => (
        <Animated.View
          className="w-15 items-center gap-2"
          style={[{ transform: [{ scale: pressed ? 0.96 : 1 }] }, PRESS_SCALE]}
        >
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            color={agent.avatarColor}
            seed={agent.avatarSeed}
            size={48}
            animateIdle={false}
          />
          <Typography.Paragraph
            align="center"
            className="w-full text-text-secondary"
            numberOfLines={1}
            style={typeScale.small}
          >
            {agent.name}
          </Typography.Paragraph>
        </Animated.View>
      )}
    </Pressable>
  );
});
