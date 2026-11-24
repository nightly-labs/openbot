import { useIsFocused } from "expo-router";
import { type PropsWithChildren, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/shared/lib/motion";

const ROW_DURATION = 240;
const ROW_STAGGER = 30;
const ROW_RISE = 10;
const MAX_DELAY = 300;
const REDUCED_DURATION = 150;
const SETTLE_GRACE = 250;
const EASE_OUT = Easing.bezierFn(0.23, 1, 0.32, 1);

export interface AgentListRevealState {
  elapsed: SharedValue<number>;
  elapsedScope: SharedValue<string>;
  scope: string;
  finished: boolean;
  reducedMotion: boolean;
  onLayout: () => void;
}

export function useAgentListReveal(ready: boolean, scope: string): AgentListRevealState {
  const elapsed = useSharedValue(0);
  const elapsedScope = useSharedValue("");
  const reducedMotion = useReducedMotion();
  const [finishedScope, setFinishedScope] = useState<string | null>(null);
  const finished = finishedScope === scope;
  const [laidOutScope, setLaidOutScope] = useState<string | null>(null);
  const onLayout = useCallback(() => setLaidOutScope(scope), [scope]);
  const focused = useIsFocused();
  const focusedNow = useRef(focused);
  const settledScope = useRef<string | null>(null);

  useLayoutEffect(() => {
    focusedNow.current = focused;
  }, [focused]);

  useLayoutEffect(() => {
    elapsed.set(0);
    elapsedScope.set(scope);
    setFinishedScope(null);
    if (!ready) {
      settledScope.current = null;
      setLaidOutScope(null);
      return;
    }
    const duration = reducedMotion ? REDUCED_DURATION : ROW_DURATION + MAX_DELAY;
    const showAll = () => {
      settledScope.current = scope;
      elapsed.set(duration);
      setFinishedScope(scope);
    };
    if (!focusedNow.current || settledScope.current === scope) {
      showAll();
      return;
    }
    let active = true;
    const finish = () => {
      if (!active) return;
      settledScope.current = scope;
      setFinishedScope(scope);
    };
    const settle = () => {
      if (!active) return;
      cancelAnimation(elapsed);
      showAll();
    };
    const settleTimer = setTimeout(settle, duration + SETTLE_GRACE);
    if (laidOutScope === scope) {
      elapsed.set(
        withTiming(duration, { duration, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (done) => {
          if (done) scheduleOnRN(finish);
        }),
      );
    }
    return () => {
      active = false;
      clearTimeout(settleTimer);
      cancelAnimation(elapsed);
    };
  }, [elapsed, elapsedScope, laidOutScope, ready, reducedMotion, scope]);

  return useMemo(
    () => ({ elapsed, elapsedScope, scope, finished, reducedMotion, onLayout }),
    [elapsed, elapsedScope, scope, finished, reducedMotion, onLayout],
  );
}

export function AgentListRowReveal({
  children,
  index,
  reveal,
  skip = false,
  style,
}: PropsWithChildren<{ index: number; reveal: AgentListRevealState; skip?: boolean; style?: StyleProp<ViewStyle> }>) {
  const initialIndex = useRef(index).current;
  const { elapsed, elapsedScope, scope, finished, reducedMotion } = reveal;
  const progress = useDerivedValue(() => {
    if (finished || skip) return 1;
    if (elapsedScope.get() !== scope) return 0;
    const delay = reducedMotion ? 0 : Math.min(initialIndex * ROW_STAGGER, MAX_DELAY);
    const duration = reducedMotion ? REDUCED_DURATION : ROW_DURATION;
    return EASE_OUT(Math.min(1, Math.max(0, (elapsed.get() - delay) / duration)));
  });
  const contentStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reducedMotion ? 0 : ROW_RISE * (1 - progress.get()) }],
  }));
  return <Animated.View style={finished || skip ? style : [style, contentStyle]}>{children}</Animated.View>;
}
