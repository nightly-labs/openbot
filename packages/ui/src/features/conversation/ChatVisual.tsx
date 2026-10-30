import {
  CHAT_VISUAL_FRAME_SANDBOX,
  type ChatVisualKey,
  type ChatVisualReplyResult,
  type ChatVisualTheme,
  chatVisualDisplayModeMessage,
  chatVisualDocument,
  chatVisualFrameHeight,
  chatVisualFrameUrl,
  chatVisualReplyMessage,
  chatVisualThemeMessage,
  parseChatVisualMessage,
} from "@openbot/contracts/chat-visual";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Button, Maximize2 } from "@openbot/ui";
import { createEffect, createSignal, onSettled, Show, untrack } from "solid-js";
import { documentColorScheme } from "../../document-color-scheme";
import { useText } from "../../text";
import { CloseIcon } from "./ConversationIcons";
import { ImageLightbox, type ImageLightboxOpening } from "./ImageLightbox";
import { safeBrowserUrl } from "./RichMessageText";

/** The page variables and the app tokens that give their values. */
const THEME_TOKENS: ReadonlyArray<readonly [`--${string}`, string]> = [
  ["--foreground", "--openbot-text-primary"],
  ["--muted-foreground", "--openbot-text-muted"],
  ["--muted", "--openbot-bg-surface"],
  ["--card", "--openbot-bg-surface"],
  ["--card-foreground", "--openbot-text-primary"],
  ["--border", "--openbot-border-strong"],
  ["--accent", "--openbot-accent-text"],
  ["--destructive", "--openbot-danger-text"],
  ["--success", "--openbot-success-text"],
  // The storage hues were checked together for colour-vision separation; the two series hues follow.
  ["--chart-1", "--openbot-chart-storage-workspaces"],
  ["--chart-2", "--openbot-chart-storage-files"],
  ["--chart-3", "--openbot-chart-storage-chats"],
  ["--chart-4", "--openbot-chart-storage-downloads"],
  ["--chart-5", "--openbot-chart-series-codex"],
  ["--chart-6", "--openbot-chart-series-grok"],
  ["--radius", "--openbot-radius-lg"],
  ["--font-sans", "--openbot-font-sans"],
  ["--font-mono", "--openbot-font-mono"],
];

/** The theme at the place of an element. The page shows the chat through its transparent canvas. */
function visualTheme(element: Element): ChatVisualTheme {
  const style = getComputedStyle(element);
  const theme: ChatVisualTheme = { "--background": "transparent" };
  for (const [name, token] of THEME_TOKENS) {
    const value = style.getPropertyValue(token).trim();
    if (value) theme[name] = value;
  }
  return theme;
}

interface ChatVisualProps {
  /**
   * The page URL, or nothing while the app gets it. The server that gives it must send a sandbox
   * policy, as the frame does.
   */
  src?: string | undefined;
  /**
   * The page itself, for a client that has no page URL, such as a browser. The frame gets it as
   * `srcdoc` with the same sandbox, so the page still has an opaque origin. It replaces `src`.
   */
  html?: string | undefined;
  title: string;
  /** The height that the agent asked for, and the maximum height of the frame. */
  height?: number | undefined;
  /** Set when the app cannot get the page. The text replaces the page in the same box. */
  failed?: boolean;
  /** The frame fills its box, as in the file preview, and the page scrolls in it. */
  fill?: boolean;
  onOpenLink: (url: string) => void;
  /**
   * Text that the page wrote for the user's message box. The app puts it there and the user sends
   * it, so a page never sends a message itself. Without it, the page cannot write a message.
   */
  onMessage?: ((text: string) => void) | undefined;
  /** The page state for the agent, shown to the user with their next message. Empty text removes it. */
  onContext?: ((text: string) => void) | undefined;
  /**
   * Whether a key chord that the user pressed in the page is an app shortcut. The frame gives an
   * accepted chord to the app as a key press on the frame element. Without it, no key leaves the page.
   */
  isAppShortcut?: ((key: ChatVisualKey) => boolean) | undefined;
  /** The window draws the macOS window controls over the top start corner. The image viewer leaves room. */
  macWindowControls?: boolean | undefined;
}

/**
 * A visual reply: an agent's HTML page with its scripts, above the agent's reply. The page has no
 * card of its own. While the page loads or after it fails, the box keeps the agent's height, so
 * the messages below it do not move.
 */
