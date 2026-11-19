import { createEffect } from "solid-js";
import { documentColorScheme } from "../../document-color-scheme";
import { REDUCED_MOTION_QUERY } from "../../utils";
import { CHAT_BACKDROP_BASE, type ChatBackdropScene, paintChatBackdrop } from "./chat-backdrop";

/** The side of one mosaic cell, in CSS pixels. The canvas has one pixel for each cell. */
const CELL = 6;
/** A mosaic does not need more: 20 frames each second keeps the work small. */
const FRAME_MS = 50;
/** The moment that a still frame shows, when the system asks for less motion. */
const STILL_TIME = 42;

/**
 * An animated scene that fills the window under all of its content. It paints the scene's base color
 * (`CHAT_BACKDROP_BASE`) too. It stops while the window is hidden, and shows one still frame when the
 * system asks for less motion.
 */
export function ChatBackdrop(props: { scene: ChatBackdropScene }) {
  let host: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  createEffect(
    () => ({ scene: props.scene, dark: documentColorScheme() === "dark" }),
    ({ scene, dark }) => {
      const box = host;
      const context = canvas?.getContext("2d");
      if (!box || !canvas || !context) return;
      const element = canvas;
      const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
      const start = performance.now();
      let width = 0;
      let height = 0;
      let visible = true;
      let request = 0;
      let last = Number.NEGATIVE_INFINITY;

      const paint = (now: number) => {
        if (width === 0 || height === 0) return;
        const time = reducedMotion.matches ? STILL_TIME : (now - start) / 1000;
        paintChatBackdrop(context, { scene, width, height, time, dark });
      };
      const tick = (now: number) => {
        request = 0;
        if (now - last >= FRAME_MS) {
          last = now;
          paint(now);
        }
        schedule();
      };
      function schedule(): void {
        if (request !== 0 || !visible || reducedMotion.matches) return;
        request = window.requestAnimationFrame(tick);
      }
      const resize = () => {
        const nextWidth = Math.max(1, Math.ceil(box.clientWidth / CELL));
        const nextHeight = Math.max(1, Math.ceil(box.clientHeight / CELL));
        if (nextWidth === width && nextHeight === height) return;
        width = nextWidth;
        height = nextHeight;
        element.width = width;
        element.height = height;
        element.style.width = `${width * CELL}px`;
        element.style.height = `${height * CELL}px`;
        paint(performance.now());
      };
      const motionChanged = () => {
        paint(performance.now());
        schedule();
      };

      const sizes = new ResizeObserver(resize);
      sizes.observe(box);
      const presence = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        schedule();
      });
      presence.observe(box);
      reducedMotion.addEventListener("change", motionChanged);
      resize();
      schedule();
      return () => {
        if (request !== 0) window.cancelAnimationFrame(request);
        sizes.disconnect();
        presence.disconnect();
        reducedMotion.removeEventListener("change", motionChanged);
      };
    },
  );
  return (
    <div
      ref={(element) => {
        host = element;
      }}
      class="chat-backdrop"
      style={{ "background-color": CHAT_BACKDROP_BASE[props.scene][documentColorScheme()] }}
      aria-hidden="true"
    >
      <canvas
        ref={(element) => {
          canvas = element;
        }}
      />
    </div>
  );
}
