import type { AvatarColor } from "@openbot/contracts/ipc";
import { Slider, Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { useText } from "@/shared/lib/text";
import type { MessageColorPickerProps } from "./message-color-picker.types";

interface Hsl {
  hue: number;
  saturation: number;
  lightness: number;
}

function hslOf(color: AvatarColor): Hsl {
  const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  const r = red ?? 0;
  const g = green ?? 0;
  const b = blue ?? 0;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness: Math.round(lightness * 100) };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return {
    hue: Math.round((sector * 60 + 360) % 360),
    saturation: Math.round(saturation * 100),
    lightness: Math.round(lightness * 100),
  };
}

function colorOf({ hue, saturation, lightness }: Hsl): AvatarColor {
  const s = saturation / 100;
  const l = lightness / 100;
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const first = (value: number | number[]) => (Array.isArray(value) ? (value[0] ?? 0) : value);

/**
 * Android: hue, saturation and lightness sliders. `@expo/ui` has no color picker for Compose. The
 * color is saved when the finger lifts.
 */
export function MessageColorPicker({ value, disabled, onChange }: MessageColorPickerProps) {
  const { t, format } = useText();
  // The sliders keep their own values during a drag: a round trip through hex moves a grey's hue.
  const [draft, setDraft] = useState<Hsl | null>(null);
  const shown = draft ?? hslOf(value);
  const channels = [
    { key: "hue", label: t("mobile.settings.appearance.messageColorHue"), maximum: 359 },
    { key: "saturation", label: t("mobile.settings.appearance.messageColorSaturation"), maximum: 100 },
    { key: "lightness", label: t("mobile.settings.appearance.messageColorLightness"), maximum: 100 },
  ] as const;
  return (
    <View className="gap-3 px-4 py-3">
      <View className="flex-row items-center justify-between">
        <Typography.Paragraph>{t("mobile.settings.appearance.messageColorPick")}</Typography.Paragraph>
        <View className="size-8 rounded-full" style={{ backgroundColor: colorOf(shown) }} />
      </View>
      {channels.map((channel) => (
        <View key={channel.key} className="gap-1">
          <View className="flex-row items-center justify-between">
            <Typography.Paragraph type="body-sm">{channel.label}</Typography.Paragraph>
            <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
              {channel.key === "hue" ? format.number(shown.hue) : format.percent(shown[channel.key] / 100)}
            </Typography.Paragraph>
          </View>
          <Slider
            value={shown[channel.key]}
            minValue={0}
            maxValue={channel.maximum}
            step={1}
            isDisabled={disabled}
            onChange={(next) => setDraft({ ...shown, [channel.key]: first(next) })}
            onChangeEnd={(next) => {
              const changed = { ...shown, [channel.key]: first(next) };
              const saved = hslOf(value);
              setDraft(null);
              // A tap with no move keeps the saved color, which a round trip through HSL can move by one step.
              if (
                changed.hue === saved.hue &&
                changed.saturation === saved.saturation &&
                changed.lightness === saved.lightness
              ) {
                return;
              }
              onChange(colorOf(changed));
            }}
          >
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb accessibilityLabel={channel.label} />
            </Slider.Track>
          </Slider>
        </View>
      ))}
    </View>
  );
}
