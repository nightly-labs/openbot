import { Button, buttonVariants, Pin, PinOff, Popover } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { ReplyQuote } from "@openbot/ui/features/conversation/ReplyQuote";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, For, Show } from "solid-js";

export interface PinnedMessageItem {
  id: string;
  author: string;
  time: string;
  body: string;
  thread: string | null;
  pinnedBy: string | null;
}

export interface PinnedMessagesProps {
  pins: readonly PinnedMessageItem[];
  agents: AgentProfile[];
  onOpenChange?: ((open: boolean) => void) | undefined;
  onJump: (id: string) => void;
  onUnpin: (id: string) => void;
}

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
    surface?.focus();
    props.onUnpin(id);
  };
  const listId = createUniqueId();
  const meta = (pin: PinnedMessageItem) =>
    [pin.thread, pin.pinnedBy === null ? null : t("chat.pins.pinnedBy", { name: pin.pinnedBy })]
      .filter((part) => part !== null)
      .join(" · ");
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
