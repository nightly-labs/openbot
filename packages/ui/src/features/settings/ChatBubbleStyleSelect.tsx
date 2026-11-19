import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { useText } from "../../text";
import { CHAT_BUBBLE_STYLE_LABEL, CHAT_BUBBLE_STYLES, type ChatBubbleStyle } from "../conversation/own-bubble";

const options = [...CHAT_BUBBLE_STYLES];

export interface ChatBubbleStyleSelectProps {
  value: ChatBubbleStyle;
  onChange: (value: ChatBubbleStyle) => void;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/** The "Your bubbles" row control in Settings › Appearance, on the desktop and in the web client. */
export function ChatBubbleStyleSelect(props: ChatBubbleStyleSelectProps): JSX.Element {
  const { t } = useText();
  return (
    <Select<ChatBubbleStyle>
      class="settings-modal-select"
      options={options}
      value={props.value}
      onChange={(style) => style && props.onChange(style)}
      placement="bottom-end"
      itemComponent={(itemProps) => (
        <SelectItem item={itemProps.item}>{t(CHAT_BUBBLE_STYLE_LABEL[itemProps.item.rawValue])}</SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={t("settings.bubbleStyle.title")}>
        <SelectValue<ChatBubbleStyle>>{(state) => t(CHAT_BUBBLE_STYLE_LABEL[state.selectedOption()])}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
