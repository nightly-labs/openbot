import {
  createGlassLens,
  type GlassArea,
  type GlassInteraction,
  type GlassLensSettings,
  type GlassPoint,
  type GlassShape,
  type GlassView,
} from "./glass-lens";
import { fitSize, paintCentered, paintElement, paintRobot } from "./glass-scene";

const AMOUNT = "$0";
const WORD = "openbot";
const KONAMI = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
];
const CYCLE: readonly GlassShape[] = ["lens", "diamond", "prism", "torus", "blob", "pill"];
const PALETTE_TOKENS = ["--openbot-logo-production", "--openbot-logo-dev", "--openbot-logo-preview"];
const WHITE = "#ffffff";
const SHAKE_TRAVEL = 30;
const SHAKE_FLIPS = 4;
const SHAKE_WINDOW_MS = 1500;
const PARTY_MS = 3600;
const PARTY_STEP_MS = 140;
const STILL_MS = 2600;
const SMALL_PRINT_MS = 7000;
const SMALL_PRINT_PX = 13;
const ROBOT_MS = 4500;
const ROBOT_SCALE = 1.05;
const FOREVER_SCALE = 1.56;
const FOREVER_FIT = 0.96;
const AMOUNT_SPACING = -0.055;
const INTERACTIVE = "a, button, input, select, textarea, [role='button']";
const ACTIONS_GAP = 8;
const OPEN_AREA: GlassArea = { left: 0, top: 0, right: Number.POSITIVE_INFINITY, bottom: Number.POSITIVE_INFINITY };

export interface PricingGlassText {
  readonly smallPrint: string;
  readonly forever: string;
}

export interface PricingGlassParts {
  readonly section: HTMLElement;
  readonly copy: readonly HTMLElement[];
  readonly amount: HTMLElement;
  readonly actions: HTMLElement;
  readonly layer: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly handle: HTMLElement | undefined;
}

interface ShakeState {
  lastX: number;
  dir: number;
  travel: number;
  flips: number[];
}

interface EggState {
  party: boolean;
  hue: number;
  smallPrint: boolean;
  robot: boolean;
  forever: boolean;
  interaction: GlassInteraction;
}

type SceneMode = "amount" | "robot" | "print" | "forever";

const isInteractive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(INTERACTIVE));

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));

