import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelAnimation, Easing, ReduceMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { SPLASH_EASE_OUT, SPLASH_SEQUENCE_MS } from "./splash-motion";

export function useSplashMotion({
  covered,
  hasTarget,
  foreground,
  reducedMotion,
}: {
  covered: boolean;
  hasTarget: boolean;
  foreground: boolean;
  reducedMotion: boolean;
}) {
  const progress = useSharedValue(0);
  const [complete, setComplete] = useState(false);
  const generation = useRef(0);
  const finish = useCallback((run: number) => {
    if (generation.current === run) setComplete(true);
  }, []);

  const settle = useCallback(() => {
    generation.current++;
    cancelAnimation(progress);
    progress.set(1);
    setComplete(true);
  }, [progress]);

  useEffect(() => {
    const run = ++generation.current;
    if (covered) {
      progress.set(0);
      setComplete(false);
    } else if (!foreground || complete) {
      // Do not replay a launch interrupted by backgrounding or a native dialog.
      progress.set(1);
      finish(run);
    } else {
      progress.set(
        withTiming(
          1,
          {
            // Keep the logo, backdrop and stagger on one UI-thread clock.
            duration: reducedMotion ? 160 : hasTarget ? SPLASH_SEQUENCE_MS : 240,
            easing: reducedMotion || !hasTarget ? SPLASH_EASE_OUT : Easing.linear,
            reduceMotion: reducedMotion ? ReduceMotion.Never : ReduceMotion.System,
          },
          (finished) => {
            if (finished) scheduleOnRN(finish, run);
          },
        ),
      );
    }
    return () => {
      generation.current++;
      cancelAnimation(progress);
    };
  }, [complete, covered, finish, foreground, hasTarget, progress, reducedMotion]);

  return useMemo(
    () => ({ progress, revealing: !covered, complete, reducedMotion, finish: settle }),
    [complete, covered, progress, reducedMotion, settle],
  );
}
