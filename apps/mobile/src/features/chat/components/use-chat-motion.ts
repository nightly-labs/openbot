import type { AnchoredEndSpaceConfig, LegendListRef } from "@legendapp/list/react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard, type LayoutChangeEvent, type NativeScrollEvent } from "react-native";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { chatContentIsVisible } from "../model/chat-layout";

export const CHAT_ROW_GAP = 10;
const FOCUS_GAP = 12;
const FOCUS_PLACE_ATTEMPTS = 6;
const FOCUS_PLACE_TOLERANCE = 1;

function afterLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
const ANDROID_PLACE_FRAMES = 2;
const ANDROID_PLACE_TIMEOUT_MS = 250;
const OPENING_FOLLOW_MS = 600;

type AnchorReadyInfo = Parameters<NonNullable<AnchoredEndSpaceConfig["onReady"]>>[0];

export function useChatMotion(
  header: number,
  keyboardOffset: number,
  ready: boolean,
  hasRows: boolean,
  lastUserId: string | null,
  requiredInputId: string | null = null,
  holdOpening = false,
  catchingUp = false,
) {
  const listRef = useRef<LegendListRef>(null);
  const reducedMotion = useReducedMotion();
  const keyboardHeight = useSharedValue(0);
  const keyboardProgress = useSharedValue(0);
  const keyboardDismissed = useSharedValue(false);
  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        if (event.height > 0) {
          cancelAnimation(keyboardHeight);
          cancelAnimation(keyboardProgress);
          keyboardDismissed.set(false);
        } else {
          keyboardDismissed.set(true);
          const timing = {
            duration: Math.max(0, event.duration),
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.System,
          };
          keyboardHeight.set(withTiming(0, timing));
          keyboardProgress.set(withTiming(0, timing));
        }
      },
      onMove: (event) => {
        "worklet";
        if (keyboardDismissed.get()) return;
        keyboardHeight.set(event.progress === 0 ? 0 : event.height);
        keyboardProgress.set(event.progress);
      },
      onInteractive: (event) => {
        "worklet";
        if (keyboardDismissed.get()) return;
        keyboardHeight.set(event.progress === 0 ? 0 : event.height);
        keyboardProgress.set(event.progress);
      },
      onEnd: (event) => {
        "worklet";
        if (event.height <= 0 || event.progress === 0) {
          keyboardDismissed.set(true);
          keyboardHeight.set(0);
          keyboardProgress.set(0);
        } else if (!keyboardDismissed.get()) {
          keyboardHeight.set(event.height);
          keyboardProgress.set(event.progress);
        }
      },
    },
    [keyboardHeight, keyboardProgress, keyboardDismissed],
  );
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidHide", () => {
      keyboardDismissed.set(true);
      keyboardHeight.set(0);
      keyboardProgress.set(0);
    });
    return () => subscription.remove();
  }, [keyboardHeight, keyboardProgress, keyboardDismissed]);
  const composerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboardHeight.get() - keyboardOffset) }],
  }));
  const composerHeight = useSharedValue(0);
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const dragging = useSharedValue(false);
  const atEnd = useSharedValue(false);
  const lowestOffset = useSharedValue(0);
  const scrolledUp = useSharedValue(false);
  const firstOffset = useSharedValue(0);
  const firstOpacity = useSharedValue(1);
  const responseOpacity = useSharedValue(1);
  const revealed = useSharedValue(false);
  const [atLatest, setAtLatest] = useState(false);
  const atLatestNow = useRef(false);
  const [userScrolled, setUserScrolled] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [responseVisible, setResponseVisible] = useState(true);
  const pending = useRef<{ baseline: string | null; first: boolean; fromLatest: boolean } | null>(null);
  const followLatest = useRef(true);
  const [keyboardLiftBehavior, setKeyboardLiftBehavior] = useState<"whenAtEnd" | "never">("whenAtEnd");
  const [latestGeneration, setLatestGeneration] = useState(0);
  const lastRequiredInputId = useRef(requiredInputId);
  const requiredInputFrame = useRef<number | null>(null);
  const sendScrollFrame = useRef<number | null>(null);
  const measurements = useRef({ viewport: 0, content: 0, composer: 0 });
  const [placedWithRows, setPlacedWithRows] = useState<boolean | null>(null);
  const listPlaced = !hasRows || placedWithRows === true;
  const shown = useRef(false);
  const [openingFollow, setOpeningFollow] = useState(!holdOpening);
  const [pinnedToLatest, setPinnedToLatest] = useState(false);
  const heldOpening = useRef(holdOpening);
  const current = useRef({ lastUserId });
  current.current = { lastUserId };

  const finishFirstMessage = useCallback(() => setResponseVisible(true), []);
  const updateAtLatest = useCallback((visible: boolean) => {
    atLatestNow.current = visible;
    setAtLatest(visible);
  }, []);
  const reveal = useCallback(() => {
    if (shown.current) return;
    shown.current = true;
    revealed.set(true);
    setHistoryVisible(true);
  }, [revealed]);
  const onListReady = useCallback((withRows: boolean) => setPlacedWithRows(withRows), []);

  useLayoutEffect(() => {
    if (holdOpening) heldOpening.current = true;
    if (shown.current || !listPlaced || !ready || holdOpening) return;
    const held = heldOpening.current;
    heldOpening.current = false;
    if (held) void (listRef.current?.scrollToEnd({ animated: false }) ?? Promise.resolve()).then(reveal, reveal);
    else reveal();
  }, [listPlaced, ready, holdOpening, reveal]);
  useEffect(() => {
    if (!isAndroid || shown.current || !hasRows || placedWithRows === true || !ready || holdOpening) return;
    const started = Date.now();
    let measuredFrames = 0;
    let frame = requestAnimationFrame(function place() {
      const list = listRef.current;
      const state = list?.getState();
      const last = state ? state.data.length - 1 : -1;
      if (state && last >= 0 && state.sizeAtIndex(last) > 0) measuredFrames += 1;
      if (list && (measuredFrames > ANDROID_PLACE_FRAMES || Date.now() - started >= ANDROID_PLACE_TIMEOUT_MS)) {
        void list.scrollToEnd({ animated: false }).then(() => setPlacedWithRows(true));
        return;
      }
      frame = requestAnimationFrame(place);
    });
    return () => cancelAnimationFrame(frame);
  }, [hasRows, placedWithRows, ready, holdOpening]);
  useEffect(() => {
    if (!openingFollow || !ready || catchingUp) return;
    const timer = setTimeout(() => setOpeningFollow(false), OPENING_FOLLOW_MS);
    return () => clearTimeout(timer);
  }, [openingFollow, ready, catchingUp]);
  useLayoutEffect(() => {
    if (requiredInputId !== lastRequiredInputId.current && requiredInputId && followLatest.current && shown.current) {
      if (requiredInputFrame.current !== null) cancelAnimationFrame(requiredInputFrame.current);
      requiredInputFrame.current = requestAnimationFrame(() => {
        requiredInputFrame.current = null;
        if (followLatest.current) void listRef.current?.scrollToEnd({ animated: !reducedMotion });
      });
    }
    lastRequiredInputId.current = requiredInputId;
  }, [requiredInputId, reducedMotion]);
  useEffect(
    () => () => {
      if (requiredInputFrame.current !== null) cancelAnimationFrame(requiredInputFrame.current);
      if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
    },
    [],
  );

  const onViewportLayout = useCallback(
    (event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      measurements.current.viewport = event.nativeEvent.layout.height;
      viewport.set(event.nativeEvent.layout.height);
    },
    [viewport],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      measurements.current.content = height;
      content.set(height);
    },
    [content],
  );
  const onComposerLayout = useCallback(
    (event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      const height = event.nativeEvent.layout.height + 20;
      measurements.current.composer = height;
      composerHeight.set(height);
    },
    [composerHeight],
  );
  const onAnchorReady = useCallback(
    (info: AnchorReadyInfo, anchorMaxSize?: number) => {
      const send = pending.current;
      const list = listRef.current;
      if (!send || !list || info.anchorKey === undefined || info.anchorKey === send.baseline) return;
      pending.current = null;
      reveal();
      const animated = !send.first && send.fromLatest && !reducedMotion;
      if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
      if (animated) {
        sendScrollFrame.current = requestAnimationFrame(() => {
          sendScrollFrame.current = requestAnimationFrame(() => {
            sendScrollFrame.current = null;
            void listRef.current?.scrollToEnd({ animated: true });
          });
        });
      } else {
        sendScrollFrame.current = null;
        void list.scrollToEnd({ animated: false });
      }
      if (!send.first || info.anchorIndex === undefined) return;
      const m = measurements.current;
      const lift = Math.max(0, keyboardHeight.get() - keyboardOffset);
      const rowHeight = list.getState().sizeAtIndex(info.anchorIndex);
      const userHeight = Math.max(0, Math.min(rowHeight, anchorMaxSize ?? rowHeight) - CHAT_ROW_GAP);
      firstOffset.set(Math.max(0, m.viewport - lift - m.composer - header - userHeight));
      firstOpacity.set(withTiming(1, { duration: 200, reduceMotion: ReduceMotion.System }));
      firstOffset.set(
        withSpring(0, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }, (finished) => {
          if (!finished) return;
          responseOpacity.set(withTiming(1, { duration: 350, reduceMotion: ReduceMotion.System }));
          scheduleOnRN(finishFirstMessage);
        }),
      );
    },
    [
      finishFirstMessage,
      firstOffset,
      firstOpacity,
      header,
      keyboardHeight,
      keyboardOffset,
      reducedMotion,
      responseOpacity,
      reveal,
    ],
  );

  useAnimatedReaction(
    () =>
      revealed.get() &&
      chatContentIsVisible(
        content.get(),
        viewport.get(),
        scrollOffset.get(),
        composerHeight.get() + Math.max(0, keyboardHeight.get() - keyboardOffset),
      ),
    (visible, previous) => {
      if (visible !== previous) scheduleOnRN(updateAtLatest, visible);
    },
  );
  useAnimatedReaction(
    () => scrollOffset.get(),
    (y) => {
      if (!revealed.get() || scrolledUp.get()) return;
      lowestOffset.set(Math.max(lowestOffset.get(), y));
      if (y >= lowestOffset.get() - 24) return;
      scrolledUp.set(true);
      scheduleOnRN(setUserScrolled, true);
    },
  );
  const historyStyle = useAnimatedStyle(() => ({
    opacity: withTiming(revealed.get() ? 1 : 0, { duration: 150, reduceMotion: ReduceMotion.System }),
  }));
  const firstMessageStyle = useAnimatedStyle(() => ({
    opacity: firstOpacity.get(),
    transform: [{ translateY: firstOffset.get() }],
  }));
  const responseStyle = useAnimatedStyle(() => ({ opacity: responseOpacity.get() }));

  const beginSend = useCallback(() => {
    setOpeningFollow(false);
    setPinnedToLatest(false);
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
    const baseline = current.current.lastUserId;
    const first = baseline === null;
    pending.current = { baseline, first, fromLatest: atLatestNow.current };
    if (first) {
      firstOpacity.set(0);
      responseOpacity.set(0);
      setResponseVisible(false);
    }
  }, [firstOpacity, responseOpacity]);
  const cancelSend = useCallback(() => {
    pending.current = null;
    if (sendScrollFrame.current !== null) cancelAnimationFrame(sendScrollFrame.current);
    sendScrollFrame.current = null;
    cancelAnimation(firstOffset);
    firstOffset.set(0);
    firstOpacity.set(1);
    responseOpacity.set(1);
    setResponseVisible(true);
  }, [firstOffset, firstOpacity, responseOpacity]);
  const leaveLatest = useCallback(() => {
    setUserScrolled(true);
    setPinnedToLatest(false);
    followLatest.current = false;
    setKeyboardLiftBehavior("never");
  }, []);
  const followFrom = useCallback(
    (scrollY: number) => {
      const m = measurements.current;
      followLatest.current = chatContentIsVisible(
        m.content,
        m.viewport,
        scrollY,
        m.composer + Math.max(0, keyboardHeight.get() - keyboardOffset),
      );
      setKeyboardLiftBehavior(followLatest.current ? "whenAtEnd" : "never");
    },
    [keyboardHeight, keyboardOffset],
  );
  const drags = useRef(0);
  const onScrollBeginDrag = useCallback(() => {
    drags.current += 1;
    dragging.set(true);
    setOpeningFollow(false);
    leaveLatest();
    reveal();
    cancelSend();
  }, [leaveLatest, reveal, cancelSend, dragging]);
  const openAt = useCallback(
    async (index: number, unread = false): Promise<void> => {
      if (unread) followLatest.current = false;
      else leaveLatest();
      const startDrags = drags.current;
      let shown: number | null = null;
      try {
        for (let attempt = 0; attempt < FOCUS_PLACE_ATTEMPTS; attempt += 1) {
          const list = listRef.current;
          if (!list || drags.current !== startDrags) break;
          await list.scrollToIndex({ index, viewOffset: header + FOCUS_GAP, animated: false });
          await afterLayout();
          const state = listRef.current?.getState();
          if (!state) break;
          const next = state.positionAtIndex(index) - state.scroll;
          if (shown !== null && Math.abs(next - shown) <= FOCUS_PLACE_TOLERANCE) break;
          shown = next;
        }
      } catch {}
      reveal();
      const state = unread && drags.current === startDrags ? listRef.current?.getState() : undefined;
      if (state) followFrom(state.scroll);
    },
    [leaveLatest, header, reveal, followFrom],
  );
  const returnToLatest = useCallback((pin = false) => {
    followLatest.current = true;
    setPinnedToLatest(pin);
    setKeyboardLiftBehavior("whenAtEnd");
    setLatestGeneration((generation) => generation + 1);
  }, []);
  const onScrollEndDrag = useCallback(
    (event: { nativeEvent: Pick<NativeScrollEvent, "contentOffset"> }) => {
      dragging.set(false);
      followFrom(event.nativeEvent.contentOffset.y);
    },
    [followFrom, dragging],
  );
  const scrollToLatest = useCallback(() => {
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
    void listRef.current?.scrollToEnd({ animated: !reducedMotion });
  }, [reducedMotion]);
  const pinToLatest = useCallback(() => {
    setPinnedToLatest(true);
    scrollToLatest();
  }, [scrollToLatest]);

  return useMemo(
    () => ({
      listRef,
      listPlaced,
      startsAtEnd: !holdOpening,
      atLatest,
      userScrolled,
      historyVisible,
      responseVisible,
      composerHeight,
      composerStyle,
      keyboardHeight,
      keyboardProgress,
      keyboardLiftBehavior,
      followsEnd:
        (requiredInputId !== null && keyboardLiftBehavior === "whenAtEnd") ||
        (openingFollow && !holdOpening) ||
        pinnedToLatest,
      scrollOffset,
      dragging,
      atEnd,
      historyStyle,
      firstMessageStyle,
      responseStyle,
      onListReady,
      onAnchorReady,
      onViewportLayout,
      onContentSizeChange,
      onComposerLayout,
      onScrollBeginDrag,
      onScrollEndDrag,
      beginSend,
      cancelSend,
      scrollToLatest,
      pinToLatest,
      openAt,
      returnToLatest,
      latestGeneration,
    }),
    [
      listPlaced,
      holdOpening,
      atLatest,
      userScrolled,
      historyVisible,
      responseVisible,
      composerHeight,
      composerStyle,
      keyboardHeight,
      keyboardProgress,
      keyboardLiftBehavior,
      requiredInputId,
      openingFollow,
      pinnedToLatest,
      scrollOffset,
      dragging,
      atEnd,
      historyStyle,
      firstMessageStyle,
      responseStyle,
      onListReady,
      onAnchorReady,
      onViewportLayout,
      onContentSizeChange,
      onComposerLayout,
      onScrollBeginDrag,
      onScrollEndDrag,
      beginSend,
      cancelSend,
      scrollToLatest,
      pinToLatest,
      openAt,
      returnToLatest,
      latestGeneration,
    ],
  );
}

export type ChatMotion = ReturnType<typeof useChatMotion>;
