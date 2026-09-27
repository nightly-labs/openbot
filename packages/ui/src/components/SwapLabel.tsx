import { createEffect, untrack } from "solid-js";

const COUNT_LABEL = /^(\d+)(\D.*)$/;

/** No motion when the user asks for less, or where the page cannot animate an element. */
function motionAllowed(element: HTMLElement): boolean {
  return "animate" in element && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === false;
}

function fillLabel(target: HTMLElement, text: string): HTMLElement | undefined {
  const count = COUNT_LABEL.exec(text);
  if (!count) {
    target.replaceChildren(text);
    return undefined;
  }
  const digits = document.createElement("span");
  digits.className = "ui-swap-digits";
  digits.textContent = count[1] ?? "";
  target.replaceChildren(digits, count[2] ?? "");
  return digits;
}

/** How far the text slides, how much it blurs, and for how long, in px and ms. */
export interface SwapMotion {
  distance: number;
  blur: number;
  enter: { duration: number; easing: string };
  leave: { duration: number; easing: string };
}

const DEFAULT_SWAP: SwapMotion = {
  distance: 20,
  blur: 2,
  enter: { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  leave: { duration: 140, easing: "cubic-bezier(0.4, 0, 1, 1)" },
};

/**
 * A label that animates a change of its text. The box eases to the new width. A count rolls its
 * digits up or down; any other change slides the old text out and the new text in, with a blur.
 * `from` is the text that a new label animates from, when it replaces an old one.
 */
export function SwapLabel(props: { text: string; from?: string | undefined; class?: string; motion?: SwapMotion }) {
  let box: HTMLSpanElement | undefined;
  let shown: HTMLSpanElement | undefined;
  let previous = untrack(() => props.from ?? props.text);
  createEffect(
    () => props.text,
    (text) => {
      if (!box || !shown || text === previous) return;
      const from = previous;
      previous = text;
      const startWidth = box.getBoundingClientRect().width;
      const fromCount = COUNT_LABEL.exec(from);
      const toCount = COUNT_LABEL.exec(text);
      const digits = fillLabel(shown, text);
      if (!motionAllowed(box)) return;
      box.animate([{ width: `${startWidth}px` }, { width: `${box.getBoundingClientRect().width}px` }], {
        duration: 240,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      });
      const leaving = document.createElement("span");
      leaving.className = "ui-swap-leaving";
      box.append(leaving);
      if (fromCount && toCount && digits && fromCount[2] === toCount[2]) {
        const direction = Number(toCount[1]) > Number(fromCount[1]) ? 1 : -1;
        leaving.textContent = fromCount[1] ?? "";
        const roll = { duration: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
        digits.animate(
          [
            { opacity: 0, transform: `translateY(${direction * 0.7}em)`, filter: "blur(2px)" },
            { opacity: 1, transform: "none", filter: "blur(0px)" },
          ],
          roll,
        );
        leaving.animate(
          [
            { opacity: 1, transform: "none", filter: "blur(0px)" },
            { opacity: 0, transform: `translateY(${-direction * 0.7}em)`, filter: "blur(2px)" },
          ],
          { ...roll, fill: "forwards" },
        ).onfinish = () => leaving.remove();
        return;
      }
      leaving.textContent = from;
      const { distance, blur, enter, leave } = props.motion ?? DEFAULT_SWAP;
      const away = { opacity: 0, transform: `translateX(${-distance}px)`, filter: `blur(${blur}px)` };
      shown.animate([away, { opacity: 1, transform: "none", filter: "blur(0px)" }], enter);
      leaving.animate([{ opacity: 1, transform: "none", filter: "blur(0px)" }, away], {
        ...leave,
        fill: "forwards",
      }).onfinish = () => leaving.remove();
    },
  );
  return (
    <span ref={box} class={props.class ? `ui-swap ${props.class}` : "ui-swap"}>
      <span
        ref={(element) => {
          shown = element;
          fillLabel(element, previous);
        }}
      />
    </span>
  );
}
