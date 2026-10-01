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
/** The motion starts as the crossfade from the previous greeting settles. */
const MOTION_DELAY = 350;
const TURN_BLUR_LIMIT = 1.4;
const TURN_SPEED_BLUR_LIMIT = 0.4;
const TURN_BLUR_PER_DEGREE_PER_MS = 0.75;
const TURN_EDGE_BLUR = 1.2;
const TURN_EDGE_FADE = 0.5;
const TURN_EDGE_SHADE = 0.3;
/** The look of a face at rest, so the last keyframe lists the same filter functions. */
const FACE_AT_REST = { filter: "blur(0px) brightness(1)", opacity: "1" };
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
  return playSparkles(front);
}

/**
 * Each star lights up on a soft spring, the large one first, and then shimmers: a slow breath in
 * light, size and tilt, each star at its own pace and phase, so they glint in turn. The stars are
 * copies of the glyph, each masked to one star.
 */
function playSparkles(face: HTMLElement): Animation[] {
  const duration = 7000;
  const light = spring(0.75, 0.6);
  const stars = Array.from(face.querySelectorAll<HTMLElement>(".dynamic-island-surface-idle-greeting-sparkle"));
  return stars.map((star, index) => {
    const start = index * 260;
    const period = 1700 + index * 380;
    const phase = index * 2.1;
    // The shimmer fades in after the star is lit and out before the greeting changes.
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

/** The hand waves from the wrist, the card turns to the heart hands, and then on, back to the wave. */
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

/** The smile turns like a ball, with a small hop, to the grin, and after a moment back to the smile. */
function playSmile(parts: IdleGreetingParts): Animation[] {
  const duration = 3300;
  const turn = spring(0.6, 0.8);
  const theta = (t: number) => 180 * turn(t) + 180 * turn(t - 2200);
  const hop = (t: number) =>
    -1.5 * Math.sin(Math.PI * clamp(t / 650, 0, 1)) - Math.sin(Math.PI * clamp((t - 2200) / 650, 0, 1));
  const sphere = parts.card.querySelector<HTMLCanvasElement>(".dynamic-island-surface-idle-greeting-sphere");
  const ball = sphere && parts.back ? playSphere(sphere, parts.front, parts.back, duration, theta) : [];
  if (ball.length > 0) {
    // The ball turns in the canvas, so the card only hops.
    return [...ball, animate(parts.card, duration, (t) => ({ translate: `0 ${hop(t)}px` }), { translate: "0 0" })];
  }
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

interface EmojiTexture {
  pixels: Uint8ClampedArray;
  size: number;
  /** The centre and the radius of the round face in the texture, in texture pixels. */
  centerX: number;
  centerY: number;
  radius: number;
}

/**
 * Turns a round emoji as a ball: the front face is drawn on the near half of a sphere and the back
 * face on the far half, so the face slides over the curve and goes behind the horizon as the grin
 * comes round. A light from the upper left shades the ball and gives it a small highlight while it
 * turns; at rest the drawing is the plain glyph. Both faces come from the system emoji font at run
 * time. The faces hide while the canvas shows, and come back at the end.
 */
function playSphere(
  sphere: HTMLCanvasElement,
  front: HTMLElement,
  back: HTMLElement,
  duration: number,
  theta: (t: number) => number,
): Animation[] {
  const pixels = Math.max(8, Math.round(sphere.clientWidth * window.devicePixelRatio));
  sphere.width = pixels;
  sphere.height = pixels;
  const context = sphere.getContext("2d");
  const style = getComputedStyle(front);
  const fontSize = (Number.parseFloat(style.fontSize) / sphere.clientWidth) * pixels * 2;
  const frontTexture = emojiTexture(front.textContent ?? "", pixels * 2, fontSize, style.fontFamily);
  const backTexture = emojiTexture(back.textContent ?? "", pixels * 2, fontSize, style.fontFamily);
  if (!context || !frontTexture || !backTexture) return [];
  const image = context.createImageData(pixels, pixels);
  const show = 80 / duration;
  const visibility = sphere.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: show },
      { opacity: 1, offset: 1 - show },
      { opacity: 0, offset: 1 },
    ],
    { duration, delay: MOTION_DELAY, fill: "forwards" },
  );
  const faces = [front, back].map((face) =>
    face.animate(
      [
        { opacity: 1, offset: 0 },
        { opacity: 0, offset: show },
        { opacity: 0, offset: 1 - show },
        { opacity: 1, offset: 1 },
      ],
      { duration, delay: MOTION_DELAY, fill: "forwards" },
    ),
  );
  const tick = () => {
    if (visibility.playState === "idle") {
      context.clearRect(0, 0, pixels, pixels);
      return;
    }
    const t = clamp(Number(visibility.currentTime ?? 0) - MOTION_DELAY, 0, duration);
    drawSphere(image, frontTexture, backTexture, theta(t));
    context.putImageData(image, 0, 0);
    if (visibility.playState !== "finished") requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return [visibility, ...faces];
}

const SPHERE_LIGHT = normalize([-0.4, -0.55, 0.73]);
const SPHERE_HALF = normalize([SPHERE_LIGHT[0], SPHERE_LIGHT[1], SPHERE_LIGHT[2] + 1]);

/** Draws the ball turned by `theta` degrees around its vertical axis. */
function drawSphere(image: ImageData, front: EmojiTexture, back: EmojiTexture, theta: number): void {
  const size = image.width;
  const scale = size / front.size;
  const centerX = front.centerX * scale;
  const centerY = front.centerY * scale;
  const radius = front.radius * scale;
  const angle = (theta * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // The shading only shows while the ball turns, so at rest the drawing is the plain glyph.
  const shading = Math.abs(sin);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const nx = (x + 0.5 - centerX) / radius;
      const ny = (y + 0.5 - centerY) / radius;
      const distance = nx * nx + ny * ny;
      if (distance >= 1) {
        data[index + 3] = 0;
        continue;
      }
      const nz = Math.sqrt(1 - distance);
      // The point of the ball under this pixel, turned back into the ball's own frame.
      const ox = cos * nx - sin * nz;
      const oz = sin * nx + cos * nz;
      const texture = oz >= 0 ? front : back;
      const tx = oz >= 0 ? ox : -ox;
      sample(texture, texture.centerX + tx * texture.radius, texture.centerY + ny * texture.radius, SAMPLED);
      const r = SAMPLED[0] ?? 0;
      const g = SAMPLED[1] ?? 0;
      const b = SAMPLED[2] ?? 0;
      const a = SAMPLED[3] ?? 0;
      const diffuse = Math.max(0, nx * SPHERE_LIGHT[0] + ny * SPHERE_LIGHT[1] + nz * SPHERE_LIGHT[2]);
      const shade = 1 - shading * 0.55 * (1 - diffuse);
      const highlight =
        shading * 0.4 * Math.max(0, nx * SPHERE_HALF[0] + ny * SPHERE_HALF[1] + nz * SPHERE_HALF[2]) ** 28;
      const edge = clamp((1 - Math.sqrt(distance)) * radius, 0, 1);
      data[index] = r * shade + 255 * highlight;
      data[index + 1] = g * shade + 255 * highlight;
      data[index + 2] = b * shade + 255 * highlight;
      data[index + 3] = a * edge;
    }
  }
}

/** The emoji drawn with the system emoji font, and where its round face is. */
function emojiTexture(emoji: string, size: number, fontSize: number, fontFamily: string): EmojiTexture | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !emoji) return undefined;
  context.font = `${fontSize}px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(emoji, size / 2, size / 2);
  const pixels = context.getImageData(0, 0, size, size).data;
  let left = size;
  let right = -1;
  let top = size;
  let bottom = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((pixels[(y * size + x) * 4 + 3] ?? 0) < 16) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return undefined;
  return {
    pixels,
    size,
    centerX: (left + right + 1) / 2,
    centerY: (top + bottom + 1) / 2,
    radius: Math.max(right - left + 1, bottom - top + 1) / 2,
  };
}

/** One reused sample, so drawing a frame does not allocate for each pixel. */
const SAMPLED = new Float32Array(4);

/** A bilinear sample into `out`, interpolated on premultiplied colour so the edge does not darken. */
function sample(texture: EmojiTexture, u: number, v: number, out: Float32Array): void {
  const x = clamp(u - 0.5, 0, texture.size - 1);
  const y = clamp(v - 0.5, 0, texture.size - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(texture.size - 1, x0 + 1);
  const y1 = Math.min(texture.size - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  out.fill(0);
  addSample(texture, x0, y0, (1 - fx) * (1 - fy), out);
  addSample(texture, x1, y0, fx * (1 - fy), out);
  addSample(texture, x0, y1, (1 - fx) * fy, out);
  addSample(texture, x1, y1, fx * fy, out);
  const alpha = out[3] ?? 0;
  if (alpha > 0) {
    out[0] = (out[0] ?? 0) / alpha;
    out[1] = (out[1] ?? 0) / alpha;
    out[2] = (out[2] ?? 0) / alpha;
  }
}

function addSample(texture: EmojiTexture, x: number, y: number, weight: number, out: Float32Array): void {
  const index = (y * texture.size + x) * 4;
  const alpha = (texture.pixels[index + 3] ?? 0) * weight;
  out[0] = (out[0] ?? 0) + (texture.pixels[index] ?? 0) * alpha;
  out[1] = (out[1] ?? 0) + (texture.pixels[index + 1] ?? 0) * alpha;
  out[2] = (out[2] ?? 0) + (texture.pixels[index + 2] ?? 0) * alpha;
  out[3] = alpha + (out[3] ?? 0);
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * The raised hands turn to clapping hands and clap twice, each clap a squash with a small rebound
 * and tilt. Then they crouch a little, throw themselves up as they turn back raised, and land on a
 * spring.
 */
function playCheer(parts: IdleGreetingParts): Animation[] {
  const duration = 2700;
  const turn = spring(0.62, 0.65);
  const launch = spring(0.45, 0.5);
  const land = spring(0.55, 0.5);
  const claps = [700, 1000];
  const theta = (t: number) => 180 * turn(t) + 180 * turn(t - 1420);
  // A crouch before the throw, the throw up, and the landing.
  const crouch = (t: number) => 0.8 * Math.sin(Math.PI * clamp((t - 1280) / 160, 0, 1));
  const rise = (t: number) => crouch(t) - 3 * (launch(t - 1420) - land(t - 1800));
  const pop = (t: number) => 1 - (0.04 * crouch(t)) / 0.8 + 0.1 * (launch(t - 1420) - land(t - 1760));
  // Each clap squashes the hands across and stretches them a little up, then rebounds.
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

/**
 * Samples a motion into keyframes. The last keyframe is exact, so the card rests square on its face,
 * and `fill: forwards` holds it there until the greeting changes. A motion that does not start from
 * rest, such as the sparkles, also holds its first keyframe through the delay (`both`).
 */
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

/**
 * How a face looks as the card turns, for an illusion of depth. Edge-on, the face blurs, fades and
 * darkens, as a card turning away from the light does; a fast turn adds a little motion blur. Both
 * faces get the same look, and the one turned away is hidden by its back face.
 */
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
