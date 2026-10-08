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
  children?: JSX.Element;
}

/**
 * A button that acts only after it is held for `holdMs`. The fill grows from left to right while the
 * pointer, Enter or Space is down; letting go, leaving the button or losing focus starts it over.
 * A plain click does nothing, so a stray tap cannot confirm.
 */
export function UiHoldButton(props: UiHoldButtonProps) {
  const [holding, setHolding] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

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
      style={{ "--ui-block-hold-duration": `${props.holdMs}ms` }}
      onPointerDown={(event: PointerEvent) => {
        if (event.button > 0) return;
        start();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (!event.repeat) start();
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
