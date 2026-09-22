import { type PropsWithChildren, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

const ROW_DURATION = 260;
const ROW_STAGGER = 32;
const MAX_DELAY = 160;
const REDUCED_DURATION = 150;
const EASE_OUT = Easing.bezierFn(0.23, 1, 0.32, 1);

export interface AgentListRevealState {
  elapsed: SharedValue<number>;
  finished: boolean;
  reducedMotion: boolean;
  onLayout: () => void;
}

export function useAgentListReveal(ready: boolean, scope: string): AgentListRevealState {
  const elapsed = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const [finishedScope, setFinishedScope] = useState<string | null>(null);
  const finished = finishedScope === scope;
  const [laidOutScope, setLaidOutScope] = useState<string | null>(null);
  const onLayout = useCallback(() => setLaidOutScope(scope), [scope]);

  useLayoutEffect(() => {
    elapsed.set(0);
    setFinishedScope(null);
    if (!ready) {
      setLaidOutScope(null);
      return;
    }
    // Start after native layout, so loading and first layout do not consume the reveal.
    if (laidOutScope !== scope) return;
    let active = true;
    const finish = () => {
      if (active) setFinishedScope(scope);
    };
    const duration = reducedMotion ? REDUCED_DURATION : ROW_DURATION + MAX_DELAY;
    elapsed.set(
      withTiming(duration, { duration, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (done) => {
        if (done) scheduleOnRN(finish);
      }),
    );
    return () => {
      active = false;
      cancelAnimation(elapsed);
    };
  }, [elapsed, laidOutScope, ready, reducedMotion, scope]);

  return useMemo(() => ({ elapsed, finished, reducedMotion, onLayout }), [elapsed, finished, reducedMotion, onLayout]);
}

export function AgentListRowReveal({
  children,
  index,
  reveal,
  skip = false,
}: PropsWithChildren<{ index: number; reveal: AgentListRevealState; skip?: boolean }>) {
  // Keep a mounted row's place in the reveal when a live update inserts a section.
  const initialIndex = useRef(index).current;
  const { elapsed, finished, reducedMotion } = reveal;
  const progress = useDerivedValue(() => {
    if (finished || skip) return 1;
    const delay = reducedMotion ? 0 : Math.min(initialIndex * ROW_STAGGER, MAX_DELAY);
    const duration = reducedMotion ? REDUCED_DURATION : ROW_DURATION;
    return EASE_OUT(Math.min(1, Math.max(0, (elapsed.get() - delay) / duration)));
  });
  const contentStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateX: reducedMotion ? 0 : -18 * (1 - progress.get()) }],
  }));
  return <Animated.View style={contentStyle}>{children}</Animated.View>;
}
