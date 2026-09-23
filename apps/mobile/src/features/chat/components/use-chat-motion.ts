import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Keyboard, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import type Animated from "react-native-reanimated";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedRef,
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

export function useChatMotion(
  header: number,
  keyboardOffset: number,
  ready: boolean,
  lastUserId: string | null,
  requiredInputId: string | null = null,
) {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const setScrollRef = useCallback(
    (instance: Animated.ScrollView | null) => {
      ref(instance);
    },
    [ref],
  );
  const reducedMotion = useReducedMotion();
  const keyboardHeight = useSharedValue(0);
  // 0 while the keyboard is down, 1 while it is fully up, and every value
  // between during an interactive dismissal. The composer reads this to size
  // itself, so a swipe drives the shape change frame by frame.
  const keyboardProgress = useSharedValue(0);
  const keyboardDismissed = useSharedValue(false);
  // Track opening and interactive frames. Once dismissal starts, finish the
  // return independently so a missing completion cannot retain keyboard space.
  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        if (event.height > 0) {
          cancelAnimation(keyboardHeight);
          cancelAnimation(keyboardProgress);
          keyboardDismissed.set(false);
        } else {
          // Complete the return from the destination event. An interrupted iOS
          // dismissal can omit its final frame; subsequent drag frames must not
          // cancel this animation and leave the composer above an absent keyboard.
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
    // A native picker or interrupted dismissal can omit the controller's final frame.
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
  const layout = useSharedValue<ChatLayout>({ viewport: 0, content: 0, header, tailY: 0, tailHeight: 0 });
  const composerHeight = useSharedValue(0);
  const blankSpace = useDerivedValue(() =>
    lastUserId && layout.get().tailHeight > 0 ? chatBlankSpace(layout.get()) : 0,
  );
  const scrollY = useSharedValue(0);
  const firstOffset = useSharedValue(0);
  const firstOpacity = useSharedValue(1);
  const responseOpacity = useSharedValue(1);
  const revealed = useSharedValue(false);
  const [atLatest, setAtLatest] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [responseVisible, setResponseVisible] = useState(true);
  const pending = useRef<{ baseline: string | null; first: boolean } | null>(null);
  const followLatest = useRef(true);
  const [keyboardLiftBehavior, setKeyboardLiftBehavior] = useState<"whenAtEnd" | "never">("whenAtEnd");
  const pendingRequiredInput = useRef<{ id: string; contentRevision: number } | null>(null);
  const lastRequiredInputId = useRef(requiredInputId);
  const frame = useRef<number | null>(null);
  const measurements = useRef<{
    layout: ChatLayout;
    inset: number;
    composer: number;
    userHeight: number;
    tailId: string | null;
    contentRevision: number;
    initialized: boolean;
    virtualized: boolean;
  }>({
    layout: { viewport: 0, content: 0, header, tailY: 0, tailHeight: 0 },
    inset: 0,
    composer: 0,
    userHeight: 0,
    tailId: null,
    contentRevision: 0,
    initialized: false,
    virtualized: false,
  });
  const current = useRef({ ready, lastUserId, requiredInputId });
  current.current = { ready, lastUserId, requiredInputId };

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
      const requiredInput = pendingRequiredInput.current;
      if (requiredInput && m.contentRevision <= requiredInput.contentRevision) return;
      if (requiredInput) {
        pendingRequiredInput.current = null;
        pending.current = null;
        m.initialized = true;
        revealed.set(true);
        setHistoryVisible(true);
        ref.current?.scrollTo({ y: chatEndOffset(m.layout, m.inset), animated: !reducedMotion });
        return;
      }
      const send = pending.current;
      if (send && current.current.lastUserId === send.baseline) return;
      if (send) {
        pending.current = null;
        m.initialized = true;
        revealed.set(true);
        setHistoryVisible(true);
        ref.current?.scrollTo({ y: chatSendOffset(m.layout, m.inset), animated: !send.first && !reducedMotion });
        if (send.first) {
          const lift = Math.max(0, keyboardHeight.get() - keyboardOffset);
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
      if (m.initialized) {
        if (current.current.requiredInputId && followLatest.current) {
          ref.current?.scrollTo({ y: chatEndOffset(m.layout, m.inset), animated: false });
        }
        return;
      }
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
    keyboardHeight,
    keyboardOffset,
    reducedMotion,
    ref,
    responseOpacity,
    revealHistory,
    revealed,
  ]);

  useLayoutEffect(() => {
    current.current = { ready, lastUserId, requiredInputId };
    if (requiredInputId !== lastRequiredInputId.current) {
      pendingRequiredInput.current =
        requiredInputId && followLatest.current
          ? { id: requiredInputId, contentRevision: measurements.current.contentRevision }
          : null;
    }
    lastRequiredInputId.current = requiredInputId;
    position();
  }, [position, ready, lastUserId, requiredInputId]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onViewportLayout = useCallback(
    (event: Pick<LayoutChangeEvent, "nativeEvent">) => {
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
      measurements.current.contentRevision += 1;
      measurements.current.layout = {
        ...measurements.current.layout,
        content: height,
        ...(measurements.current.virtualized
          ? { tailHeight: Math.max(0, height - measurements.current.layout.tailY) }
          : {}),
      };
      layout.set(measurements.current.layout);
      position();
    },
    [layout, position],
  );
  const onTailLayout = useCallback(
    (id: string, event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      const { y, height } = event.nativeEvent.layout;
      measurements.current.tailId = id;
      measurements.current.layout = { ...measurements.current.layout, tailY: y, tailHeight: height };
      layout.set(measurements.current.layout);
      position();
    },
    [layout, position],
  );
  const onTailStartLayout = useCallback(
    (id: string, event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      const m = measurements.current;
      m.virtualized = true;
      m.tailId = id;
      m.layout = {
        ...m.layout,
        tailY: event.nativeEvent.layout.y,
        tailHeight: Math.max(event.nativeEvent.layout.height, m.layout.content - event.nativeEvent.layout.y),
      };
      layout.set(m.layout);
      position();
    },
    [layout, position],
  );

  const onUserLayout = useCallback(
    (event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      measurements.current.userHeight = event.nativeEvent.layout.height;
      position();
    },
    [position],
  );
  const onComposerLayout = useCallback(
    (event: Pick<LayoutChangeEvent, "nativeEvent">) => {
      const height = event.nativeEvent.layout.height + 20;
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

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.set(event.nativeEvent.contentOffset.y);
    },
    [scrollY],
  );
  const updateAtLatest = useCallback((visible: boolean) => {
    setAtLatest(visible);
  }, []);
  useAnimatedReaction(
    () =>
      revealed.get() &&
      chatContentIsVisible(
        layout.get(),
        scrollY.get(),
        composerHeight.get() + Math.max(0, keyboardHeight.get() - keyboardOffset),
      ),
    (visible, previous) => {
      if (visible !== previous) scheduleOnRN(updateAtLatest, visible);
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

  const needsSendPosition = useCallback(() => pending.current !== null, []);
  const needsInitialPosition = useCallback(() => !measurements.current.initialized, []);

  function beginSend() {
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
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
  function onScrollBeginDrag() {
    followLatest.current = false;
    setKeyboardLiftBehavior("never");
    pendingRequiredInput.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    measurements.current.initialized = true;
    revealed.set(true);
    setHistoryVisible(true);
    cancelSend();
  }
  function onScrollEndDrag(event: { nativeEvent: Pick<NativeScrollEvent, "contentOffset"> }) {
    // Only a user scroll can resume following. Keyboard dismissal can make the
    // reply visible without the user choosing to return to it.
    followLatest.current = chatContentIsVisible(
      measurements.current.layout,
      event.nativeEvent.contentOffset.y,
      measurements.current.composer + Math.max(0, keyboardHeight.get() - keyboardOffset),
    );
    setKeyboardLiftBehavior(followLatest.current ? "whenAtEnd" : "never");
  }
  function scrollToLatest() {
    const m = measurements.current;
    followLatest.current = true;
    setKeyboardLiftBehavior("whenAtEnd");
    ref.current?.scrollTo({ y: chatEndOffset(m.layout, m.inset), animated: !reducedMotion });
  }

  return {
    ref,
    setScrollRef,
    atLatest,
    historyVisible,
    responseVisible,
    composerHeight,
    composerStyle,
    keyboardHeight,
    keyboardProgress,
    keyboardLiftBehavior,
    blankSpace,
    historyStyle,
    firstMessageStyle,
    responseStyle,
    onViewportLayout,
    onContentSizeChange,
    onTailLayout,
    onTailStartLayout,
    onUserLayout,
    onComposerLayout,
    onContentInsetChange,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    beginSend,
    needsSendPosition,
    needsInitialPosition,
    cancelSend,
    scrollToLatest,
  };
}

export type ChatMotion = ReturnType<typeof useChatMotion>;
