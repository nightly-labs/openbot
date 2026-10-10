// The stage: the real app in a window, a camera, a cursor, captions, and the real logo for the
// intro and the outro. render.ts calls `appVideo.frame(t)` once per frame, in time order from 0.
// The page draws the frame and returns the mouse and key input that render.ts plays as real input.

import { AppLogo } from "@openbot/brand";
import { render } from "@solidjs/web";
import { APP, BEAT, CUE, type FrameInput, STAGE } from "../cues";
import { createAnimationStepper } from "./animations";
import { clamp, ease, keyframes, mix, progress, spring } from "./motion";
import "./stage.css";

const COPY = {
  headline: ["Persistent", "AI", "teammates", "on", "your", "computer."],
  captions: [
    // The composer is at the bottom of the app, and the header and the model picker are at the top.
    { from: CUE.askCaption, to: CUE.typeTo - BEAT, text: "Ask once.", place: "top" },
    { from: CUE.teamCaption, to: CUE.researchAnswerTo, text: "Your agents hand off the work.", place: "bottom" },
    { from: CUE.modelsCaption, to: CUE.modelClose, text: "Any model. The plans you already pay for.", place: "bottom" },
  ],
  name: "OpenBot",
  tagline: "Free. No account. On your computer.",
  url: "openbot.run",
};

// ---------------------------------------------------------------------------------------------
// Camera. `x` and `y` are the app point at the stage center; `scale` is app pixels to stage pixels.

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const WIDE: Camera = { x: APP.width / 2, y: APP.height / 2, scale: 1.08 };
const COMPOSER: Camera = { x: 880, y: 780, scale: 1.6 };
const ANSWER: Camera = { x: 880, y: 560, scale: 1.36 };
const SIDEBAR: Camera = { x: 560, y: 420, scale: 1.2 };
const MODELS: Camera = { x: 1060, y: 300, scale: 1.5 };

const CAMERA = [
  { t: CUE.settled, value: WIDE },
  { t: CUE.composerClick - BEAT, value: WIDE },
  { t: CUE.typeFrom, value: COMPOSER },
  { t: CUE.send, value: COMPOSER },
  { t: CUE.thinking[0], value: ANSWER },
  { t: CUE.answerTo + BEAT, value: { ...ANSWER, y: 500 } },
  { t: CUE.handoff, value: { ...ANSWER, y: 500 } },
  { t: CUE.teamCaption, value: SIDEBAR },
  { t: CUE.researchClick + 0.3, value: SIDEBAR },
  { t: CUE.researchThinking + BEAT, value: ANSWER },
  { t: CUE.researchAnswerTo + BEAT, value: { ...ANSWER, y: 480 } },
  { t: CUE.modelsCaption, value: { ...ANSWER, y: 480 } },
  { t: CUE.modelClick, value: MODELS },
  { t: CUE.modelClose, value: MODELS },
  { t: CUE.outro, value: WIDE },
];

const blendCamera = (from: Camera, to: Camera, amount: number): Camera => {
  // Zoom moves in log space, so a zoom in and a zoom out look the same speed.
  const scale = Math.exp(mix(Math.log(from.scale), Math.log(to.scale), amount));
  return { x: mix(from.x, to.x, amount), y: mix(from.y, to.y, amount), scale };
};

/** The window's top left corner on the stage. A zoomed window always fills the stage. */
function cameraOrigin(t: number): { left: number; top: number; scale: number } {
  const camera = keyframes(t, CAMERA, blendCamera, ease.inOutQuint);
  const place = (stage: number, app: number, center: number) => {
    const size = app * camera.scale;
    const origin = stage / 2 - center * camera.scale;
    return size <= stage ? (stage - size) / 2 : clamp(origin, stage - size, 0);
  };
  return {
    left: place(STAGE.width, APP.width, camera.x),
    top: place(STAGE.height, APP.height, camera.y),
    scale: camera.scale,
  };
}

// ---------------------------------------------------------------------------------------------
// Targets in the app, found by role and text, so the video follows the real layout.

interface Point {
  space: "app" | "stage";
  x: number;
  y: number;
}

function appDocument(): Document {
  const document = frameElement().contentDocument;
  if (!document) throw new Error("The app frame has no document.");
  return document;
}

