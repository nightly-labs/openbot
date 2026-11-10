/** "Sort chats" in the list menu: the order of the chats in the sections. See `SidebarChatOrder`. */

import type { AppTextKey } from "@openbot/i18n";
import { ArrowDownWideNarrow, Check, ChevronRight, ContextMenu } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { useSidebarScope } from "./sidebar-scope";
import { SIDEBAR_CHAT_ORDERS, type SidebarChatOrder } from "./sidebar-types";

const ORDER_LABEL = {
  manual: "sidebar.order.manual",
  "unread-group": "sidebar.order.unreadGroup",
  "unread-first": "sidebar.order.unreadFirst",
} as const satisfies Record<SidebarChatOrder, AppTextKey>;

export function SidebarChatOrderSubmenu() {
  const { props } = useSidebarScope();
  const { t } = useText();
  const current = () => props.chatOrder ?? "manual";
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger>
        <ArrowDownWideNarrow class="agent-context-icon size-4" aria-hidden="true" />
        <span>{t("sidebar.order.title")}</span>
        <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent
          class="ui-action-menu agent-context-menu agent-context-submenu"
          aria-label={t("sidebar.order.title")}
        >
          <ContextMenu.RadioGroup
            value={current()}
            onChange={(value: string) => {
              const order = SIDEBAR_CHAT_ORDERS.find((candidate) => candidate === value);
              if (order) props.onChatOrderChange?.(order);
            }}
          >
            <For each={SIDEBAR_CHAT_ORDERS}>
              {(order) => (
                <ContextMenu.RadioItem value={order} closeOnSelect>
                  <span class="ui-menu-check" data-checked={current() === order ? "" : undefined} aria-hidden="true">
                    <Show when={current() === order}>
                      <Check />
                    </Show>
                  </span>
                  <span>{t(ORDER_LABEL[order])}</span>
                </ContextMenu.RadioItem>
              )}
            </For>
          </ContextMenu.RadioGroup>
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}
