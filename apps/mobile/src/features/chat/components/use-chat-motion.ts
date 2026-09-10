import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import type Animated from "react-native-reanimated";
import {
  cancelAnimation,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import {
  type ChatLayout,
  chatBlankSpace,
  chatContentIsVisible,
  chatEndOffset,
  chatSendOffset,
} from "../model/chat-layout";

export function useChatMotion(header: number, keyboardOffset: number, ready: boolean, lastUserId: string | null) {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const setScrollRef = useCallback(
    (instance: Animated.ScrollView | null) => {
      ref(instance);
    },
    [ref],
  );
  const reducedMotion = useReducedMotion();
  const keyboard = useReanimatedKeyboardAnimation();
  const layout = useSharedValue<ChatLayout>({ viewport: 0, content: 0, header, tailY: 0, tailHeight: 0 });
  const composerHeight = useSharedValue(0);
  const blankSpace = useDerivedValue(() => (lastUserId ? chatBlankSpace(layout.get()) : 0));
  const scrollY = useSharedValue(0);
  const firstOffset = useSharedValue(0);
  const firstOpacity = useSharedValue(1);
  const responseOpacity = useSharedValue(1);
  const revealed = useSharedValue(false);
  const [atLatest, setAtLatest] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [responseVisible, setResponseVisible] = useState(true);
  const pending = useRef<{ baseline: string | null; first: boolean } | null>(null);
  const frame = useRef<number | null>(null);
  const measurements = useRef<{
    layout: ChatLayout;
    inset: number;
    composer: number;
    userHeight: number;
    tailId: string | null;
    initialized: boolean;
  }>({
    layout: { viewport: 0, content: 0, header, tailY: 0, tailHeight: 0 },
    inset: 0,
    composer: 0,
    userHeight: 0,
    tailId: null,
    initialized: false,
  });
  const current = useRef({ ready, lastUserId });
  current.current = { ready, lastUserId };

  const finishFirstMessage = useCallback(() => setResponseVisible(true), []);
  const revealHistory = useCallback(() => setHistoryVisible(true), []);
  const position = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const m = measurements.current;
      if (!current.current.ready || !m.layout.viewport || !m.composer) return;
      if (current.current.lastUserId && (m.tailId !== current.current.lastUserId || !m.layout.tailHeight)) return;
      if (m.layout.content + 2 < m.layout.tailY + m.layout.tailHeight) return;
      const floor = current.current.lastUserId ? chatBlankSpace(m.layout) : 0;
      // Wait for the native inset commit; Android otherwise clamps to the old range.
      if (m.inset + 2 < Math.max(floor, m.composer)) return;
      const send = pending.current;
      if (send && current.current.lastUserId === send.baseline) return;
      if (send) {
        pending.current = null;
        m.initialized = true;
        revealed.set(true);
        setHistoryVisible(true);
        ref.current?.scrollTo({ y: chatSendOffset(m.layout, m.inset), animated: !send.first && !reducedMotion });
        if (send.first) {
          const lift = Math.max(0, -keyboard.height.get() - keyboardOffset);
          firstOffset.set(Math.max(0, m.layout.viewport - lift - m.composer - m.layout.header - m.userHeight));
          firstOpacity.set(withTiming(1, { duration: 200, reduceMotion: ReduceMotion.System }));
          firstOffset.set(
            withSpring(0, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }, (finished) => {
              if (!finished) return;
              responseOpacity.set(withTiming(1, { duration: 350, reduceMotion: ReduceMotion.System }));
              scheduleOnRN(finishFirstMessage);
            }),
          );
        }
        return;
      }
      if (m.initialized) return;
      const target = chatEndOffset(m.layout, m.inset);
      ref.current?.scrollTo({ y: target, animated: false });
      // Repeat after layout/inset commits, then reveal without showing the top of history.
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const latest = measurements.current;
        ref.current?.scrollTo({ y: chatEndOffset(latest.layout, latest.inset), animated: false });
        latest.initialized = true;
        revealed.set(true);
        revealHistory();
      });
    });
  }, [
    finishFirstMessage,
    firstOffset,
    firstOpacity,
    keyboard.height,
    keyboardOffset,
    reducedMotion,
    ref,
    responseOpacity,
    revealHistory,
    revealed,
  ]);

  useEffect(() => {
    current.current = { ready, lastUserId };
    position();
  }, [position, ready, lastUserId]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      measurements.current.layout = {
        ...measurements.current.layout,
        viewport: event.nativeEvent.layout.height,
        header,
      };
      layout.set(measurements.current.layout);
      position();
    },
    [header, layout, position],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      measurements.current.layout = { ...measurements.current.layout, content: height };
      layout.set(measurements.current.layout);
      position();
    },
    [layout, position],
  );
  const onTailLayout = useCallback(
    (id: string, event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      measurements.current.tailId = id;
      measurements.current.layout = { ...measurements.current.layout, tailY: y, tailHeight: height };
      layout.set(measurements.current.layout);
      position();
    },
    [layout, position],
  );
  const onUserLayout = useCallback(
    (event: LayoutChangeEvent) => {
      measurements.current.userHeight = event.nativeEvent.layout.height;
      position();
    },
    [position],
  );
  const onComposerHeight = useCallback(
    (measuredHeight: number) => {
      const height = measuredHeight + 20;
      measurements.current.composer = height;
      composerHeight.set(height);
      position();
    },
    [composerHeight, position],
  );
  const onContentInsetChange = useCallback(
    (inset: { bottom: number }) => {
      measurements.current.inset = inset.bottom;
      position();
    },
    [position],
  );

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
    },
  });
  useAnimatedReaction(
    () =>
      revealed.get() &&
      chatContentIsVisible(
        layout.get(),
        scrollY.get(),
        composerHeight.get() + Math.max(0, -keyboard.height.get() - keyboardOffset),
      ),
    (visible, previous) => {
      if (visible !== previous) scheduleOnRN(setAtLatest, visible);
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

  function beginSend() {
    const first = current.current.lastUserId === null;
    pending.current = { baseline: current.current.lastUserId, first };
    if (first) {
      firstOpacity.set(0);
      responseOpacity.set(0);
      setResponseVisible(false);
    }
  }
  function cancelSend() {
    pending.current = null;
    cancelAnimation(firstOffset);
    firstOffset.set(0);
    firstOpacity.set(1);
    responseOpacity.set(1);
    setResponseVisible(true);
  }
  function scrollToLatest() {
    const m = measurements.current;
    ref.current?.scrollTo({ y: chatEndOffset(m.layout, m.inset), animated: !reducedMotion });
  }

  return {
    ref,
    setScrollRef,
    atLatest,
    historyVisible,
    responseVisible,
    composerHeight,
    blankSpace,
    historyStyle,
    firstMessageStyle,
    responseStyle,
    onViewportLayout,
    onContentSizeChange,
    onTailLayout,
    onUserLayout,
    onComposerHeight,
    onContentInsetChange,
    onScroll,
    beginSend,
    cancelSend,
    scrollToLatest,
  };
}

export type ChatMotion = ReturnType<typeof useChatMotion>;
