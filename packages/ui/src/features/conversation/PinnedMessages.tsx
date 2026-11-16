import { Button, buttonVariants, Pin, PinOff, Popover } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { ReplyQuote } from "@openbot/ui/features/conversation/ReplyQuote";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, For, Show } from "solid-js";

/** One pinned message as the list shows it. The caller resolves the names and the time. */
export interface PinnedMessageItem {
  /** The key of the pin, unique in the list. `onJump` and `onUnpin` get it. */
  id: string;
  author: string;
  time: string;
  body: string;
  /** The chat of the message when it is not the chat in view, or null. */
  thread: string | null;
  /** Who pinned the message, or null when the reader did. */
  pinnedBy: string | null;
}

export interface PinnedMessagesProps {
  /** The pins of the agent's chats: the chat in view first, then the newest pin first. */
  pins: readonly PinnedMessageItem[];
  /** The agents whose mentions the quotes show by name. */
  agents: AgentProfile[];
  /** The list opened or closed. The caller reads the pins again when it opens. */
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Shows the pinned message in its chat. The list closes first. */
  onJump: (id: string) => void;
  onUnpin: (id: string) => void;
}

/**
 * The pin button of the chat header and its list. Each pin is the start of the message as a quote;
 * one click goes to the message, and Unpin shows on hover or focus. The list scrolls under its title.
 */
export function PinnedMessages(props: PinnedMessagesProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  let surface: HTMLDivElement | undefined;
  const change = (next: boolean) => {
    setOpen(next);
    props.onOpenChange?.(next);
  };
  const jump = (id: string) => {
    change(false);
    props.onJump(id);
  };
  const unpin = (id: string) => {
    // The row goes away with its button. The focus moves to the list first, so the list stays open.
    surface?.focus();
    props.onUnpin(id);
  };
  const listId = createUniqueId();
  /** The line under the quote: the chat of a pin in another chat, and who pinned it when another did. */
  const meta = (pin: PinnedMessageItem) =>
    [pin.thread, pin.pinnedBy === null ? null : t("chat.pins.pinnedBy", { name: pin.pinnedBy })]
      .filter((part) => part !== null)
      .join(" · ");
  /** The id of a pin's line under the quote, which the jump button reads out. Undefined without one. */
  const metaId = (pin: PinnedMessageItem, index: number) => (meta(pin) ? `${listId}-${index}` : undefined);

  return (
    <Popover.Root open={open()} onOpenChange={change} placement="bottom-end" gutter={6}>
      <Popover.Trigger
        class={`${buttonVariants({ variant: "ghost" })} header-panel-toggle no-drag`}
        aria-label={t("chat.pins.title")}
        title={t("chat.pins.title")}
      >
        <Pin aria-hidden="true" class="size-[14px]" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLDivElement) => {
            surface = element;
          }}
          class="ui-popover-menu-surface pinned-messages"
          tabIndex={-1}
        >
          <Popover.Title class="pinned-messages-title">{t("chat.pins.title")}</Popover.Title>
          <Show
            when={props.pins.length > 0}
            fallback={
              <div class="pinned-messages-empty" role="status">
                <span class="pinned-messages-empty-mark" aria-hidden="true">
                  <Pin />
                </span>
                <p class="pinned-messages-empty-title">{t("chat.pins.emptyTitle")}</p>
                <p class="pinned-messages-empty-body">{t("chat.pins.emptyBody")}</p>
              </div>
            }
          >
            <ul class="pinned-messages-list">
              <For each={props.pins} keyed={(pin) => pin.id}>
                {(pin, index) => (
                  <li class="pinned-messages-item">
                    <Button
                      variant="ghost"
                      type="button"
                      class="pinned-messages-jump"
                      aria-label={t("chat.pins.jump", { name: pin().author })}
                      aria-describedby={metaId(pin(), index())}
                      onClick={() => jump(pin().id)}
                    />
                    <div class="pinned-messages-content">
                      <div class="message-reply-context">
                        <div class="pinned-messages-head">
                          <span class="pinned-messages-author">{pin().author}</span>
                          <span class="pinned-messages-time">{pin().time}</span>
                        </div>
                        <ReplyQuote body={pin().body} agents={props.agents} />
                      </div>
                      <Show when={meta(pin())}>
                        {(line) => (
                          <p class="pinned-messages-meta" id={metaId(pin(), index())}>
                            {line()}
                          </p>
                        )}
                      </Show>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      class="pinned-messages-unpin"
                      aria-label={t("chat.menu.unpin")}
                      title={t("chat.menu.unpin")}
                      onClick={() => unpin(pin().id)}
                    >
                      <PinOff aria-hidden="true" />
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
