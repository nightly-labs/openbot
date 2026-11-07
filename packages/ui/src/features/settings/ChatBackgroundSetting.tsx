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
import { ChatColorDot, type ColorPopupPicker, createChatColorPopup } from "./ChatColorSetting";

export type ChatBackgroundScheme = "light" | "dark";

type ChatBackgroundPreset = { value: AvatarColor; label: AppTextKey };

/**
 * Calm tints of the chat color preset hues, in the same order, that the text of each scheme reads
 * well on: OKLCH lightness 0.965 and chroma 0.018 in Light, lightness 0.25 and chroma 0.035 in Dark.
 */
const CHAT_BACKGROUND_PRESETS: Record<ChatBackgroundScheme, readonly ChatBackgroundPreset[]> = {
  light: [
    { value: "#ffefed", label: "agent.color.red" },
    { value: "#fef0e9", label: "agent.color.orange" },
    { value: "#faf2e6", label: "agent.color.yellow" },
    { value: "#ebf7ed", label: "agent.color.green" },
    { value: "#e7f8f5", label: "agent.color.cyan" },
    { value: "#e7f6fd", label: "agent.color.sky" },
    { value: "#ecf4ff", label: "agent.color.blue" },
    { value: "#f1f2ff", label: "agent.color.indigo" },
    { value: "#f6f1fe", label: "agent.color.violet" },
    { value: "#fceff8", label: "agent.color.magenta" },
    { value: "#ffeff3", label: "agent.color.pink" },
  ],
  dark: [
    { value: "#311b19", label: "agent.color.red" },
    { value: "#2f1d12", label: "agent.color.orange" },
    { value: "#2a200d", label: "agent.color.yellow" },
    { value: "#152619", label: "agent.color.green" },
    { value: "#0a2724", label: "agent.color.cyan" },
    { value: "#0c252e", label: "agent.color.sky" },
    { value: "#162232", label: "agent.color.blue" },
    { value: "#1e2032", label: "agent.color.indigo" },
    { value: "#251d2f", label: "agent.color.violet" },
    { value: "#2c1b28", label: "agent.color.magenta" },
    { value: "#2f1a21", label: "agent.color.pink" },
  ],
};

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

/** One scheme's trigger. The scheme is fixed, so a draft saves to the scheme it was opened for. */
function ChatBackgroundTrigger(props: {
  scheme: ChatBackgroundScheme;
  value: AvatarColor | null;
  onChange: (scheme: ChatBackgroundScheme, value: AvatarColor | null) => void;
}) {
  const { t } = useText();
  const scheme = props.scheme;
  const presets = createMemo(() =>
    CHAT_BACKGROUND_PRESETS[scheme].map((preset) => ({ value: preset.value, label: t(preset.label) })),
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