export function ChatVisual(props: ChatVisualProps) {
  const { t } = useText();
  return (
    <Show
      when={!props.failed && (props.html !== undefined || props.src !== undefined)}
      fallback={
        <div
          class={{ "chat-visual-placeholder": true, "chat-visual-reply": props.fill !== true }}
          style={`height: ${chatVisualFrameHeight(undefined, props.height)}px`}
        >
          <Show when={props.failed}>{t("chat.visual.loadFailed", { title: props.title })}</Show>
        </div>
      }
    >
      <VisualFrame {...props} />
    </Show>
  );
}

/**
 * The frame has scripts but not `allow-same-origin`, so the page has an opaque origin and cannot
 * read the app. The page can only post messages, and each one is checked. A request that acts for
 * the user, such as a link or a message, needs a click or a key that the user made in this frame.
 *
 * Full screen puts the frame's box in the top layer. The frame stays where it is in the document,
 * so the page does not load again and keeps its state. The app's own dialogs and menus cannot show
 * above the top layer, so the page goes back into the chat before the app shows one for it.
 */
function VisualFrame(props: ChatVisualProps) {
  const { t } = useText();
  const [theme, setTheme] = createSignal<ChatVisualTheme>();
  const [reported, setReported] = createSignal<number>();
  const [fullscreen, setFullscreen] = createSignal(false);
  const [image, setImage] = createSignal<ImageLightboxOpening | null>(null);
  let frame: HTMLIFrameElement | undefined;
  let box: HTMLDivElement | undefined;
  let expandButton: HTMLButtonElement | undefined;
  // The page waits for the theme, which the frame reads at its place once it is mounted.
  const url = () => {
    const current = theme();
    return current && props.html === undefined && props.src !== undefined
      ? chatVisualFrameUrl(props.src, current)
      : undefined;
  };
  const pageDocument = () => {
    const current = theme();
    return current && props.html !== undefined ? chatVisualDocument(props.html, { theme: current }) : undefined;
  };
  const filled = () => props.fill === true || fullscreen();

  /** The user clicked or pressed a key in this frame just now. */
  const userActed = () => document.activeElement === frame && navigator.userActivation.isActive;
  const shown = () => box?.matches(":popover-open") === true;

  const enterFullscreen = () => {
    if (props.fill || !box || shown()) return;
    box.showPopover();
    frame?.focus({ preventScroll: true });
  };
  const exitFullscreen = () => {
    if (box && shown()) box.hidePopover();
  };
  const onToggle = () => {
    const open = shown();
    setFullscreen(open);
    frame?.contentWindow?.postMessage(chatVisualDisplayModeMessage(open ? "fullscreen" : "inline"), "*");
    // The close button leaves with full screen; the expand button takes the focus back.
    if (!open && document.activeElement !== frame) expandButton?.focus({ preventScroll: true });
  };

  const onMessage = (event: MessageEvent) => {
    const page = frame?.contentWindow;
    if (!page || event.source !== page) return;
    const message = parseChatVisualMessage(event.data);
    if (!message) return;
    const reply = (result: ChatVisualReplyResult | null) => {
      if ("id" in message) page.postMessage(chatVisualReplyMessage(message.id, result), "*");
    };
    switch (message.type) {
      case "size":
        setReported(message.height);
        return;
      case "open-link": {
        reply({});
        if (!userActed()) return;
        const url = safeBrowserUrl(message.url);
        if (!url) return;
        // One click opens one link: the next link needs a new click, which focuses the frame again.
        frame?.blur();
        props.onOpenLink(url);
        return;
      }
      case "display-mode":
        // Going back into the chat is always allowed; filling the window needs the user.
        if (message.mode === "inline") exitFullscreen();
        else if (userActed()) enterFullscreen();
        reply({ mode: shown() ? "fullscreen" : "inline" });
        return;
      case "message":
        if (!props.onMessage || !userActed()) return reply(null);
        exitFullscreen();
        props.onMessage(message.text);
        return reply({});
      case "refused":
        return reply(null);
      case "context":
        if (!props.onContext || !userActed()) return reply(null);
        props.onContext(message.text);
        return reply({});
      case "open-image":
        if (!userActed()) return;
        exitFullscreen();
        // The viewer reads Esc in the app window, so the app takes the focus back from the page.
        frame?.blur();
        setImage({ images: [pageImage(message.src, message.name)], index: 0 });
        return;
      case "key": {
        const { key } = message;
        if (key.key === "Escape" && !key.metaKey && !key.ctrlKey) return exitFullscreen();
        if (!frame || !userActed() || !props.isAppShortcut?.(key)) return;
        exitFullscreen();
        // The app acts on the key, so it takes the focus back first. Else the window gets its focus
        // event when the shortcut's view takes the focus, inside that view's effect.
        frame.blur();
        frame.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true, composed: true }));
        return;
      }
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && shown() && !event.defaultPrevented) {
      event.preventDefault();
      exitFullscreen();
    }
  };
  // A click on the dim area around the page in full screen goes back to the chat. Esc does the same.
  const onBoxClick = (event: MouseEvent) => {
    if (event.target === box) exitFullscreen();
  };

  onSettled(() => {
    if (frame) setTheme(visualTheme(frame));
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
    box?.addEventListener("toggle", onToggle);
    box?.addEventListener("click", onBoxClick);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown);
      box?.removeEventListener("toggle", onToggle);
      box?.removeEventListener("click", onBoxClick);
    };
  });
  // A page that is open gets the colors of the other palette as a message, so it does not load again.
  let shownScheme = untrack(documentColorScheme);
  createEffect(documentColorScheme, (scheme) => {
    if (scheme === shownScheme) return;
    shownScheme = scheme;
    if (frame && untrack(theme)) frame.contentWindow?.postMessage(chatVisualThemeMessage(visualTheme(frame)), "*");
  });

  return (
    <div
      ref={(element) => (box = element)}
      class={{
        "chat-visual-box": true,
        "chat-visual-reply": props.fill !== true,
        "chat-visual-box-fill": props.fill === true,
      }}
      popover={props.fill ? undefined : "manual"}
    >
      <section class="chat-visual-surface" aria-label={fullscreen() ? props.title : undefined}>
        <Show when={fullscreen()}>
          <header class="message-preview-dialog-header">
            <h2 class="message-preview-dialog-title">{props.title}</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={t("chat.visual.exitFullScreen")}
              title={t("chat.visual.exitFullScreen")}
              data-cuelume-tap="close"
              onClick={exitFullscreen}
            >
              <CloseIcon />
            </Button>
          </header>
        </Show>
        <iframe
          ref={(element) => (frame = element)}
          class={{ "chat-visual-frame": true, "chat-visual-frame-fill": filled() }}
          title={props.title}
          sandbox={CHAT_VISUAL_FRAME_SANDBOX}
          referrerpolicy="no-referrer"
          loading={props.fill ? undefined : "lazy"}
          src={url()}
          srcdoc={pageDocument()}
          style={filled() ? undefined : `height: ${chatVisualFrameHeight(reported(), props.height)}px`}
          // The frame loads `about:blank` while it is inserted, which runs this handler inside a render.
          onLoad={() => {
            // The colors at this time, which can be the other palette since the URL was made.
            if (frame && untrack(theme))
              frame.contentWindow?.postMessage(chatVisualThemeMessage(visualTheme(frame)), "*");
          }}
        />
      </section>
      {/* It stays in the document in full screen, so it can take the focus back when the page returns. */}
      <Show when={!props.fill}>
        <Button
          ref={(element) => (expandButton = element)}
          variant="secondary"
          size="icon-sm"
          type="button"
          class="chat-visual-expand"
          aria-label={t("chat.visual.fullScreen")}
          title={t("chat.visual.fullScreen")}
          data-cuelume-open=""
          onClick={enterFullscreen}
        >
          <Maximize2 aria-hidden="true" />
        </Button>
      </Show>
      <Show when={image()}>
        {(opening) => (
          <ImageLightbox
            opening={opening()}
            macWindowControls={props.macWindowControls}
            onClose={() => {
              setImage(null);
              frame?.focus({ preventScroll: true });
            }}
          />
        )}
      </Show>
    </div>
  );
}

/** A page image for the image viewer, which shows it as it shows an image in a message. */
function pageImage(src: string, name: string): AttachmentSummary {
  return {
    id: "chat-visual-image",
    name,
    size: 0,
    kind: "image",
    mimeType: "image/*",
    previewKind: "image",
    previewUrl: src,
  };
}
