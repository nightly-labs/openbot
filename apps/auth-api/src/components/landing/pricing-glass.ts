import { createFluidGlass, type FluidGlassSettings, type GlassInteraction, type GlassShape } from "./fluid-glass";

const AMOUNT = "$0";
const ROBOT = "🤖";
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

export interface PricingGlassText {
  readonly smallPrint: string;
  readonly forever: string;
}

export interface PricingGlassParts {
  readonly stage: HTMLElement;
  readonly amount: HTMLElement;
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

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));

export function mountPricingGlass(parts: PricingGlassParts, text: () => PricingGlassText): () => void {
  const { stage, amount, layer } = parts;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const styles = getComputedStyle(stage);
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

  const settings = (): FluidGlassSettings => {
    const words = text();
    const content = state.forever
      ? `${AMOUNT}\n${words.forever}`
      : state.robot
        ? ROBOT
        : state.smallPrint
          ? words.smallPrint
          : AMOUNT;
    const fontSize = state.forever
      ? null
      : state.robot
        ? amountSize * 1.09
        : state.smallPrint
          ? SMALL_PRINT_PX
          : amountSize;
    return {
      text: content,
      fontSize,
      shape: state.forever ? "diamond" : "lens",
      cycle: CYCLE,
      size: amountSize * (state.forever ? 1.56 : 1),
      refraction: state.forever ? 2 : 1.2,
      dispersion: state.party || state.forever ? 1 : 0.6,
      color: state.party ? (palette[state.hue % Math.max(1, palette.length)] ?? WHITE) : WHITE,
      tint: state.party ? 0.7 : 0,
      wobble: state.party ? 1 : 0.6,
      interaction: state.interaction,
    };
  };

  const glass = createFluidGlass({ container: layer, canvas: parts.canvas, handle: parts.handle }, settings);
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

  const onMove = (event: PointerEvent) => {
    clearTimeout(stillTimer);
    stillTimer = later(STILL_MS, () => {
      update({ smallPrint: true });
      later(SMALL_PRINT_MS, () => update({ smallPrint: false }));
    });
    trackShake(event.clientX);
  };

  const onLeave = () => {
    clearTimeout(stillTimer);
    shake = { lastX: Number.NaN, dir: 0, travel: 0, flips: [] };
  };

  const onDoubleClick = () => {
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

  const onResize = () => {
    amountSize = Number.parseFloat(getComputedStyle(amount).fontSize) || amountSize;
    glass.refresh();
  };

  const sizeObserver = new ResizeObserver(onResize);
  const visibility = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
  });
  sizeObserver.observe(amount);
  visibility.observe(stage);
  stage.addEventListener("pointermove", onMove, { passive: true });
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("dblclick", onDoubleClick);
  document.addEventListener("keydown", onKey);
  layer.dataset.interaction = state.interaction;
  stage.dataset.glass = "on";

  return () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    clearInterval(partyLoop);
    clearTimeout(stillTimer);
    sizeObserver.disconnect();
    visibility.disconnect();
    stage.removeEventListener("pointermove", onMove);
    stage.removeEventListener("pointerleave", onLeave);
    stage.removeEventListener("dblclick", onDoubleClick);
    document.removeEventListener("keydown", onKey);
    delete stage.dataset.glass;
    delete layer.dataset.interaction;
    glass.dispose();
  };
}
