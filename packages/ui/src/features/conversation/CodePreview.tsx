import { type ChatPreviewKind, chatHtmlPreviewDocument } from "@openbot/contracts/chat-preview";
import { Button, Dialog, Maximize2, SlidingTabs } from "@openbot/ui";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, Match, onSettled, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { CodeBlock } from "./CodeBlock";
import { CloseIcon } from "./ConversationIcons";
import { createSmoothHeightResize } from "./createSmoothHeightResize";
import type { MessageCodeBlock } from "./DataTable";
import { DiagramCanvas } from "./DiagramCanvas";
import { BACKDROP_IN, BACKDROP_OUT, IMAGE_FADE_IN, ZOOM_IN, ZOOM_OUT, ZOOM_OUT_DURATION } from "./lightbox-motion";
import { mermaidDiagramUrl } from "./mermaid-diagram";
import { safeBrowserUrl } from "./RichMessageText";

type DiagramState = { status: "drawing" } | { status: "ready"; url: string } | { status: "failed" };
type PreviewView = "preview" | "code";

/**
 * A fenced ```html or ```mermaid block: the rendered page or diagram in the code block's frame,
 * with a switch to its code and a larger view. While the block streams, it shows the code, because
 * half a page or diagram is not worth drawing. A diagram that Mermaid cannot parse stays code.
 */
export function CodePreview(props: {
  block: MessageCodeBlock;
  kind: ChatPreviewKind;
  streaming?: boolean;
  onOpenLink: (url: string) => void;
}) {
  const { t } = useText();
  const [view, setView] = createSignal<PreviewView>("preview");
  const [expanded, setExpanded] = createSignal(false);
  const [diagram, setDiagram] = createSignal<DiagramState>({ status: "drawing" });
  let diagramRun = 0;
  let card: HTMLElement | undefined;
  let expandButton: HTMLButtonElement | undefined;
  let resize: HTMLDivElement | undefined;
  let views: HTMLDivElement | undefined;

  createEffect(
    () => (props.kind === "mermaid" && !props.streaming ? props.block.code : null),
    (source) => {
      const run = ++diagramRun;
      if (source === null) return;
      setDiagram({ status: "drawing" });
      void mermaidDiagramUrl(source).then((url) => {
        if (run === diagramRun) setDiagram(url ? { status: "ready", url } : { status: "failed" });
      });
    },
  );
  onSettled(() => () => {
    diagramRun += 1;
  });
  // The block eases to the height of the view that the switch selects.
  createSmoothHeightResize({ container: () => resize, content: () => views });

  const previewable = () => !props.streaming && !(props.kind === "mermaid" && diagram().status === "failed");
  const title = () => (props.kind === "html" ? t("chat.preview.htmlTitle") : t("chat.preview.mermaidTitle"));
  const content = (fill: boolean) => (
    <Switch>
      <Match when={props.kind === "html"}>
        <HtmlPreviewFrame html={props.block.code} title={title()} fill={fill} onOpenLink={props.onOpenLink} />
      </Match>
      <Match when={diagram().status === "drawing"}>
        <p class="message-preview-status" role="status">
          {t("chat.preview.drawing")}
        </p>
      </Match>
      <Match when={diagramUrl(diagram())}>
        {(url) =>
          fill ? (
            <DiagramCanvas url={url()} title={title()} />
          ) : (
            <img class="message-preview-diagram" src={url()} alt={title()} />
          )
        }
      </Match>
    </Switch>
  );
  const previewViews = (code: JSX.Element) => (
    <div class="message-preview-resize" ref={(element) => (resize = element)}>
      <SlidingTabs.ContentSlot class="message-preview-views" ref={(element) => (views = element)}>
        <SlidingTabs.Content value="preview" class="message-preview-view">
          <div class="message-preview-body" data-preview-kind={props.kind}>
            {content(false)}
          </div>
        </SlidingTabs.Content>
        <SlidingTabs.Content value="code" class="message-preview-view">
          {code}
        </SlidingTabs.Content>
      </SlidingTabs.ContentSlot>
    </div>
  );

  return (
    <SlidingTabs.Root
      ref={card}
      class="message-preview"
      value={view()}
      onChange={(value: string) => setView(value === "code" ? "code" : "preview")}
    >
      <CodeBlock
        block={props.block}
        streaming={props.streaming}
        actions={
          <Show when={previewable()}>
            <SlidingTabs.List class="message-preview-switch" aria-label={t("chat.preview.switchLabel")}>
              <SlidingTabs.Trigger value="preview">{t("chat.preview.preview")}</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="code">{t("chat.preview.code")}</SlidingTabs.Trigger>
            </SlidingTabs.List>
          </Show>
        }
        trailingActions={
          <Show when={previewable()}>
            <Button
              ref={expandButton}
              type="button"
              variant="ghost"
              size="xs"
              class="message-code-copy message-preview-expand"
              data-cuelume-open=""
              onClick={() => setExpanded(true)}
            >
              <Maximize2 aria-hidden="true" />
              <span>{t("chat.preview.expandLabel")}</span>
            </Button>
          </Show>
        }
        body={previewable() ? previewViews : undefined}
      />
      <Show when={expanded() && previewable()}>
        <PreviewDialog
          title={title()}
          kind={props.kind}
          origin={() => card}
          onClosed={() => {
            setExpanded(false);
            if (expandButton?.isConnected) expandButton.focus({ preventScroll: true });
          }}
        >
          {content(true)}
        </PreviewDialog>
      </Show>
    </SlidingTabs.Root>
  );
}

