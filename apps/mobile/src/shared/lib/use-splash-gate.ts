import { createContext, useCallback, useEffect, useRef, useState } from "react";
import type { SharedValue } from "react-native-reanimated";

export interface SplashController {
  /** Removes the native splash, uncovering whatever the app renders below it. */
  hide: () => void;
}

// Every image the backdrop puts on screen is worth waiting for before the
// handoff: uncovering with the wallpaper but not the mark would blink the mark
// out, because the native splash paints that mark and the backdrop has not yet.
export const SPLASH_ARTWORK = ["wallpaper", "mark"] as const;
export type SplashArtwork = (typeof SPLASH_ARTWORK)[number];

export interface SplashLogoTarget {
  x: number;
  y: number;
  size: number;
}

export const SplashContentReadyContext = createContext((_target?: SplashLogoTarget) => {});
export const SplashMotionContext = createContext<{
  progress: SharedValue<number>;
  revealing: boolean;
  complete: boolean;
  reducedMotion: boolean;
  finish: () => void;
} | null>(null);

// The artwork may never report: expo-image reports nothing for a source it
// cannot decode. Uncover anyway at this point, so a broken asset costs the
// wallpaper and never the app.
export const SPLASH_HANDOFF_DEADLINE_MS = 1500;

// Readiness, not a display timer, controls when the app becomes available.
export function useSplashGate(busy: boolean, splash: SplashController, nativeReady = true) {
  const shown = useRef(new Set<SplashArtwork>());
  const uncovered = useRef(false);
  const [handedOff, setHandedOff] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const reportContentReady = useCallback(() => setContentReady(true), []);

  const handOff = useCallback(() => {
    if (uncovered.current || !nativeReady) return;
    uncovered.current = true;
    splash.hide();
    setHandedOff(true);
  }, [nativeReady, splash]);

  useEffect(() => {
    if (!nativeReady) return;
    const deadline = setTimeout(handOff, SPLASH_HANDOFF_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [handOff, nativeReady]);

  const reportArtwork = useCallback(
    (artwork: SplashArtwork) => {
      shown.current.add(artwork);
      if (SPLASH_ARTWORK.every((source) => shown.current.has(source))) handOff();
    },
    [handOff],
  );

  return { covered: busy || !handedOff || !contentReady, reportArtwork, reportContentReady };
}
