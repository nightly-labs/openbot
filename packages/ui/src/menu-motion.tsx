import type { JSX } from "@solidjs/web";
import { onCleanup, onSettled } from "solid-js";
import { prefersReducedMotion } from "./utils";

// Kobalte removes the content of a menu or a popover at once when it closes, so a CSS exit
// animation cannot play. When the content closes, an inert copy takes its place and plays the exit
// that the stylesheet gives to content without data-expanded.
//
// When the pointer moves from one submenu trigger to the next, one submenu panel stays on screen:
// the copy of the old submenu waits for the new one, then both move from the old place to the new
// place, the size follows the new items, and the old items fade out while the new items fade in.

const SWAP_MS = 200;
const SWAP_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SWAP_BLUR = "blur(2px)";
// Kobalte opens a submenu 100 ms after the pointer reaches its trigger.
const HANDOFF_WAIT_MS = 180;
const EXIT_FALLBACK_MS = 400;
const PLACEMENT_FRAMES = 6;

interface HeldSubmenu {
  copy: HTMLElement;
  panel: HTMLElement;
  parentMenu: Element;
  timer: ReturnType<typeof setTimeout>;
}

let held: HeldSubmenu | undefined;

/** The scroll offsets of a copy, by the index of the element in the copy. A clone does not keep them. */
const scrollOffsets = new WeakMap<HTMLElement, Array<[index: number, top: number, left: number]>>();

/** Puts a copy on the page, and gives back the scroll offsets that the insertion resets. */
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

/** The menu that holds a submenu trigger, or null for the trigger of a top-level menu. */
function parentMenuOf(trigger: HTMLElement | null): Element | null {
  return trigger?.closest(".ui-action-menu") ?? null;
}

function playExit(copy: HTMLElement, panel: HTMLElement): void {
  delete panel.dataset.menuHold;
  // Content with no exit animation in the stylesheet goes at once.
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

/** Puts an inert copy of closed content in its place and plays its exit. */
function leave(panel: HTMLElement, place: Node | null): void {
  const positioner = positionerOf(panel);
  if (!positioner) return;
  // The copy is made now, while the content is still whole.
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
  for (const element of copy.querySelectorAll("[id]")) element.removeAttribute("id");
  copyPanel.removeAttribute("data-expanded");
  delete copyPanel.dataset.menuSwapIn;

  const trigger = triggerOf(panel);
  const parentMenu = parentMenuOf(trigger);
  // Wait for a sibling submenu only when the pointer is already on its trigger.
  const nextTriggerHovered =
    trigger !== null &&
    parentMenu?.isConnected === true &&
    Array.from(parentMenu.querySelectorAll("[aria-expanded]")).some(
      (element) => element !== trigger && element.matches(":hover"),
    );
  if (nextTriggerHovered && parentMenu) {
    releaseHeld();
    copyPanel.dataset.menuHold = "";
    held = { copy, panel: copyPanel, parentMenu, timer: setTimeout(releaseHeld, HANDOFF_WAIT_MS) };
  }

  // The cleanup can run before the content leaves the page. Solid removes it in the same pass, so
  // the copy goes in after that pass and before the next paint.
  queueMicrotask(() => {
    if (positioner.isConnected) {
      if (held?.copy === copy) releaseHeld();
      return;
    }
    if (held?.copy === copy) {
      insertCopy(copy, document.body);
      return;
    }
    // Content without a portal goes back into its parent, so that its position stays right.
    insertCopy(copy, place?.isConnected ? place : document.body);
    playExit(copy, copyPanel);
  });
}

/** Kobalte places the positioner after the first frame. Runs `then` once it has a place. */
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
    // The swap state comes before the handoff state goes: without either, the open animation starts
    // and the panel measures at its first-frame scale. It stays while the submenu is open, because
    // removing it would start the open animation again.
    panel.dataset.menuSwapIn = "";
    delete panel.dataset.menuHandoff;
    const before = from.panel.getBoundingClientRect();
    const after = panel.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    const timing: KeyframeAnimationOptions = { duration: SWAP_MS, easing: SWAP_EASE };
    const size = (rect: DOMRect) => ({ width: `${rect.width}px`, height: `${rect.height}px` });

    // The old copy stays on top: its items leave over the new panel.
    insertCopy(from.copy, document.body);
    from.panel.dataset.menuSwapOut = "";

    panel.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, ...size(before) },
        { transform: "none", ...size(after) },
      ],
      timing,
    );
    for (const item of panel.children) {
      item.animate(
        [
          { opacity: 0, filter: SWAP_BLUR },
          { opacity: 1, filter: "blur(0px)" },
        ],
        timing,
      );
    }

    from.panel.animate(
      [
        { transform: "none", ...size(before) },
        { transform: `translate(${-dx}px, ${-dy}px)`, ...size(after) },
      ],
      { ...timing, fill: "forwards" },
    ).onfinish = () => from.copy.remove();
    for (const item of from.panel.children) {
      item.animate(
        [
          { opacity: 1, filter: "blur(0px)" },
          { opacity: 0, filter: SWAP_BLUR },
        ],
        { ...timing, fill: "forwards" },
      );
    }
  });
}

/**
 * Gives menu content its exit animation, and the move from one submenu to the next. Call it in a
 * component that closes with the content, such as a wrapper inside a portal. The returned ref goes
 * on the content element.
 */
export function useMenuMotion(): (element: HTMLElement) => void {
  let panel: HTMLElement | undefined;
  let place: Node | null = null;
  onCleanup(() => {
    if (panel && motionAllowed(panel)) leave(panel, place);
  });
  return (element) => {
    panel = element;
    if (!motionAllowed(element)) return;
    requestAnimationFrame(() => {
      if (!element.isConnected) return;
      place = positionerOf(element)?.parentNode ?? null;
      const from = held;
      if (from && parentMenuOf(triggerOf(element)) === from.parentMenu) handOff(from, element);
    });
  };
}

/**
 * The exit animation for content that has no portal, such as a popover in place. Put it among the
 * children of the content, because the children close with the content and the wrapper does not.
 */
export function ContentExitMotion(props: { panel: () => HTMLElement | undefined }): JSX.Element {
  const attach = useMenuMotion();
  onSettled(() => {
    const panel = props.panel();
    if (panel) attach(panel);
  });
  return undefined;
}
