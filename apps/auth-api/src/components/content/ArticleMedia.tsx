import type { JSX } from "@solidjs/web";
import { children, Show } from "solid-js";
import { ArticleGradient } from "./ArticleGradient";

// Pictures inside an article. A body is plain TSX, so a bare
// <img> would already render; these exist so that every picture carries the things
// that cannot be added to it afterwards: a text alternative, its own size — so the
// prose under it does not jump when the file lands — and a caption where it needs one.
//
// Each file is imported rather than written as a path, and lives beside the body
// that uses it in `src/content/<collection>/media/<slug>/`. Vite then fingerprints
// it and fails the build on a file that is not there, so a renamed picture cannot
// ship as a broken one, and a replaced picture is never served from a cache under
// the name of the old one.

/** How much of the card gradient shows around a mounted picture. */
export type ArticleMountPad = "tight" | "roomy";

interface ArticleMediaBase {
  /** The file's own width in pixels. It is the space the page holds open for it. */
  width: number;
  /** The file's own height in pixels. */
  height: number;
  /** The line under the picture. Left out, the picture stands on its own. */
  caption?: JSX.Element;
  /**
   * Sets the picture on the article's own gradient, with room around it. Give it
   * the article title, because that string is the whole of what the colours are
   * drawn from: a mounted picture then carries the colours of the card the reader
   * arrived from, and two pictures in one article agree with each other.
   *
   * Use it for a screenshot with a pale or busy edge, which otherwise runs into
   * the page where it stops. A screenshot that is already dark to its edges needs
   * nothing around it, and a mount would only make the column narrower.
   */
  mountOn?: string;
  /**
   * How much gradient shows around the picture. `"tight"` is a thin mat, `"roomy"`
   * is a field. Left out, a wide picture is tight and a tall one is roomy.
   */
  mountPad?: ArticleMountPad;
}

export interface ArticleImageProps extends ArticleMediaBase {
  /** The imported image file. */
  src: string;
  /** What the picture shows, for a reader who cannot see it. */
  alt: string;
}

export function ArticleImage(props: ArticleImageProps) {
  return (
    <ArticleFigure {...figureMount(props)}>
      <img
        class="post-media"
        src={props.src}
        alt={props.alt}
        width={props.width}
        height={props.height}
        style={mediaShape(props)}
        loading="lazy"
        decoding="async"
      />
    </ArticleFigure>
  );
}

function figureMount(props: ArticleMediaBase): {
  caption?: JSX.Element | undefined;
  mountOn?: string | undefined;
  mountPad?: ArticleMountPad | undefined;
  wide: boolean;
} {
  return {
    caption: props.caption,
    mountOn: props.mountOn,
    mountPad: props.mountPad,
    wide: props.width > props.height,
  };
}

function ArticleFigure(props: {
  caption?: JSX.Element | undefined;
  mountOn?: string | undefined;
  mountPad?: ArticleMountPad | undefined;
  wide?: boolean;
  children: JSX.Element;
}) {
  let mount: HTMLDivElement | undefined;
  // Resolved once and reused, so that switching a picture onto a mount moves the
  // same nodes rather than building a second copy of them.
  const body = children(() => props.children);
  const pad = (): ArticleMountPad => props.mountPad ?? (props.wide ? "tight" : "roomy");

  return (
    <figure class="post-figure">
      <Show when={props.mountOn} fallback={body()}>
        {(title) => (
          <div ref={mount} class="post-mount" data-pad={pad()}>
            {/* Keep the article's mounted backgrounds moving with the hero. The
                gradient still falls back to its baked or CSS frame, and the
                live mode respects the reader's reduced-motion preference. */}
            <ArticleGradient title={title()} mode="live" />
            {body()}
          </div>
        )}
      </Show>
      <Show when={props.caption}>{(caption) => <figcaption class="post-figure-caption">{caption()}</figcaption>}</Show>
    </figure>
  );
}

// The width and height of an <img> already tell a browser the shape to hold open.
// A <video> is not covered by that rule as widely, and the two sit in the same
// column, so both are told in writing.
function mediaShape(props: ArticleMediaBase): JSX.CSSProperties {
  return { "aspect-ratio": `${props.width} / ${props.height}` };
}
