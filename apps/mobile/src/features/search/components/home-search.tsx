import { isAgentTaskOpen, taskNeedsYou } from "@openbot/team-client/agent-tasks";
import * as Crypto from "expo-crypto";
import { type Href, router, useFocusEffect } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartColumn from "lucide-react-native/icons/chart-column";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import CircleX from "lucide-react-native/icons/circle-x";
import EyeOff from "lucide-react-native/icons/eye-off";
import ListRestart from "lucide-react-native/icons/list-restart";
import Plus from "lucide-react-native/icons/plus";
import Search from "lucide-react-native/icons/search";
import Settings from "lucide-react-native/icons/settings";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import SquareCheck from "lucide-react-native/icons/square-check";
import UsersRound from "lucide-react-native/icons/users-round";
import {
  type ComponentProps,
  type PropsWithChildren,
  type RefObject,
  useCallback,
  useContext,
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
  type ViewInstance,
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
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import type { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { reportMobileNotification } from "@/features/analytics/failure-reports";
import { MobileSearchResults, SearchCaption } from "@/features/search/components/mobile-search-results";
import { setHomeSearchOpener } from "@/features/search/model/home-search-request";
import { useAppDrawerShown } from "@/features/servers/components/app-drawer-activity";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { TaskListRow } from "@/features/servers/components/task-list-row";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { BlurSwap } from "@/shared/components/blur-swap";
import { useBottomFieldMetrics } from "@/shared/components/bottom-field-metrics";
import { ANDROID_BLUR, GLASS_CAPSULE_HEIGHT, GlassCapsule } from "@/shared/components/glass-capsule";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion, useTransitionMode } from "@/shared/lib/motion";
import { selectionColorProps } from "@/shared/lib/selection-color";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

/**
 * Opens an agent chat from the search. In the chat list pane, the chat takes the place of the open
 * one; on home, the chat zooms from its row when the row is on screen.
 */
function openSearchedChat(
  pane: ReturnType<typeof useChatListPane>,
  gate: ReturnType<typeof createChatNavigationGate> | null,
  agentId: string,
): void {
  const open = () => router.push({ pathname: "/chat/[agentId]", params: { agentId } });
  if (pane) openChatFromPane(pane, agentId, open);
  else if (!gate?.openFromHome(agentId)) open();
}

/** The height of the search field at the bottom of home. */
export const HOME_SEARCH_HEIGHT = GLASS_CAPSULE_HEIGHT;
/** The space between the field and the keyboard. */
const KEYBOARD_GAP = 8;
const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
// The iOS sheet curve: it starts softer than the strong ease-out and settles for longer, so the
// layers of the search glide into each other and do not snap.
const EASE_SMOOTH = Easing.bezier(0.32, 0.72, 0, 1);
const CSS_EASE_SMOOTH = cubicBezier(0.32, 0.72, 0, 1);
// The list goes back as the results come in over it. The results come in with the keyboard; they go
// back a little slower, so the list has time to settle.
const OPEN = { duration: 340, easing: EASE_SMOOTH };
const CLOSE = { duration: 360, easing: EASE_SMOOTH };
const FIELD_LAYOUT = LinearTransition.duration(340).easing(EASE_SMOOTH);
/** How long the field shows the result of a task start before it returns. */
const RESULT_DURATION = 2_000;
/** The result and the field cross: the one that leaves goes first and faster. */
const RESULT_IN = 380;
const RESULT_OUT = 280;
const RESULT_STAGGER = 40;
const PRESS_SCALE = {
  transitionProperty: "transform",
  transitionDuration: 120,
  transitionTimingFunction: CSS_EASE_OUT,
} as const;

/**
 * The close button grows a little from the field's edge as it comes in. Glass does not render under
 * a parent with opacity 0, so the glass appears with its own native animation and this wrapper only
 * scales.
 */
const closeButtonGrow: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { transform: [{ scale: 0.9 }] },
    animations: { transform: [{ scale: withTiming(1, OPEN) }] },
  };
};
/** The clear button and the agent chip: no glass, so they fade too. */
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

/** What happened to the last task start. A failure keeps the agent and the text for a new try. */
interface TaskStartResult {
  id: number;
  agent: MobileAgent;
  text: string;
  ok: boolean;
}

