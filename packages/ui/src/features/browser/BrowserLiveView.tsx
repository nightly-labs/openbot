import {
  BROWSER_LIVE_VIEW_MAX_PASTE_TEXT,
  type BrowserDesktopApi,
  type BrowserLiveViewInput,
} from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore, onCleanup, Show } from "solid-js";

/** CDP's modifier bitmap, which is what the host dispatches the event with. */
const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;

export type BrowserViewRuntime = Pick<
  BrowserDesktopApi,
  "startLiveView" | "stopLiveView" | "sendLiveViewInput" | "onLiveViewEvent"
>;

/** One frame of the host's screencast, as the renderer receives it. */
interface LiveViewFrame {
  sequence: number;
  width: number;
  height: number;
  image: Uint8Array;
}

interface BrowserLiveViewProps {
  runtime: BrowserViewRuntime;
  tabId: string;
  /** False while the panel is closed: a view nobody is looking at still costs the host a screencast. */
  active: boolean;
  /** Whether the host pastes and copies for this view. An older host closes the view on either. */
  clipboard: boolean;
  /** The pixel size of the frame on the canvas, so the panel can take the page's shape. */
  onFrameSize?: (size: { width: number; height: number }) => void;
}

/**
 * The page on a remote host, drawn here.
 *
 * A local tab is a native view placed over this panel, so there is nothing to draw. A host's tab is
 * somewhere else entirely, and before this the panel showed a still image that changed when the user
 * asked for another one. The host sends frames while anyone watches, and the pointer and keys go
 * back on the same socket as a fraction of the frame the user was actually looking at.
 */
