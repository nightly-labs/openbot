import { springProgress } from "@openbot/ui/spring-motion";
import { clamp } from "@openbot/ui/utils";

export type IdleGreetingMotionName = "wave" | "smile" | "cheer" | "sparkles";

interface IdleGreetingParts {
  card: HTMLElement;
  front: HTMLElement;
  back: HTMLElement | undefined;
}

const SAMPLE_COUNT = 30;
const MOTION_DELAY = 350;
const TURN_BLUR_LIMIT = 1.4;
const TURN_SPEED_BLUR_LIMIT = 0.4;
const TURN_BLUR_PER_DEGREE_PER_MS = 0.75;
const TURN_EDGE_BLUR = 1.2;
const TURN_EDGE_FADE = 0.5;
const TURN_EDGE_SHADE = 0.3;
const FACE_AT_REST = { filter: "blur(0px) brightness(1)", opacity: "1" };
const EDGE_SCALE_DIP = 0.07;

export function playIdleGreetingMotion(name: IdleGreetingMotionName, layer: HTMLElement): Animation[] {
  const card = layer.querySelector<HTMLElement>(".dynamic-island-surface-idle-greeting-card");
  const front = card?.querySelector<HTMLElement>(".dynamic-island-surface-idle-greeting-face");
  if (!card?.animate || !front) return [];
  const back = card.querySelector<HTMLElement>(".dynamic-island-surface-idle-greeting-face-back") ?? undefined;
  const parts = { card, front, back };
  if (name === "wave") return playWave(parts);
  if (name === "smile") return playSmile(parts);
  if (name === "cheer") return playCheer(parts);
  return playSparkles(front);
}

function playSparkles(face: HTMLElement): Animation[] {
  const duration = 7000;
  const light = spring(0.75, 0.6);
  const stars = Array.from(face.querySelectorAll<HTMLElement>(".dynamic-island-surface-idle-greeting-sparkle"));
  return stars.map((star, index) => {
    const start = index * 260;
    const period = 1700 + index * 380;
    const phase = index * 2.1;
    const envelope = (t: number) => clamp((t - start - 700) / 900, 0, 1) * clamp((duration - t) / 700, 0, 1);
    const breath = (t: number) => Math.sin((2 * Math.PI * (t - start)) / period + phase);
    return animate(
      star,
      duration,
      (t) => {
        const lit = light(t - start);
        const shimmer = envelope(t) * breath(t);
        return {
          opacity: clamp(0.2 + 0.8 * lit, 0, 1) * (1 - 0.09 * envelope(t) * (1 - breath(t))),
          scale: (0.6 + 0.4 * lit) * (1 + 0.05 * shimmer),
          rotate: `${6 * envelope(t) * Math.sin((2 * Math.PI * (t - start)) / (period * 1.6) + phase)}deg`,
        };
      },
      { opacity: "1", scale: "1", rotate: "0deg" },
      "both",
      90,
    );
  });
}

function playWave(parts: IdleGreetingParts): Animation[] {
  const duration = 3500;
  const turn = spring(0.62, 0.7);
  const theta = (t: number) => 180 * turn(t - 820) + 180 * turn(t - 2600);
  const wave = (t: number) => {
    if (t >= 820) return 0;
    const seconds = t / 1000;
    const envelope = Math.sqrt(Math.sin(Math.PI * Math.min(1, t / 820)));
    return 20 * Math.sin(2 * Math.PI * 2.4 * seconds) * Math.exp(-2.2 * seconds) * envelope;
  };
  parts.front.style.transformOrigin = "70% 80%";
  return [
    animate(parts.card, duration, (t) => ({ transform: `rotateY(${theta(t)}deg)`, scale: edgeScale(theta(t)) }), {
      transform: "rotateY(360deg)",
      scale: "1",
    }),
    animate(parts.front, duration, (t) => ({ rotate: `${wave(t)}deg`, ...turnLook(theta, t) }), {
      rotate: "0deg",
      ...FACE_AT_REST,
    }),
    ...faceTurn(parts.back, duration, theta),
  ];
}

function playSmile(parts: IdleGreetingParts): Animation[] {
  const duration = 3300;
  const turn = spring(0.6, 0.8);
  const theta = (t: number) => 180 * turn(t) + 180 * turn(t - 2200);
  const hop = (t: number) =>
    -1.5 * Math.sin(Math.PI * clamp(t / 650, 0, 1)) - Math.sin(Math.PI * clamp((t - 2200) / 650, 0, 1));
  return [
    animate(
      parts.card,
      duration,
      (t) => ({ transform: `rotateY(${theta(t)}deg)`, translate: `0 ${hop(t)}px`, scale: edgeScale(theta(t)) }),
      { transform: "rotateY(360deg)", translate: "0 0", scale: "1" },
    ),
    ...faceTurn(parts.front, duration, theta),
    ...faceTurn(parts.back, duration, theta),
  ];
}