export interface HomeSearch {
  open: boolean;
  /** True while the results show or leave. */
  mounted: boolean;
  /** True when a touch on the field mounted the hidden results before the field takes focus. */
  prepared: boolean;
  /** True when the results finished coming in, so they rest with no animated style. */
  settled: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** Mounts the hidden results on touch down, so their first render is done when search opens. */
  prepare: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  /** Closes the search for a result that opens another screen. */
  leave: () => void;
  input: RefObject<TextInputInstance | null>;
  progress: SharedValue<number>;
  /** 1 while the results leave. Opening and closing move differently. */
  closing: SharedValue<number>;
  /** False when the server cannot start tasks: then `@` is plain search text. */
  canUseTasks: boolean;
  /** The agent that the next Return gives the typed text to. */
  target: MobileAgent | null;
  /** Opens the task editor for the agent. `text` fills the field, else the text kept from before. */
  chooseTarget: (agent: MobileAgent, text?: string) => void;
  /** Back to choosing an agent: the field shows `@`, and the task text waits for the next agent. */
  clearTarget: () => void;
  /** Puts a task text in the field, such as an idea. */
  fillTask: (text: string) => void;
  /** The agents that match an `@name` query, or null when the query is not one. */
  targetMatches: MobileAgent[] | null;
  startTask: (agent: MobileAgent, text: string) => void;
  /** Return in the field: chooses the first `@name` match, or starts the task. */
  submit: () => void;
  sending: boolean;
  /** The result of the last task start, which the field shows for a short time. */
  result: TaskStartResult | null;
  /** Ends the result early. After a failure, the task opens again with its agent and text. */
  dismissResult: () => void;
}

/** The agents whose name or title starts with the text after `@`. */
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

