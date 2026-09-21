import type { BrowserDesktopApi, BrowserLiveViewInput } from "@openbot/contracts/ipc";
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

interface BrowserLiveViewProps {
  runtime?: BrowserViewRuntime;
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
  const runtime = props.runtime ?? window.openbot.browser;
  const [state, setState] = createStore<{ live: boolean; message: string }>({
    live: false,
    message: "Connecting to the page on the host…",
  });
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
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
  };

  const stopListening = runtime.onLiveViewEvent((event) => {
    if (event.tabId !== props.tabId) return;
    if (event.type === "stopped") {
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
      setState(() => ({ live: false, message: "Connecting to the page on the host…" }));
      void runtime
        .startLiveView(tabId)
        .catch((error: unknown) => setState(() => ({ live: false, message: errorMessage(error) })));
      onCleanup(() => void runtime.stopLiveView().catch(() => undefined));
    },
  );

  const send = (input: BrowserLiveViewInput) => {
    void runtime.sendLiveViewInput(input).catch(() => undefined);
  };

  const point = (event: MouseEvent): { x: number; y: number } | null => {
    const element = canvas();
    if (!element) return null;
    return mapBrowserViewPoint(
      element.getBoundingClientRect(),
      element.width,
      element.height,
      event.clientX,
      event.clientY,
    );
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

/** Map a screen point to the image area of a contain-sized canvas. */
export function mapBrowserViewPoint(
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  frameWidth: number,
  frameHeight: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (bounds.width <= 0 || bounds.height <= 0 || frameWidth <= 0 || frameHeight <= 0) return null;
  const scale = Math.min(bounds.width / frameWidth, bounds.height / frameHeight);
  const imageWidth = frameWidth * scale;
  const imageHeight = frameHeight * scale;
  const imageLeft = bounds.left + (bounds.width - imageWidth) / 2;
  const imageTop = bounds.top + (bounds.height - imageHeight) / 2;
  if (clientX < imageLeft || clientX > imageLeft + imageWidth || clientY < imageTop || clientY > imageTop + imageHeight)
    return null;
  return {
    x: clampFraction((clientX - imageLeft) / imageWidth),
    y: clampFraction((clientY - imageTop) / imageHeight),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "This page could not be shown live.";
}
