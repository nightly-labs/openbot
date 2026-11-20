import { createSignal } from "solid-js";

const STARTUP_ANIMATION_STORAGE_KEY = "openbot:startup-animation";

function readStartupAnimation(): boolean {
  try {
    return window.localStorage.getItem(STARTUP_ANIMATION_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

const [startupAnimation, setStartupAnimationShown] = createSignal(
  typeof window === "undefined" ? true : readStartupAnimation(),
);

export function startupLoadingScene(): "pile" | "quiet" {
  return startupAnimation() ? "pile" : "quiet";
}

export function useStartupAnimation(): () => boolean {
  return startupAnimation;
}

export function setStartupAnimation(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(STARTUP_ANIMATION_STORAGE_KEY);
    else window.localStorage.setItem(STARTUP_ANIMATION_STORAGE_KEY, "off");
  } catch {}
  setStartupAnimationShown(on);
}
