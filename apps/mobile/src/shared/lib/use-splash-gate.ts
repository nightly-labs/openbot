import { useCallback, useEffect, useRef, useState } from "react";

export interface SplashController {
  /** Removes the native splash, uncovering whatever the app renders below it. */
  hide: () => void;
}

// Every image the backdrop puts on screen is worth waiting for before the
// handoff: uncovering with the wallpaper but not the mark would blink the mark
// out, because the native splash paints that mark and the backdrop has not yet.
export const SPLASH_ARTWORK = ["wallpaper", "mark"] as const;
export type SplashArtwork = (typeof SPLASH_ARTWORK)[number];

// How long the artwork stays after it reaches the screen. The splash exists to
// be seen and carries product copy, so this is a floor, not a timeout.
export const SPLASH_MIN_VISIBLE_MS = 900;

// The artwork may never report: expo-image reports nothing for a source it
// cannot decode. Uncover anyway at this point, so a broken asset costs the
// wallpaper and never the app.
export const SPLASH_HANDOFF_DEADLINE_MS = 1500;

/**
 * Keeps the splash artwork on screen for {@link SPLASH_MIN_VISIBLE_MS} once it
 * has actually painted, and hides the native splash at that same moment.
 *
 * `busy` extends the cover for as long as the app has nothing to show yet. The
 * minimum window is independent of it and latches once, so a later busy state
 * reuses the backdrop without arming the wait again.
 */
export function useSplashGate(busy: boolean, splash: SplashController) {
  const shown = useRef(new Set<SplashArtwork>());
  const uncovered = useRef(false);
  const [handedOff, setHandedOff] = useState(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);

  const handOff = useCallback(() => {
    if (uncovered.current) return;
    uncovered.current = true;
    splash.hide();
    setHandedOff(true);
  }, [splash]);

  useEffect(() => {
    const deadline = setTimeout(handOff, SPLASH_HANDOFF_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [handOff]);

  useEffect(() => {
    if (!handedOff) return;
    const minimum = setTimeout(() => setMinimumElapsed(true), SPLASH_MIN_VISIBLE_MS);
    return () => clearTimeout(minimum);
  }, [handedOff]);

  const reportArtwork = useCallback(
    (artwork: SplashArtwork) => {
      shown.current.add(artwork);
      if (SPLASH_ARTWORK.every((source) => shown.current.has(source))) handOff();
    },
    [handOff],
  );

  return { covered: busy || !minimumElapsed, reportArtwork };
}
