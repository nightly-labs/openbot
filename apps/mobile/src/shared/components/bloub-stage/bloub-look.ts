import { useCSSVariable, useUniwind } from "uniwind";

import { SPLASH_EASE_IN_OUT } from "@/shared/lib/splash-motion";

export const BLOUB_RADIUS = 40;
export const BLOUB_MOVE_MS = 560;
export const BLOUB_MOVE = { duration: BLOUB_MOVE_MS, easing: SPLASH_EASE_IN_OUT };
const FULL_EYES_SHARE = 0.65;
const MIN_EYES_SCALE = 0.3;
const EYES_FADE_SPAN = 80;
const DARK_BODY_SHARE = 0.5;

function mix(color: string, toward: string, share: number): string {
  const from = /^#([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  const to = /^#([0-9a-f]{6})$/i.exec(toward.trim())?.[1];
  if (!from || !to) return color;
  const a = Number.parseInt(from, 16);
  const b = Number.parseInt(to, 16);
  const channel = (shift: number) => {
    const start = (a >> shift) & 0xff;
    const end = (b >> shift) & 0xff;
    return Math.round(start + (end - start) * share)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

export function bloubGradient(light: string, body: string): string {
  return `radial-gradient(120% 70% at 18% 0%, ${light} 0%, ${body} 58%)`;
}

export function useBloubColors() {
  const logo = String(useCSSVariable("--openbot-logo-production") ?? "#d6adf2");
  const canvas = String(useCSSVariable("--openbot-bg-native-canvas") ?? "#141414");
  const eye = String(useCSSVariable("--openbot-logo-eye") ?? "#040007");
  const dark = useUniwind().theme === "dark";
  const dimBody = mix(logo, canvas, DARK_BODY_SHARE);
  return {
    dark,
    eye,
    body: logo,
    light: mix(logo, "#ffffff", 0.5),
    dimBody,
    dimLight: mix(dimBody, "#ffffff", 0.12),
  };
}

export function bloubEyesFrame(edge: number, height: number, top: number) {
  "worklet";
  const visible = Math.min(Math.max(edge, 0), height);
  return {
    opacity: Math.min(Math.max((visible - top) / EYES_FADE_SPAN, 0), 1),
    center: Math.max(visible / 2, top + (visible - top) * 0.45),
    scale: Math.min(Math.max(visible / (FULL_EYES_SHARE * height), MIN_EYES_SCALE), 1),
  };
}
