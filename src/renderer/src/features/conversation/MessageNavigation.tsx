import { Show } from "solid-js";
import { Button, X } from "../../components/ui";

export function preferredMessageScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function scrollToLatestMessage(scrollElement: HTMLElement): void {
  scrollElement.scrollTo({
    top: scrollElement.scrollHeight,
    behavior: preferredMessageScrollBehavior(),
  });
}

export function newMessagesLabel(count: number): string {
  return `${count} new ${count === 1 ? "message" : "messages"}`;
}

/**
 * The way back to the newest message, and how much of it the reader has not seen.
 *
 * With a count the round arrow becomes a labelled pill, and the dismiss button drops the count
 * without moving the view. The two buttons are siblings inside the pill, not one inside the other:
 * a button in a button is invalid, and a dismiss click would also read as a jump.
 *
 * `aria-live="off"` is deliberate. The channel transcript is a polite live region and the direct
 * transcript is a log, so every step of the count would be read out from inside them, over the
 * unread banner that already announces the same news. The count still reaches a screen reader
 * through the name of the jump button.
 */
export function ScrollToLatestButton(props: { onClick: () => void; newMessageCount?: number; onDismiss?: () => void }) {
  const count = () => props.newMessageCount ?? 0;
  const showCount = () => count() > 0 && Boolean(props.onDismiss);
  return (
    <div class="scroll-to-latest" data-new-messages={showCount() ? "true" : undefined} aria-live="off">
      <Button
        variant="ghost"
        type="button"
        class="scroll-to-latest-button"
        aria-label={showCount() ? `Jump to ${newMessagesLabel(count())}` : "Scroll to latest message"}
        onClick={props.onClick}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 4v14m-6-6 6 6 6-6" />
        </svg>
        <Show when={showCount()}>
          <span class="scroll-to-latest-count">{newMessagesLabel(count())}</span>
        </Show>
      </Button>
      <Show when={showCount()}>
        <Button
          variant="ghost"
          type="button"
          class="scroll-to-latest-dismiss"
          aria-label="Dismiss new message count"
          onClick={() => props.onDismiss?.()}
        >
          <X aria-hidden="true" />
        </Button>
      </Show>
    </div>
  );
}
