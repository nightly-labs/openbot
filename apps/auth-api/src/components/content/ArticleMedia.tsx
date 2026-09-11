import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { motionWelcome } from "../../lib/motion";

// Pictures, animations and video inside an article. A body is plain TSX, so a bare
// <img> would already render; these exist so that every picture carries the things
// that cannot be added to it afterwards: a text alternative, its own size — so the
// prose under it does not jump when the file lands — a caption where it needs one,
// and, for anything that moves, a way to stop it.
//
// Each file is imported rather than written as a path, and lives beside the body
// that uses it in `src/content/<collection>/media/<slug>/`. Vite then fingerprints
// it and fails the build on a file that is not there, so a renamed picture cannot
// ship as a broken one, and a replaced picture is never served from a cache under
// the name of the old one.
//
// Motion starts from the reader's own setting. That setting cannot be read on the
// server, so the markup takes the safe side of the question — an animated image
// leaves the choice to a media query, and a clip simply does not start — and the
// component takes the answer over once the page has hydrated. From that point the
// reader can also overrule it in either direction, which is the part a media query
// cannot do.

interface ArticleMediaBase {
  /** The file's own width in pixels. It is the space the page holds open for it. */
  width: number;
  /** The file's own height in pixels. */
  height: number;
  /** The line under the picture. Left out, the picture stands on its own. */
  caption?: JSX.Element;
}

export interface ArticleImageProps extends ArticleMediaBase {
  /** The imported image file. */
  src: string;
  /** What the picture shows, for a reader who cannot see it. */
  alt: string;
}