export default function BrowserLiveView(props: BrowserLiveViewProps) {
  const runtime = props.runtime;
  const { t, errorMessage, sourceText } = useText();
  // `message` is null while the view connects, and otherwise text from the host or an error.
  const [state, setState] = createStore<{ live: boolean; message: string | null }>({
    live: false,
    message: null,
  });
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
  /**
   * The frame the canvas is showing, which is not the last frame to arrive. Decoding is
   * asynchronous, so while the host resizes its viewport the newest frame's shape and the drawn
   * pixels disagree. `object-fit` letterboxes what is drawn, so a pointer placed with the newer
   * shape would miss by the difference between the two bands. Its sequence goes back with every
   * point, so the host expands the fraction against these pixels and not a frame still in transit.
   * It stays unset until the first frame is drawn, which is what holds input back while there is
   * nothing on the canvas to aim at.
   */
  const [frame, setFrame] = createSignal<{ sequence: number; width: number; height: number }>();
  let pendingFrame: Promise<void> | undefined;
  /**
   * The newest frame to arrive while another was decoding. Only the newest is worth keeping: it is
   * the page as it is now, and the ones behind it are a page nobody can still act on.
   */
  let queuedFrame: LiveViewFrame | undefined;
  /** Which stream the frames belong to. Another tab, or the same tab again, is a new one. */
  let stream = 0;

  /**
   * Forget the stream that just ended, including the frame still decoding in it. That frame is a
   * page nobody is watching any more: drawn late it would put stale pixels and stale geometry under
   * a pointer that now belongs somewhere else, and left pending it would drop the new stream's
   * frames until it finished.
   */
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
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    setFrame({ sequence: next.sequence, width: next.width, height: next.height });
  };

  /**
   * Decode one frame, then whichever frame arrived last while it was decoding. Dropping a frame and
   * waiting for the next one is wrong for a page that has stopped changing: the host sends nothing
   * more, and the canvas would keep the frame before the last resize for as long as the user looks
   * at it.
   */
  const decode = (next: LiveViewFrame) => {
    const drawing: Promise<void> = draw(next)
      .catch(() => undefined)
      .finally(() => {
        // An abandoned stream leaves its decode running, so only the promise that is still the
        // pending one may clear it or start the frame behind it.
        if (pendingFrame !== drawing) return;
        pendingFrame = undefined;
        const queued = queuedFrame;
        queuedFrame = undefined;
        if (queued) decode(queued);
      });
    pendingFrame = drawing;
  };

  /**
   * The copy that waits for the host's answer. Its clipboard write started in the key press, the one
   * moment every browser lets a page write, and it holds until the answer settles it.
   */
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
      setState(() => ({ live: false, message: sourceText(event.reason) }));
      return;
    }
    if (!state.live) setState(() => ({ live: true, message: "" }));
    // One frame decodes at a time, and the newest of the rest waits behind it.
    if (pendingFrame) {
      queuedFrame = event;
      return;
    }
    decode(event);
  });
  onCleanup(stopListening);

  createEffect(
    () => ({ tabId: props.tabId, active: props.active }),
    ({ tabId, active }) => {
      if (!active) return;
      abandonStream();
      setState(() => ({ live: false, message: null }));
      void runtime
        .startLiveView(tabId)
        .catch((error: unknown) =>
          setState(() => ({ live: false, message: errorMessage(error, t("browser.liveView.failed")) })),
        );
      onCleanup(() => void runtime.stopLiveView().catch(() => undefined));
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

  // A view nobody clicks still has to say which frame is on screen. The host otherwise keeps
  // every frame it sent for the whole session.
  createEffect(
    () => frame(),
    (drawn) => {
      if (!drawn) return;
      send({ type: "ack", sequence: drawn.sequence });
    },
  );

  /**
   * Where on the frame the pointer is, which is not where on the canvas it is. The canvas fills the
   * panel and draws the frame with `object-fit: contain`, so a frame of a different shape sits
   * letterboxed inside it - a wide page in a narrow panel is a band with most of the panel above and
   * below it. A fraction of the canvas box would put every click that many bars away from the point
   * the user aimed at.
   *
   * Null means there is no point to send. The bars are not the page, and a point on one clamped to
   * the edge of the frame would work the first or last row of a page the user never pointed at.
   * Nothing drawn yet is the same answer: there is no frame to be a fraction of.
   */
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

  /**
   * Ask the host for its selection, and write it to the user's clipboard when it comes. The host's
   * clipboard is not the user's, so the text has to come back here. A copy already waiting is the
   * same copy: the Edit menu fires one after the key press that started it.
   */
  const copy = (cut: boolean) => {
    if (pendingCopy) return;
    let failure: "empty" | "tooLarge" | undefined;
    const answer = new Promise<CopyAnswer>((resolve) => {
      pendingCopy = resolve;
    });
    const text = answer.then((reply) => {
      if (reply === "tooLarge" || !reply?.text) {
        failure = reply === "tooLarge" ? "tooLarge" : "empty";
        throw new Error("The host sent no text to copy.");
      }
      return new Blob([reply.text], { type: "text/plain" });
    });
    send({ type: "copy", cut });
    // Nothing selected leaves the clipboard as it was, as a copy of nothing does.
    void writeClipboard(text).catch(() => {
      if (failure === "tooLarge") toast.error(t("browser.liveView.copyTooLarge"));
      else if (failure !== "empty") toast.error(t("browser.liveView.copyFailed"));
    });
  };

  const key = (event: KeyboardEvent, action: "down" | "up") => {
    const letter = clipboardLetter(event);
    // A paste stays with this window, which fires its own paste event with the user's clipboard. The
    // key still goes to the page, as every other key does: a terminal reads Ctrl+C as an interrupt.
    if (letter !== "v" || !props.clipboard) event.preventDefault();
    send({ type: "key", action, key: event.key, code: event.code, modifiers: modifiers(event) });
    if (action === "down" && letter) {
      if (!props.clipboard) toast.error(t("browser.liveView.clipboardUnsupported"));
      else if (letter !== "v") copy(letter === "x");
    }
    // A printable key is two events on the wire: the key itself, and the character it produces.
    if (action === "down" && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      send({ type: "key", action: "char", key: event.key, code: event.code, text: event.key });
    }
  };

  const paste = (event: ClipboardEvent) => {
    event.preventDefault();
    if (!props.clipboard) {
      toast.error(t("browser.liveView.clipboardUnsupported"));
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

  // Copy or Cut from the Edit menu. The event is not cancelled: a cancelled copy with no data would
  // empty the clipboard before the host's answer arrives.
  const menuCopy = (cut: boolean) => {
    if (props.clipboard) copy(cut);
    else toast.error(t("browser.liveView.clipboardUnsupported"));
  };

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
          send({
            type: "pointer",
            action: "wheel",
            ...at,
            button: "left",
            // CDP reads a wheel delta the way the DOM event carries it: down is positive.
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            modifiers: modifiers(event),
          });
        }}
        onKeyDown={(event) => key(event, "down")}
        onKeyUp={(event) => key(event, "up")}
        onPaste={paste}
        onCopy={() => menuCopy(false)}
        onCut={() => menuCopy(true)}
      />
      <Show when={!state.live}>
        <div class="browser-empty-state">
          <span>{state.message ?? t("browser.liveView.connecting")}</span>
        </div>
      </Show>
    </div>
  );
}

/** The host's answer to a copy: its text, a selection too long to send, or no answer at all. */
type CopyAnswer = { text: string } | "tooLarge" | null;

/**
 * Ctrl or Cmd with C, V or X. On a layout whose letters are not Latin, such as Russian, the key is
 * the letter of that layout, so the place of the key decides.
 */
function clipboardLetter(event: KeyboardEvent): "c" | "v" | "x" | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  const letter = /^[a-z]$/iu.test(event.key)
    ? event.key.toLowerCase()
    : /^Key[A-Z]$/u.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : "";
  return letter === "c" || letter === "v" || letter === "x" ? letter : undefined;
}

/**
 * Write text that is still on its way. A `ClipboardItem` made in the key press keeps that press's
 * permission while the host answers; Safari allows no later write. Without one, the text is written
 * when it arrives.
 */
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