export function mountPricingGlass(parts: PricingGlassParts, text: () => PricingGlassText): () => void {
  const { section, amount, layer } = parts;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const styles = getComputedStyle(section);
  const palette = PALETTE_TOKENS.map((token) => styles.getPropertyValue(token).trim()).filter(Boolean);
  const state: EggState = {
    party: false,
    hue: 0,
    smallPrint: false,
    robot: false,
    forever: false,
    interaction: "follow",
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let partyLoop: ReturnType<typeof setInterval> | undefined;
  let stillTimer: ReturnType<typeof setTimeout> | undefined;
  let shake: ShakeState = { lastX: Number.NaN, dir: 0, travel: 0, flips: [] };
  let keys: string[] = [];
  let typed = "";
  let visible = false;
  let amountSize = Number.parseFloat(getComputedStyle(amount).fontSize) || 230;
  let home: GlassPoint = { x: 0, y: 0 };
  let area = OPEN_AREA;
  let layout = 0;

  const mode = (): SceneMode => {
    if (state.forever) return "forever";
    if (state.robot) return "robot";
    if (state.smallPrint) return "print";
    return "amount";
  };

  const paint = (ctx: CanvasRenderingContext2D, view: GlassView) => {
    const words = text();
    const origin = section.getBoundingClientRect();
    for (const element of parts.copy) paintElement(ctx, element, origin);
    const box = amount.getBoundingClientRect();
    const style = getComputedStyle(amount);
    const color = getComputedStyle(layer).color;
    amountSize = Number.parseFloat(style.fontSize) || amountSize;
    home = { x: box.left - origin.left + box.width / 2, y: box.top - origin.top + box.height / 2 };
    area = { ...OPEN_AREA, bottom: parts.actions.getBoundingClientRect().top - origin.top - ACTIONS_GAP };
    const scene = mode();
    if (scene === "amount") {
      paintElement(ctx, amount, origin, color);
      return;
    }
    if (scene === "robot") {
      paintRobot(ctx, home, amountSize * ROBOT_SCALE, color);
      return;
    }
    const font = { family: style.fontFamily, weight: style.fontWeight, letterSpacing: AMOUNT_SPACING };
    const lines = scene === "print" ? [words.smallPrint] : [AMOUNT, words.forever];
    const size =
      scene === "print"
        ? SMALL_PRINT_PX
        : fitSize(ctx, { ...font, lines }, view.width * 0.84, amountSize * FOREVER_FIT);
    paintCentered(ctx, { ...font, lines, center: home, size, color });
  };

  const settings = (): GlassLensSettings => {
    const words = text();
    return {
      scene: [mode(), layout, words.smallPrint, words.forever].join("|"),
      home,
      area,
      shape: state.forever ? "diamond" : "lens",
      cycle: CYCLE,
      size: amountSize * (state.forever ? FOREVER_SCALE : 1),
      refraction: state.forever ? 2 : 1,
      color: state.party ? (palette[state.hue % Math.max(1, palette.length)] ?? WHITE) : WHITE,
      tint: state.party ? 0.7 : 0,
      wobble: state.party ? 1 : 0.5,
      interaction: state.interaction,
    };
  };

  const setLive = (live: boolean) => {
    if (live) section.dataset.glass = "on";
    else delete section.dataset.glass;
  };

  const glass = createGlassLens(
    { container: layer, canvas: parts.canvas, handle: parts.handle, paint, onLive: setLive },
    settings,
  );
  if (!glass) return () => {};

  const later = (ms: number, run: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      run();
    }, ms);
    timers.add(id);
    return id;
  };

  const update = (change: Partial<EggState>) => {
    Object.assign(state, change);
    glass.refresh();
  };

  const stopParty = () => {
    clearInterval(partyLoop);
    partyLoop = undefined;
    update({ party: false, hue: 0 });
  };

  const startParty = () => {
    if (state.party) return;
    update({ party: true });
    if (!reduced) partyLoop = setInterval(() => update({ hue: state.hue + 1 }), PARTY_STEP_MS);
    later(PARTY_MS, stopParty);
  };

  const trackShake = (x: number) => {
    if (Number.isNaN(shake.lastX)) {
      shake.lastX = x;
      return;
    }
    const dx = x - shake.lastX;
    shake.lastX = x;
    const dir = Math.sign(dx);
    if (!dir) return;
    if (dir === shake.dir) {
      shake.travel += Math.abs(dx);
      return;
    }
    if (shake.travel > SHAKE_TRAVEL) {
      const now = performance.now();
      shake.flips = [...shake.flips.filter((at) => now - at < SHAKE_WINDOW_MS), now];
      if (shake.flips.length >= SHAKE_FLIPS) {
        shake.flips = [];
        startParty();
      }
    }
    shake.dir = dir;
    shake.travel = Math.abs(dx);
  };

  const stopStill = () => {
    if (stillTimer === undefined) return;
    clearTimeout(stillTimer);
    timers.delete(stillTimer);
    stillTimer = undefined;
  };

  const onMove = (event: PointerEvent) => {
    stopStill();
    stillTimer = later(STILL_MS, () => {
      update({ smallPrint: true });
      later(SMALL_PRINT_MS, () => update({ smallPrint: false }));
    });
    trackShake(event.clientX);
  };

  const onLeave = () => {
    stopStill();
    shake = { lastX: Number.NaN, dir: 0, travel: 0, flips: [] };
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (isInteractive(event.target)) return;
    const interaction: GlassInteraction = state.interaction === "drag" ? "follow" : "drag";
    layer.dataset.interaction = interaction;
    update({ interaction });
  };

  const onKey = (event: KeyboardEvent) => {
    if (!visible || event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
    const key = event.key.toLowerCase();
    keys = [...keys, key].slice(-KONAMI.length);
    if (!state.forever && KONAMI.every((step, index) => keys[index] === step)) update({ forever: true });
    if (key.length !== 1) return;
    typed = (typed + key).slice(-WORD.length);
    if (typed !== WORD || state.robot) return;
    update({ robot: true });
    later(ROBOT_MS, () => update({ robot: false }));
  };

  const relayout = () => {
    layout += 1;
    glass.refresh();
  };

  const sizeObserver = new ResizeObserver(relayout);
  const copyObserver = new MutationObserver(relayout);
  const visibility = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
  });
  sizeObserver.observe(section);
  sizeObserver.observe(amount);
  for (const element of parts.copy)
    copyObserver.observe(element, { childList: true, characterData: true, subtree: true });
  visibility.observe(section);
  section.addEventListener("pointermove", onMove, { passive: true });
  section.addEventListener("pointerleave", onLeave);
  section.addEventListener("dblclick", onDoubleClick);
  section.addEventListener("animationend", relayout);
  document.addEventListener("keydown", onKey);
  void document.fonts?.ready.then(relayout);
  layer.dataset.interaction = state.interaction;

  return () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    clearInterval(partyLoop);
    sizeObserver.disconnect();
    copyObserver.disconnect();
    visibility.disconnect();
    section.removeEventListener("pointermove", onMove);
    section.removeEventListener("pointerleave", onLeave);
    section.removeEventListener("dblclick", onDoubleClick);
    section.removeEventListener("animationend", relayout);
    document.removeEventListener("keydown", onKey);
    delete section.dataset.glass;
    delete layer.dataset.interaction;
    glass.dispose();
  };
}
