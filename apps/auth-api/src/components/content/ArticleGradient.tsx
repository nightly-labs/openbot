import { cx, prefersReducedMotion } from "@openbot/ui/utils";
import type { ShaderMount } from "@paper-design/shaders";
import { createMemo, createSignal, onSettled } from "solid-js";
import { articleGradient, articleGradientCss, articleGradientUniforms } from "../../lib/article-gradient";
import { articleArtPath, type ContentArtShape, type ContentCollection } from "../../lib/content-collection";

interface ArticleGradientArt {
  collection: ContentCollection;
  slug: string;
  shape: ContentArtShape;
}

interface ArticleGradientBaseProps {
  title: string;
  art?: ArticleGradientArt;
  class?: string;
}

export type ArticleGradientProps = ArticleGradientBaseProps &
  (
    | { mode: "live"; hoverTarget?: never }
    | {
        mode: "hover";
        hoverTarget: () => HTMLElement | undefined;
      }
  );

const ANIMATION_SPEED = 0.6;

const CANVAS_FRAME_BUDGET = 12;

const CARD_ART_ROOT_MARGIN = "400px 0px";

let primeQueue: Promise<void> = Promise.resolve();

export function ArticleGradient(props: ArticleGradientProps) {
  let host: HTMLDivElement | undefined;
  const [shaderReady, setShaderReady] = createSignal(false);
  const gradient = createMemo(() => articleGradient(props.title));

  let mount: ShaderMount | undefined;
  let generation = 0;

  let resumeFrame: number | undefined;

  const [frozen, setFrozen] = createSignal<string>();

  const [cardArtReady, setCardArtReady] = createSignal(false);

  const background = createMemo(() => {
    const captured = frozen();
    if (captured) return `url("${captured}")`;
    const css = articleGradientCss(gradient());
    const art = props.art;
    if (!art) return css;
    if (art.shape === "card" && !cardArtReady()) return css;
    return `url("${articleArtPath(art.collection, art.slug, art.shape)}"), ${css}`;
  });

  const captureFrame = (): string | undefined => {
    try {
      const canvas = mount?.canvasElement;
      if (!canvas?.width) return undefined;
      const url = canvas.toDataURL("image/webp", 0.92);
      return url && url.length > 512 ? url : undefined;
    } catch {
      return undefined;
    }
  };

  const disposeShader = (keepFrame = true) => {
    generation += 1;
    if (mount && keepFrame) {
      resumeFrame = mount.getCurrentFrame();
      const captured = captureFrame();
      if (captured) setFrozen(captured);
    }
    mount?.dispose();
    mount = undefined;
    if (keepFrame) setShaderReady(false);
  };

  const mountShader = async (speed = ANIMATION_SPEED, reveal = true): Promise<ShaderMount | undefined> => {
    if (mount || !host) return;
    generation += 1;
    const attempt = generation;

    try {
      const { ShaderMount, getShaderColorFromString, meshGradientFragmentShader } = await import(
        "@paper-design/shaders"
      );

      if (attempt !== generation || !host) return;

      mount = new ShaderMount(
        host,
        meshGradientFragmentShader,
        articleGradientUniforms(gradient(), getShaderColorFromString),
        { preserveDrawingBuffer: true },
        speed,
        resumeFrame ?? gradient().frame,
      );
    } catch {
      mount = undefined;
      return undefined;
    }

    for (let frames = 0; frames < CANVAS_FRAME_BUDGET; frames += 1) {
      if (attempt !== generation || !mount) return undefined;
      if (mount.canvasElement.width > 0) {
        if (reveal) setShaderReady(true);
        return mount;
      }
      await nextAnimationFrame();
    }
    return undefined;
  };

  let priming = false;
  let hovered = false;
  let detached = false;

  const primeStill = (): Promise<void> => {
    primeQueue = primeQueue.then(async () => {
      if (detached || mount || frozen() || !host) return;
      priming = true;
      try {
        const primed = await mountShader(0, false);
        primed?.setFrame(gradient().frame);
        disposeShader();
      } finally {
        priming = false;
      }
      if (hovered && !detached) void mountShader();
    });
    return primeQueue;
  };

  onSettled(() => {
    const wantsArt = props.art?.shape === "card";
    const wantsPrime =
      !prefersReducedMotion() &&
      props.mode === "hover" &&
      !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
    const stopWatching =
      host && (wantsArt || wantsPrime)
        ? watchNearViewport(host, () => {
            if (wantsArt) setCardArtReady(true);
            if (wantsPrime) void primeStill();
          })
        : undefined;

    if (prefersReducedMotion()) return stopWatching;

    if (props.mode === "live") {
      void primeStill().then(() => {
        if (!detached) void mountShader();
      });
      return () => {
        detached = true;
        disposeShader(false);
        stopWatching?.();
      };
    }

    if (!wantsPrime) return stopWatching;

    const element = props.hoverTarget?.();
    if (!element) return stopWatching;

    const enter = () => {
      hovered = true;
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
    element.addEventListener("pointercancel", leave);

    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("pointercancel", leave);
      hovered = false;
      detached = true;
      disposeShader(false);
      stopWatching?.();
    };
  });

  return (
    <div
      ref={host}
      class={cx("post-gradient", props.class)}
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

function watchNearViewport(element: Element, onNear: () => void): () => void {
  if (!globalThis.IntersectionObserver) {
    onNear();
    return () => {};
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      onNear();
      observer.disconnect();
    },
    { rootMargin: CARD_ART_ROOT_MARGIN },
  );
  observer.observe(element);
  return () => observer.disconnect();
}
