import type { JSX } from "@solidjs/web";
import { onCleanup, onSettled } from "solid-js";
import { prefersReducedMotion } from "./utils";

const SWAP_MS = 200;
const SWAP_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SWAP_BLUR = "blur(2px)";
const LARGE_RESIZE = 1.5;
const LARGE_RESIZE_OUT_END = 0.3;
const LARGE_RESIZE_IN_START = 0.75;
const HANDOFF_WAIT_MS = 180;
const LATE_HANDOFF_MS = 50;
const EXIT_FALLBACK_MS = 400;
const PLACEMENT_FRAMES = 6;

interface HeldSubmenu {
  copy: HTMLElement;
  panel: HTMLElement;
  group: Element;
  own: boolean;
  moving?: MovingState | undefined;
  natural?: DOMRect;
  itemWidths?: string[];
  timer: ReturnType<typeof setTimeout>;
}

export interface MotionPlace {
  trigger: Element;
  group: Element;
}

let held: HeldSubmenu | undefined;

let unmatched: { panel: HTMLElement; group: Element; since: number } | undefined;

const openInGroup = new Map<HTMLElement, Element>();

interface MovingState {
  rect: DOMRect;
  itemOpacity: number;
  surface: Keyframe;
}

const moves = new WeakMap<
  HTMLElement,
  { from: DOMRect; to: DOMRect; animation: Animation; large: boolean; surfaces: [Keyframe, Keyframe] }
>();

function movingState(panel: HTMLElement): MovingState | undefined {
  const move = moves.get(panel);
  const progress = move?.animation.effect?.getComputedTiming().progress;
  if (!move || move.animation.playState === "finished" || progress == null) return undefined;
  const mix = (from: number, to: number) => from + (to - from) * progress;
  return {
    rect: new DOMRect(
      mix(move.from.left, move.to.left),
      mix(move.from.top, move.to.top),
      mix(move.from.width, move.to.width),
      mix(move.from.height, move.to.height),
    ),
    itemOpacity: move.large ? Math.max(0, (progress - LARGE_RESIZE_IN_START) / (1 - LARGE_RESIZE_IN_START)) : progress,
    surface: move.surfaces[progress < 0.5 ? 0 : 1],
  };
}

const scrollOffsets = new WeakMap<HTMLElement, Array<[index: number, top: number, left: number]>>();

function insertCopy(copy: HTMLElement, parent: Node): void {
  parent.appendChild(copy);
  const offsets = scrollOffsets.get(copy);
  if (!offsets) return;
  const elements = copy.querySelectorAll("*");
  for (const [index, top, left] of offsets) {
    const element = elements[index];
    if (!element) continue;
    element.scrollTop = top;
    element.scrollLeft = left;
  }
}

function motionAllowed(element: HTMLElement): boolean {
  return typeof element.animate === "function" && !prefersReducedMotion();
}

function positionerOf(panel: HTMLElement): HTMLElement | null {
  return panel.closest<HTMLElement>("[data-popper-positioner]");
}

function triggerOf(panel: HTMLElement): HTMLElement | null {
  const id = panel.getAttribute("aria-labelledby");
  return id ? document.getElementById(id) : null;
}

function parentMenuOf(trigger: HTMLElement | null): Element | null {
  return trigger?.closest(".ui-action-menu") ?? null;
}

function playExit(copy: HTMLElement, panel: HTMLElement): void {
  delete panel.dataset.menuHold;
  if (panel.getAnimations().length === 0) {
    copy.remove();
    return;
  }
  const fallback = setTimeout(() => copy.remove(), EXIT_FALLBACK_MS);
  panel.addEventListener(
    "animationend",
    () => {
      clearTimeout(fallback);
      copy.remove();
    },
    { once: true },
  );
}

function releaseHeld(): void {
  if (!held) return;
  clearTimeout(held.timer);
  playExit(held.copy, held.panel);
  held = undefined;
}

function nextPanelExpected(panel: HTMLElement, own: MotionPlace | undefined): Element | null {
  if (own) {
    const waits = own.group.isConnected && own.group.matches(":hover") && !own.trigger.matches(":hover");
    return waits ? own.group : null;
  }
  const trigger = triggerOf(panel);
  const parentMenu = parentMenuOf(trigger);
  const nextTriggerHovered =
    trigger !== null &&
    parentMenu?.isConnected === true &&
    Array.from(parentMenu.querySelectorAll("[aria-expanded]")).some(
      (element) => element !== trigger && element.matches(":hover"),
    );
  return nextTriggerHovered ? parentMenu : null;
}

