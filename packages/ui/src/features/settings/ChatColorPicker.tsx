import { CHAT_COLOR_PRESETS as CHAT_COLORS, type ChatColorPresetId } from "@openbot/brand/chat-colors";
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

export const CHAT_COLOR_PRESET_LABELS = {
  red: "agent.color.red",
  orange: "agent.color.orange",
  yellow: "agent.color.yellow",
  green: "agent.color.green",
  cyan: "agent.color.cyan",
  sky: "agent.color.sky",
  blue: "agent.color.blue",
  indigo: "agent.color.indigo",
  violet: "agent.color.violet",
  magenta: "agent.color.magenta",
  pink: "agent.color.pink",
} as const satisfies Record<ChatColorPresetId, AppTextKey>;

export const CHAT_COLOR_PRESETS: readonly ChatColorPreset[] = CHAT_COLORS.map((preset) => ({
  value: preset.value,
  label: CHAT_COLOR_PRESET_LABELS[preset.id],
}));

const NAMED_CHAT_COLORS: readonly ChatColorPreset[] = [
  ...CHAT_COLOR_PRESETS,
  ...AVATAR_COLOR_CHOICES.flatMap((choice) => {
    const value = choice.swatch.toLowerCase();
    return isAvatarColor(value) ? [{ value, label: avatarColorChoiceLabel(choice) }] : [];
  }),
];

export function useChatColorName(): (value: AvatarColor | null) => string {
  const { t } = useText();
  return (value) => {
    if (value === null) return t("settings.chatColor.none");
    const preset = NAMED_CHAT_COLORS.find((choice) => choice.value === value);
    return preset ? t(preset.label) : value.toUpperCase();
  };
}

export interface ChatColorPickerProps {
  label: string;
  value: AvatarColor | null;
  onChange: (value: AvatarColor | null) => void;
}

export function ChatColorPicker(props: ChatColorPickerProps) {
  const { t } = useText();
  const presets = createMemo(() =>
    CHAT_COLOR_PRESETS.map((preset) => ({ value: preset.value, label: t(preset.label) })),
  );
  return <ColorPicker label={props.label} presets={presets()} value={props.value} onChange={props.onChange} />;
}
