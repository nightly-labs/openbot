import { createContext, useCallback, useEffect, useRef, useState } from "react";

export interface SplashController {
  /** Removes the native splash, uncovering whatever the app renders below it. */
  hide: () => void;
}

// The stage draws the native splash again, the lilac block with the eyes. The native splash
// waits until the stage has laid out, so the handoff shows no frame without it.
const SPLASH_ARTWORK = ["stage"] as const;
export type SplashArtwork = (typeof SPLASH_ARTWORK)[number];

/** A screen reports that its first layout is done, so the stage can show it. */
export const SplashContentReadyContext = createContext(() => {});

// A layout report may never come. Uncover anyway at this point.
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
    // The stage can lay out before the preferences are ready.
    if (SPLASH_ARTWORK.every((source) => shown.current.has(source))) handOff();
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

  return {
    covered: busy || !handedOff || !contentReady,
    /** The native splash is gone, and only the stage shows. */
    nativeHidden: handedOff,
    reportArtwork,
    reportContentReady,
  };
}
