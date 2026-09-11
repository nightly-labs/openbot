import type { ShaderMount } from "@paper-design/shaders";
import { createMemo, createSignal, onSettled } from "solid-js";
import { type NewsArtShape, newsCardImagePath } from "../../lib/news";
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
// The still has to be the animation's own first frame, or the moment the shader
// arrives is a cut between two different pictures. The baked PNG is drawn from
// this same description at `gradient.frame` with the clock stopped, so it is that
// frame — but only in a full build, and only at the shape it was baked at. In
// development it answers 404, and the CSS approximation underneath is a handful of
// coloured blobs that look nothing like the shader's output.
//
// So the component draws its own. Before anything is hovered it mounts the shader
// with the clock stopped, keeps the frame it produced as the still, and lets the
// context go again. That picture is exact, it is the right shape because it was
// drawn at the element's own size, and it costs one short-lived context per card.
// The canvas is revealed only once it has drawn, and it fades in over that same
// frame, so the handover is never a cut and never a cut to an empty rectangle.

interface NewsGradientBaseProps {
  slug: string;
  title: string;
  /** The frame this artwork fills, which decides the shape it is drawn at. */
  shape: NewsArtShape;
  class?: string;
}

export type NewsGradientProps = NewsGradientBaseProps &
  (
    | { mode: "live"; hoverTarget?: never }
    | {
        mode: "hover";
        /**
         * The element a pointer must be over for the gradient to run. Required,
         * and never the artwork: the artwork takes no pointer, so that the link
         * covering the card stays clickable. Give this the whole card, so the
         * artwork also reacts to the date and the title under it.
         */
        hoverTarget: () => HTMLElement | undefined;
      }
  );

const ANIMATION_SPEED = 0.6;

/** Enough frames for the mount's ResizeObserver to have sized the canvas. */
const CANVAS_FRAME_BUDGET = 12;

// Priming is serialised across every card on the page. Each one is a WebGL
// context that lives for a few frames, and a browser keeps only so many before it
// drops the oldest without warning; one at a time keeps the page far under that
// however many articles are published.
let primeQueue: Promise<void> = Promise.resolve();

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
    return `url("${newsCardImagePath(props.slug, props.shape)}"), ${newsGradientCss(gradient())}`;
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

  const mountShader = async (speed = ANIMATION_SPEED, reveal = true): Promise<ShaderMount | undefined> => {
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
      return undefined;
    }

    // The canvas has no size, and so no picture, until the mount's ResizeObserver
    // has run; the library draws the first frame inside that same callback. The
    // canvas is transparent until it is called ready, so waiting here is what
    // keeps the still picture on screen for those few frames instead of blinking
    // through to nothing.
    for (let frames = 0; frames < CANVAS_FRAME_BUDGET; frames += 1) {
      if (attempt !== generation || !mount) return undefined;
      if (mount.canvasElement.width > 0) {
        // A priming mount is never shown: its whole purpose is the picture it
        // leaves behind, and revealing it would fade a canvas in and straight
        // back out again.
        if (reveal) setShaderReady(true);
        return mount;
      }
      await nextAnimationFrame();
    }
    // The canvas was never sized. The mount is still real, and the caller is
    // responsible for letting it go.
    return undefined;
  };

  // Whether a prime is in flight, and whether a pointer is waiting on it. A
  // prime owns `mount` while it runs, so hover must not reach in and change the
  // speed of a mount that is about to be thrown away.
  let priming = false;
  let hovered = false;
  let detached = false;

  /**
   * Draw the first frame, keep it, and let the context go. `disposeShader` does
   * the keeping: it captures the canvas and records the frame it stopped on, so
   * with the clock stopped the card is left holding exactly `gradient.frame` and
   * the first hover carries on from the picture already on screen.
   */
  const primeStill = (): Promise<void> => {
    primeQueue = primeQueue.then(async () => {
      if (detached || mount || frozen() || !host) return;
      priming = true;
      try {
        const primed = await mountShader(0, false);
        // The constructor does not draw with the clock stopped, so the canvas is
        // still empty here. `setFrame` draws synchronously, and it is the same
        // call the build-time generator makes, so the still the card keeps and
        // the baked PNG are the same frame of the same picture.
        primed?.setFrame(gradient().frame);
        // Unconditional: a mount that never sized its canvas still holds a
        // context, and `disposeShader` is what captures the frame and frees it.
        disposeShader();
      } finally {
        priming = false;
      }
      if (hovered && !detached) void mountShader();
    });
    return primeQueue;
  };

  onSettled(() => {
    // The still must be the first frame whether or not the animation may run:
    // it is what the reader looks at while the shader starts, and what they keep
    // if it never does. Reduced motion is a reason not to move, not a reason to
    // show a different picture.
    if (!animationWelcome()) {
      void primeStill();
      return;
    }

    if (props.mode === "live") {
      // The still is painted first and the animation starts from it, so the
      // canvas fades in over the very frame it opens on.
      void primeStill().then(() => {
        if (!detached) void mountShader();
      });
      return () => {
        detached = true;
        disposeShader();
      };
    }

    // Hover only makes sense where a pointer can rest on something. A touch
    // screen reports a hover that never ends, which would leave a context alive
    // for the rest of the session.
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
      void primeStill();
      return;
    }

    const element = props.hoverTarget?.();
    if (!element) return;

    // Paint the first frame now and let the context go again, so a card at rest
    // shows the picture its animation opens on.
    void primeStill();

    // A pointer that arrives while a stopped mount is still on the element starts
    // that one again rather than building a second.
    const enter = () => {
      hovered = true;
      // The prime finishes by starting the animation itself when a pointer
      // arrived while it was running.
      if (priming) return;
      if (mount) mount.setSpeed(ANIMATION_SPEED);
      else void mountShader();
    };
    const leave = () => {
      hovered = false;
      if (priming) return;
      disposeShader();
    };
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    // A card can be scrolled out from under a held pointer, and Safari does not
    // always follow that with pointerleave.
    element.addEventListener("pointercancel", leave);

    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("pointercancel", leave);
      hovered = false;
      detached = true;
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
