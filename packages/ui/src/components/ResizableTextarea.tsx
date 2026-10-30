import type { JSX } from "@solidjs/web";
import { createSignal, omit, onSettled } from "solid-js";
import { Textarea, type TextareaProps } from "../form";

const KEYBOARD_STEP = 24;

export interface ResizableTextareaProps extends Omit<TextareaProps, "ref" | "style"> {
  /** The accessible name of the drag handle. */
  resizeLabel: string;
}

/**
 * A textarea with a drag grip in its bottom-right corner. The stylesheet sets the start height and
 * the minimum; a drag or the arrow keys change the height, and a double click returns to the start.
 */
export function ResizableTextarea(props: ResizableTextareaProps): JSX.Element {
  const textareaProps = omit(props, "resizeLabel");
  let textarea: HTMLTextAreaElement | undefined;
  let cleanupDrag: (() => void) | undefined;
  const [height, setHeight] = createSignal<number>();
  const [minimum, setMinimum] = createSignal(0);
  const [startHeight, setStartHeight] = createSignal(0);
  const [isResizing, setIsResizing] = createSignal(false);

  // A field taller than the window cannot be read in one view, so the window height is the limit.
  const maximum = () => Math.max(minimum(), window.innerHeight);
  const clamp = (value: number) => Math.round(Math.min(maximum(), Math.max(minimum(), value)));
  const currentHeight = () => height() ?? startHeight();
  const textareaStyle = () => {
    const value = height();
    return value === undefined ? undefined : { height: `${value}px` };
  };

  onSettled(() => {
    if (textarea) {
      setMinimum(Number.parseFloat(getComputedStyle(textarea).minHeight) || 0);
      setStartHeight(textarea.offsetHeight);
    }
    return () => cleanupDrag?.();
  });

  const beginDrag = (event: PointerEvent) => {
    if (event.button !== 0 || !textarea) return;
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    const startY = event.clientY;
    const dragStartHeight = textarea.offsetHeight;
    setIsResizing(true);
    document.documentElement.classList.add("ui-textarea-resizing");

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      setHeight(clamp(dragStartHeight + moveEvent.clientY - startY));
    };
    const finish = (finishEvent?: PointerEvent) => {
      if (finishEvent && finishEvent.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      document.documentElement.classList.remove("ui-textarea-resizing");
      setIsResizing(false);
      cleanupDrag = undefined;
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    const cancel = () => finish();

    cleanupDrag?.();
    cleanupDrag = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Measure now: the field can be hidden when it mounts, and then the start height is 0.
    const current = textarea?.offsetHeight ?? currentHeight();
    let next: number | undefined;
    if (event.key === "ArrowDown") next = current + KEYBOARD_STEP;
    else if (event.key === "ArrowUp") next = current - KEYBOARD_STEP;
    else if (event.key === "Home") next = minimum();
    else if (event.key === "End") next = maximum();
    if (next === undefined) return;
    event.preventDefault();
    setHeight(clamp(next));
  };

  return (
    <div class="ui-textarea-resizable">
      <Textarea {...textareaProps} ref={(element) => (textarea = element)} style={textareaStyle()} />
      <hr
        class="ui-textarea-resizer"
        data-active={isResizing() ? "" : undefined}
        tabindex={0}
        aria-label={props.resizeLabel}
        aria-orientation="horizontal"
        aria-valuemin={minimum()}
        aria-valuemax={maximum()}
        aria-valuenow={currentHeight()}
        onPointerDown={beginDrag}
        onKeyDown={handleKeyDown}
        onDblClick={(event) => {
          event.preventDefault();
          setHeight(undefined);
        }}
      />
    </div>
  );
}