/** The state of the search field at the bottom of home and of the results it opens over the list. */
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
  // The task text while the person chooses another agent.
  const draft = useRef("");
  const progress = useSharedValue(0);
  const closing = useSharedValue(0);
  const targetMatches = canUseTasks && !target ? matchTargets(agents, query) : null;

  // `open` at once, for the end of a close animation that comes before the next render.
  const openNow = useRef(false);
  const prepare = useCallback(() => setPrepared(true), []);
  const openSearch = useCallback(() => {
    openNow.current = true;
    setOpen(true);
    setMounted(true);
    // The results take the screen, so a swipe right must not open the drawer under them.
    setOpeningBlocked(true);
    setSettled(false);
  }, [setOpeningBlocked]);
  // The results come in after they mount, not when the field asks: the first render of the results
  // takes time on the JS thread, and an animation that started before it would be nearly over when
  // they show.
  useEffect(() => {
    if (!open) return;
    closing.set(0);
    progress.set(
      withTiming(1, OPEN, (finished) => {
        if (finished) scheduleOnRN(setSettled, true);
      }),
    );
  }, [open, progress, closing]);
  // A reopen can come after the close animation ends and before its callback runs: then the results stay.
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
  const chooseTarget = useCallback((agent: MobileAgent, text?: string) => {
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
      workspace()
        // The agent's own server: the person can change server while the task starts.
        .startAgentTask({ agentId: agent.id, text: task, clientMessageId: Crypto.randomUUID() }, agent.serverId)
        .then(
          () => {
            void haptics.notification("success");
            closeSearch();
            setResult({ id: Date.now(), agent, text: task, ok: true });
          },
          (error: unknown) => {
            // The field says that the task failed, so the failure is reported without an alert.
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
  /** The field returns. After a failure it holds the task again; `reopen` also opens it for editing. */
  const finishResult = useCallback(
    (ended: TaskStartResult, reopen: boolean) => {
      setResult((current) => (current?.id === ended.id ? null : current));
      // A failed task comes back only on its own server: another server has other agents.
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
  // The result goes after a short read. VoiceOver and TalkBack read it when it shows.
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
  // A task names an agent of the open server, so another server starts without one.
  useEffect(() => {
    if (serverId) setTarget(null);
  }, [serverId]);
  // Android Back closes the results before it leaves the app. Only while home has focus: a chat that
  // a notification opens over the search keeps its own Back.
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

/** The room between the status bar and the first result. */
const RESULTS_TOP_GAP = 8;

/**
 * The home list under the search. It goes back and fades as the results come in over it, and comes
 * forward again as they leave, so the results read as a layer in front of the list. The search has
 * no bar, so the list also moves up by the bar's height with the results, as the content of an iOS
 * search does when its bar goes.
 */
export function HomeSearchList({
  search,
  barHeight,
  children,
}: PropsWithChildren<{
  search: HomeSearch;
  /** The height of the home bar under the status bar. */
  barHeight: number;
}>) {
  const reduced = useReducedMotion();
  const { progress, closing } = search;
  const style = useAnimatedStyle(() => {
    const value = progress.get();
    // Opening: the list is gone before the results are fully in, and moves up with the bar.
    // Closing: the list comes forward in place as the results fade over it.
    const leaving = closing.get() === 1;
    return {
      opacity: interpolate(value, [0, leaving ? 0.7 : 0.5], [1, 0], Extrapolation.CLAMP),
      transform: reduced
        ? []
        : [{ translateY: leaving ? 0 : -value * barHeight }, { scale: interpolate(value, [0, 1], [1, 0.98]) }],
    };
  });
  // At rest the list has no animated style: the opaque results cover it while they are open.
  return (
    <Animated.View className="flex-1" style={search.mounted && !search.settled ? style : undefined}>
      {children}
    </Animated.View>
  );
}

/**
 * The results over the home list. The bar hides its buttons while they show, so they start under the
 * status bar, not under the bar. They come in from the bar's height below, where the list content
 * starts, and move up with the list, so the content does not jump when the bar goes.
 */
export function HomeSearchResults({
  search,
  barHeight,
}: {
  search: HomeSearch;
  /** The height of the home bar under the status bar. */
  barHeight: number;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { progress, closing } = search;
  const style = useAnimatedStyle(() => {
    const value = progress.get();
    // Opening: the fade starts at once and ends well before the movement, so the rows are readable
    // while they settle. Closing: the results fade and drop only a little, over the list.
    const leaving = closing.get() === 1;
    return {
      opacity: interpolate(value, leaving ? [0.15, 0.9] : [0, 0.6], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: reduced ? 0 : (1 - value) * (leaving ? 12 : barHeight) }],
    };
  });
  // Prepared results are hidden: the animated opacity is 0 until search opens.
  if (!search.mounted && !search.prepared) return null;
  return (
    <Animated.View
      className="absolute inset-0 bg-background"
      pointerEvents={search.open ? "auto" : "none"}
      accessibilityElementsHidden={!search.open}
      importantForAccessibility={search.open ? "auto" : "no-hide-descendants"}
      // At rest the results have no animated style. A render while the user types then cannot put
      // back the first-render opacity of 0 when the animated value has not reached React.
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
      {/* Results scroll up under the status bar with the edge of the other screens. It ends at the
          status bar, so the first heading is clear of the blur when the list is at the top. */}
      <SheetScrollEdgeEffect style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top }} />
    </Animated.View>
  );
}

/**
 * What the results show: the agents for `@name`, the task that Return starts, the agents that can
 * take the typed text, and the search results of the text.
 */
function HomeSearchBody({ search }: { search: HomeSearch }) {
  const { t } = useText();
  const motion = useTransitionMode("searchTransitions");
  const text = search.query.trim();
  const { target, targetMatches } = search;
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
                  <AgentChip key={agent.id} agent={agent} onPress={() => search.chooseTarget(agent, text)} />
                ))}
              </ScrollView>
            </>
          ) : null}
          {!target && text && search.canUseTasks ? <SearchTasks query={text} onLeave={search.leave} /> : null}
          {/* Text to an agent is a task, not a search. */}
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

/** An agent that an `@name` query matches. */
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

