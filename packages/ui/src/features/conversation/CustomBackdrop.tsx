import {
  CHAT_VISUAL_FRAME_SANDBOX,
  chatVisualAppTheme,
  chatVisualDocument,
  chatVisualFrameUrl,
} from "@openbot/contracts/chat-visual";
import { Match, Switch } from "solid-js";
import { documentColorScheme } from "../../document-color-scheme";

/**
 * What a backdrop that the user added shows: a picture or GIF from a data URL, or an HTML page. The
 * desktop serves a page at an `openbot-visual:` address (`src`), because its policy stops scripts in
 * `srcdoc`; the web client gives the HTML (`html`).
 */
export type CustomBackdropSource =
  | { kind: "image"; url: string }
  | { kind: "page"; src: string }
  | { kind: "page"; html: string };

/**
 * A backdrop that the user added, behind the whole window like `ChatBackdrop`. A page plays in the
 * same locked frame as a visual reply, and it gets no pointer or keyboard input. A tint in the chat
 * color keeps the text readable on a bright or busy picture.
 */
export function CustomBackdrop(props: { source: CustomBackdropSource; title: string }) {
  const theme = () => chatVisualAppTheme(documentColorScheme());
  return (
    <div class="chat-backdrop chat-backdrop-custom" aria-hidden="true">
      <Switch>
        <Match when={"url" in props.source ? props.source.url : undefined}>
          {(url) => <img class="chat-backdrop-media" src={url()} alt="" draggable={false} />}
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
