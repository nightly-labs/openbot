import {
  EASE_OUT,
  ISLAND_CLOSE,
  ISLAND_CONTENT,
  ISLAND_OPEN,
  type Spring,
  springKeyframes,
} from "@openbot/ui/spring-motion";
import { clamp, mix, prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, flush, omit, onCleanup, Show, untrack } from "solid-js";

/** The small capsule beyond the edge that the pill grows out of and goes back into. */
const BUD = { width: 64, height: 22 };

const px = (value: number) => `${value}px`;
const ms = (spring: Spring) => spring.response * 1000;

/** Brings content in with a blur, as the island does. `motion` gives the transform for the rest of the way. */
export function contentIn(element: HTMLElement, delay = 0, motion = (rest: number) => `scale(${1 - 0.04 * rest})`) {
  element.animate(
    springKeyframes(ISLAND_CONTENT, (progress) => ({
      opacity: clamp(progress * 1.5, 0, 1),
      filter: `blur(${Math.max(0, 4 * (1 - progress))}px)`,
      transform: motion(1 - progress),
    })),
    { duration: ms(ISLAND_CONTENT), delay, easing: "linear", fill: "backwards" },
  );
}

export interface MorphPillProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "children" | "ref"> {
  open: boolean;
  /** The class of the shell. The shell must clip its content, so the content does not show past the spring. */
  class: string;
  /** The class of the face, the content that keeps its own width. */
  faceClass: string;
  /** A key: a new key brings the new content in with a blur. */
  face?: string | undefined;
  /** Content of the shell behind the face, such as a progress fill. */
  backdrop?: JSX.Element;
  children: JSX.Element;
}

/**
 * A pill that is in the page while it is open or closing. It grows out of a small capsule below the
 * bottom edge of its frame (the offset parent) and goes back into it. The width follows the content
 * on a spring. Other attributes, such as `aria-label` and `data-*`, go on the shell.
 */
export function MorphPill(props: MorphPillProps) {
  const shellProps = omit(props, "open", "class", "faceClass", "face", "backdrop", "children");
  const [present, setPresent] = createSignal(false);
  let shell: HTMLElement | undefined;
  let face: HTMLElement | undefined;
  let sizing: Animation | undefined;
  /** The width that the shell goes to now. The observer sees the new face first: that must not stop the bud. */
  let target = 0;
  let closing: Animation[] = [];
  let lastFace = untrack(() => props.face);
  const observer = new ResizeObserver(() => {
    if (shell?.isConnected) resizeTo(contentWidth());
  });
  onCleanup(() => {
    observer.disconnect();
    for (const animation of closing) animation.cancel();
    closing = [];
  });

  // The face has its own width; 2 px are the border of the shell.
  const contentWidth = () => (face ? face.offsetWidth + 2 : 0);
  /** From the pill to past the bottom edge of its frame, so the capsule starts out of view. */
  const travel = () => {
    if (!shell?.offsetParent) return 48;
    const parent = shell.offsetParent.getBoundingClientRect();
    return parent.bottom - shell.getBoundingClientRect().bottom + BUD.height;
  };

  function resizeTo(next: number) {
    if (!shell || closing.length > 0 || Math.abs(next - target) < 0.5) return;
    target = next;
    const from = shell.getBoundingClientRect().width;
    sizing?.cancel();
    shell.style.width = px(next);
    if (prefersReducedMotion() || Math.abs(from - next) < 0.5) return;
    const spring = next >= from ? ISLAND_OPEN : ISLAND_CLOSE;
    sizing = shell.animate(
      springKeyframes(spring, (progress) => ({ width: px(mix(from, next, progress)) })),
      { duration: ms(spring), easing: "linear" },
    );
  }

  function bud() {
    if (!shell || !face) return;
    const width = contentWidth();
    target = width;
    const height = shell.offsetHeight;
    shell.style.width = px(width);
    if (prefersReducedMotion()) {
      shell.animate([{ opacity: 0 }, { opacity: 1 }], 150);
      return;
    }
    const away = travel();
    sizing?.cancel();
    sizing = shell.animate(
      springKeyframes(ISLAND_OPEN, (progress) => ({
        width: px(mix(BUD.width, width, progress)),
        height: px(mix(BUD.height, height, progress)),
        transform: `translateY(${mix(away, 0, progress)}px)`,
      })),
      { duration: ms(ISLAND_OPEN), easing: "linear" },
    );
    shell.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1 }], ms(ISLAND_OPEN));
    contentIn(face, ms(ISLAND_OPEN) * 0.3);
  }

  function sink() {
    if (!shell || !face) return close();
    if (prefersReducedMotion()) {
      closing = [shell.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" })];
    } else {
      const from = shell.getBoundingClientRect();
      const away = travel();
      target = BUD.width;
      sizing?.cancel();
      closing = [
        face.animate(
          [
            { opacity: 1, filter: "blur(0px)", transform: "none" },
            { opacity: 0, filter: "blur(4px)", transform: "scale(0.96)" },
          ],
          { duration: ms(ISLAND_CLOSE) * 0.35, easing: EASE_OUT, fill: "forwards" },
        ),
        shell.animate(
          springKeyframes(ISLAND_CLOSE, (progress) => ({
            width: px(mix(from.width, BUD.width, progress)),
            height: px(mix(from.height, BUD.height, progress)),
            transform: `translateY(${mix(0, away, progress)}px)`,
          })),
          { duration: ms(ISLAND_CLOSE), easing: "linear", fill: "forwards" },
        ),
        shell.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], {
          duration: ms(ISLAND_CLOSE),
          fill: "forwards",
        }),
      ];
    }
    const motion = closing.at(-1);
    motion?.addEventListener("finish", () => {
      if (!closing.includes(motion)) return;
      closing = [];
      close();
    });
  }

  function close() {
    setPresent(false);
  }

  function reopen() {
    for (const animation of closing) animation.cancel();
    closing = [];
    resizeTo(contentWidth());
  }

  createEffect(
    () => props.open,
    (open) => {
      // The pill must be in the page before it can measure its face.
      queueMicrotask(() => {
        if (open && !untrack(present)) {
          setPresent(true);
          flush();
          bud();
        } else if (open && closing.length > 0) reopen();
        else if (!open && untrack(present) && closing.length === 0) sink();
      });
    },
  );

  createEffect(
    () => props.face,
    (key) => {
      if (key === lastFace) return;
      lastFace = key;
      if (face && closing.length === 0 && !prefersReducedMotion()) contentIn(face);
    },
  );

  return (
    <Show when={present()}>
      <section
        {...shellProps}
        class={props.class}
        ref={(element) => {
          shell = element;
        }}
      >
        {props.backdrop}
        <div
          class={props.faceClass}
          ref={(element) => {
            // The face is made again each time the pill opens; the observer must not keep the old one.
            if (face) observer.unobserve(face);
            face = element;
            observer.observe(element);
          }}
        >
          {props.children}
        </div>
      </section>
    </Show>
  );
}