function frameElement(): HTMLIFrameElement {
  const element = document.querySelector<HTMLIFrameElement>("#app");
  if (!element) throw new Error("The stage has no #app frame.");
  return element;
}

function center(element: Element, dx = 0.5): Point {
  const rect = element.getBoundingClientRect();
  return { space: "app", x: rect.left + rect.width * dx, y: rect.top + rect.height / 2 };
}

const CLICKABLE =
  "a, button, [role='button'], [role='option'], [role='menuitem'], [role='menuitemradio'], [role='link']";

/** The clickable element that holds `text`, in the app area `inside`. */
function byText(text: RegExp, inside: (rect: DOMRect) => boolean): Element {
  const document = appDocument();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!text.test(node.textContent ?? "")) continue;
    const element = node.parentElement?.closest(CLICKABLE) ?? node.parentElement;
    if (element && inside(element.getBoundingClientRect())) return element;
  }
  throw new Error(`The app shows no clickable ${text} in the expected area.`);
}

function bySelector(selector: string, match: (element: Element) => boolean = () => true): Element {
  const elements = [...appDocument().querySelectorAll(selector)];
  const element = elements.find(match);
  if (!element) {
    const labels = elements.map((item) => item.getAttribute("aria-label") ?? item.textContent).join(", ");
    throw new Error(`The app shows no matching ${selector}. It shows: ${labels || "none"}.`);
  }
  return element;
}

const TARGET = {
  offStage: (): Point => ({ space: "stage", x: STAGE.width * 0.82, y: STAGE.height + 60 }),
  composer: (): Point => {
    const editor = appDocument().querySelector("[role='textbox'][contenteditable='true']");
    if (!editor) throw new Error("The app shows no composer.");
    return center(editor, 0.18);
  },
  /** A place to leave the cursor near `point`, out of the way of the content. */
  rest: (point: Point, dx: number, dy: number): Point => ({ ...point, x: point.x + dx, y: point.y + dy }),
  research: (): Point =>
    center(
      byText(/^Research$/u, (rect) => rect.left < 420),
      0.3,
    ),
  modelButton: (): Point => center(bySelector(".provider-model-trigger"), 0.3),
  provider: (name: RegExp) => (): Point =>
    center(bySelector(".provider-model-rail-button", (element) => name.test(element.getAttribute("aria-label") ?? ""))),
  logo: (): Point => ({ space: "stage", x: STAGE.width / 2 + 40, y: OUTRO_LOGO_Y + 30 }),
};

// ---------------------------------------------------------------------------------------------
// The cursor: moves between targets, clicks, and types.

interface Move {
  from: number;
  to: number;
  target: () => Point;
  resolved?: Point;
}

const MOVES: Move[] = [
  { from: CUE.settled, to: CUE.composerClick, target: TARGET.composer },
  { from: CUE.send, to: CUE.send + 2 * BEAT, target: () => TARGET.rest(TARGET.composer(), 700, 0) },
  { from: CUE.handoff + BEAT, to: CUE.researchClick, target: TARGET.research },
  {
    from: CUE.researchClick + BEAT,
    to: CUE.researchClick + 3 * BEAT,
    target: () => TARGET.rest(TARGET.research(), 40, 300),
  },
  { from: CUE.modelsCaption - BEAT, to: CUE.modelClick, target: TARGET.modelButton },
  { from: CUE.modelTabs[0] - BEAT, to: CUE.modelTabs[0], target: TARGET.provider(/^(Codex|ChatGPT|OpenAI)/u) },
  { from: CUE.modelTabs[1] - 0.6 * BEAT, to: CUE.modelTabs[1], target: TARGET.provider(/^Grok/u) },
  { from: CUE.modelTabs[2] - 0.6 * BEAT, to: CUE.modelTabs[2], target: TARGET.provider(/^Claude/u) },
  { from: CUE.modelClose, to: CUE.outro, target: TARGET.offStage },
  { from: CUE.url, to: CUE.wink, target: TARGET.logo },
];

const CLICKS = [
  CUE.composerClick,
  CUE.researchClick,
  CUE.modelClick,
  ...CUE.modelTabs,
  ...[0, 1, 2, 3, 4].map((i) => CUE.wink + i * 0.16),
];

