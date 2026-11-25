import type { JSX } from "@solidjs/web";
import { children, Show } from "solid-js";
import { ArticleGradient } from "./ArticleGradient";

export type ArticleMountPad = "tight" | "roomy";

interface ArticleMediaBase {
  width: number;
  height: number;
  caption?: JSX.Element;
  mountOn?: string;
  mountPad?: ArticleMountPad;
}

export interface ArticleImageProps extends ArticleMediaBase {
  src: string;
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
  const body = children(() => props.children);
  const pad = (): ArticleMountPad => props.mountPad ?? (props.wide ? "tight" : "roomy");

  return (
    <figure class="post-figure">
      <Show when={props.mountOn} fallback={body()}>
        {(title) => (
          <div ref={mount} class="post-mount" data-pad={pad()}>
            <ArticleGradient title={title()} mode="live" />
            {body()}
          </div>
        )}
      </Show>
      <Show when={props.caption}>{(caption) => <figcaption class="post-figure-caption">{caption()}</figcaption>}</Show>
    </figure>
  );
}

function mediaShape(props: ArticleMediaBase): JSX.CSSProperties {
  return { "aspect-ratio": `${props.width} / ${props.height}` };
}
