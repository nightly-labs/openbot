import { Easing, FadeIn, FadeInLeft, FadeInRight, FadeInUp, FadeOut, Keyframe } from "react-native-reanimated";

export const SIGN_IN_EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const SIGN_IN_EASE_MOVE = Easing.bezier(0.32, 0.72, 0, 1);

export const SIGN_IN_TEXT_EASE = Easing.bezier(0.45, 0, 0.55, 1);

const ENTER_MS = 220;
const EXIT_MS = 120;
const RISE = 8;

export function signInMotion(reduced: boolean) {
  const fadeIn = (delay = 0) =>
    FadeIn.duration(ENTER_MS)
      .delay(reduced ? 0 : delay)
      .easing(SIGN_IN_EASE_OUT);
  return {
    enter: (delay = 0) =>
      reduced
        ? fadeIn()
        : FadeInUp.duration(ENTER_MS)
            .delay(delay)
            .easing(SIGN_IN_EASE_OUT)
            .withInitialValues({ opacity: 0, transform: [{ translateY: RISE }] }),
    fadeIn,
    fadeOut: FadeOut.duration(EXIT_MS),
  };
}

export type SignInMotion = ReturnType<typeof signInMotion>;

export type PaneDirection = "vertical" | "left" | "right";

export const PANE_ENTER_DELAY_MS = 320;
export const PANE_SIDE_ENTER_DELAY_MS = 160;
export const PANE_STAGGER_MS = 45;
const PANE_ENTER_MS = 300;
const PANE_EXIT_MS = 160;
const PANE_RISE = 10;
const PANE_SHIFT = 24;

export function paneEnter(index: number, from: PaneDirection, reduced: boolean, startMs: number) {
  const delay = startMs + index * PANE_STAGGER_MS;
  if (reduced) return FadeIn.duration(ENTER_MS).delay(index * PANE_STAGGER_MS);
  if (from === "vertical")
    return FadeInUp.duration(PANE_ENTER_MS)
      .delay(delay)
      .easing(SIGN_IN_EASE_OUT)
      .withInitialValues({ opacity: 0, transform: [{ translateY: PANE_RISE }] });
  const Enter = from === "left" ? FadeInLeft : FadeInRight;
  return Enter.duration(PANE_ENTER_MS)
    .delay(delay)
    .easing(SIGN_IN_EASE_OUT)
    .withInitialValues({ opacity: 0, transform: [{ translateX: from === "left" ? -PANE_SHIFT : PANE_SHIFT }] });
}

export function paneExit(to: PaneDirection, reduced: boolean) {
  if (reduced) return FadeOut.duration(EXIT_MS);
  const x = to === "left" ? -PANE_SHIFT : to === "right" ? PANE_SHIFT : 0;
  const y = to === "vertical" ? PANE_RISE : 0;
  return new Keyframe({
    0: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }] },
    100: { opacity: 0, transform: [{ translateX: x }, { translateY: y }], easing: SIGN_IN_EASE_OUT },
  }).duration(PANE_EXIT_MS);
}
