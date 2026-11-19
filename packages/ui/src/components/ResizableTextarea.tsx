import type { JSX } from "@solidjs/web";
import { createSignal, omit, onSettled } from "solid-js";
import { Textarea, type TextareaProps } from "../form";
import { createPointerDrag } from "./createPointerDrag";

const KEYBOARD_STEP = 24;

export interface ResizableTextareaProps extends Omit<TextareaProps, "ref" | "style"> {
  resizeLabel: string;
}

export function ResizableTextarea(props: ResizableTextareaProps): JSX.Element {
  const textareaProps = omit(props, "resizeLabel");
  let textarea: HTMLTextAreaElement | undefined;
  const [height, setHeight] = createSignal<number>();
  const [minimum, setMinimum] = createSignal(0);
  const [startHeight, setStartHeight] = createSignal(0);

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
    return () => drag.cancel();
  });

  let dragStartHeight = 0;
  const drag = createPointerDrag({
    axis: "y",
    rootClass: "ui-textarea-resizing",
    onStart: () => {
      dragStartHeight = textarea?.offsetHeight ?? currentHeight();
    },
    onMove: (delta) => setHeight(clamp(dragStartHeight + delta)),
  });

  const handleKeyDown = (event: KeyboardEvent) => {
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
        data-active={drag.isDragging() ? "" : undefined}
        tabindex={0}
        aria-label={props.resizeLabel}
        aria-orientation="horizontal"
        aria-valuemin={minimum()}
        aria-valuemax={maximum()}
        aria-valuenow={currentHeight()}
        onPointerDown={drag.begin}
        onKeyDown={handleKeyDown}
        onDblClick={(event) => {
          event.preventDefault();
          setHeight(undefined);
        }}
      />
    </div>
  );
}
