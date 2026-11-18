/**
 * The side threads of one agent in the sidebar. The chevron in the corner of the agent row shows them
 * under the row: the threads that need a look first, then the latest others, cut short. A longer
 * hover on the row shows all of them in a card beside the sidebar, with a new thread item at the top.
 * The icon of each thread shows its state, as the tabs of the chat header do.
 */

import { Button, ChevronDown, MessageCirclePlus, Popover } from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useText } from "../../text";
import { ThreadStatusText, ThreadTabIcon } from "../conversation/threads/ThreadStatusMark";
import { ThreadTitle } from "../conversation/threads/ThreadTitle";
import type { ThreadItem } from "../conversation/threads/thread-types";
import { sidebarMessageTime } from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarAgentThreads as SidebarAgentThreadsModel } from "./sidebar-types";

/** A pointer that stays this long on an agent row opens its thread card. A pass over the list does not. */
const CARD_OPEN_DELAY = 700;
/** Time to move the pointer from the row into the card before it closes. */
const CARD_CLOSE_DELAY = 220;
/** The threads that need no look and show under the row before "Show more". */
const EARLIER_LIMIT = 3;

/** A thread that needs a look: it runs, waits, failed, or has unread messages. */
function needsLook(thread: ThreadItem): boolean {
  return thread.status.kind !== "idle" || (thread.unread ?? 0) > 0;
}

/** The latest threads, with the open thread in the list even when it is older. */
function shownThreads(threads: readonly ThreadItem[], openId: string | undefined, limit: number): ThreadItem[] {
  const latest = threads.slice(0, limit);
  const open = threads.find((thread) => thread.id === openId);
  if (!open || latest.includes(open)) return latest;
  return [...latest.slice(0, limit - 1), open];
}

/** One thread under the agent row: state icon, title, time. */
function ThreadRow(props: { thread: ThreadItem; current: boolean; index: number; onOpen: () => void }) {
  const { format } = useText();
  return (
    <li class="sidebar-thread-item" style={{ "--sidebar-thread-index": props.index }}>
      <Button
        variant="ghost"
        class="sidebar-thread-row"
        aria-current={props.current ? "page" : undefined}
        onClick={props.onOpen}
      >
        <span class="sidebar-thread-icon" aria-hidden="true">
          <ThreadTabIcon status={props.thread.status} unread={props.thread.unread} />
        </span>
        <ThreadTitle class="sidebar-thread-title" title={props.thread.title} />
        <ThreadStatusText status={props.thread.status} unread={props.thread.unread} />
        <span class="sidebar-thread-time">{sidebarMessageTime(props.thread.updatedAt, format)}</span>
      </Button>
    </li>
  );
}

/** The threads under the agent row. They open and close in place. */
function InlineThreads(props: {
  model: SidebarAgentThreadsModel;
  agentId: string;
  agentName: string;
  threads: readonly ThreadItem[];
  open: boolean;
}) {
  const { t } = useText();
  const [all, setAll] = createSignal(false);
  const active = () => props.threads.filter(needsLook);
  const earlier = () => props.threads.filter((thread) => !needsLook(thread));
  const shownEarlier = () =>
    all() ? earlier() : shownThreads(earlier(), props.model.openId(props.agentId), EARLIER_LIMIT);
  const shown = () => [...active(), ...shownEarlier()];
  return (
    <div class="sidebar-threads" data-open={props.open ? "" : undefined} inert={!props.open}>
      <div class="sidebar-threads-clip">
        <ul class="sidebar-threads-list" aria-label={t("sidebar.threads.label", { name: props.agentName })}>
          <For each={shown()} keyed={(thread) => thread.id}>
            {(thread, index) => (
              <ThreadRow
                thread={thread()}
                current={props.model.openId(props.agentId) === thread().id}
                index={index()}
                onOpen={() => props.model.onOpen(props.agentId, thread().id)}
              />
            )}
          </For>
          <Show when={earlier().length > EARLIER_LIMIT}>
            <li class="sidebar-thread-item" style={{ "--sidebar-thread-index": shown().length }}>
              <Button
                variant="ghost"
                class="sidebar-thread-row sidebar-thread-more"
                aria-expanded={all() ? "true" : "false"}
                onClick={() => setAll(!all())}
              >
                <span class="sidebar-thread-icon" aria-hidden="true">
                  <ChevronDown class="sidebar-thread-more-icon" />
                </span>
                <span class="sidebar-thread-title">
                  {all()
                    ? t("sidebar.threads.less")
                    : t("sidebar.threads.more", { count: earlier().length - shownEarlier().length })}
                </span>
              </Button>
            </li>
          </Show>
        </ul>
      </div>
    </div>
  );
}