/** When the cursor shows. It hides while the window rises and while the outro text comes in. */
const CURSOR_SHOWN = [
  { from: CUE.settled, to: CUE.outro },
  { from: CUE.url, to: CUE.end },
];

interface Key {
  at: number;
  text?: string;
  press?: string;
}

/** The message, typed key by key. The `@` names open the mention picker; Tab picks the agent. */
function typingSchedule(): Key[] {
  const parts: ({ text: string } | { pause: number } | { press: string })[] = [
    { text: "Plan team pricing for Friday with " },
    { text: "@Res" },
    { pause: 0.5 },
    { press: "Tab" },
    { text: "and " },
    { text: "@Bui" },
    { pause: 0.5 },
    { press: "Tab" },
  ];
  const characters = parts.reduce((sum, part) => sum + ("text" in part ? part.text.length : 1), 0);
  const pauses = parts.reduce((sum, part) => sum + ("pause" in part ? part.pause : 0), 0);
  const interval = (CUE.typeTo - CUE.typeFrom - pauses) / characters;
  const keys: Key[] = [];
  let at = CUE.typeFrom;
  let seed = 7;
  for (const part of parts) {
    if ("pause" in part) at += part.pause;
    else if ("press" in part) {
      at += interval;
      keys.push({ at, press: part.press });
    } else {
      for (const character of part.text) {
        // A small, fixed jitter, so the typing does not look like a metronome.
        seed = (seed * 9301 + 49297) % 233280;
        at += interval * (0.6 + (seed / 233280) * 0.8);
        keys.push({ at, text: character });
      }
    }
  }
  keys.push({ at: CUE.send, press: "Enter" });
  keys.push({ at: CUE.modelClose, press: "Escape" });
  return keys;
}

const KEYS = typingSchedule();

// ---------------------------------------------------------------------------------------------
// The DOM.

const OUTRO_LOGO_Y = 380;

function Stage() {
  return (
    <div id="stage">
      <div class="backdrop">
        <div class="blob blob-lilac" />
        <div class="blob blob-cyan" />
        <div class="grid" />
      </div>
      <div class="rise">
        <div class="window">
          <iframe id="app" title="OpenBot" src="./app.html" width={APP.width} height={APP.height} />
          <div class="traffic-lights" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
      <div class="intro">
        <h1 class="headline">
          {COPY.headline.map((word, index) => (
            <>
              <span class="word">{word}</span>
              {index === 2 ? <br /> : " "}
            </>
          ))}
        </h1>
      </div>
      <div class="outro">
        <div class="name">{COPY.name}</div>
        <div class="tagline">{COPY.tagline}</div>
        <div class="url">{COPY.url}</div>
      </div>
      <div class="logo-mount">
        <div class="logo-halo" />
        <AppLogo variant="production" animation="blink" interactive class="logo" />
      </div>
      <div class="caption">
        <span />
      </div>
      <div class="click-ring" />
      <svg class="cursor" viewBox="0 0 28 28" aria-hidden="true">
        <path d="M6 3.5 L6 22 L10.6 17.7 L13.6 24.6 L16.9 23.2 L13.9 16.4 L20.2 16.4 Z" />
      </svg>
      <div class="fade" />
    </div>
  );
}

render(() => <Stage />, document.body);

function element<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`The stage has no ${selector}.`);
  return found;
}

const view = {
  backdrop: element(".backdrop"),
  lilac: element(".blob-lilac"),
  cyan: element(".blob-cyan"),
  rise: element(".rise"),
  window: element(".window"),
  words: [...document.querySelectorAll<HTMLElement>(".word")],
  logoMount: element(".logo-mount"),
  halo: element(".logo-halo"),
  name: element(".outro .name"),
  tagline: element(".outro .tagline"),
  url: element(".outro .url"),
  caption: element(".caption"),
  captionText: element(".caption span"),
  ring: element(".click-ring"),
  cursor: element<SVGSVGElement>(".cursor"),
  fade: element(".fade"),
};

// ---------------------------------------------------------------------------------------------
// One frame.

/** A soft pulse on every beat after the drop, for the backdrop. */
function beatPulse(t: number): number {
  if (t < 0) return 0;
  const sinceBeat = t % BEAT;
  return Math.exp(-sinceBeat * 7);
}

