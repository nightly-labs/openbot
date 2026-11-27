import { CHAT_BACKGROUND_PRESETS, type ChatBackgroundScheme } from "@openbot/brand/chat-colors";
import type { AvatarColor } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createMemo, Show } from "solid-js";
import { ColorPicker, ColorPickerTrigger } from "../../color-picker";
import { useText } from "../../text";
import { CHAT_COLOR_PRESET_LABELS } from "./ChatColorPicker";
import { ChatColorDot, type ColorPopupPicker, createChatColorPopup } from "./ChatColorSetting";

const PICKER_LABEL = {
  light: "settings.chatBackground.light",
  dark: "settings.chatBackground.dark",
} as const satisfies Record<ChatBackgroundScheme, AppTextKey>;

function chatBackgroundPicker(presets: () => { value: AvatarColor; label: string }[]): ColorPopupPicker {
  return (props) => {
    const { t } = useText();
    return (
      <ColorPicker
        label={props.label}
        presets={presets()}
        value={props.value}
        onChange={props.onChange}
        clearLabel={t("settings.chatBackground.default")}
      />
    );
  };
}

function ChatBackgroundTrigger(props: {
  scheme: ChatBackgroundScheme;
  value: AvatarColor | null;
  onChange: (scheme: ChatBackgroundScheme, value: AvatarColor | null) => void;
}) {
  const { t } = useText();
  const scheme = props.scheme;
  const presets = createMemo(() =>
    CHAT_BACKGROUND_PRESETS[scheme].map((preset) => ({
      value: preset.value,
      label: t(CHAT_COLOR_PRESET_LABELS[preset.id]),
    })),
  );
  const popup = createChatColorPopup(
    () => props.value,
    (value) => props.onChange(scheme, value),
    chatBackgroundPicker(presets),
  );
  const name = (value: AvatarColor | null) => {
    if (value === null) return t("settings.chatBackground.default");
    const preset = presets().find((choice) => choice.value === value);
    return preset ? preset.label : value.toUpperCase();
  };
  return (
    <div class="settings-modal-select">
      <ColorPickerTrigger label={t(PICKER_LABEL[scheme])} expanded={popup.open()} onClick={popup.toggle}>
        <ChatColorDot ref={popup.dot} color={popup.shown()} open={popup.open()} />
        <span class="ui-select-value">{name(popup.shown())}</span>
      </ColorPickerTrigger>
      {popup.popup(t(PICKER_LABEL[scheme]))}
    </div>
  );
}

export interface ChatBackgroundSettingProps {
  scheme: ChatBackgroundScheme;
  light: AvatarColor | null;
  dark: AvatarColor | null;
  onChange: (scheme: ChatBackgroundScheme, value: AvatarColor | null) => void;
}

export function ChatBackgroundSetting(props: ChatBackgroundSettingProps) {
  const savedColor = (scheme: ChatBackgroundScheme) => (scheme === "light" ? props.light : props.dark);
  return (
    <Show when={props.scheme} keyed>
      {(scheme) => <ChatBackgroundTrigger scheme={scheme} value={savedColor(scheme)} onChange={props.onChange} />}
    </Show>
  );
}
