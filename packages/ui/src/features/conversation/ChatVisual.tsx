import {
  CHAT_VISUAL_FRAME_SANDBOX,
  type ChatVisualKey,
  type ChatVisualRect,
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
import { Button, Maximize2, PanelRight, Wallpaper } from "@openbot/ui";
import { Portal } from "@solidjs/web";
import { createEffect, createSignal, onSettled, Show, untrack } from "solid-js";
import { documentColorScheme } from "../../document-color-scheme";
import { useText } from "../../text";
import { CloseIcon } from "./ConversationIcons";
import { ImageLightbox, type ImageLightboxOpening } from "./ImageLightbox";
import { safeBrowserUrl } from "./RichMessageText";
import {
  isQuoteShortcut,
  QuoteSelectionButton,
  type QuoteShortcutModifier,
  releaseSelectionAction,
  type SelectionActionsPosition,
  selectionActionsPosition,
  showSelectionAction,
} from "./SelectionActions";

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
  src?: string | undefined;
  html?: string | undefined;
  title: string;
  height?: number | undefined;
  failed?: boolean;
  fill?: boolean;
  onOpenLink: (url: string) => void;
  onMessage?: ((text: string) => void) | undefined;
  onContext?: ((text: string) => void) | undefined;
  onUse?: (() => void) | undefined;
  isAppShortcut?: ((key: ChatVisualKey) => boolean) | undefined;
  onQuote?: ((text: string) => void) | undefined;
  onOpenInSidePanel?: (() => void) | undefined;
  onUseAsBackdrop?: (() => void) | undefined;
  quoteShortcut?: QuoteShortcutModifier | undefined;
  macWindowControls?: boolean | undefined;
}

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

function VisualFrame(props: ChatVisualProps) {
  const { t } = useText();
  const [theme, setTheme] = createSignal<ChatVisualTheme>();
  const [reported, setReported] = createSignal<number>();
  const [fullscreen, setFullscreen] = createSignal(false);
  const [image, setImage] = createSignal<ImageLightboxOpening | null>(null);
  const [selection, setSelection] = createSignal<{ text: string; rect: ChatVisualRect } | null>(null);
  let frame: HTMLIFrameElement | undefined;
  let box: HTMLDivElement | undefined;
  let expandButton: HTMLButtonElement | undefined;
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
    if (!open && document.activeElement !== frame) expandButton?.focus({ preventScroll: true });
  };

  let quoted: string | undefined;
  const dismiss = () => {
    const selected = selection();
    if (selected) quoted = selected.text;
    setSelection(null);
  };
  const quote = () => {
    const selected = selection();
    if (!selected || !props.onQuote) return;
    quoted = selected.text;
    setSelection(null);
    props.onQuote(selected.text);
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
        frame?.blur();
        props.onOpenLink(url);
        return;
      }
      case "display-mode":
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
        frame?.blur();
        setImage({ images: [pageImage(message.src, message.name)], index: 0 });
        return;
      case "selection":
        if (message.text === quoted) return;
        quoted = undefined;
        if (!props.onQuote || !message.text) return setSelection(null);
        showSelectionAction(dismiss);
        setSelection({ text: message.text, rect: message.rect });
        return;
      case "key": {
        const { key } = message;
        if (key.key === "Escape" && !key.metaKey && !key.ctrlKey) return exitFullscreen();
        if (!frame || !userActed()) return;
        if (selection() && isQuoteShortcut(key, props.quoteShortcut ?? "ctrl")) {
          exitFullscreen();
          frame.blur();
          return quote();
        }
        if (!props.isAppShortcut?.(key)) return;
        exitFullscreen();
        frame.blur();
        frame.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true, composed: true }));
        return;
      }
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") dismiss();
    if (event.key === "Escape" && shown() && !event.defaultPrevented) {
      event.preventDefault();
      exitFullscreen();
    }
  };
  const onBoxClick = (event: MouseEvent) => {
    if (event.target === box) exitFullscreen();
  };

  const onWindowBlur = () => {
    if (frame && document.activeElement === frame) props.onUse?.();
  };

  let quoteLayer: HTMLDivElement | undefined;
  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Node && quoteLayer?.contains(event.target))) dismiss();
  };

  onSettled(() => {
    if (frame) setTheme(visualTheme(frame));
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onWindowBlur);
    box?.addEventListener("toggle", onToggle);
    box?.addEventListener("click", onBoxClick);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onWindowBlur);
      releaseSelectionAction(dismiss);
      box?.removeEventListener("toggle", onToggle);
      box?.removeEventListener("click", onBoxClick);
    };
  });
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
          onLoad={() => {
            if (frame && untrack(theme))
              frame.contentWindow?.postMessage(chatVisualThemeMessage(visualTheme(frame)), "*");
          }}
        />
      </section>
      <Show when={!props.fill}>
        <div class="chat-visual-actions">
          <Show when={props.onOpenInSidePanel}>
            {(open) => (
              <Button
                variant="secondary"
                size="icon-sm"
                type="button"
                aria-label={t("chat.visual.openInSidePanel")}
                title={t("chat.visual.openInSidePanel")}
                data-cuelume-open=""
                onClick={() => open()()}
              >
                <PanelRight aria-hidden="true" />
              </Button>
            )}
          </Show>
          <Show when={props.onUseAsBackdrop}>
            {(setBackdrop) => (
              <Button
                variant="secondary"
                size="icon-sm"
                type="button"
                aria-label={t("chat.menu.useAsBackdrop")}
                title={t("chat.menu.useAsBackdrop")}
                onClick={() => setBackdrop()()}
              >
                <Wallpaper aria-hidden="true" />
              </Button>
            )}
          </Show>
          <Button
            ref={(element) => (expandButton = element)}
            variant="secondary"
            size="icon-sm"
            type="button"
            aria-label={t("chat.visual.fullScreen")}
            title={t("chat.visual.fullScreen")}
            data-cuelume-open=""
            onClick={enterFullscreen}
          >
            <Maximize2 aria-hidden="true" />
          </Button>
        </div>
      </Show>
      <Show when={!fullscreen() && selection()}>
        {(selected) => (
          <PageQuoteAction
            frame={() => frame}
            rect={selected().rect}
            quoteShortcut={props.quoteShortcut ?? "ctrl"}
            layerRef={(element) => (quoteLayer = element)}
            onQuote={quote}
          />
        )}
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

