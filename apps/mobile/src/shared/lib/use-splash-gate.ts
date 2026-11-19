import { createContext, useCallback, useEffect, useRef, useState } from "react";

export interface SplashController {
  hide: () => void;
}

const SPLASH_ARTWORK = ["stage"] as const;
export type SplashArtwork = (typeof SPLASH_ARTWORK)[number];

export const SplashContentReadyContext = createContext(() => {});

export const SPLASH_HANDOFF_DEADLINE_MS = 1500;

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
    nativeHidden: handedOff,
    reportArtwork,
    reportContentReady,
  };
}