export function ArticleImage(props: ArticleImageProps) {
  return (
    <ArticleFigure caption={props.caption}>
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

export interface ArticleGifProps extends ArticleMediaBase {
  /** The moving file: a GIF, or an animated WebP. */
  src: string;
  /**
   * One frame of it. It is what a reader who asked for less motion is given, and
   * what the picture returns to when the reader stops the animation. A GIF has no
   * way to stop itself, so this second file is the stop.
   */
  still: string;
  /** What the animation shows, for a reader who cannot see it. */
  alt: string;
}

export function ArticleGif(props: ArticleGifProps) {
  const [decided, setDecided] = createSignal(false);
  const [playing, setPlaying] = createSignal(true);

  onSettled(() => {
    setPlaying(motionWelcome());
    setDecided(true);
  });

  return (
    <ArticleFigure caption={props.caption}>
      <div class="post-media-frame">
        <picture>
          {/* Before the script runs this is the whole of the answer, and it stays
              the whole of it for a reader with no script at all. It goes once the
              component holds the preference itself, because a <source> that
              matches outranks the src beneath it, and from then on the reader is
              allowed to ask for the animation in spite of the setting. */}
          <Show when={!decided()}>
            <source media="(prefers-reduced-motion: reduce)" srcset={props.still} />
          </Show>
          <img
            class="post-media"
            src={playing() ? props.src : props.still}
            alt={props.alt}
            width={props.width}
            height={props.height}
            style={mediaShape(props)}
            loading="lazy"
            decoding="async"
          />
        </picture>
        <Show when={decided()}>
          <MotionToggle playing={playing()} onToggle={() => setPlaying(!playing())} />
        </Show>
      </div>
    </ArticleFigure>
  );
}

export interface ArticleClipProps extends ArticleMediaBase {
  /** The imported MP4. A clip carries no sound: it is a GIF that compresses. */
  src: string;
  /** Its opening frame, shown before the clip loads and whenever it is stopped. */
  poster: string;
  /** What the clip shows, for a reader who cannot see it. */
  label: string;
}

/**
 * A silent clip on a loop — what a GIF is usually asked to do, at a fraction of
 * the bytes. It plays only while it is on screen and only while the reader wants
 * it to, and it downloads nothing until the first of those is true.
 */
export function ArticleClip(props: ArticleClipProps) {
  let video: HTMLVideoElement | undefined;
  let onScreen = false;
  const [decided, setDecided] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);

  const sync = () => {
    if (!video) return;
    if (playing() && onScreen) {
      // A browser can still refuse — iOS in Low Power Mode refuses even a muted
      // clip. Answer that by showing the reader a Play button rather than a
      // control that says Pause over a picture that is not moving. A start that
      // was cut short because the clip left the screen is not a refusal: the
      // pause below cancels it, and the reader's choice has to stand for when the
      // clip comes back.
      void video.play().catch(() => {
        if (onScreen) setPlaying(false);
      });
      return;
    }
    if (!video.paused) video.pause();
  };

  onSettled(() => {
    const element = video;
    if (!element) return;
    // `muted` is a property rather than an attribute, and an unmuted clip is not
    // allowed to start on its own. Set it before anything is asked to play.
    element.muted = true;
    setPlaying(motionWelcome());
    setDecided(true);

    // Without an observer there is no way to tell whether the clip is on screen,
    // and a page of clips all playing at once is what that would cost. In that
    // case the clip waits to be asked.
    if (!globalThis.IntersectionObserver) return;
    const observer = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  return (
    <ArticleFigure caption={props.caption}>
      <div class="post-media-frame">
        {/* A clip with no controls is a moving picture, and that is how it is
            announced — but the role and the text alternative go on the frame
            around it, because a <video> is an interactive element and must not be
            relabelled as a still one. The reader's control over it is the button
            below. */}
        <div role="img" aria-label={props.label}>
          <video
            ref={video}
            class="post-media"
            src={props.src}
            poster={props.poster}
            width={props.width}
            height={props.height}
            style={mediaShape(props)}
            muted
            loop
            playsinline
            preload="none"
          />
        </div>
        <Show when={decided()}>
          <MotionToggle
            playing={playing()}
            onToggle={() => {
              setPlaying(!playing());
              sync();
            }}
          />
        </Show>
      </div>
    </ArticleFigure>
  );
}

export interface ArticleVideoProps extends ArticleMediaBase {
  /** The imported MP4. */
  src: string;
  /** The frame to show before the reader presses play. */
  poster: string;
  /**
   * The WebVTT file of what is said, imported with `?url`. It is required, not
   * optional: a video that says something and cannot be read is a video half the
   * readers are shut out of.
   */
  captions: string;
  /** What the video shows, for a reader who cannot see it. */
  label: string;
}

/**
 * A video the reader starts, with sound, controls and captions. Nothing of it is
 * downloaded until it is asked for, so the cost of one in an article is the poster.
 */
export function ArticleVideo(props: ArticleVideoProps) {
  return (
    <ArticleFigure caption={props.caption}>
      <video
        class="post-media"
        src={props.src}
        poster={props.poster}
        width={props.width}
        height={props.height}
        style={mediaShape(props)}
        aria-label={props.label}
        controls
        playsinline
        preload="none"
      >
        <track kind="captions" src={props.captions} srclang="en" label="English" default />
      </video>
    </ArticleFigure>
  );
}

function ArticleFigure(props: { caption?: JSX.Element; children: JSX.Element }) {
  return (
    <figure class="post-figure">
      {props.children}
      <Show when={props.caption}>{(caption) => <figcaption class="post-figure-caption">{caption()}</figcaption>}</Show>
    </figure>
  );
}

function MotionToggle(props: { playing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      class="post-media-toggle"
      data-state={props.playing ? "playing" : "paused"}
      aria-label={props.playing ? "Pause animation" : "Play animation"}
      onClick={props.onToggle}
    >
      <span class="post-media-toggle-icon" aria-hidden="true" />
      {props.playing ? "Pause" : "Play"}
    </button>
  );
}

// The width and height of an <img> already tell a browser the shape to hold open.
// A <video> is not covered by that rule as widely, and the two sit in the same
// column, so both are told in writing.
function mediaShape(props: ArticleMediaBase): JSX.CSSProperties {
  return { "aspect-ratio": `${props.width} / ${props.height}` };
}
