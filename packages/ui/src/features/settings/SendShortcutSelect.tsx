import type { AppTextKey } from "@openbot/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { useText } from "../../text";
import { SEND_SHORTCUT_MODES, type SendShortcutMode } from "../conversation/send-shortcut";

interface SendShortcutOption {
  readonly id: SendShortcutMode;
  readonly labelKey: AppTextKey;
}

function sendShortcutOption(id: SendShortcutMode, devicePlatform: "darwin" | "win32" | "linux"): SendShortcutOption {
  return {
    id,
    labelKey:
      id === "enter"
        ? "settings.sendShortcut.enter"
        : devicePlatform === "darwin"
          ? "settings.sendShortcut.modEnterMac"
          : "settings.sendShortcut.modEnterWin",
  };
}

export interface SendShortcutSelectProps {
  value: SendShortcutMode;
  onChange: (value: SendShortcutMode) => void;
  /** The device with the keyboard, so the modifier option names ⌘ or Ctrl. */
  devicePlatform: "darwin" | "win32" | "linux";
  disabled?: boolean;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/**
 * The send shortcut row control. It is a plain `Select`, the same shape as the rows beside it,
 * because a settings list that mixes control styles reads as two different screens.
 */
export function SendShortcutSelect(props: SendShortcutSelectProps): JSX.Element {
  const { t } = useText();
  const options = () => SEND_SHORTCUT_MODES.map((id) => sendShortcutOption(id, props.devicePlatform));
  const selected = () => sendShortcutOption(props.value, props.devicePlatform);

  return (
    <Select<SendShortcutOption>
      class="settings-modal-select"
      options={options()}
      optionValue="id"
      optionTextValue={(option) => t(option.labelKey)}
      value={selected()}
      disabled={props.disabled ?? false}
      onChange={(option) => option && props.onChange(option.id)}
      placement="bottom-end"
      itemComponent={(itemProps) => (
        <SelectItem item={itemProps.item}>{t(itemProps.item.rawValue.labelKey)}</SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={t("settings.sendShortcut.title")}>
        <SelectValue<SendShortcutOption>>{(state) => t(state.selectedOption().labelKey)}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
