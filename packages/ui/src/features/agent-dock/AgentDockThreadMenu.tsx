import { buttonVariants, Check, ChevronDown, DropdownMenu, MessageCirclePlus, MessageSquare } from "@openbot/ui";
import { sidebarMessageTime } from "@openbot/ui/features/sidebar/sidebar-filtering";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { ThreadStatusMark } from "../conversation/threads/ThreadStatusMark";
import { ThreadTitle } from "../conversation/threads/ThreadTitle";
import { DRAFT_THREAD_ID, MAIN_THREAD_ID, type ThreadItem } from "../conversation/threads/thread-types";

export interface AgentDockThreadChoices {
  activeId: string;
  threads: readonly ThreadItem[];
}

export function AgentDockThreadMenu(props: {
  choices: AgentDockThreadChoices;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { t, format } = useText();
  const activeId = () => props.choices.activeId;
  const label = () => {
    if (activeId() === DRAFT_THREAD_ID) return t("conversation.threads.new");
    return props.choices.threads.find((thread) => thread.id === activeId())?.title ?? t("agent.dock.mainChat");
  };
  const unreadElsewhere = () =>
    props.choices.threads.some((thread) => thread.id !== activeId() && (thread.unread ?? 0) > 0);
  const current = (id: string) => (id === activeId() ? "true" : undefined);
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "sm", class: "agent-dock-thread-switcher" })}
        title={label()}
        aria-description={t("agent.dock.changeChat")}
      >
        <span class="agent-dock-thread-switcher-label" dir="auto">
          {label()}
        </span>
        <ChevronDown aria-hidden="true" />
        <Show when={unreadElsewhere()}>
          <span class="agent-threads-menu-unread" aria-hidden="true" />
        </Show>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-threads-menu agent-dock-thread-menu">
          <DropdownMenu.Item
            aria-current={current(MAIN_THREAD_ID)}
            onSelectAfterClose={() => props.onOpen(MAIN_THREAD_ID)}
          >
            <MessageSquare aria-hidden="true" />
            <span>{t("agent.dock.mainChat")}</span>
            <Show when={activeId() === MAIN_THREAD_ID}>
              <Check class="ui-menu-trailing" aria-hidden="true" />
            </Show>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelectAfterClose={() => props.onNew()}>
            <MessageCirclePlus aria-hidden="true" />
            {t("conversation.threads.new")}
          </DropdownMenu.Item>
          <Show when={props.choices.threads.length > 0}>
            <DropdownMenu.Separator />
            <div class="agent-threads-menu-list">
              <For each={props.choices.threads}>
                {(thread) => (
                  <DropdownMenu.Item
                    class="agent-threads-menu-item"
                    aria-current={current(thread.id)}
                    onSelectAfterClose={() => props.onOpen(thread.id)}
                  >
                    <ThreadTitle class="agent-threads-menu-title" title={thread.title} />
                    <ThreadStatusMark status={thread.status} unread={thread.unread} />
                    <span class="agent-threads-menu-time ui-menu-trailing">
                      {sidebarMessageTime(thread.updatedAt, format)}
                    </span>
                  </DropdownMenu.Item>
                )}
              </For>
            </div>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
