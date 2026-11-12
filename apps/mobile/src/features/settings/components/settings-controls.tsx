import { Host, Switch } from "@expo/ui";
import { HStack, Image, Menu, Picker, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  accessibilityValue,
  disabled as disabledModifier,
  foregroundStyle,
  lineLimit,
  pickerStyle,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useCSSVariable } from "uniwind";
import { useNativeLabelFont } from "@/shared/lib/native-label-font";
import type { SettingsPickerProps, SettingsSwitchProps } from "./settings-controls.types";

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
  // A menu picker draws its value in the primary colour, so the menu has its own gray label.
  return (
    <Host matchContents colorScheme={dark ? "dark" : "light"}>
      <Menu
        modifiers={[
          tint(muted),
          disabledModifier(!enabled),
          accessibilityLabel(label),
          accessibilityValue(selected?.label ?? ""),
        ]}
        label={
          <HStack spacing={4}>
            <Text modifiers={[foregroundStyle(muted), lineLimit(1)]}>{selected?.label ?? ""}</Text>
            <Image systemName="chevron.up.chevron.down" size={13} color={muted} />
          </HStack>
        }
      >
        <Picker
          selection={value}
          onSelectionChange={(next) => {
            const option = options.find((candidate) => candidate.value === next);
            if (option) onChange(option.value);
          }}
          modifiers={[pickerStyle("inline")]}
        >
          {options.map((option) => (
            <Text key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </Text>
          ))}
        </Picker>
      </Menu>
    </Host>
  );
}

export function SettingsSwitch({ value, disabled, label, dark, onValueChange }: SettingsSwitchProps) {
  const nativeLabelFont = useNativeLabelFont();
  return (
    <Host matchContents={{ vertical: true }} style={{ width: "100%" }} colorScheme={dark ? "dark" : "light"}>
      <Switch
        value={value}
        disabled={disabled}
        label={label}
        modifiers={nativeLabelFont}
        onValueChange={onValueChange}
      />
    </Host>
  );
}