function diagramUrl(state: DiagramState): string | undefined {
  return state.status === "ready" ? state.url : undefined;
}

const CONTENT_FADE_IN: KeyframeAnimationOptions = { ...IMAGE_FADE_IN, delay: 90, fill: "backwards" };
const CONTENT_FADE_OUT: KeyframeAnimationOptions = { duration: 120, easing: "linear", fill: "forwards" };

/**
 * The larger view. It grows out of the block that opened it and goes back into it when it
 * closes, as the image viewer does with a thumbnail. With reduced motion, or when the block has
 * left the list, it only fades.
 */
function PreviewDialog(props: {
  title: string;
  kind: ChatPreviewKind;
  origin: () => HTMLElement | undefined;
  onClosed: () => void;
  children: JSX.Element;
}) {
  const { t } = useText();
  let backdrop: HTMLElement | undefined;
  let surface: HTMLElement | undefined;
  let body: HTMLDivElement | undefined;
  let frame: number | undefined;
  let closing = false;

  /** The transform that puts the dialog on the block, or undefined when it only fades. */
  const originTransform = (): string | undefined => {
    const origin = props.origin();
    if (!surface || !origin?.isConnected || prefersReducedMotion()) return undefined;
    const from = origin.getBoundingClientRect();
    const to = surface.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) return undefined;
    const x = from.left - to.left;
    const y = from.top - to.top;
    return `translate(${x}px, ${y}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  };

  const open = () => {
    frame = undefined;
    // The portal can attach after this component settles; the dialog stays hidden until then.
    if (!surface?.isConnected || !backdrop) {
      frame = requestAnimationFrame(open);
      return;
    }
    const from = originTransform();
    surface.dataset.shown = "";
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], BACKDROP_IN);
    if (from) {
      surface.animate([{ transform: from }, { transform: "none" }], ZOOM_IN);
      body?.animate([{ opacity: 0 }, { opacity: 1 }], CONTENT_FADE_IN);
    } else {
      surface.animate([{ opacity: 0 }, { opacity: 1 }], IMAGE_FADE_IN);
    }
  };

  const close = () => {
    if (closing) return;
    closing = true;
    if (!surface || !backdrop) {
      props.onClosed();
      return;
    }
    const to = originTransform();
    const animations = [backdrop.animate([{ opacity: 1 }, { opacity: 0 }], BACKDROP_OUT)];
    if (to) {
      animations.push(
        surface.animate([{ transform: "none" }, { transform: to }], ZOOM_OUT),
        // The dialog fades at the end, so the block under it takes its place.
        surface.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], {
          duration: ZOOM_OUT_DURATION,
          fill: "forwards",
        }),
      );
      if (body) animations.push(body.animate([{ opacity: 1 }, { opacity: 0 }], CONTENT_FADE_OUT));
    } else {
      animations.push(surface.animate([{ opacity: 1 }, { opacity: 0 }], CONTENT_FADE_OUT));
    }
    void Promise.all(animations.map((animation) => animation.finished))
      .catch(() => undefined)
      .then(props.onClosed);
  };

  onSettled(() => {
    open();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  });

  return (
    <Dialog.Root open onOpenChange={(isOpen) => !isOpen && close()}>
      <Dialog.Portal>
        <Dialog.Overlay ref={backdrop} class="message-preview-backdrop">
          <Dialog.Content ref={surface} class="message-preview-dialog" as="section">
            <header class="message-preview-dialog-header">
              <Dialog.Title class="message-preview-dialog-title">{props.title}</Dialog.Title>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={t("common.close")}
                title={t("common.close")}
                data-cuelume-tap="close"
                onClick={close}
              >
                <CloseIcon />
              </Button>
            </header>
            <div ref={(element) => (body = element)} class="message-preview-dialog-body" data-preview-kind={props.kind}>
              {props.children}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Agent HTML in a sandboxed frame. Without `allow-scripts` nothing in the page runs, and the page
 * policy blocks every request, so the page can only draw itself. `allow-same-origin` is safe
 * without scripts, and it lets the app read the page height and open its links in the browser.
 */
function HtmlPreviewFrame(props: { html: string; title: string; fill: boolean; onOpenLink: (url: string) => void }) {
  const [height, setHeight] = createSignal<number>();
  let frame: HTMLIFrameElement | undefined;
  const measure = () => {
    const root = frame?.contentDocument?.documentElement;
    if (root) setHeight(Math.ceil(root.getBoundingClientRect().height));
  };
  const openLink = (event: MouseEvent) => {
    const page = frame?.contentDocument;
    if (!page) return;
    const path = event.composedPath();
    const link = [...page.querySelectorAll("a, area")].find((anchor) => path.includes(anchor));
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      page.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
      return;
    }
    const url = safeBrowserUrl(href);
    if (url) props.onOpenLink(url);
  };
  onSettled(() => {
    // The page reflows when the message gets narrower or wider.
    const observer = new ResizeObserver(measure);
    if (frame) observer.observe(frame);
    return () => observer.disconnect();
  });
  return (
    <iframe
      ref={(element) => (frame = element)}
      class="message-preview-frame"
      title={props.title}
      sandbox="allow-same-origin"
      referrerpolicy="no-referrer"
      srcdoc={chatHtmlPreviewDocument(props.html)}
      style={props.fill || height() === undefined ? undefined : `--message-preview-height: ${height()}px`}
      onLoad={() => {
        measure();
        frame?.contentDocument?.addEventListener("click", openLink);
      }}
    />
  );
}