function leave(panel: HTMLElement, place: Node | null, own: MotionPlace | undefined): void {
  const positioner = positionerOf(panel);
  if (!positioner) return;
  const copy = positioner.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return;
  const offsets: Array<[number, number, number]> = [];
  for (const [index, element] of Array.from(positioner.querySelectorAll("*")).entries()) {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0)
      offsets.push([index, element.scrollTop, element.scrollLeft]);
  }
  if (offsets.length > 0) scrollOffsets.set(copy, offsets);
  const copyPanel = panel.id ? copy.querySelector<HTMLElement>(`#${CSS.escape(panel.id)}`) : null;
  if (!copyPanel) return;
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  copy.style.pointerEvents = "none";
  for (const element of copy.querySelectorAll("[id]"))
    if (!(element instanceof SVGElement)) element.removeAttribute("id");
  copyPanel.removeAttribute("data-expanded");
  delete copyPanel.dataset.menuSwapIn;

  const group = nextPanelExpected(panel, own);
  if (group) {
    releaseHeld();
    copyPanel.dataset.menuHold = "";
    held = {
      copy,
      panel: copyPanel,
      group,
      own: own !== undefined,
      moving: movingState(panel),
      timer: setTimeout(releaseHeld, HANDOFF_WAIT_MS),
    };
  }

  queueMicrotask(() => {
    if (positioner.isConnected) {
      if (held?.copy === copy) releaseHeld();
      return;
    }
    if (held?.copy === copy) {
      insertCopy(copy, document.body);
      holdInPlace(held);
      const next = unmatched;
      if (next?.group === held.group && next.panel.isConnected && performance.now() - next.since < LATE_HANDOFF_MS) {
        unmatched = undefined;
        handOff(held, next.panel);
      }
      return;
    }
    insertCopy(copy, place?.isConnected ? place : document.body);
    playExit(copy, copyPanel);
  });
}

const translate = (to: DOMRect, from: DOMRect) => `translate(${to.left - from.left}px, ${to.top - from.top}px)`;
const size = (rect: DOMRect) => ({ width: `${rect.width}px`, height: `${rect.height}px` });

const itemWidths = (panel: HTMLElement) =>
  Array.from(panel.children, (item) => `${item.getBoundingClientRect().width}px`);

const itemWidth = (from: HeldSubmenu, width: string | undefined): Keyframe => (from.own ? { width } : {});

function holdInPlace(from: HeldSubmenu): void {
  const natural = from.panel.getBoundingClientRect();
  from.natural = natural;
  const widths = itemWidths(from.panel);
  from.itemWidths = widths;
  const moving = from.moving;
  if (!moving) return;
  const hold: KeyframeAnimationOptions = { duration: 0, fill: "forwards" };
  from.panel.animate([{ transform: translate(moving.rect, natural), ...size(moving.rect), ...moving.surface }], hold);
  for (const [index, item] of Array.from(from.panel.children).entries())
    item.animate([{ opacity: moving.itemOpacity, ...itemWidth(from, widths[index]) }], hold);
}

function largeResize(before: DOMRect, after: DOMRect): boolean {
  const factor = (a: number, b: number) => (a > 0 && b > 0 ? Math.max(a / b, b / a) : Number.POSITIVE_INFINITY);
  return Math.max(factor(before.width, after.width), factor(before.height, after.height)) > LARGE_RESIZE;
}

function surfaceOf(panel: HTMLElement): Keyframe {
  const style = getComputedStyle(panel);
  return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow, borderRadius: style.borderRadius };
}

function whenPlaced(panel: HTMLElement, then: () => void, frame = 0): void {
  const positioner = positionerOf(panel);
  if ((positioner && positioner.style.transform !== "") || frame >= PLACEMENT_FRAMES) {
    then();
    return;
  }
  requestAnimationFrame(() => whenPlaced(panel, then, frame + 1));
}

