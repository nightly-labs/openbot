import { PlushMascot } from "@openbot/ui";
import { createEffect, createSignal, onSettled } from "solid-js";
import { prefersReducedMotion } from "../utils";

/** How long the typing stops before the plush looks for a result. */
const IDLE_MS = 500;
/** The caret distance, in pixels, at which the eyes turn the most. */
const GAZE_REACH = 160;
/** How far the eyes look to each side when the plush looks for a result, in pixels. */
const LOOK_PX = 4;

interface Gaze {
  x: number;
  y: number;
}

/** Where the caret of `input` is on the screen. */
function caretPoint(input: HTMLInputElement, context: CanvasRenderingContext2D): Gaze {
  const style = getComputedStyle(input);
  context.font = style.font;
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const rect = input.getBoundingClientRect();
  const left = rect.left + Number.parseFloat(style.paddingLeft) - input.scrollLeft;
  return { x: Math.min(rect.right, left + context.measureText(before).width), y: rect.top + rect.height / 2 };
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * The plush of the "No results" state. Its eyes follow the caret of `input` while the user types.
 * When the typing stops and no search runs, it looks left and right for a result, then tilts its
 * head. It is decoration: the text beside it is the accessible content. With reduced motion it
 * stays still.
 */
export function GlobalSearchPlush(props: { input: () => HTMLInputElement | undefined; searching: boolean }) {
  const [gaze, setGaze] = createSignal<Gaze | null>(null);
  let root: HTMLSpanElement | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  // The typing stopped while a search ran, so the plush looks when the search ends.
  let waiting = false;
  let animations: Animation[] = [];

  function stopAnimations(): void {
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  function lookForResult(): void {
    waiting = false;
    setGaze(null);
    const eyes = root?.querySelector(".ui-plush-eyes");
    if (!root || !eyes || typeof root.animate !== "function") return;
    stopAnimations();
    animations = [
      eyes.animate(
        [
          { translate: "0 0" },
          { translate: `${-LOOK_PX}px 0`, offset: 0.2 },
          { translate: `${LOOK_PX}px 0`, offset: 0.5 },
          { translate: `${-LOOK_PX}px 0`, offset: 0.75 },
          { translate: "0 0" },
        ],
        { duration: 760, easing: "ease-in-out" },
      ),
      root.animate(
        [
          { rotate: "0deg", translate: "0 0" },
          { rotate: "-10deg", translate: "0 -4px", offset: 0.35 },
          { rotate: "-10deg", translate: "0 -4px", offset: 0.7 },
          { rotate: "0deg", translate: "0 0" },
        ],
        { duration: 900, delay: 760, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      ),
    ];
  }

  createEffect(
    () => props.searching,
    (searching) => {
      if (!searching && waiting) lookForResult();
    },
  );

  onSettled(() => {
    if (prefersReducedMotion()) return;
    const context = document.createElement("canvas").getContext("2d");

    function waitForIdle(): void {
      waiting = false;
      clearTimeout(idle);
      idle = setTimeout(() => {
        waiting = true;
        if (!props.searching) lookForResult();
      }, IDLE_MS);
    }

    function follow(): void {
      const input = props.input();
      if (!root || !context || !input || document.activeElement !== input) return;
      stopAnimations();
      const caret = caretPoint(input, context);
      const rect = root.getBoundingClientRect();
      setGaze({
        x: clampUnit((caret.x - (rect.left + rect.width / 2)) / GAZE_REACH),
        y: clampUnit((caret.y - (rect.top + rect.height / 2)) / GAZE_REACH),
      });
      waitForIdle();
    }

    // The state shows after an input, so the plush first looks at the caret, then looks for a result.
    follow();
    waitForIdle();
    document.addEventListener("input", follow, true);
    document.addEventListener("selectionchange", follow);
    return () => {
      clearTimeout(idle);
      stopAnimations();
      document.removeEventListener("input", follow, true);
      document.removeEventListener("selectionchange", follow);
    };
  });

  return (
    <span
      ref={root}
      class="global-search-plush"
      data-gaze={gaze() ? "follow" : undefined}
      style={{
        "--global-search-gaze-x": `${gaze()?.x ?? 0}`,
        "--global-search-gaze-y": `${gaze()?.y ?? 0}`,
      }}
      aria-hidden="true"
    >
      <PlushMascot />
    </span>
  );
}
