/**
 * The Chat background setting: one trigger with the color picker in a popup, for the scheme that the
 * window shows. Each scheme keeps its own color; "Default" gives the canvas of the theme again. The
 * popup saves once, when it closes, as the Chat color popup does.
 */

import type { AvatarColor } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createMemo, Show } from "solid-js";
import { ColorPicker, ColorPickerTrigger } from "../../color-picker";
import { useText } from "../../text";
import { CHAT_COLOR_PRESETS } from "./ChatColorPicker";
import { ChatColorDot, type ColorPopupPicker, createChatColorPopup } from "./ChatColorSetting";

export type ChatBackgroundScheme = "light" | "dark";

/**
 * The hues of the chat color presets, in the same order, as calm tints that the text of each scheme reads well on:
 * OKLCH lightness 0.965 and chroma 0.018 in Light, lightness 0.25 and chroma 0.035 in Dark.
 */
const CHAT_BACKGROUND_PRESETS: Record<ChatBackgroundScheme, readonly AvatarColor[]> = {
  light: [
    "#ffefed",
    "#fef0e9",
    "#faf2e6",
    "#ebf7ed",
    "#e7f8f5",
    "#e7f6fd",
    "#ecf4ff",
    "#f1f2ff",
    "#f6f1fe",
    "#fceff8",
    "#ffeff3",
  ],
  dark: [
    "#311b19",
    "#2f1d12",
    "#2a200d",
    "#152619",
    "#0a2724",
    "#0c252e",
    "#162232",
    "#1e2032",
    "#251d2f",
    "#2c1b28",
    "#2f1a21",
  ],
};

const PICKER_LABEL = {
  light: "settings.chatBackground.light",
  dark: "settings.chatBackground.dark",
} as const satisfies Record<ChatBackgroundScheme, AppTextKey>;

function chatBackgroundPresets(scheme: ChatBackgroundScheme, t: (key: AppTextKey) => string) {
  return CHAT_COLOR_PRESETS.flatMap((preset, index) => {
    const value = CHAT_BACKGROUND_PRESETS[scheme][index];
    return value ? [{ value, label: t(preset.label) }] : [];
  });
}

function chatBackgroundPicker(scheme: ChatBackgroundScheme): ColorPopupPicker {
  return (props) => {
    const { t } = useText();
    const presets = createMemo(() => chatBackgroundPresets(scheme, t));
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

/** One scheme's trigger. The scheme is fixed, so a draft saves to the scheme it was opened for. */
function ChatBackgroundTrigger(props: {
  scheme: ChatBackgroundScheme;
  value: AvatarColor | null;
  onChange: (scheme: ChatBackgroundScheme, value: AvatarColor | null) => void;
}) {
  const { t } = useText();
  const scheme = props.scheme;
  const popup = createChatColorPopup(
    () => props.value,
    (value) => props.onChange(scheme, value),
    chatBackgroundPicker(scheme),
  );
  const name = (value: AvatarColor | null) => {
    if (value === null) return t("settings.chatBackground.default");
    const preset = chatBackgroundPresets(scheme, t).find((choice) => choice.value === value);
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
  /** The scheme that the window shows now: the trigger edits its color. */
  scheme: ChatBackgroundScheme;
  /** The saved color of each scheme, or null for the canvas of the theme. */
  light: AvatarColor | null;
  dark: AvatarColor | null;
  onChange: (scheme: ChatBackgroundScheme, value: AvatarColor | null) => void;
}

/**
 * The trigger of the Chat background row in Settings › General. It edits the color of the scheme that
 * the window shows; the other scheme keeps its color and shows it again when the theme changes.
 */
export function ChatBackgroundSetting(props: ChatBackgroundSettingProps) {
  const savedColor = (scheme: ChatBackgroundScheme) => (scheme === "light" ? props.light : props.dark);
  return (
    <Show when={props.scheme} keyed>
      {(scheme) => <ChatBackgroundTrigger scheme={scheme} value={savedColor(scheme)} onChange={props.onChange} />}
    </Show>
  );
}