/** The field at the bottom of home. It rides on the keyboard, and a close button comes in beside it. */
export function HomeSearchBar({
  search,
  blurTarget,
}: {
  search: HomeSearch;
  /** Android: the home content that the field blurs. */
  blurTarget?: RefObject<ViewInstance | null>;
}) {
  const { t } = useText();
  const { input } = search;
  // Touch down mounts the hidden results, and focus opens them: a drag that starts on the field
  // does not focus it, so it does not open the search. The ref keeps the soft tap to a search that a
  // touch on the field opens. A drag leaves it set, so each focus that no touch on the field caused
  // clears it first.
  const touched = useRef(false);
  // A quick action of the app icon opens the search with the keyboard. The field registers it, so a
  // request that comes while the list loads waits until the field and its input are mounted.
  useEffect(() => {
    setHomeSearchOpener(() => {
      touched.current = false;
      input.current?.focus();
    });
    return () => setHomeSearchOpener(null);
  }, [input]);
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
  // The last result stays in the field while it fades out, so its text and color do not change then.
  const [shownResult, setShownResult] = useState(search.result);
  if (search.result && search.result !== shownResult) setShownResult(search.result);
  const showsResult = search.result !== null;
  const resultColor = shownResult?.ok
    ? getBloubAvatarColor(shownResult.agent.avatarSeed, shownResult.agent.avatarHue)
    : danger;
  // As the prototype: the color at 18% over the field, so the text in the same color stays readable.
  const resultTint = `${resultColor}2e`;
  const { height: fieldHeight, bottomGap } = useBottomFieldMetrics();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  // The field rises only when the keyboard reaches it, and then stays 8 pt above it. Android can
  // report an open keyboard with no height (a hardware or floating keyboard); the field stays.
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, Math.abs(keyboardHeight.get()) - (bottomGap - KEYBOARD_GAP)) }],
  }));
  const layout = reduced ? undefined : FIELD_LAYOUT;
  const enter = reduced ? undefined : closeButtonEnter;
  const exit = reduced ? undefined : closeButtonExit;
  const homeAtRest = useHomeAtRest();
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
        // While the results leave, the button is out of the layout, so the field grows under it as its
        // glass dissolves. Glass does not render under a parent with opacity below 1, so only the
        // solid capsule fades as a whole.
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
        <HomeFieldCapsule
          height={fieldHeight}
          liquidGlass={liquidGlass}
          fallbackBackground={fieldBackground}
          tint={resultTint}
          tintShown={showsResult}
          blurTarget={blurTarget}
          // The open results lie over the list and are not in the target, so the field is solid then.
          blurPaused={search.open || !homeAtRest}
        >
          {/* The field stays mounted under the result, so "Try again" can focus it at once. The field
              fades out first; the result then fades in from 97% as the tint comes in. */}
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
            {/* The field is shorter than the capsule, so a tap anywhere on the capsule focuses it. */}
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
                }}
                value={search.query}
                onChangeText={search.setQuery}
                onSubmitEditing={search.submit}
                onKeyPress={({ nativeEvent }) => {
                  // Backspace in an empty field removes the agent, as in a mail address field.
                  if (nativeEvent.key === "Backspace" && !search.query && target) search.clearTarget();
                }}
                // The results mount on touch down: the field takes focus, and the keyboard starts, only
                // when the finger lifts.
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
              {/* Search updates as you type; only a task has a send button. */}
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
          {/* Mounted before the first result, so the result comes in with a transition. */}
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
                  // The result has its own tap; "Try again" then focuses the field.
                  touched.current = false;
                  search.dismissResult();
                }}
              />
            ) : null}
          </Animated.View>
        </HomeFieldCapsule>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The result of a task start in the field: the agent, what happened, and a check, or "Try again"
 * after a failure. A tap ends it early; after a failure it opens the task again.
 */
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

/** The widest name in the agent chip of the search field. */
const TARGET_NAME_WIDTH = 80;

/**
 * The agent that gets the task: its avatar and name in its own color. A tap chooses another agent,
 * as Backspace in the empty field does; it has no remove mark, so the text field keeps the width.
 */
