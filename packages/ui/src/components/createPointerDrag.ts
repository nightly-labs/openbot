import { createSignal } from "solid-js";

interface PointerDragOptions {
  axis: "x" | "y";
  /** The class on the root element while the drag runs, for the cursor and transitions. */
  rootClass: string;
  /** Called when a drag starts. Read the start value here. */
  onStart: () => void;
  /** The distance from the start position, in pixels along the axis. */
  onMove: (delta: number) => void;
  /** The last distance. A cancelled drag ends at the last move. */
  onEnd?: (delta: number) => void;
}

/**
 * The pointer lifecycle of a drag handle: pointer capture, window listeners, and the root class.
 * Call `cancel` when the owner unmounts.
 */
export function createPointerDrag(options: PointerDragOptions) {
  let cleanup: (() => void) | undefined;
  const [isDragging, setIsDragging] = createSignal(false);

  const begin = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    const position = (pointer: PointerEvent) => (options.axis === "x" ? pointer.clientX : pointer.clientY);
    const start = position(event);
    let delta = 0;
    options.onStart();
    setIsDragging(true);
    document.documentElement.classList.add(options.rootClass);

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      delta = position(moveEvent) - start;
      options.onMove(delta);
    };
    const finish = (finishEvent?: PointerEvent) => {
      if (finishEvent && finishEvent.pointerId !== event.pointerId) return;
      if (finishEvent) delta = position(finishEvent) - start;
      options.onEnd?.(delta);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      document.documentElement.classList.remove(options.rootClass);
      setIsDragging(false);
      cleanup = undefined;
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    const cancel = () => finish();

    cleanup?.();
    cleanup = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  };

  return { begin, cancel: () => cleanup?.(), isDragging };
}
