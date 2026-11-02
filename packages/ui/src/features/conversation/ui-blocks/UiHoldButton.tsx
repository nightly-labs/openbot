import { Button, type ButtonProps } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, onCleanup } from "solid-js";

export interface UiHoldButtonProps {
  holdMs: number;
  variant?: ButtonProps["variant"];
  disabled?: boolean | undefined;
  /** The id of the text that says the button has to be held. */
  describedBy?: string | undefined;
  /** The hold ran its full time. */
  onComplete: () => void;
  /**
   * A click that was not a full hold, such as a tap, or the click a screen reader or switch access
   * sends. The owner asks for the action again in a second step.
   */
  onClickWithoutHold: () => void;
  ref?: ((element: HTMLButtonElement) => void) | undefined;
  children?: JSX.Element;
}

/**
 * A button that acts after it is held for `holdMs`. The fill grows from left to right while the
 * pointer, Enter or Space is down; letting go, leaving the button or losing focus starts it over.
 * A click without a full hold calls `onClickWithoutHold`, so a stray tap cannot confirm, and a
 * person who cannot hold still has a path.
 */
export function UiHoldButton(props: UiHoldButtonProps) {
  const [holding, setHolding] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The click that ends a full hold is not a click without a hold.
  let completed = false;

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    setHolding(false);
  }

  function start(): void {
    if (props.disabled || timer !== undefined) return;
    setHolding(true);
    timer = setTimeout(() => {
      timer = undefined;
      completed = true;
      setHolding(false);
      props.onComplete();
    }, props.holdMs);
  }

  onCleanup(cancel);

  return (
    <Button
      type="button"
      variant={props.variant ?? "default"}
      class="ui-block-hold"
      data-holding={holding() ? "" : undefined}
      disabled={props.disabled}
      aria-describedby={props.describedBy}
      ref={(element: HTMLButtonElement) => props.ref?.(element)}
      style={{ "--ui-block-hold-duration": `${props.holdMs}ms` }}
      onPointerDown={(event: PointerEvent) => {
        if (event.button > 0) return;
        completed = false;
        start();
      }}
      onPointerUp={cancel}
      onClick={() => {
        if (completed) {
          completed = false;
          return;
        }
        cancel();
        if (!props.disabled) props.onClickWithoutHold();
      }}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (!event.repeat) {
          completed = false;
          start();
        }
      }}
      onKeyUp={(event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") cancel();
      }}
    >
      <span class="ui-block-hold-fill" aria-hidden="true" />
      <span class="ui-block-hold-label">{props.children}</span>
    </Button>
  );
}
