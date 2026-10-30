import { buttonVariants, DropdownMenu, Ellipsis, MessageCircle, X } from "@openbot/ui";
import { createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { dayAndTimeLabel, timeLabel } from "./chat-day-markers";
import { createTaskListPlayState, TaskListHeader, TaskMark, type TaskMarkState } from "./TaskList";

/**
 * `waiting`: nothing woke the wait yet. `resuming`: a run woke it and continues the request.
 * `woken`: a run woke it and ended, and the agent did not close it.
 */
export type OpenWaitState = "waiting" | "resuming" | "woken";

export interface OpenWaitItem {
  id: string;
  /** The agent's note: what it waits for and what it does next. */
  note: string;
  /** The message that the wait continues. */
  request: string;
  /** When the agent opened the wait, as an ISO time. */
  openedAt: string;
  state: OpenWaitState;
}

export interface OpenWaitsProps {
  items: readonly OpenWaitItem[];
  /** Shows the message that the wait continues. Without it, the menu has no such item. */
  onShowRequest?: ((waitId: string) => void) | undefined;
  onCancel: (waitId: string) => void;
  /** The list starts collapsed when this is false. */
  defaultOpen?: boolean;
  /** The time that ages count from. The default is the time of the first render. */
  now?: Date;
}

const MARK_STATE: Record<OpenWaitState, TaskMarkState> = {
  waiting: "pending",
  resuming: "active",
  woken: "failed",
};

const STATE_LABEL = {
  waiting: "chat.waits.state.waiting",
  resuming: "chat.waits.state.resuming",
  woken: "chat.waits.state.woken",
} as const;

/**
 * The work that an agent stopped because it waits for something outside its turn: one row for each
 * open wait, above the composer. It has the card of "Waiting for replies", and it renders nothing
 * when no wait is open.
 */
export function OpenWaits(props: OpenWaitsProps) {
  return (
    <Show when={props.items.length > 0}>
      <OpenWaitList {...props} />
    </Show>
  );
}

function OpenWaitList(props: OpenWaitsProps) {
  const { t, format } = useText();
  const panelId = createUniqueId();
  const playState = createTaskListPlayState();
  const [open, setOpen] = createSignal(untrack(() => props.defaultOpen ?? true));
  const now = () => props.now ?? new Date();
  const total = () => props.items.length;
  const woken = () => props.items.filter((item) => item.state === "woken").length;
  const wokenCount = () => (woken() > 0 ? t("chat.waits.woken", { count: woken() }) : "");
  const lead = () => props.items.find((item) => item.state === "resuming") ?? props.items[0];
  const openedAt = (value: string) => {
    const date = new Date(value);
    return date.toDateString() === now().toDateString()
      ? timeLabel(date, { now: now(), format })
      : dayAndTimeLabel(date, { now: now(), t, format });
  };
  return (
    <section
      style={{ "--task-list-play-state": playState() }}
      class="task-list awaiting-replies open-waits"
      data-open={open() ? "" : undefined}
      aria-label={t("chat.waits.label")}
    >
      <div class="awaiting-replies-bar">
        <TaskListHeader
          open={open()}
          onToggle={() => setOpen((value) => !value)}
          panelId={panelId}
          done={0}
          total={total()}
          title={t("chat.waits.title", { count: total() })}
          active={
            lead() && {
              id: lead()?.id ?? "",
              label: t("chat.waits.active", {
                state: t(STATE_LABEL[lead()?.state ?? "waiting"]),
                note: lead()?.note ?? "",
              }),
            }
          }
          summary={wokenCount()}
          count={wokenCount()}
        />
      </div>
      <div id={panelId} class="task-list-panel" inert={open() ? undefined : true}>
        <ol class="task-list-items">
          <For each={props.items} keyed={(item) => item.id}>
            {(item, index) => (
              <li
                class="task-list-item open-waits-row"
                data-state={MARK_STATE[item().state]}
                data-wait-state={item().state}
                style={{ "--task-list-index": index() }}
              >
                <span class="task-list-item-mark" aria-hidden="true">
                  <TaskMark state={MARK_STATE[item().state]} />
                </span>
                <span class="open-waits-row-text">
                  <span class="open-waits-row-note">{item().note}</span>
                  <span class="open-waits-row-meta">
                    <span class="open-waits-row-state">{t(STATE_LABEL[item().state])}</span>
                    <span aria-hidden="true">·</span>
                    <span>{openedAt(item().openedAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span class="open-waits-row-request">{t("chat.waits.request", { text: item().request })}</span>
                  </span>
                </span>
                <DropdownMenu.Root placement="bottom-end" gutter={4}>
                  <DropdownMenu.Trigger
                    class={buttonVariants({ variant: "ghost", size: "icon-xs", class: "open-waits-menu" })}
                    aria-label={t("chat.waits.actions", { note: item().note })}
                  >
                    <Ellipsis aria-hidden="true" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content>
                      <Show when={props.onShowRequest}>
                        {(showRequest) => (
                          <>
                            <DropdownMenu.Item onSelect={() => showRequest()(item().id)}>
                              <MessageCircle aria-hidden="true" />
                              {t("chat.waits.showRequest")}
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator />
                          </>
                        )}
                      </Show>
                      <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => props.onCancel(item().id)}>
                        <X aria-hidden="true" />
                        {t("chat.waits.cancel")}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </li>
            )}
          </For>
        </ol>
      </div>
    </section>
  );
}