/** The card beside the sidebar: a new thread, then every thread of the agent. */
function ThreadCard(props: {
  model: SidebarAgentThreadsModel;
  agentId: string;
  agentName: string;
  threads: readonly ThreadItem[];
  open: boolean;
  anchor: HTMLElement | undefined;
  onKeep: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const { format, t } = useText();
  const pick = (action: () => void) => {
    props.onClose();
    action();
  };
  return (
    <Popover.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      anchorRef={() => props.anchor}
      placement="right-start"
      gutter={14}
      modal={false}
    >
      <Popover.Portal>
        <Popover.Content
          class="ui-action-menu sidebar-threads-card"
          aria-label={t("sidebar.threads.label", { name: props.agentName })}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={props.onKeep}
          onPointerLeave={props.onLeave}
        >
          <Show when={props.model.onNew}>
            {(onNew) => (
              <Button
                variant="ghost"
                class="sidebar-threads-card-row sidebar-threads-card-new"
                onClick={() => pick(() => onNew()(props.agentId))}
              >
                <span class="sidebar-threads-card-icon" aria-hidden="true">
                  <MessageCirclePlus />
                </span>
                <span class="sidebar-threads-card-title">{t("sidebar.agentMenu.newThread")}</span>
              </Button>
            )}
          </Show>
          <ul class="sidebar-threads-card-list">
            <For each={props.threads} keyed={(thread) => thread.id}>
              {(thread) => (
                <li>
                  <Button
                    variant="ghost"
                    class="sidebar-threads-card-row"
                    aria-current={props.model.openId(props.agentId) === thread().id ? "page" : undefined}
                    onClick={() => pick(() => props.model.onOpen(props.agentId, thread().id))}
                  >
                    <span class="sidebar-threads-card-icon" aria-hidden="true">
                      <ThreadTabIcon status={thread().status} unread={thread().unread} />
                    </span>
                    <ThreadTitle class="sidebar-threads-card-title" title={thread().title} />
                    <ThreadStatusText status={thread().status} unread={thread().unread} />
                    <span class="sidebar-threads-card-time">{sidebarMessageTime(thread().updatedAt, format)}</span>
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The thread part of an agent's sidebar item: the chevron, the threads under the row, and the card.
 * `row` is the agent row button. It shows nothing for an agent without side threads.
 */
export function SidebarAgentThreads(threadProps: {
  model: SidebarAgentThreadsModel;
  agentId: string;
  agentName: string;
  row: HTMLElement | undefined;
  /** The row's context menu is open. The card does not open over it. */
  menuOpen: boolean;
  /** Tells the row that the card opens or closes, so that the row's own tooltip does not show under it. */
  onCardChange?: ((open: boolean) => void) | undefined;
}) {
  const { t } = useText();
  const { agentThreadsOpen, toggleAgentThreads } = useSidebarScope();
  // The list is read once for each change, not again by each part that shows it.
  const threads = createMemo(() => threadProps.model.threads(threadProps.agentId));
  const expanded = () => agentThreadsOpen(threadProps.agentId);
  const [card, setCard] = createSignal(false);
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
  };
  const close = () => {
    clear();
    setCard(false);
  };
  // The list under the row already shows the threads, so the card does not open over it.
  const arm = () => {
    clear();
    threadProps.model.load(threadProps.agentId);
    if (expanded()) return;
    openTimer = setTimeout(() => {
      if (!expanded() && !threadProps.menuOpen && threads().length > 0) setCard(true);
    }, CARD_OPEN_DELAY);
  };
  const leave = () => {
    clear();
    closeTimer = setTimeout(() => setCard(false), CARD_CLOSE_DELAY);
  };

  // An open list reads its threads when they are not read yet.
  createEffect(expanded, (open) => {
    if (open) threadProps.model.load(threadProps.agentId);
  });
  createEffect(card, (open) => {
    threadProps.onCardChange?.(open);
  });
  // The card goes with the last thread, and it does not open again by itself when a thread comes back.
  createEffect(
    () => threads().length === 0,
    (empty) => {
      if (empty) close();
    },
  );
  // The row stops hiding its tooltip when this part goes, such as in a compact sidebar.
  onCleanup(() => {
    clear();
    threadProps.onCardChange?.(false);
  });
  createEffect(
    () => threadProps.menuOpen,
    (menuOpen) => {
      if (menuOpen) close();
    },
  );
  createEffect(
    () => threadProps.row,
    (row) => {
      if (!row) return;
      // A keyboard user gets the chevron too: focus reads the threads, as a hover does.
      const load = () => threadProps.model.load(threadProps.agentId);
      row.addEventListener("pointerenter", arm);
      row.addEventListener("pointerleave", leave);
      row.addEventListener("focus", load);
      // A click on the row opens the agent's chat; the card is not needed then.
      row.addEventListener("pointerdown", close);
      return () => {
        clear();
        row.removeEventListener("pointerenter", arm);
        row.removeEventListener("pointerleave", leave);
        row.removeEventListener("focus", load);
        row.removeEventListener("pointerdown", close);
      };
    },
  );

  return (
    <Show when={threads().length > 0}>
      <Button
        variant="ghost"
        class="sidebar-threads-toggle"
        data-open={expanded() ? "" : undefined}
        aria-expanded={expanded() ? "true" : "false"}
        aria-label={t("sidebar.threads.label", { name: threadProps.agentName })}
        title={expanded() ? t("sidebar.threads.hide") : t("sidebar.threads.show")}
        onClick={() => {
          close();
          toggleAgentThreads(threadProps.agentId);
        }}
      >
        <ChevronDown class="sidebar-threads-toggle-icon" aria-hidden="true" />
      </Button>
      <InlineThreads
        model={threadProps.model}
        agentId={threadProps.agentId}
        agentName={threadProps.agentName}
        threads={threads()}
        open={expanded()}
      />
      <ThreadCard
        model={threadProps.model}
        agentId={threadProps.agentId}
        agentName={threadProps.agentName}
        threads={threads()}
        open={card()}
        anchor={threadProps.row}
        onKeep={clear}
        onLeave={leave}
        onClose={close}
      />
    </Show>
  );
}