function playCheer(parts: IdleGreetingParts): Animation[] {
  const duration = 2700;
  const turn = spring(0.62, 0.65);
  const launch = spring(0.45, 0.5);
  const land = spring(0.55, 0.5);
  const claps = [700, 1000];
  const theta = (t: number) => 180 * turn(t) + 180 * turn(t - 1420);
  const crouch = (t: number) => 0.8 * Math.sin(Math.PI * clamp((t - 1280) / 160, 0, 1));
  const rise = (t: number) => crouch(t) - 3 * (launch(t - 1420) - land(t - 1800));
  const pop = (t: number) => 1 - (0.04 * crouch(t)) / 0.8 + 0.1 * (launch(t - 1420) - land(t - 1760));
  const clapAt = (t: number) => {
    for (const at of claps) {
      const since = t - at;
      if (since < 0 || since > 320) continue;
      if (since < 110) return -Math.sin((Math.PI * since) / 110);
      return 0.28 * Math.sin((Math.PI * (since - 110)) / 210) * Math.exp(-(since - 110) / 160);
    }
    return 0;
  };
  const clapTilt = (t: number) => {
    const since = Math.min(...claps.map((at) => (t >= at ? t - at : Number.POSITIVE_INFINITY)));
    return since > 320 ? 0 : 4 * Math.sin((Math.PI * since) / 320) * (since < 160 ? 1 : -0.5);
  };
  return [
    animate(
      parts.card,
      duration,
      (t) => ({
        transform: `rotateY(${theta(t)}deg)`,
        translate: `0 ${rise(t)}px`,
        scale: edgeScale(theta(t)) * pop(t),
      }),
      { transform: "rotateY(360deg)", translate: "0 0", scale: "1" },
      "forwards",
      54,
    ),
    ...faceTurn(parts.front, duration, theta),
    ...(parts.back
      ? [
          animate(
            parts.back,
            duration,
            (t) => {
              const squash = clapAt(t);
              const across = squash < 0 ? 1 + 0.22 * squash : 1 + 0.06 * squash;
              const up = squash < 0 ? 1 - 0.05 * squash : 1;
              return { scale: `${across} ${up}`, rotate: `${clapTilt(t)}deg`, ...turnLook(theta, t) };
            },
            { scale: "1 1", rotate: "0deg", ...FACE_AT_REST },
            "forwards",
            54,
          ),
        ]
      : []),
  ];
}

function faceTurn(face: HTMLElement | undefined, duration: number, theta: (t: number) => number): Animation[] {
  if (!face) return [];
  return [animate(face, duration, (t) => turnLook(theta, t), FACE_AT_REST)];
}

function animate(
  element: HTMLElement,
  duration: number,
  frame: (t: number) => Record<string, string | number>,
  final: Record<string, string>,
  fill: FillMode = "forwards",
  samples = SAMPLE_COUNT,
): Animation {
  const keyframes: Keyframe[] = Array.from({ length: samples + 1 }, (_, index) => {
    const offset = index / samples;
    const values = index === samples ? final : frame(duration * offset);
    return { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])), offset };
  });
  return element.animate(keyframes, { duration, delay: MOTION_DELAY, easing: "linear", fill });
}

function turnLook(theta: (t: number) => number, t: number): { filter: string; opacity: number } {
  const edge = Math.abs(Math.sin((theta(t) * Math.PI) / 180));
  const degreesPerMs = Math.abs(theta(t + 4) - theta(t - 4)) / 8;
  const speedBlur = clamp(degreesPerMs * TURN_BLUR_PER_DEGREE_PER_MS, 0, TURN_SPEED_BLUR_LIMIT);
  const blur = clamp(TURN_EDGE_BLUR * edge + speedBlur, 0, TURN_BLUR_LIMIT);
  return {
    filter: `blur(${blur}px) brightness(${1 - TURN_EDGE_SHADE * edge})`,
    opacity: 1 - TURN_EDGE_FADE * edge ** 1.5,
  };
}

function edgeScale(theta: number): number {
  return 1 - EDGE_SCALE_DIP * Math.abs(Math.sin((theta * Math.PI) / 180));
}

function spring(dampingRatio: number, responseSeconds: number): (t: number) => number {
  const settings = { response: responseSeconds, dampingFraction: dampingRatio };
  return (t) => (t <= 0 ? 0 : springProgress(t / 1000, settings));
}
