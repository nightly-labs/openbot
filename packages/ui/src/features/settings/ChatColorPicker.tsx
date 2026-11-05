/**
 * The chat color picker: the color picker primitive with the 17 agent colors as presets, in the
 * order of the agent color grid, so a bubble can match an avatar.
 */

import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createMemo } from "solid-js";
import { AVATAR_COLOR_CHOICES } from "../../bloub-avatar";
import { ColorPicker } from "../../color-picker";
import { useText } from "../../text";
import { avatarColorChoiceLabel } from "../agents/avatar-hue-label";

interface ChatColorPreset {
  value: AvatarColor;
  label: AppTextKey;
}

const CHAT_COLOR_PRESETS: readonly ChatColorPreset[] = AVATAR_COLOR_CHOICES.flatMap((choice) => {
  const value = choice.swatch.toLowerCase();
  return isAvatarColor(value) ? [{ value, label: avatarColorChoiceLabel(choice) }] : [];
});

/** The name of a chat color: "None", the name of a preset, or the hex in capitals. */
export function useChatColorName(): (value: AvatarColor | null) => string {
  const { t } = useText();
  return (value) => {
    if (value === null) return t("settings.chatColor.none");
    const preset = CHAT_COLOR_PRESETS.find((choice) => choice.value === value);
    return preset ? t(preset.label) : value.toUpperCase();
  };
}

export interface ChatColorPickerProps {
  /** Names the panel, for example "Your chat color". */
  label: string;
  /** The current color, or null for no color. */
  value: AvatarColor | null;
  /** Live: each drag frame, key, preset and field commit. */
  onChange: (value: AvatarColor | null) => void;
}

export function ChatColorPicker(props: ChatColorPickerProps) {
  const { t } = useText();
  const presets = createMemo(() =>
    CHAT_COLOR_PRESETS.map((preset) => ({ value: preset.value, label: t(preset.label) })),
  );
  return <ColorPicker label={props.label} presets={presets()} value={props.value} onChange={props.onChange} />;
}
