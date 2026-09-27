// The frame that both videos draw into: the camera, the backdrop, the particle canvas, the flash,
// the vignette and the grain. Each video's main.ts adds its scenes and moves the camera.
// `registerPromo` gives render.ts its `window.promo` handle and adds the `?play` player.

import { html } from "./dom";
import { Effects, Grain } from "./fx";
import { type RenderScene, readPalette, type SceneContext } from "./scene";
import { ease, FPS, noise, progress, STAGE_HEIGHT, STAGE_WIDTH } from "./timeline";

interface Promo {
  duration: number;
  fps: number;
  ready: Promise<void>;
  seek(t: number): void;
  /** The soundtrack as a base64 16-bit WAV, for a video that synthesizes its sound. */
  renderAudio?: () => Promise<string>;
}

declare global {
  interface Window {
    promo: Promo;
  }
}

export interface Stage {
  world: HTMLElement;
  grid: HTMLElement;
  pulse: HTMLElement;
  glow: HTMLElement;
  content: HTMLElement;
  flash: HTMLElement;
  context: SceneContext;
  /** Draws the scenes, the particles, the backdrop spot and the grain at `t`. */
  draw(t: number): void;
}

export async function createStage(createScenes: (context: SceneContext) => RenderScene[]): Promise<Stage> {
  const stage = document.getElementById("stage");
  if (!stage) throw new Error("The page has no #stage element.");
  const fitStage = () => {
    const scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
    stage.style.transform = `scale(${scale})`;
  };
  fitStage();
  window.addEventListener("resize", fitStage);

  await Promise.all([500, 600, 650, 700, 800].map((weight) => document.fonts.load(`${weight} 100px "Inter Variable"`)));
  await document.fonts.ready;

  const world = html("div", "camera", stage);
  const backdrop = html("div", "backdrop", world);
  const spot = html("div", "spot", backdrop);
  const grid = html("div", "grid", backdrop);
  const pulse = html("div", "grid grid-bright", backdrop);
  const glow = html("div", "glow", backdrop);
  const content = html("div", "layer", world);

  let spotColor = "";
  let spotOpacity = 0;
  const context: SceneContext = {
    content,
    palette: readPalette(),
    backdrop: {
      spot(color, opacity) {
        spotColor = color;
        spotOpacity = opacity;
      },
    },
    bursts: [],
    rings: [],
    overlays: [],
  };
  const scenes = createScenes(context);
  const effects = new Effects(world, context.bursts, context.rings);
  const flash = html("div", "flash", stage);
  html("div", "vignette", stage);
  const grain = new Grain(stage);

  const draw = (t: number) => {
    spotOpacity = 0;
    for (const scene of scenes) scene(t);
    effects.render(t, (canvas) => {
      for (const overlay of context.overlays) overlay(canvas, t);
    });
    spot.style.background = spotColor;
    spot.style.opacity = String(spotOpacity);
    grain.render(t);
  };
  return { world, grid, pulse, glow, content, flash, context, draw };
}

/** The bright ring that runs out from the middle of the grid after the last of `pulses`. */
export function drawGridPulse(stage: Stage, t: number, pulses: readonly number[], scale: number) {
  const last = [...pulses].reverse().find((at) => t >= at);
  const ring = last === undefined ? 1 : progress(t, last, 1);
  stage.pulse.style.opacity = ring < 1 ? String(1 - ring) : "0";
  if (ring < 1) {
    const radius = 1700 * ease.outExpo(ring);
    stage.pulse.style.maskImage = `radial-gradient(circle at 50% 50%, var(--openbot-transparent) ${radius - 160}px, var(--openbot-mask-solid) ${radius}px, var(--openbot-transparent) ${radius + 60}px)`;
    stage.pulse.style.transform = `scale(${scale})`;
  }
}

/** Shakes the camera by `shake` pixels and pushes it in by `pump`. */
export function moveCamera(stage: Stage, t: number, shake: number, pump: number) {
  stage.world.style.transform = `translate(${shake * noise(1, t * 38)}px, ${shake * noise(2, t * 38)}px) rotate(${shake * 0.03 * noise(3, t * 30)}deg) scale(${pump})`;
}

/** The color split on the hits, `split` pixels to each side. */
export function splitColor(stage: Stage, split: number) {
  stage.content.style.filter =
    split > 0.3
      ? `drop-shadow(${split}px 0 0 var(--promo-split-warm)) drop-shadow(${-split}px 0 0 var(--promo-split-cool))`
      : "";
}

export interface Soundtrack {
  buffer: AudioBuffer;
  /** Where the video's `t = 0` is in the buffer, in seconds. */
  offset: number;
}

export function registerPromo(options: {
  duration: number;
  build: () => Promise<(t: number) => void>;
  /** The sound that `?play` plays. */
  soundtrack: (audio: BaseAudioContext) => Promise<Soundtrack>;
  renderAudio?: () => Promise<string>;
}) {
  const { duration } = options;
  let draw: (t: number) => void = () => undefined;
  const ready = options.build().then((render) => {
    draw = render;
    const start = Number(new URLSearchParams(window.location.search).get("t") ?? 0);
    draw(Number.isFinite(start) ? start : 0);
  });

  window.promo = { duration, fps: FPS, ready, seek: (t) => draw(t), renderAudio: options.renderAudio };

  if (new URLSearchParams(window.location.search).has("play")) {
    void ready.then(() => createPlayer(duration, (t) => draw(t), options.soundtrack));
  }
}

/** A play button and a scrub bar, for review in a normal browser. Not used by the renderer. */
function createPlayer(
  duration: number,
  draw: (t: number) => void,
  load: (audio: BaseAudioContext) => Promise<Soundtrack>,
) {
  const bar = html("div", "player", document.body);
  const button = html("button", "", bar, "Play");
  const scrub = html("input", "", bar);
  const clock = html("span", "", bar, "0.00");
  Object.assign(scrub, { type: "range", min: "0", max: String(duration), step: String(1 / FPS), value: "0" });
  let audio: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let soundtrack: Soundtrack | undefined;
  let startedAt = 0;
  let from = 0;
  let frame = 0;

  const show = (t: number) => {
    draw(t);
    scrub.value = String(t);
    clock.textContent = t.toFixed(2);
  };
  const stop = () => {
    source?.stop();
    source = undefined;
    cancelAnimationFrame(frame);
    button.textContent = "Play";
  };
  const tick = () => {
    if (!audio) return;
    const t = from + audio.currentTime - startedAt;
    if (t >= duration) {
      stop();
      show(duration - 1 / FPS);
      return;
    }
    show(t);
    frame = requestAnimationFrame(tick);
  };
  button.addEventListener("click", async () => {
    if (source) return stop();
    audio ??= new AudioContext();
    soundtrack ??= await load(audio);
    from = Number(scrub.value) >= duration - 0.05 ? 0 : Number(scrub.value);
    source = audio.createBufferSource();
    source.buffer = soundtrack.buffer;
    source.connect(audio.destination);
    startedAt = audio.currentTime;
    source.start(0, soundtrack.offset + from);
    button.textContent = "Pause";
    tick();
  });
  scrub.addEventListener("input", () => {
    stop();
    show(Number(scrub.value));
  });
}