function TargetChip({ agent, onPress }: { agent: MobileAgent; onPress: () => void }) {
  const { t } = useText();
  const color = getBloubAvatarColor(agent.avatarSeed, agent.avatarHue);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.search.thread.changeAgent")}
      className="-ml-2.5 h-10 flex-row items-center gap-1 rounded-full pr-2.5 pl-1"
      // 40 pt in the 52 pt field: the same 6 pt inset above, below and at the left edge.
      // The agent color at 18% opacity, so the avatar in the same color stays visible on it.
      style={{ backgroundColor: `${color}2e` }}
      onPress={onPress}
    >
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={28}
        animateIdle={false}
      />
      {/* A long name ends in an ellipsis, so the text field keeps most of the width. */}
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

/**
 * Android: whether home shows with no screen over it and no push or pop in progress. The field's
 * blur blurs the whole home list again on each frame that the list changes, so it stops from the
 * moment home loses focus. It starts again when home has focus and its return animation has ended.
 * A sheet over home does not hide home, so its close gives focus with no animation to wait for.
 */
function useHomeAtRest(): boolean {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [atRest, setAtRest] = useState(true);
  useEffect(() => {
    if (!ANDROID_BLUR) return;
    // A screen that slid over home hid it; home then comes back with its own animation.
    let hidden = false;
    const listeners = [
      navigation.addListener("blur", () => setAtRest(false)),
      navigation.addListener("focus", () => {
        if (!hidden) setAtRest(true);
      }),
      navigation.addListener("transitionStart", () => setAtRest(false)),
      navigation.addListener("transitionEnd", (event) => {
        if (event.data.closing) {
          hidden = !navigation.isFocused();
          return;
        }
        hidden = false;
        if (navigation.isFocused()) setAtRest(true);
      }),
    ];
    return () => {
      for (const remove of listeners) remove();
    };
  }, [navigation]);
  return atRest;
}

/**
 * The capsule of the home field. It shows the solid glass while the drawer is open or moves: the
 * scrim covers home then, and the Android blur would blur the whole home list again on each frame of
 * the motion. Only the capsule reads the drawer state, so the field itself does not render again.
 */
function HomeFieldCapsule({ blurPaused = false, ...props }: ComponentProps<typeof GlassCapsule>) {
  const drawerShown = useAppDrawerShown();
  return <GlassCapsule {...props} blurPaused={blurPaused || drawerShown} />;
}

interface Shortcut {
  id: string;
  label: string;
  icon: LucideIcon;
  href: Href;
}

/** Before the user types: the pages to go to, and the agents of the server. */
function HomeSearchIdle({ onLeave, canUseTasks }: { onLeave: () => void; canUseTasks: boolean }) {
  const { t } = useText();
  const gate = useContext(ChatNavigationGateContext);
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
              icon: SquareCheck,
              href: { pathname: "/server-tasks", params: { serverId } } as const,
            },
          ]
        : []),
      ...(hasServer
        ? [
            {
              id: "routines",
              label: t("mobile.app.route.routines"),
              icon: CalendarClock,
              href: { pathname: "/server-routines", params: { serverId } } as const,
            },
            {
              id: "usage",
              label: t("mobile.app.route.usage"),
              icon: ChartColumn,
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
  const openChat = (agent: MobileAgent) => {
    onLeave();
    openSearchedChat(pane, gate, agent.id);
  };
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
              <AgentChip key={agent.id} agent={agent} onPress={() => openChat(agent)} />
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

/** The most ideas that the task editor shows. */
const IDEA_LIMIT = 4;
/** Marks the place of the agent name in a translated line, so the name can have its own weight. */
const NAME_MARK = "\u2063";

/**
 * The page above the field while it holds a task: no cards. Who gets the task, one line on what a
 * task is with a way to message the agent instead, earlier tasks to run again, and the agent's open
 * tasks. A tap on an idea fills the field.
 */
function TaskEditorPage({ agent, search }: { agent: MobileAgent; search: HomeSearch }) {
  const { t } = useText();
  const gate = useContext(ChatNavigationGateContext);
  const pane = useChatListPane();
  const muted = String(useThemeColor("muted"));
  const color = getBloubAvatarColor(agent.avatarSeed, agent.avatarHue);
  const { tasks } = useServerTasks(agent.serverId, { agentId: agent.id });
  const sorted = [...tasks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const ideas = [...new Set(sorted.filter((task) => !isAgentTaskOpen(task)).map((task) => task.title.trim()))]
    .filter(Boolean)
    .slice(0, IDEA_LIMIT);
  const open = sorted.filter((task) => task.state === "running" || taskNeedsYou(task));
  const [before = "", after = ""] = t("mobile.search.thread.newFor", { name: NAME_MARK }).split(NAME_MARK);
  const message = () => {
    search.leave();
    openSearchedChat(pane, gate, agent.id);
  };
  return (
    // The spacing of the prototype: 4 pt above the page, 8 pt beside the avatar, 10 pt above the line.
    <View className="pb-2">
      <View className="gap-2.5 px-5 pt-1">
        <View className="flex-row items-center gap-2">
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
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
            <SquareCheck color={muted} size={16} strokeWidth={1.8} />
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

/** The most tasks that a search section shows. */
const SEARCH_TASK_LIMIT = 5;

/**
 * Tasks in the search: with a query, the tasks whose title has it; without one, the tasks that
 * need the person. Nothing when no task fits.
 */
function SearchTasks({ query, onLeave }: { query?: string; onLeave: () => void }) {
  const { t } = useText();
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const { agents, tasks } = useServerTasks(serverId);
  const needle = query?.toLocaleLowerCase();
  const shown = tasks
    .filter((task) =>
      needle ? task.title.toLocaleLowerCase().includes(needle) : isAgentTaskOpen(task) && taskNeedsYou(task),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, SEARCH_TASK_LIMIT);
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

function AgentChip({ agent, onPress }: { agent: MobileAgent; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={agent.name}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
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
}
