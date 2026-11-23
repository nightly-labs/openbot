import { createEffect, createSignal } from "solid-js";

const CODE_FALLBACK_DELAY_MS = 25_000;

export function createCodeSignInFallback(connecting: () => boolean) {
  const [stalled, setStalled] = createSignal(false);
  const [attempted, setAttempted] = createSignal(false);
  const [way, setWay] = createSignal<"browser" | "code" | null>(null);
  createEffect(
    () => connecting() && way() === "browser",
    (browserWaiting) => {
      setStalled(false);
      if (!browserWaiting) return;
      setAttempted(true);
      const timer = window.setTimeout(() => setStalled(true), CODE_FALLBACK_DELAY_MS);
      return () => window.clearTimeout(timer);
    },
  );
  return {
    offered: () => way() === "browser" && (connecting() ? stalled() : attempted()),
    startedWithCode: () => {
      setWay("code");
      setAttempted(false);
    },
    startedInBrowser: () => setWay("browser"),
  };
}
