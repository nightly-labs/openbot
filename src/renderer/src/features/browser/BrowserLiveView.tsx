import type { BrowserLiveViewInput } from "@openbot/contracts/ipc";
import { createEffect, createSignal, createStore, onCleanup, Show } from "solid-js";

/** CDP's modifier bitmap, which is what the host dispatches the event with. */
const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;

interface BrowserLiveViewProps {
  tabId: string;
  /** False while the panel is closed: a view nobody is looking at still costs the host a screencast. */
  active: boolean;
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
  const [state, setState] = createStore<{ live: boolean; message: string }>({
    live: false,
    message: "Connecting to the page on the host…",
  });
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
  /**
   * The size of the frame the canvas is showing, which is not the size of the last frame to arrive.
   * Decoding is asynchronous and a frame that arrives mid-decode is dropped, so while the host
   * resizes its viewport the newest frame's shape and the drawn pixels disagree. `object-fit`
   * letterboxes what is drawn, so a pointer placed with the newer shape would miss by the
   * difference between the two bands. It stays unset until the first frame is drawn, which is what
   * holds input back while there is nothing on the canvas to aim at.
   */
  const [frameSize, setFrameSize] = createSignal<{ width: number; height: number }>();
  let pendingFrame: Promise<void> | undefined;

  const draw = async (frame: { width: number; height: number; image: Uint8Array }) => {
    const element = canvas();
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(frame.image)], { type: "image/jpeg" }));
    if (element.width !== frame.width || element.height !== frame.height) {
      element.width = frame.width;
      element.height = frame.height;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    setFrameSize({ width: frame.width, height: frame.height });
  };

  const stopListening = window.openbot.browser.onLiveViewEvent((event) => {
    if (event.tabId !== props.tabId) return;
    if (event.type === "stopped") {
      setFrameSize(undefined);
      setState(() => ({ live: false, message: event.reason }));
      return;
    }
    if (!state.live) setState(() => ({ live: true, message: "" }));
    // One frame decodes at a time. The next frame is the page as it is now, so a frame that arrives
    // while one is decoding is dropped rather than queued behind it.
    if (pendingFrame) return;
    pendingFrame = draw(event)
      .catch(() => undefined)
      .finally(() => {
        pendingFrame = undefined;
      });
  });
  onCleanup(stopListening);

  createEffect(
    () => ({ tabId: props.tabId, active: props.active }),
    ({ tabId, active }) => {
      if (!active) return;
      setFrameSize(undefined);
      setState(() => ({ live: false, message: "Connecting to the page on the host…" }));
      void window.openbot.browser
        .startLiveView(tabId)
        .catch((error: unknown) => setState(() => ({ live: false, message: errorMessage(error) })));
      onCleanup(() => void window.openbot.browser.stopLiveView().catch(() => undefined));
    },
  );

  const send = (input: BrowserLiveViewInput) => {
    void window.openbot.browser.sendLiveViewInput(input).catch(() => undefined);
  };

  /**
   * Where on the frame the pointer is, which is not where on the canvas it is. The canvas fills the
   * panel and draws the frame with `object-fit: contain`, so a frame of a different shape sits
   * letterboxed inside it - a wide page in a narrow panel is a band with most of the panel above and
   * below it. A fraction of the canvas box would put every click that many bars away from the point
   * the user aimed at.
   */
  const point = (event: MouseEvent): { x: number; y: number } | null => {
    const bounds = canvas()?.getBoundingClientRect();
    const size = frameSize();
    if (!bounds || !size || bounds.width === 0 || bounds.height === 0) return null;
    if (size.width === 0 || size.height === 0) return null;
    const scale = Math.min(bounds.width / size.width, bounds.height / size.height);
    const width = size.width * scale;
    const height = size.height * scale;
    return {
      x: clampFraction((event.clientX - bounds.left - (bounds.width - width) / 2) / width),
      y: clampFraction((event.clientY - bounds.top - (bounds.height - height) / 2) / height),
    };
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

  const key = (event: KeyboardEvent, action: "down" | "up") => {
    event.preventDefault();
    send({ type: "key", action, key: event.key, code: event.code, modifiers: modifiers(event) });
    // A printable key is two events on the wire: the key itself, and the character it produces.
    if (action === "down" && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      send({ type: "key", action: "char", key: event.key, code: event.code, text: event.key });
    }
  };

  return (
    <div class="browser-live-view">
      <canvas
        ref={setCanvas}
        tabindex="0"
        role="img"
        aria-label="Live view of the page on the host"
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
      />
      <Show when={!state.live}>
        <div class="browser-empty-state">
          <span>{state.message}</span>
        </div>
      </Show>
    </div>
  );
}

function modifiers(event: MouseEvent | KeyboardEvent): number {
  return (
    (event.altKey ? ALT : 0) + (event.ctrlKey ? CONTROL : 0) + (event.metaKey ? META : 0) + (event.shiftKey ? SHIFT : 0)
  );
}

function clampFraction(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "This page could not be shown live.";
}
