import { Easing } from "react-native-reanimated";

// Native equivalents of the shared brand easing tokens.
export const SPLASH_EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const SPLASH_EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
export const SPLASH_LOGO_SIZE = 112;
export const SPLASH_MORPH_START = 0.65;

// One rare launch sequence: 400 ms travel, then 220 ms reveals 60 ms apart.
// Text starts only once the moving mark has cleared its final text area.
export const SPLASH_SEQUENCE_MS = 560;
const easeTravel = SPLASH_EASE_IN_OUT.factory();
const easeReveal = SPLASH_EASE_OUT.factory();

export function splashTravel(progress: number, reducedMotion: boolean): number {
  "worklet";
  return reducedMotion ? progress : easeTravel(Math.min(1, (progress * SPLASH_SEQUENCE_MS) / 400));
}

export function splashReveal(progress: number, delay: number, reducedMotion: boolean): number {
  "worklet";
  return reducedMotion ? progress : easeReveal(Math.min(1, Math.max(0, (progress * SPLASH_SEQUENCE_MS - delay) / 220)));
}