function handOff(from: HeldSubmenu, panel: HTMLElement): void {
  clearTimeout(from.timer);
  held = undefined;
  panel.dataset.menuHandoff = "";
  whenPlaced(panel, () => {
    if (!panel.isConnected) {
      playExit(from.copy, from.panel);
      return;
    }
    panel.dataset.menuSwapIn = "";
    delete panel.dataset.menuHandoff;
    const natural = from.natural ?? from.panel.getBoundingClientRect();
    const before = from.moving?.rect ?? natural;
    const after = panel.getBoundingClientRect();
    const widths = itemWidths(panel);
    const oldWidths = from.itemWidths ?? itemWidths(from.panel);
    const timing: KeyframeAnimationOptions = { duration: SWAP_MS, easing: SWAP_EASE };

    insertCopy(from.copy, document.body);
    const oldSurface = surfaceOf(from.panel);
    const newSurface = surfaceOf(panel);
    for (const animation of from.panel.getAnimations()) animation.cancel();
    from.panel.dataset.menuSwapOut = "";
    const large = from.own && largeResize(before, after);

    const move = panel.animate(
      [
        { transform: translate(before, after), ...size(before), ...oldSurface },
        { transform: "none", ...size(after), ...newSurface },
      ],
      timing,
    );
    moves.set(panel, { from: before, to: after, animation: move, large, surfaces: [oldSurface, newSurface] });
    panel.dataset.menuMoving = "";
    const moved = () => delete panel.dataset.menuMoving;
    move.onfinish = moved;
    move.oncancel = moved;
    const height = `${after.height}px`;
    positionerOf(panel)?.animate([{ height }, { height }], timing);
    for (const [index, item] of Array.from(panel.children).entries()) {
      const width = itemWidth(from, widths[index]);
      const hidden = { opacity: 0, filter: SWAP_BLUR, ...width };
      item.animate(
        [
          hidden,
          ...(large ? [{ ...hidden, offset: LARGE_RESIZE_IN_START }] : []),
          { opacity: 1, filter: "blur(0px)", ...width },
        ],
        timing,
      );
    }

    from.panel.animate(
      [
        { transform: translate(before, natural), ...size(before) },
        { transform: translate(after, natural), ...size(after) },
      ],
      { ...timing, fill: "forwards" },
    ).onfinish = () => from.copy.remove();
    for (const [index, item] of Array.from(from.panel.children).entries()) {
      const width = itemWidth(from, oldWidths[index]);
      item.animate(
        [
          { opacity: from.moving?.itemOpacity ?? 1, filter: "blur(0px)", ...width },
          { opacity: 0, filter: SWAP_BLUR, ...width, ...(large ? { offset: LARGE_RESIZE_OUT_END } : {}) },
          ...(large ? [{ opacity: 0, filter: SWAP_BLUR, ...width }] : []),
        ],
        { ...timing, fill: "forwards" },
      );
    }
  });
}

export function panelShownInGroup(group: Element): boolean {
  return held?.group === group || Array.from(openInGroup.values()).includes(group);
}

export function useMenuMotion(own?: () => MotionPlace | undefined): (element: HTMLElement) => void {
  let panel: HTMLElement | undefined;
  let place: Node | null = null;
  onCleanup(() => {
    if (panel) openInGroup.delete(panel);
    if (panel && motionAllowed(panel)) leave(panel, place, own?.());
  });
  return (element) => {
    panel = element;
    if (!motionAllowed(element)) return;
    const ownGroup = own?.()?.group;
    if (ownGroup) {
      if (Array.from(openInGroup.values()).includes(ownGroup)) element.dataset.menuHandoff = "";
      openInGroup.set(element, ownGroup);
    }
    requestAnimationFrame(() => {
      if (!element.isConnected) return;
      place = positionerOf(element)?.parentNode ?? null;
      const from = held;
      const group = own ? own()?.group : parentMenuOf(triggerOf(element));
      if (from && group === from.group) {
        handOff(from, element);
        return;
      }
      if (!group) return;
      unmatched = { panel: element, group, since: performance.now() };
      setTimeout(() => {
        if (unmatched?.panel !== element) return;
        unmatched = undefined;
        delete element.dataset.menuHandoff;
      }, LATE_HANDOFF_MS);
    });
  };
}

export function ContentExitMotion(props: { panel: () => HTMLElement | undefined }): JSX.Element {
  const attach = useMenuMotion();
  onSettled(() => {
    const panel = props.panel();
    if (panel) attach(panel);
  });
  return undefined;
}
