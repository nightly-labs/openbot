/**
 * The chat color picker: the color picker primitive with 11 chat colors as presets. A bubble mixes
 * a part of its color into the surface, so the presets have one OKLCH lightness (0.68) and the most
 * chroma up to 0.19 that sRGB holds at each hue. Their tints then have the same weight in the light
 * and the dark theme. Yellow is lighter, because a yellow at that lightness is mustard.
 */

import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createMemo } from "solid-js";
import { AVATAR_COLOR_CHOICES } from "../../bloub-avatar";
import { ColorPicker } from "../../color-picker";
import { useText } from "../../text";
import { avatarColorChoiceLabel } from "../agents/avatar-hue-label";

export interface ChatColorPreset {
  value: AvatarColor;
  label: AppTextKey;
}

export const CHAT_COLOR_PRESETS: readonly ChatColorPreset[] = [
  { value: "#f75d59", label: "agent.color.red" },
  { value: "#eb7007", label: "agent.color.orange" },
  { value: "#e5a50a", label: "agent.color.yellow" },
  { value: "#07b655", label: "agent.color.green" },
  { value: "#0eafa2", label: "agent.color.cyan" },
  { value: "#06a8d3", label: "agent.color.sky" },
  { value: "#4699fe", label: "agent.color.blue" },
  { value: "#8688ff", label: "agent.color.indigo" },
  { value: "#b474f4", label: "agent.color.violet" },
  { value: "#dc63c6", label: "agent.color.magenta" },
  { value: "#f05b93", label: "agent.color.pink" },
];

/** Earlier versions offered the agent colors as presets. A saved one keeps its name. */
const NAMED_CHAT_COLORS: readonly ChatColorPreset[] = [
  ...CHAT_COLOR_PRESETS,
  ...AVATAR_COLOR_CHOICES.flatMap((choice) => {
    const value = choice.swatch.toLowerCase();
    return isAvatarColor(value) ? [{ value, label: avatarColorChoiceLabel(choice) }] : [];
  }),
];

/** The name of a chat color: "None", the name of a preset, or the hex in capitals. */
export function useChatColorName(): (value: AvatarColor | null) => string {
  const { t } = useText();
  return (value) => {
    if (value === null) return t("settings.chatColor.none");
    const preset = NAMED_CHAT_COLORS.find((choice) => choice.value === value);
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
