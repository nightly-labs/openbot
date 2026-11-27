import {
  type ChatPreviewKind,
  chatHtmlPreviewDocument,
  mermaidMayLoadRemoteContent,
} from "@openbot/contracts/chat-preview";
import { Button, Dialog, Maximize2, SlidingTabs } from "@openbot/ui";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, Match, onSettled, Show, Switch } from "solid-js";
import { ScrollEdges } from "../../components/ScrollEdges";
import { documentColorScheme } from "../../document-color-scheme";
import { useText } from "../../text";
import { CodeBlock } from "./CodeBlock";
import { CloseIcon } from "./ConversationIcons";
import { createSmoothHeightResize } from "./createSmoothHeightResize";
import type { MessageCodeBlock } from "./DataTable";
import { DiagramCanvas } from "./DiagramCanvas";
import { BACKDROP_IN, BACKDROP_OUT, IMAGE_FADE_IN, ZOOM_IN, ZOOM_OUT, ZOOM_OUT_DURATION } from "./lightbox-motion";
import { type MermaidDiagram, mermaidDiagram } from "./mermaid-diagram";
import { safeBrowserUrl } from "./RichMessageText";

type DiagramState = { status: "drawing" } | MermaidDiagram;
type PreviewView = "preview" | "code";

export function CodePreview(props: {
  block: MessageCodeBlock;
  kind: ChatPreviewKind;
  streaming?: boolean;
  onOpenLink: (url: string) => void;
  remoteContent?: boolean | undefined;
}) {
  const { t } = useText();
  const [remoteAllowed, setRemoteAllowed] = createSignal(false);
  const remoteBlocked = () =>
    props.kind === "mermaid" &&
    props.remoteContent !== true &&
    !remoteAllowed() &&
    mermaidMayLoadRemoteContent(props.block.code);
  const [view, setView] = createSignal<PreviewView>("preview");
  const [expanded, setExpanded] = createSignal(false);
  const [diagram, setDiagram] = createSignal<DiagramState>({ status: "drawing" });
  const [diagramAttempt, setDiagramAttempt] = createSignal(0);
  let diagramRun = 0;
  let card: HTMLElement | undefined;
  let expandButton: HTMLButtonElement | undefined;
  let resize: HTMLDivElement | undefined;
  let views: HTMLDivElement | undefined;

  createEffect(
    () => {
      diagramAttempt();
      return props.kind === "mermaid" && !props.streaming && !remoteBlocked()
        ? { source: props.block.code, scheme: documentColorScheme() }
        : null;
    },
    (drawn) => {
      const run = ++diagramRun;
      if (drawn === null) return;
      setDiagram({ status: "drawing" });
      void mermaidDiagram(drawn.source, drawn.scheme).then((result) => {
        if (run === diagramRun) setDiagram(result);
      });
    },
  );
  onSettled(() => () => {
    diagramRun += 1;
  });
  createSmoothHeightResize({ container: () => resize, content: () => views });

  const diagramFailure = () => {
    const state = diagram();
    return props.kind === "mermaid" &&
      !props.streaming &&
      (state.status === "invalid" || state.status === "unavailable")
      ? state
      : undefined;
  };
  const invalidDiagramMessage = () => {
    const failure = diagramFailure();
    return failure?.status === "invalid" ? failure.message : "";
  };
  const previewable = () => !props.streaming && !diagramFailure();
  const title = () => (props.kind === "html" ? t("chat.preview.htmlTitle") : t("chat.preview.mermaidTitle"));
  const content = (fill: boolean) => (
    <Switch>
      <Match when={props.kind === "html"}>
        <HtmlPreviewFrame html={props.block.code} title={title()} fill={fill} onOpenLink={props.onOpenLink} />
      </Match>
      <Match when={remoteBlocked()}>
        <div class="message-preview-remote">
          <p class="message-preview-status">{t("chat.remoteContent.diagramNotDrawn")}</p>
          <Button variant="outline" size="sm" type="button" onClick={() => setRemoteAllowed(true)}>
            {t("chat.remoteContent.loadDiagram")}
          </Button>
        </div>
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
          <Show
            when={props.kind === "mermaid"}
            fallback={
              <div class="message-preview-body" data-preview-kind={props.kind}>
                {content(false)}
              </div>
            }
          >
            <ScrollEdges
              axis="y"
              label={title()}
              class="message-preview-diagram-scroll"
              viewClass="message-preview-body message-preview-diagram-view"
            >
              {content(false)}
            </ScrollEdges>
          </Show>
        </SlidingTabs.Content>
        <SlidingTabs.Content value="code" class="message-preview-view">
          {code}
        </SlidingTabs.Content>
      </SlidingTabs.ContentSlot>
    </div>
  );

  const failedDiagram = (code: JSX.Element) => (
    <>
      <div class="message-preview-failure" role="status">
        <Show
          when={diagramFailure()?.status === "unavailable"}
          fallback={
            <>
              <span>{t("chat.preview.diagramInvalid")}</span>
              <Show when={invalidDiagramMessage()}>
                {(message) => (
                  <pre class="message-preview-failure-detail" dir="ltr">
                    {message()}
                  </pre>
                )}
              </Show>
            </>
          }
        >
          <span>{t("chat.preview.diagramUnavailable")}</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setDiagramAttempt((attempt) => attempt + 1)}>
            {t("common.retry")}
          </Button>
        </Show>
      </div>
      {code}
    </>
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
        body={previewable() ? previewViews : diagramFailure() ? failedDiagram : undefined}
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
