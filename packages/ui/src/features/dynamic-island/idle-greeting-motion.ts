// The motion each idle greeting plays once as it shows. Every curve is a formula, a damped spring or
// a decaying sine, sampled into keyframes that play linearly, so a motion is one smooth path rather
// than a curve per keyframe. The card turns in 3D to its back face; the moment it is edge-on is hidden
// by a small blur, from how fast it turns, and a small scale dip.

export type IdleGreetingMotionName = "wave" | "smile" | "cheer" | "sparkles";

interface IdleGreetingParts {
  card: HTMLElement;
  front: HTMLElement;
  back: HTMLElement | undefined;
}

const SAMPLE_COUNT = 30;
/** The motion starts after the crossfade from the previous greeting. */
const MOTION_DELAY = 250;
const TURN_BLUR_LIMIT = 0.6;
const TURN_BLUR_PER_DEGREE_PER_MS = 0.75;
const EDGE_SCALE_DIP = 0.07;

/** Plays the motion of a greeting that just showed, and returns its animations to cancel. */
export function playIdleGreetingMotion(name: IdleGreetingMotionName, layer: HTMLElement): Animation[] {
  const card = layer.querySelector<HTMLElement>(".dynamic-island-surface-idle-greeting-card");
  const front = card?.querySelector<HTMLElement>(".dynamic-island-surface-idle-greeting-face");
  if (!card?.animate || !front) return [];
  const back = card.querySelector<HTMLElement>(".dynamic-island-surface-idle-greeting-face-back") ?? undefined;
  const parts = { card, front, back };
  if (name === "wave") return playWave(parts);
  if (name === "smile") return playSmile(parts);
  if (name === "cheer") return playCheer(parts);
  return [];
}

/** The hand waves from the wrist, then the card turns to the heart hands. */
function playWave(parts: IdleGreetingParts): Animation[] {
  const duration = 2000;
  const turn = spring(0.62, 0.7);
  const theta = (t: number) => 180 * turn(t - 820);
  const wave = (t: number) => {
    if (t >= 820) return 0;
    const seconds = t / 1000;
    const envelope = Math.sqrt(Math.sin(Math.PI * Math.min(1, t / 820)));
    return 20 * Math.sin(2 * Math.PI * 2.4 * seconds) * Math.exp(-2.2 * seconds) * envelope;
  };
  parts.front.style.transformOrigin = "70% 80%";
  return [
    animate(parts.card, duration, (t) => ({ transform: `rotateY(${theta(t)}deg)`, scale: edgeScale(theta(t)) }), {
      transform: "rotateY(180deg)",
      scale: "1",
    }),
    animate(parts.front, duration, (t) => ({ rotate: `${wave(t)}deg`, filter: turnBlur(theta, t) }), {
      rotate: "0deg",
      filter: "blur(0px)",
    }),
    ...faceBlur(parts.back, duration, theta),
  ];
}

/** The smile turns once like a ball, with a small hop, and lands on the grin. */
function playSmile(parts: IdleGreetingParts): Animation[] {
  const duration = 1500;
  const turn = spring(0.6, 0.8);
  const theta = (t: number) => 180 * turn(t);
  const hop = (t: number) => -1.5 * Math.sin(Math.PI * clamp(t / 650, 0, 1));
  return [
    animate(
      parts.card,
      duration,
      (t) => ({ transform: `rotateY(${theta(t)}deg)`, translate: `0 ${hop(t)}px`, scale: edgeScale(theta(t)) }),
      { transform: "rotateY(180deg)", translate: "0 0", scale: "1" },
    ),
    ...faceBlur(parts.front, duration, theta),
    ...faceBlur(parts.back, duration, theta),
  ];
}

/** The raised hands turn to clapping hands, clap twice, turn back raised, and lift. */
function playCheer(parts: IdleGreetingParts): Animation[] {
  const duration = 2400;
  const turn = spring(0.62, 0.65);
  const lift = spring(0.5, 0.55);
  const theta = (t: number) => 180 * turn(t) + 180 * turn(t - 1350);
  const rise = (t: number) => -2.2 * (lift(t - 1450) - lift(t - 1850));
  const clap = (t: number) =>
    t < 650 || t > 1250 ? 1 : 1 - 0.2 * Math.abs(Math.sin((2 * Math.PI * (t - 650)) / 600)) ** 1.5;
  return [
    animate(
      parts.card,
      duration,
      (t) => ({ transform: `rotateY(${theta(t)}deg)`, translate: `0 ${rise(t)}px`, scale: edgeScale(theta(t)) }),
      { transform: "rotateY(360deg)", translate: "0 0", scale: "1" },
    ),
    ...faceBlur(parts.front, duration, theta),
    ...(parts.back
      ? [
          animate(parts.back, duration, (t) => ({ scale: `${clap(t)} 1`, filter: turnBlur(theta, t) }), {
            scale: "1 1",
            filter: "blur(0px)",
          }),
        ]
      : []),
  ];
}

function faceBlur(face: HTMLElement | undefined, duration: number, theta: (t: number) => number): Animation[] {
  if (!face) return [];
  return [animate(face, duration, (t) => ({ filter: turnBlur(theta, t) }), { filter: "blur(0px)" })];
}

/**
 * Samples a motion into keyframes. The last keyframe is exact, so the card rests square on its face,
 * and `fill: forwards` holds it there until the greeting changes.
 */
function animate(
  element: HTMLElement,
  duration: number,
  frame: (t: number) => Record<string, string | number>,
  final: Record<string, string>,
): Animation {
  const keyframes: Keyframe[] = Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => {
    const offset = index / SAMPLE_COUNT;
    const values = index === SAMPLE_COUNT ? final : frame(duration * offset);
    return { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])), offset };
  });
  return element.animate(keyframes, { duration, delay: MOTION_DELAY, easing: "linear", fill: "forwards" });
}

/** A blur while the card turns fast, so the edge-on moment does not read as a thin line. */
function turnBlur(theta: (t: number) => number, t: number): string {
  const degreesPerMs = Math.abs(theta(t + 4) - theta(t - 4)) / 8;
  return `blur(${clamp(degreesPerMs * TURN_BLUR_PER_DEGREE_PER_MS, 0, TURN_BLUR_LIMIT)}px)`;
}

/** The card gets a little smaller as it turns edge-on. */
function edgeScale(theta: number): number {
  return 1 - EDGE_SCALE_DIP * Math.abs(Math.sin((theta * Math.PI) / 180));
}

/** A damped spring from 0 to 1, for a time in milliseconds; 0 before it starts. */
function spring(dampingRatio: number, responseSeconds: number): (t: number) => number {
  const omega = (2 * Math.PI) / responseSeconds;
  const damped = omega * Math.sqrt(1 - dampingRatio * dampingRatio);
  return (t) => {
    if (t <= 0) return 0;
    const seconds = t / 1000;
    const decay = Math.exp(-dampingRatio * omega * seconds);
    return 1 - decay * (Math.cos(damped * seconds) + ((dampingRatio * omega) / damped) * Math.sin(damped * seconds));
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
