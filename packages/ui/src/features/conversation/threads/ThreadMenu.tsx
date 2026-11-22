import { Archive, buttonVariants, ChevronDown, ChevronRight, DropdownMenu, MessageCirclePlus } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { sidebarMessageTime } from "@openbot/ui/features/sidebar/sidebar-filtering";
import { useText } from "@openbot/ui/text";
import { For, onSettled, Show } from "solid-js";
import { ThreadStatusMark, ThreadStatusText, ThreadTabIcon, threadAttention } from "./ThreadStatusMark";
import { ThreadTitle } from "./ThreadTitle";
import type { ThreadHeaderProps, ThreadRowMode, ThreadStem } from "./thread-types";

export function ThreadStemMark(props: { stem: ThreadStem }) {
  return (
    <span class="agent-threads-menu-stem" aria-hidden="true">
      <For each={props.stem.through}>
        {(line) => <span class={["agent-threads-stem-rail", line && "agent-threads-stem-line"]} />}
      </For>
      <span class={["agent-threads-stem-elbow", props.stem.last && "agent-threads-stem-last"]} />
    </span>
  );
}

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
            <Show when={thread.stem}>{(stem) => <ThreadStemMark stem={stem()} />}</Show>
            <ThreadTitle class="agent-threads-menu-title" title={thread.title} />
            <ThreadStatusMark status={thread.status} unread={thread.unread} />
            <span class="agent-threads-menu-time ui-menu-trailing">{sidebarMessageTime(thread.updatedAt, format)}</span>
          </DropdownMenu.Item>
        )}
      </For>
    </div>
  );
}

function ThreadMenuTrigger(props: ThreadHeaderProps & { mode: ThreadRowMode }) {
  const { t } = useText();
  const active = () => props.tabs.find((thread) => thread.id === props.activeId);
  const switcher = () => (props.mode === "compact" ? active() : undefined);
  const unreadInMenu = () =>
    props.threads.some(
      (thread) =>
        (thread.unread ?? 0) > 0 &&
        thread.id !== props.activeId &&
        (props.mode !== "tabs" || !props.tabs.some((tab) => tab.id === thread.id)),
    );
  const allLabel = () => t(unreadInMenu() ? "conversation.threads.allUnread" : "conversation.threads.all");
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
          aria-label={allLabel()}
          title={allLabel()}
        >
          <ChevronDown aria-hidden="true" />
          <Show when={unreadInMenu()}>
            <span class="agent-threads-menu-unread" aria-hidden="true" />
          </Show>
        </DropdownMenu.Trigger>
      }
    >
      {(thread) => (
        <DropdownMenu.Trigger
          class={buttonVariants({ variant: "ghost", size: "sm", class: "agent-threads-switcher no-drag" })}
          data-attention={threadAttention(thread().status)}
          title={thread().title}
          aria-label={t("conversation.threads.current", { title: thread().title })}
          aria-description={unreadInMenu() ? t("conversation.threads.allUnread") : undefined}
        >
          <span class="agent-threads-switcher-icon" aria-hidden="true">
            <ThreadTabIcon status={thread().status} />
          </span>
          <ThreadTitle class="agent-threads-tab-title" title={thread().title} />
          <ThreadStatusText status={thread().status} />
          <ChevronDown class="agent-threads-switcher-chevron" aria-hidden="true" />
          <Show when={unreadInMenu()}>
            <span class="agent-threads-menu-unread" aria-hidden="true" />
          </Show>
        </DropdownMenu.Trigger>
      )}
    </Show>
  );
}

export function ThreadMenu(props: ThreadHeaderProps & { mode: ThreadRowMode }) {
  const { t, format } = useText();
  let archivedMenu: HTMLDivElement | undefined;
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
          <Show when={props.archived.length > 0 || props.olderArchived}>
            <DropdownMenu.Separator />
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <Archive class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("conversation.threads.archived")}</span>
                <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  ref={(element: HTMLDivElement) => {
                    archivedMenu = element;
                  }}
                  class="ui-action-menu agent-context-menu agent-context-submenu agent-threads-archived"
                >
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
                  <Show when={props.olderArchived}>
                    {(older) => (
                      <DropdownMenu.Item
                        class="agent-threads-menu-item"
                        closeOnSelect={false}
                        disabled={older().loading}
                        onSelect={() => {
                          archivedMenu?.focus();
                          props.onShowOlderArchived?.();
                        }}
                      >
                        {t("conversation.threads.archivedOlder")}
                      </DropdownMenu.Item>
                    )}
                  </Show>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
