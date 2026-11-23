import {
  CHAT_VISUAL_FRAME_SANDBOX,
  chatVisualAppTheme,
  chatVisualDocument,
  chatVisualFrameUrl,
} from "@openbot/contracts/chat-visual";
import { Match, onSettled, Switch } from "solid-js";
import { documentColorScheme } from "../../document-color-scheme";
import { REDUCED_MOTION_QUERY } from "../../utils";

export type CustomBackdropSource =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "page"; src: string }
  | { kind: "page"; html: string };

function BackdropVideo(props: { url: string }) {
  let video: HTMLVideoElement | undefined;
  const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
  const sync = () => {
    if (!video) return;
    if (reducedMotion.matches || document.hidden) video.pause();
    else void video.play().catch(() => undefined);
  };
  onSettled(() => {
    reducedMotion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  });
  return (
    <video
      ref={(element) => {
        video = element;
      }}
      class="chat-backdrop-media"
      src={props.url}
      muted
      loop
      playsinline
      preload="auto"
      disablepictureinpicture
      disableremoteplayback
      tabindex={-1}
      onLoadedData={sync}
    />
  );
}

export function CustomBackdrop(props: { source: CustomBackdropSource; title: string }) {
  const theme = () => chatVisualAppTheme(documentColorScheme());
  return (
    <div class="chat-backdrop chat-backdrop-custom" aria-hidden="true">
      <Switch>
        <Match when={props.source.kind === "image" ? props.source.url : undefined}>
          {(url) => <img class="chat-backdrop-media" src={url()} alt="" draggable={false} />}
        </Match>
        <Match when={props.source.kind === "video" ? props.source.url : undefined}>
          {(url) => <BackdropVideo url={url()} />}
        </Match>
        <Match when={"src" in props.source ? props.source.src : undefined}>
          {(src) => (
            <iframe
              class="chat-backdrop-media"
              title={props.title}
              sandbox={CHAT_VISUAL_FRAME_SANDBOX}
              referrerpolicy="no-referrer"
              tabindex={-1}
              src={chatVisualFrameUrl(src(), theme())}
            />
          )}
        </Match>
        <Match when={"html" in props.source ? props.source.html : undefined}>
          {(html) => (
            <iframe
              class="chat-backdrop-media"
              title={props.title}
              sandbox={CHAT_VISUAL_FRAME_SANDBOX}
              referrerpolicy="no-referrer"
              tabindex={-1}
              srcdoc={chatVisualDocument(html(), { theme: theme(), appearance: documentColorScheme() })}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}
