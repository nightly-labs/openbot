import { Button, ChevronDown, MessageCirclePlus, Popover } from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useText } from "../../text";
import { ThreadStatusText, ThreadTabIcon } from "../conversation/threads/ThreadStatusMark";
import { ThreadTitle } from "../conversation/threads/ThreadTitle";
import type { ThreadItem } from "../conversation/threads/thread-types";
import { sidebarMessageTime } from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarAgentThreads as SidebarAgentThreadsModel } from "./sidebar-types";

const CARD_OPEN_DELAY = 700;
const CARD_CLOSE_DELAY = 220;
const EARLIER_LIMIT = 3;

function needsLook(thread: ThreadItem): boolean {
  return thread.status.kind !== "idle" || (thread.unread ?? 0) > 0;
}

function shownThreads(threads: readonly ThreadItem[], openId: string | undefined, limit: number): ThreadItem[] {
  const latest = threads.slice(0, limit);
  const open = threads.find((thread) => thread.id === openId);
  if (!open || latest.includes(open)) return latest;
  return [...latest.slice(0, limit - 1), open];
}

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

export function SidebarAgentThreads(threadProps: {
  model: SidebarAgentThreadsModel;
  agentId: string;
  agentName: string;
  row: HTMLElement | undefined;
  menuOpen: boolean;
  onCardChange?: ((open: boolean) => void) | undefined;
}) {
  const { t } = useText();
  const { agentThreadsOpen, toggleAgentThreads } = useSidebarScope();
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

  createEffect(expanded, (open) => {
    if (open) threadProps.model.load(threadProps.agentId);
  });
  createEffect(card, (open) => {
    threadProps.onCardChange?.(open);
  });
  createEffect(
    () => threads().length === 0,
    (empty) => {
      if (empty) close();
    },
  );
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
      const load = () => threadProps.model.load(threadProps.agentId);
      row.addEventListener("pointerenter", arm);
      row.addEventListener("pointerleave", leave);
      row.addEventListener("focus", load);
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
