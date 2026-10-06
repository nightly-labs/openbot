import { MenuView } from "@expo/ui/community/menu";
import { Typography } from "heroui-native";
import { ChevronsUpDown } from "lucide-react-native";
import { Switch, View } from "react-native";
import { useCSSVariable } from "uniwind";
import type { SettingsPickerProps, SettingsSwitchProps } from "./settings-controls.types";

/**
 * Android settings controls. The Material picker of `@expo/ui` is a wide text field that wraps the
 * row label, so a choice opens a menu from the current value, as the Android Settings app does.
 */
export function SettingsPicker<T extends string | number>({
  value,
  options,
  enabled,
  dark,
  label,
  onChange,
}: SettingsPickerProps<T>) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const selected = options.find((option) => option.value === value);
  return (
    <MenuView
      colorScheme={dark ? "dark" : "light"}
      actions={options.map((option) => ({
        id: String(option.value),
        title: option.label,
        state: option.value === value ? "on" : "off",
        attributes: { disabled: !enabled },
      }))}
      onPressAction={({ nativeEvent }) => {
        const next = options.find((option) => String(option.value) === nativeEvent.event);
        if (enabled && next && next.value !== value) onChange(next.value);
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected?.label }}
        accessibilityState={{ disabled: !enabled }}
        className="min-h-11 max-w-56 flex-row items-center gap-1"
        style={{ opacity: enabled ? 1 : 0.45 }}
      >
        <Typography.Paragraph className="min-w-0 shrink text-grouped-secondary" numberOfLines={1}>
          {selected?.label}
        </Typography.Paragraph>
        <ChevronsUpDown color={muted} size={16} strokeWidth={1.75} />
      </View>
    </MenuView>
  );
}

export function SettingsSwitch({ value, disabled, label, onValueChange }: SettingsSwitchProps) {
  const accent = String(useCSSVariable("--openbot-accent"));
  return (
    <View className="min-w-0 flex-1 flex-row items-center gap-3">
      <Typography.Paragraph className="min-w-0 flex-1">{label}</Typography.Paragraph>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        trackColor={{ true: accent }}
        onValueChange={onValueChange}
      />
    </View>
  );
}