function drawBackdrop(t: number) {
  const pulse = beatPulse(t);
  view.lilac.style.transform = `translate(${Math.sin(t * 0.31) * 120}px, ${Math.cos(t * 0.23) * 60}px)`;
  view.cyan.style.transform = `translate(${Math.cos(t * 0.27) * 140}px, ${Math.sin(t * 0.19) * 80}px)`;
  view.backdrop.style.opacity = String(0.82 + pulse * 0.18);
}

function drawIntro(t: number) {
  const leave = ease.inCubic(progress(t, CUE.window - 0.1, CUE.window + 2 * BEAT));
  view.words.forEach((word, index) => {
    const start = CUE.words[index] ?? CUE.words[0];
    const amount = spring(t - start, 2.4, 0.7);
    const shown = clamp(amount * 1.6);
    word.style.opacity = String(shown * (1 - leave));
    word.style.transform = `translateY(${(1 - amount) * 46 - leave * 140}px)`;
    word.style.filter = `blur(${(1 - shown) * 14 + leave * 10}px)`;
  });
}

function drawLogo(t: number) {
  const introIn = spring(t - CUE.logo, 1.9, 0.5);
  const introOut = ease.inCubic(progress(t, CUE.window - 0.1, CUE.window + 2 * BEAT));
  const outroIn = spring(t - CUE.outro - BEAT / 2, 1.9, 0.55);
  const inOutro = t >= CUE.outro;
  const scale = inOutro ? mix(0.3, 1, outroIn) : mix(0.3, 1, introIn);
  const y = inOutro ? OUTRO_LOGO_Y : 330 - introOut * 160;
  const opacity = inOutro ? clamp(outroIn * 2) : clamp(introIn * 2) * (1 - introOut);
  view.logoMount.style.transform = `translate(${STAGE.width / 2 - 100}px, ${y - 100}px) scale(${scale})`;
  view.logoMount.style.opacity = String(opacity);
  view.logoMount.style.filter = inOutro ? "none" : `blur(${introOut * 12}px)`;
  view.logoMount.style.visibility = opacity > 0.001 ? "visible" : "hidden";
  view.halo.style.opacity = String(0.55 + beatPulse(t) * 0.45);
}

function drawWindow(t: number) {
  const rise = spring(t - CUE.window, 1.1, 0.82);
  const leave = ease.inOutCubic(progress(t, CUE.outro, CUE.outro + 1.5 * BEAT));
  const shown = t >= CUE.window && leave < 1;
  view.rise.style.visibility = shown ? "visible" : "hidden";
  view.rise.style.transform = [
    `translateY(${(1 - rise) * 820 + leave * 120}px)`,
    `rotateX(${(1 - rise) * 28}deg)`,
    `scale(${mix(0.86, 1, rise) * mix(1, 0.86, leave)})`,
  ].join(" ");
  view.rise.style.opacity = String(clamp(rise * 3) * (1 - leave));
  view.rise.style.filter = leave > 0 ? `blur(${leave * 16}px)` : "none";

  const origin = cameraOrigin(t);
  view.window.style.transform = `translate(${origin.left}px, ${origin.top}px) scale(${origin.scale})`;
  return origin;
}

function drawCaption(t: number) {
  const caption = COPY.captions.find((item) => t >= item.from - 0.5 && t < item.to + 0.5);
  if (!caption) {
    view.caption.style.opacity = "0";
    return;
  }
  const enter = spring(t - caption.from, 2.2, 0.75);
  const exit = ease.inCubic(progress(t, caption.to, caption.to + 0.35));
  view.captionText.textContent = caption.text;
  view.caption.dataset.place = caption.place;
  view.caption.style.opacity = String(clamp(enter * 2) * (1 - exit));
  const away = caption.place === "top" ? -1 : 1;
  view.caption.style.transform = `translate(-50%, ${away * ((1 - enter) * 30 + exit * 16)}px) scale(${mix(0.94, 1, enter)})`;
}

function drawOutro(t: number) {
  const parts: [HTMLElement, number][] = [
    [view.name, CUE.outro + BEAT],
    [view.tagline, CUE.tagline],
    [view.url, CUE.url],
  ];
  for (const [part, start] of parts) {
    const amount = spring(t - start, 2.2, 0.72);
    const shown = clamp(amount * 1.6);
    part.style.opacity = String(shown);
    part.style.transform = `translateY(${(1 - amount) * 36}px)`;
    part.style.filter = `blur(${(1 - shown) * 10}px)`;
  }
  view.fade.style.opacity = String(ease.inCubic(progress(t, CUE.end - 0.6, CUE.end)));
}

