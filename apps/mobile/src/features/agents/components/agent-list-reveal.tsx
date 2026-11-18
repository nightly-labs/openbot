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

// The pinned tiles and then the rows come in one by one, each a little up from its place. The
// delay stops after about one screen of items, so a long list does not wait.
const ROW_DURATION = 240;
const ROW_STAGGER = 30;
const ROW_RISE = 10;
const MAX_DELAY = 300;
const REDUCED_DURATION = 150;
const EASE_OUT = Easing.bezierFn(0.23, 1, 0.32, 1);

export interface AgentListRevealState {
  elapsed: SharedValue<number>;
  /** The scope that `elapsed` counts for. */
  elapsedScope: SharedValue<string>;
  scope: string;
  finished: boolean;
  reducedMotion: boolean;
  onLayout: () => void;
}

export function useAgentListReveal(ready: boolean, scope: string): AgentListRevealState {
  const elapsed = useSharedValue(0);
  // The rows of a new scope render before the layout effect resets `elapsed`, while it still holds
  // the end of the last reveal. A row shows nothing until `elapsed` counts for its own scope.
  const elapsedScope = useSharedValue("");
  const reducedMotion = useReducedMotion();
  const [finishedScope, setFinishedScope] = useState<string | null>(null);
  const finished = finishedScope === scope;
  const [laidOutScope, setLaidOutScope] = useState<string | null>(null);
  const onLayout = useCallback(() => setLaidOutScope(scope), [scope]);

  useLayoutEffect(() => {
    elapsed.set(0);
    elapsedScope.set(scope);
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
  // Keep a mounted row's place in the reveal when a live update inserts a section.
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
  // After the reveal the row has no animated style. A later render then cannot put back the
  // first-render opacity of 0 when the animated value has not reached React.
  return <Animated.View style={finished || skip ? style : [style, contentStyle]}>{children}</Animated.View>;
}