function PageQuoteAction(props: {
  frame: () => HTMLIFrameElement | undefined;
  rect: ChatVisualRect;
  quoteShortcut: QuoteShortcutModifier;
  layerRef: (element: HTMLDivElement) => void;
  onQuote: () => void;
}) {
  const { t } = useText();
  const [position, setPosition] = createSignal<SelectionActionsPosition | null>(null);
  let bar: HTMLDivElement | undefined;

  const place = () => {
    const frame = props.frame();
    if (!bar || !frame) return;
    const box = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    const top = box.top + frame.clientTop + Number.parseFloat(style.paddingTop);
    const left = box.left + frame.clientLeft + Number.parseFloat(style.paddingLeft);
    const selected = {
      top: Math.max(box.top, top + props.rect.top),
      left: Math.max(box.left, left + props.rect.left),
      bottom: Math.min(box.bottom, top + props.rect.bottom),
      right: Math.min(box.right, left + props.rect.right),
    };
    if (selected.bottom < selected.top || selected.right < selected.left) {
      setPosition(null);
      return;
    }
    setPosition(
      selectionActionsPosition(
        [{ ...selected, width: selected.right - selected.left, height: selected.bottom - selected.top }],
        bar.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };

  createEffect(
    () => props.rect,
    () => place(),
  );
  onSettled(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  });

  return (
    <Portal>
      <div
        ref={props.layerRef}
        class="selection-actions-layer"
        data-placement={position()?.placement ?? "bottom"}
        data-ready={position() ? "true" : "false"}
        style={{ top: `${position()?.top ?? 0}px`, left: `${position()?.left ?? 0}px` }}
      >
        <div
          ref={(element) => (bar = element)}
          class="selection-actions-bar"
          role="toolbar"
          aria-label={t("chat.selection.label")}
        >
          <div class="selection-actions-content">
            <QuoteSelectionButton quoteShortcut={props.quoteShortcut} onQuote={props.onQuote} />
          </div>
        </div>
      </div>
    </Portal>
  );
}

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
