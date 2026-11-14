import { Archive, buttonVariants, ChevronDown, ChevronRight, DropdownMenu, MessageCirclePlus } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { sidebarMessageTime } from "@openbot/ui/features/sidebar/sidebar-filtering";
import { useText } from "@openbot/ui/text";
import { For, onSettled, Show } from "solid-js";
import { ThreadStatusMark, ThreadStatusText, ThreadTabIcon, threadAttention } from "./ThreadStatusMark";
import { ThreadTitle } from "./ThreadTitle";
import type { ThreadHeaderProps, ThreadRowMode } from "./thread-types";

/** The threads in the menu. The list scrolls without a scrollbar, and fades at an edge with more threads. */
function ThreadMenuList(props: ThreadHeaderProps) {
  const { format } = useText();
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  const current = (id: string) => (id === props.activeId ? "true" : undefined);
  return (
    <div class={["agent-threads-menu-list", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
      <For each={props.threads}>
        {(thread) => (
          <DropdownMenu.Item
            class="agent-threads-menu-item"
            aria-current={current(thread.id)}
            onSelectAfterClose={() => props.onOpen(thread.id)}
          >
            <Show when={thread.stem}>
              {(stem) => (
                <span class="agent-threads-menu-stem" aria-hidden="true">
                  <For each={stem().through}>
                    {(line) => <span class={["agent-threads-stem-rail", line && "agent-threads-stem-line"]} />}
                  </For>
                  <span class={["agent-threads-stem-elbow", stem().last && "agent-threads-stem-last"]} />
                </span>
              )}
            </Show>
            <ThreadTitle class="agent-threads-menu-title" title={thread.title} />
            <ThreadStatusMark status={thread.status} unread={thread.unread} />
            <span class="agent-threads-menu-time ui-menu-trailing">{sidebarMessageTime(thread.updatedAt, format)}</span>
          </DropdownMenu.Item>
        )}
      </For>
    </div>
  );
}

/**
 * Whether a thread that only the menu shows has agent messages that the user has not read. The tabs
 * show their own marks; a narrow header shows only the open thread. A routine's thread often has no
 * tab, so without this mark the agent's unread dot in the sidebar leads nowhere in the chat (#9166).
 */
function unreadInMenuOnly(props: ThreadHeaderProps & { mode: ThreadRowMode }): boolean {
  const shown = new Set(props.mode === "tabs" ? props.tabs.map((thread) => thread.id) : [props.activeId]);
  return props.threads.some((thread) => !shown.has(thread.id) && (thread.unread ?? 0) > 0);
}

/** The unread dot on the menu button. The button's description says it for a screen reader. */
function MenuUnreadDot(props: { show: boolean }) {
  return (
    <Show when={props.show}>
      <span class="agent-threads-menu-unread" aria-hidden="true" />
    </Show>
  );
}

/**
 * The menu button: a chevron after the tabs, or in a narrow header the open thread with a chevron. In
 * a header too narrow for a title, only the chevron shows, and the menu marks the open thread. A dot
 * on the button leads to an unread thread that has no tab.
 */
function ThreadMenuTrigger(props: ThreadHeaderProps & { mode: ThreadRowMode }) {
  const { t } = useText();
  const active = () => props.tabs.find((thread) => thread.id === props.activeId);
  const switcher = () => (props.mode === "compact" ? active() : undefined);
  const unread = () => unreadInMenuOnly(props);
  const unreadDescription = () => (unread() ? t("sidebar.state.unreadThreads") : undefined);
  return (
    <Show
      when={switcher()}
      fallback={
        <DropdownMenu.Trigger
          class={buttonVariants({
            variant: "ghost",
            size: "icon-sm",
            class: "agent-threads-icon-button agent-threads-menu-button no-drag",
          })}
          aria-label={t("conversation.threads.all")}
          aria-description={unreadDescription()}
          title={t("conversation.threads.all")}
        >
          <ChevronDown aria-hidden="true" />
          <MenuUnreadDot show={unread()} />
        </DropdownMenu.Trigger>
      }
    >
      {(thread) => (
        <DropdownMenu.Trigger
          class={buttonVariants({ variant: "ghost", size: "sm", class: "agent-threads-switcher no-drag" })}
          data-attention={threadAttention(thread().status)}
          title={thread().title}
          aria-label={t("conversation.threads.current", { title: thread().title })}
          aria-description={unreadDescription()}
        >
          {/* The open thread as its selected tab shows it: the icon slot, the title, then the chevron. */}
          <span class="agent-threads-switcher-icon" aria-hidden="true">
            <ThreadTabIcon status={thread().status} />
          </span>
          <ThreadTitle class="agent-threads-tab-title" title={thread().title} />
          <ThreadStatusText status={thread().status} />
          <ChevronDown class="agent-threads-switcher-chevron" aria-hidden="true" />
          <MenuUnreadDot show={unread()} />
        </DropdownMenu.Trigger>
      )}
    </Show>
  );
}

/** Every side thread of the agent. A thread without a tab opens in a new tab. */
export function ThreadMenu(props: ThreadHeaderProps & { mode: ThreadRowMode }) {
  const { t, format } = useText();
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={4}>
      <ThreadMenuTrigger {...props} />
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-threads-menu">
          <DropdownMenu.Item disabled={!props.canStartNew} onSelectAfterClose={props.onNew}>
            <MessageCirclePlus aria-hidden="true" />
            {t("conversation.threads.new")}
          </DropdownMenu.Item>
          <Show when={props.threads.length > 0}>
            <DropdownMenu.Separator />
            <ThreadMenuList {...props} />
          </Show>
          <Show when={props.archived.length > 0}>
            <DropdownMenu.Separator />
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <Archive class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("conversation.threads.archived")}</span>
                <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent class="ui-action-menu agent-context-menu agent-context-submenu agent-threads-archived">
                  {/* Opening an archived thread restores it. */}
                  <For each={props.archived}>
                    {(thread) => (
                      <DropdownMenu.Item
                        class="agent-threads-menu-item"
                        onSelectAfterClose={() => props.onRestore(thread.id)}
                      >
                        <ThreadTitle class="agent-threads-menu-title" title={thread.title} />
                        <span class="agent-threads-menu-time ui-menu-trailing">
                          {sidebarMessageTime(thread.updatedAt, format)}
                        </span>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
