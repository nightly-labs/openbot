import {
  BROWSER_LIVE_VIEW_MAX_PASTE_TEXT,
  type BrowserDesktopApi,
  type BrowserLiveViewInput,
} from "@openbot/contracts/ipc";
import { ErrorReference, toast } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { errorReference } from "@openbot/user-errors";
import { createEffect, createSignal, createStore, onCleanup, Show } from "solid-js";

const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;

export type BrowserViewRuntime = Pick<
  BrowserDesktopApi,
  "startLiveView" | "stopLiveView" | "sendLiveViewInput" | "onLiveViewEvent"
>;

interface LiveViewFrame {
  sequence: number;
  width: number;
  height: number;
  image: Uint8Array;
}

interface BrowserLiveViewProps {
  runtime: BrowserViewRuntime;
  tabId: string;
  active: boolean;
  clipboard: boolean;
  onFrameSize?: (size: { width: number; height: number }) => void;
}

export default function BrowserLiveView(props: BrowserLiveViewProps) {
  const runtime = props.runtime;
  const { t, errorMessage, sourceText } = useText();
  const [state, setState] = createStore<{ live: boolean; message: string | null; reference: string | null }>({
    live: false,
    message: null,
    reference: null,
  });
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
  const [frame, setFrame] = createSignal<{ sequence: number; width: number; height: number }>();
  let pendingFrame: Promise<void> | undefined;
  let queuedFrame: LiveViewFrame | undefined;
  let stream = 0;

  const abandonStream = () => {
    stream += 1;
    pendingFrame = undefined;
    queuedFrame = undefined;
    setFrame(undefined);
  };

  const draw = async (next: LiveViewFrame) => {
    const element = canvas();
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const drawnFor = stream;
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(next.image)], { type: "image/jpeg" }));
    if (drawnFor !== stream) {
      bitmap.close();
      return;
    }
    if (element.width !== next.width || element.height !== next.height) {
      element.width = next.width;
      element.height = next.height;
    }
    context.drawImage(bitmap, 0, 0, next.width, next.height);
    bitmap.close();
    setFrame({ sequence: next.sequence, width: next.width, height: next.height });
  };

  const decode = (next: LiveViewFrame) => {
    const drawing: Promise<void> = draw(next)
      .catch(() => undefined)
      .finally(() => {
        if (pendingFrame !== drawing) return;
        pendingFrame = undefined;
        const queued = queuedFrame;
        queuedFrame = undefined;
        if (queued) decode(queued);
      });
    pendingFrame = drawing;
  };

  let pendingCopy: ((answer: CopyAnswer) => void) | undefined;
  const settleCopy = (answer: CopyAnswer) => {
    const settle = pendingCopy;
    pendingCopy = undefined;
    settle?.(answer);
  };
  onCleanup(() => settleCopy(null));

  const stopListening = runtime.onLiveViewEvent((event) => {
    if (event.tabId !== props.tabId) return;
    if (event.type === "copied") {
      settleCopy({ text: event.text });
      return;
    }
    if (event.type === "copyTooLarge") {
      settleCopy("tooLarge");
      return;
    }
    if (event.type === "stopped") {
      settleCopy(null);
      abandonStream();
      setState(() => ({ live: false, message: sourceText(event.reason), reference: null }));
      return;
    }
    if (!state.live) setState(() => ({ live: true, message: "", reference: null }));
    if (pendingFrame) {
      queuedFrame = event;
      return;
    }
    decode(event);
  });
  onCleanup(stopListening);

  const [pageVisible, setPageVisible] = createSignal(!document.hidden);
  const updatePageVisible = () => setPageVisible(!document.hidden);
  document.addEventListener("visibilitychange", updatePageVisible);
  onCleanup(() => document.removeEventListener("visibilitychange", updatePageVisible));
  let pausedTabId: string | undefined;

  createEffect(
    () => ({ tabId: props.tabId, open: props.active, visible: pageVisible() }),
    ({ tabId, open, visible }) => {
      if (!open) pausedTabId = undefined;
      if (!open || !visible) return;
      abandonStream();
      if (pausedTabId !== tabId || !state.live) setState(() => ({ live: false, message: null, reference: null }));
      pausedTabId = undefined;
      void runtime.startLiveView(tabId).catch((error: unknown) =>
        setState(() => ({
          live: false,
          message: errorMessage(error, t("browser.liveView.failed")),
          reference: errorReference(error),
        })),
      );
      return () => {
        pausedTabId = document.hidden ? tabId : undefined;
        void runtime.stopLiveView().catch(() => undefined);
      };
    },
  );

  createEffect(
    () => ({ drawn: frame(), onFrameSize: props.onFrameSize }),
    ({ drawn, onFrameSize }) => {
      if (drawn) onFrameSize?.({ width: drawn.width, height: drawn.height });
    },
  );

  const send = (input: BrowserLiveViewInput) => {
    void runtime.sendLiveViewInput(input).catch(() => undefined);
  };

  createEffect(
    () => frame(),
    (drawn) => {
      if (!drawn) return;
      send({ type: "ack", sequence: drawn.sequence });
    },
  );

  const point = (event: MouseEvent): { x: number; y: number; sequence: number } | null => {
    const bounds = canvas()?.getBoundingClientRect();
    const size = frame();
    if (!bounds || !size || bounds.width === 0 || bounds.height === 0) return null;
    if (size.width === 0 || size.height === 0) return null;
    const scale = Math.min(bounds.width / size.width, bounds.height / size.height);
    const width = size.width * scale;
    const height = size.height * scale;
    const x = (event.clientX - bounds.left - (bounds.width - width) / 2) / width;
    const y = (event.clientY - bounds.top - (bounds.height - height) / 2) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y, sequence: size.sequence };
  };

  const pointer = (event: MouseEvent, action: "move" | "down" | "up") => {
    const at = point(event);
    if (!at) return;
    send({
      type: "pointer",
      action,
      ...at,
      button: event.button === 1 ? "middle" : event.button === 2 ? "right" : "left",
      clickCount: Math.min(Math.max(event.detail, 1), 3),
      modifiers: modifiers(event),
    });
  };

  const copy = (cut: boolean) => {
    if (pendingCopy) return;
    let failure: "empty" | "tooLarge" | undefined;
    let copied = "";
    const answer = new Promise<CopyAnswer>((resolve) => {
      pendingCopy = resolve;
    });
    const text = answer.then((reply) => {
      if (reply === "tooLarge" || !reply?.text) {
        failure = reply === "tooLarge" ? "tooLarge" : "empty";
        throw new Error("The host sent no text to copy.");
      }
      copied = reply.text;
      return new Blob([reply.text], { type: "text/plain" });
    });
    send({ type: "copy" });
    void writeClipboard(text).then(
      () => {
        if (cut) send({ type: "cut", text: copied });
      },
      (error) => {
        if (failure === "tooLarge") toast.error(t("browser.liveView.copyTooLarge"));
        else if (failure !== "empty") toast.error(t("browser.liveView.copyFailed"), { error });
      },
    );
  };

  const key = (event: KeyboardEvent, action: "down" | "up") => {
    const letter = clipboardLetter(event);
    if (letter !== "v" || !props.clipboard) event.preventDefault();
    send({ type: "key", action, key: event.key, code: event.code, modifiers: modifiers(event) });
    if (action === "down" && letter) {
      if (!props.clipboard)
        toast.error(t("browser.liveView.clipboardUnsupported"), { id: CLIPBOARD_UNSUPPORTED_TOAST });
      else if (letter !== "v") copy(letter === "x");
    }
    if (action === "down" && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      send({ type: "key", action: "char", key: event.key, code: event.code, text: event.key });
    }
  };

  const paste = (event: ClipboardEvent) => {
    event.preventDefault();
    if (!props.clipboard) {
      toast.error(t("browser.liveView.clipboardUnsupported"), { id: CLIPBOARD_UNSUPPORTED_TOAST });
      return;
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    if (text.length > BROWSER_LIVE_VIEW_MAX_PASTE_TEXT) {
      toast.error(t("browser.liveView.pasteTooLong"));
      return;
    }
    send({ type: "paste", text });
  };

  const menuCopy = (cut: boolean) => {
    if (props.clipboard) copy(cut);
    else toast.error(t("browser.liveView.clipboardUnsupported"), { id: CLIPBOARD_UNSUPPORTED_TOAST });
  };

  createEffect(
    () => canvas(),
    (element) => {
      if (!element) return;
      const document = element.ownerDocument;
      const clipboardEvent = (event: ClipboardEvent) => {
        if (event.target !== element && document.activeElement !== element) return;
        event.stopImmediatePropagation();
        if (event.type === "paste") paste(event);
        else menuCopy(event.type === "cut");
      };
      for (const type of CLIPBOARD_EVENTS) document.addEventListener(type, clipboardEvent, true);
      return () => {
        for (const type of CLIPBOARD_EVENTS) document.removeEventListener(type, clipboardEvent, true);
      };
    },
  );

  return (
    <div class="browser-live-view">
      <canvas
        ref={setCanvas}
        tabindex="0"
        role="img"
        aria-label={t("browser.liveView.label")}
        hidden={!state.live}
        onMouseMove={(event) => pointer(event, "move")}
        onMouseDown={(event) => {
          canvas()?.focus();
          pointer(event, "down");
        }}
        onMouseUp={(event) => pointer(event, "up")}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={(event) => {
          const at = point(event);
          if (!at) return;
          if (event.ctrlKey) event.preventDefault();
          send({
            type: "pointer",
            action: "wheel",
            ...at,
            button: "left",
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            modifiers: modifiers(event),
          });
        }}
        onKeyDown={(event) => key(event, "down")}
        onKeyUp={(event) => key(event, "up")}
      />
      <Show when={!state.live}>
        <div class="browser-empty-state">
          <span>{state.message ?? t("browser.liveView.connecting")}</span>
          <ErrorReference reference={state.reference} />
        </div>
      </Show>
    </div>
  );
}

const CLIPBOARD_EVENTS = ["paste", "copy", "cut"] as const;
const CLIPBOARD_UNSUPPORTED_TOAST = "browser-live-view-clipboard-unsupported";

type CopyAnswer = { text: string } | "tooLarge" | null;

function clipboardLetter(event: KeyboardEvent): "c" | "v" | "x" | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  const letter = /^[a-z]$/iu.test(event.key)
    ? event.key.toLowerCase()
    : /^Key[A-Z]$/u.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : "";
  return letter === "c" || letter === "v" || letter === "x" ? letter : undefined;
}

function writeClipboard(text: Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem !== "undefined")
    return navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
  return text.then((blob) => blob.text()).then((value) => navigator.clipboard.writeText(value));
}

function modifiers(event: MouseEvent | KeyboardEvent): number {
  return (
    (event.altKey ? ALT : 0) + (event.ctrlKey ? CONTROL : 0) + (event.metaKey ? META : 0) + (event.shiftKey ? SHIFT : 0)
  );
}