function toStage(point: Point, origin: { left: number; top: number; scale: number }) {
  return point.space === "stage"
    ? { x: point.x, y: point.y }
    : { x: origin.left + point.x * origin.scale, y: origin.top + point.y * origin.scale };
}

function cursorPoint(t: number, origin: { left: number; top: number; scale: number }) {
  let position = toStage(TARGET.offStage(), origin);
  for (const move of MOVES) {
    if (t < move.from) break;
    move.resolved ??= move.target();
    const target = toStage(move.resolved, origin);
    const amount = ease.inOutCubic(progress(t, move.from, move.to));
    // A slight arc, like a hand that moves the mouse.
    const arc =
      Math.sin(amount * Math.PI) * Math.min(60, Math.hypot(target.x - position.x, target.y - position.y) * 0.08);
    position = { x: mix(position.x, target.x, amount), y: mix(position.y, target.y, amount) - arc };
  }
  return position;
}

function drawCursor(t: number, origin: { left: number; top: number; scale: number }) {
  const shown = CURSOR_SHOWN.some((range) => t >= range.from && t < range.to);
  if (!shown) {
    view.cursor.style.opacity = "0";
    return null;
  }
  const position = cursorPoint(t, origin);
  const since = Math.min(...CLICKS.map((click) => (t >= click ? t - click : Number.POSITIVE_INFINITY)));
  const press = since < 0.18 ? Math.sin((since / 0.18) * Math.PI) : 0;
  const size = 1.15 * (t >= CUE.outro ? 1.3 : origin.scale);
  view.cursor.style.opacity = "1";
  view.cursor.style.transform = `translate(${position.x - 6 * size}px, ${position.y - 3.5 * size}px) scale(${size * (1 - press * 0.14)})`;

  const ring = since < 0.55 ? since / 0.55 : 1;
  view.ring.style.opacity = String((1 - ring) * 0.9);
  view.ring.style.transform = `translate(${position.x - 30}px, ${position.y - 30}px) scale(${mix(0.3, 1.5, ease.outCubic(ring))})`;
  return position;
}

// ---------------------------------------------------------------------------------------------
// The frame loop that render.ts drives.

const stepStage = createAnimationStepper(document);
let stepApp: ((seconds: number) => void) | null = null;
let previous = -1;

function inputFor(t: number, mouse: { x: number; y: number } | null): FrameInput {
  const input: FrameInput = { mouse, down: false, up: false, type: "", press: [] };
  for (const click of CLICKS) {
    if (click <= t && click > previous) {
      input.down = true;
      input.up = true;
    }
  }
  for (const key of KEYS) {
    if (key.at <= t && key.at > previous) {
      if (key.text) input.type += key.text;
      if (key.press) input.press.push(key.press);
    }
  }
  return input;
}

async function frame(t: number): Promise<FrameInput> {
  if (t < previous) throw new Error(`Frames must go forward: ${t} came after ${previous}.`);
  const seconds = previous < 0 ? 0 : t - previous;
  const director = frameElement().contentWindow?.director;
  if (!director) throw new Error("The app has no director.");
  director.tick(t);
  // Solid updates the DOM in a microtask after the director changes the mock's state.
  await Promise.resolve();

  drawBackdrop(t);
  drawIntro(t);
  drawLogo(t);
  const origin = drawWindow(t);
  drawCaption(t);
  drawOutro(t);
  const mouse = drawCursor(t, origin);

  stepStage(seconds);
  stepApp?.(seconds);
  const input = inputFor(t, mouse);
  previous = t;
  return input;
}

async function whenReady(): Promise<void> {
  const app = frameElement();
  await new Promise<void>((resolve) => {
    const check = () => {
      const document = app.contentDocument;
      if (app.contentWindow?.director && document?.querySelector("[role='textbox'][contenteditable='true']")) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
  await document.fonts.ready;
  await appDocument().fonts.ready;
  stepApp = createAnimationStepper(appDocument());
}

window.appVideo = { ready: whenReady(), frame };
