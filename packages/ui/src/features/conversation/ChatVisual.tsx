import {
  type ChatVisualTheme,
  chatVisualFrameHeight,
  chatVisualFrameUrl,
  chatVisualThemeMessage,
  parseChatVisualMessage,
} from "@openbot/contracts/chat-visual";
import { createSignal, onSettled, Show, untrack } from "solid-js";
import { useText } from "../../text";
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
  src?: string;
  title: string;
  /** The height that the agent asked for, and the maximum height of the frame. */
  height?: number;
  /** Set when the app cannot get the page. The text replaces the page in the same box. */
  failed?: boolean;
  /** The frame fills its box, as in the file preview, and the page scrolls in it. */
  fill?: boolean;
  onOpenLink: (url: string) => void;
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
      when={!props.failed && props.src}
      fallback={
        <div
          class={{ "chat-visual-placeholder": true, "chat-visual-reply": props.fill !== true }}
          style={`height: ${chatVisualFrameHeight(undefined, props.height)}px`}
        >
          <Show when={props.failed}>{t("chat.visual.loadFailed", { title: props.title })}</Show>
        </div>
      }
    >
      {(src) => <VisualFrame {...props} src={src()} />}
    </Show>
  );
}

/**
 * The frame has scripts but not `allow-same-origin`, so the page has an opaque origin and cannot
 * read the app. The page can only post messages, and each one is checked. A link opens only after
 * a click that the user made in this frame.
 */
function VisualFrame(props: ChatVisualProps & { src: string }) {
  const [theme, setTheme] = createSignal<ChatVisualTheme>();
  const [reported, setReported] = createSignal<number>();
  let frame: HTMLIFrameElement | undefined;
  // The URL waits for the theme, which the frame reads at its place once it is mounted.
  const url = () => {
    const current = theme();
    return current ? chatVisualFrameUrl(props.src, current) : undefined;
  };

  const onMessage = (event: MessageEvent) => {
    const page = frame?.contentWindow;
    if (!page || event.source !== page) return;
    const message = parseChatVisualMessage(event.data);
    if (!message) return;
    if (message.type === "size") {
      setReported(message.height);
      return;
    }
    page.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
    if (document.activeElement !== frame || !navigator.userActivation.isActive) return;
    const url = safeBrowserUrl(message.url);
    if (!url) return;
    // One click opens one link: the next link needs a new click, which focuses the frame again.
    frame?.blur();
    props.onOpenLink(url);
  };

  onSettled(() => {
    if (frame) setTheme(visualTheme(frame));
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  return (
    <iframe
      ref={(element) => (frame = element)}
      class={{
        "chat-visual-frame": true,
        "chat-visual-frame-fill": props.fill === true,
        "chat-visual-reply": props.fill !== true,
      }}
      title={props.title}
      sandbox="allow-scripts allow-forms"
      referrerpolicy="no-referrer"
      loading={props.fill ? undefined : "lazy"}
      src={url()}
      style={props.fill ? undefined : `height: ${chatVisualFrameHeight(reported(), props.height)}px`}
      // The frame loads `about:blank` while it is inserted, which runs this handler inside a render.
      onLoad={() => {
        const current = untrack(theme);
        if (current) frame?.contentWindow?.postMessage(chatVisualThemeMessage(current), "*");
      }}
    />
  );
}
