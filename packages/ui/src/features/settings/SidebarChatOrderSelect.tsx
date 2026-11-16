import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { useText } from "../../text";
import { SIDEBAR_CHAT_ORDER_LABEL, SIDEBAR_CHAT_ORDERS, type SidebarChatOrder } from "../sidebar/sidebar-types";

const options = [...SIDEBAR_CHAT_ORDERS];

export interface SidebarChatOrderSelectProps {
  value: SidebarChatOrder;
  onChange: (value: SidebarChatOrder) => void;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/**
 * The "Sort chats" row control in Settings. It sets the same order as "Sort chats" in the sidebar
 * menu, and "Manual" turns off the "Unread" group.
 */
export function SidebarChatOrderSelect(props: SidebarChatOrderSelectProps): JSX.Element {
  const { t } = useText();
  return (
    <Select<SidebarChatOrder>
      class="settings-modal-select"
      options={options}
      value={props.value}
      onChange={(order) => order && props.onChange(order)}
      placement="bottom-end"
      itemComponent={(itemProps) => (
        <SelectItem item={itemProps.item}>{t(SIDEBAR_CHAT_ORDER_LABEL[itemProps.item.rawValue])}</SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={t("sidebar.order.title")}>
        <SelectValue<SidebarChatOrder>>{(state) => t(SIDEBAR_CHAT_ORDER_LABEL[state.selectedOption()])}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
