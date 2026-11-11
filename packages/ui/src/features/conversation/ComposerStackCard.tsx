import type { JSX } from "@solidjs/web";
import { type Accessor, createEffect, createMemo, createSignal, Show } from "solid-js";

/** Longer than the close transition in `composer-stack.css`, for a window that does not send its end. */
const CLOSE_FALLBACK_MS = 400;

/**
 * One card of the stack above the message input. It grows out from behind the input when `when`
 * becomes truthy, and goes back down when it becomes falsy. The children stay in the page, with the
 * last value, until the card is closed.
 */
export function ComposerStackCard<T>(props: {
  when: T | false | null | undefined;
  children: (value: Accessor<NonNullable<T>>) => JSX.Element;
}) {
  const open = () => Boolean(props.when);
  const last = createMemo<T | false | null | undefined>((previous) => props.when || previous);
  const [closed, setClosed] = createSignal(true);
  createEffect(open, (isOpen) => {
    if (isOpen) {
      setClosed(false);
      return;
    }
    const timer = window.setTimeout(() => setClosed(true), CLOSE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  });
  return (
    <Show when={open() || !closed() ? last() : undefined}>
      {(value) => (
        <div
          class="composer-stack-card"
          data-open={open() ? "true" : "false"}
          aria-hidden={open() ? undefined : "true"}
          inert={open() ? undefined : true}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === "grid-template-rows" && !open()) {
              setClosed(true);
            }
          }}
        >
          <div class="composer-stack-card-inner">{props.children(value)}</div>
        </div>
      )}
    </Show>
  );
}
