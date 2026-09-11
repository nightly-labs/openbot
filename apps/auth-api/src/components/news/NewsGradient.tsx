import type { ShaderMount } from "@paper-design/shaders";
import { createMemo, createSignal, onSettled } from "solid-js";
import { newsCardImagePath } from "../../lib/news";
import { newsGradient, newsGradientCss, newsGradientUniforms } from "../../lib/news-gradient";
import { cx } from "../../lib/utils";

// Three layers, cheapest first: a CSS gradient that server-renders, the PNG baked
// at build time over it, and — for the featured card, or for a card under the
// pointer — a live WebGL canvas over both. Each layer is an improvement on the one
// below, so any of them failing leaves something that still looks like the
// article's artwork.
//
// The two still layers are two backgrounds of one element rather than an <img>.
// A background that fails to load falls through to the layer below it without
// drawing anything, while an <img> that answers 404 paints the browser's
// torn-page glyph in the corner of the card before any script can remove it. The
// images exist only in a full build, so that case is the everyday one in
// development.
//
// The reason for the staging is context budget. A browser allows on the order of
// eight to sixteen live WebGL contexts and drops the oldest without warning past
// that. The index page shows one featured card and a grid, so "live" is used once
// and everything else waits to be hovered. At most two contexts exist at a time.
//
// The baked PNG is the animation's own first frame: the generator draws it from
// this same description at `gradient.frame` with the clock stopped. So the canvas
// takes the picture over rather than replacing it. It is revealed only once it has
// drawn, and it fades in, so the handover is never a cut and never a cut to an
// empty rectangle.

export type NewsGradientMode = "live" | "hover";

export interface NewsGradientProps {
  slug: string;
  title: string;
  mode: NewsGradientMode;
  /**
   * The element a pointer must be over for a `hover` gradient to run. Give it the
   * whole card, so the artwork reacts to the date and the title under it as well.
   * Defaults to the artwork alone.
   */
  hoverTarget?: () => HTMLElement | undefined;
  class?: string;
}

const ANIMATION_SPEED = 0.6;

/** Enough frames for the mount's ResizeObserver to have sized the canvas. */
const CANVAS_FRAME_BUDGET = 12;

export function NewsGradient(props: NewsGradientProps) {
  let host: HTMLDivElement | undefined;
  const [shaderReady, setShaderReady] = createSignal(false);
  const gradient = createMemo(() => newsGradient(props.title));

  // One mount at a time, and a generation counter so a dynamic import that
  // resolves after the pointer has already left never attaches an orphan context.
  let mount: ShaderMount | undefined;
  let generation = 0;

  // Where the animation had got to when the pointer last left. Letting go of the
  // WebGL context is the whole reason hover mode exists, but the reader should see
  // the gradient carry on rather than snap back to its first frame each time.
  let resumeFrame: number | undefined;

  // The last frame the shader drew, kept as an image. It is what makes stopping
  // look like stopping: without it the card falls back to its first frame the
  // moment the pointer leaves, which reads as a reset however faithfully the next
  // hover continues.
  const [frozen, setFrozen] = createSignal<string>();

  const background = createMemo(() => {
    const captured = frozen();
    if (captured) return `url("${captured}")`;
    return `url("${newsCardImagePath(props.slug)}"), ${newsGradientCss(gradient())}`;
  });

  /**
   * The canvas pixels as an image. The card canvas is only as large as the card,
   * so this is a few tens of kilobytes rather than a full-size screenshot.
   */
  const captureFrame = (): string | undefined => {
    try {
      const url = mount?.canvasElement.toDataURL("image/webp", 0.92);
      return url && url.length > 512 ? url : undefined;
    } catch {
      // A lost context has nothing to read back. The layer below is still the
      // right picture, so there is nothing to report and nothing to fix.
      return undefined;
    }
  };

  const disposeShader = () => {
    generation += 1;
    if (mount) {
      resumeFrame = mount.getCurrentFrame();
      const captured = captureFrame();
      // Set before the canvas goes away, so the picture under it is already the
      // frame the reader was looking at.
      if (captured) setFrozen(captured);
    }
    mount?.dispose();
    mount = undefined;
    setShaderReady(false);
  };

  const mountShader = async (speed = ANIMATION_SPEED) => {
    if (mount || !host) return;
    generation += 1;
    const attempt = generation;

    // The constructor throws when WebGL2 is missing, and the import fails on a
    // flaky network. Neither is worth an error: the still image is already on
    // screen and stays there.
    try {
      const { ShaderMount, getShaderColorFromString, meshGradientFragmentShader } = await import(
        "@paper-design/shaders"
      );

      if (attempt !== generation || !host) return;

      mount = new ShaderMount(
        host,
        meshGradientFragmentShader,
        newsGradientUniforms(gradient(), getShaderColorFromString),
        // Without this the colour buffer is undefined by the time the frame is
        // read back, which shows up as a card that freezes to an empty rectangle
        // on some machines and to the right picture on others.
        { preserveDrawingBuffer: true },
        speed,
        resumeFrame ?? gradient().frame,
      );
    } catch {
      mount = undefined;
      return;
    }

    // The canvas has no size, and so no picture, until the mount's ResizeObserver
    // has run; the library draws the first frame inside that same callback. The
    // canvas is transparent until it is called ready, so waiting here is what
    // keeps the still picture on screen for those few frames instead of blinking
    // through to nothing.
    for (let frames = 0; frames < CANVAS_FRAME_BUDGET; frames += 1) {
      if (attempt !== generation || !mount) return;
      if (mount.canvasElement.width > 0) {
        setShaderReady(true);
        return;
      }
      await nextAnimationFrame();
    }
  };

  onSettled(() => {
    if (!animationWelcome()) return;

    if (props.mode === "live") {
      void mountShader();
      return () => disposeShader();
    }

    // Hover only makes sense where a pointer can rest on something. A touch
    // screen reports a hover that never ends, which would leave a context alive
    // for the rest of the session.
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;

    const element = props.hoverTarget?.() ?? host;
    if (!element) return;

    // A pointer that arrives while a stopped mount is still on the element starts
    // that one again rather than building a second.
    const enter = () => {
      if (mount) mount.setSpeed(ANIMATION_SPEED);
      else void mountShader();
    };
    const leave = () => disposeShader();
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    // A card can be scrolled out from under a held pointer, and Safari does not
    // always follow that with pointerleave.
    element.addEventListener("pointercancel", leave);

    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("pointercancel", leave);
      disposeShader();
    };
  });

  return (
    <div
      ref={host}
      class={cx("news-gradient", props.class)}
      data-shader={shaderReady() ? "live" : "still"}
      style={{ "background-image": background() }}
      aria-hidden="true"
    />
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function animationWelcome(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
