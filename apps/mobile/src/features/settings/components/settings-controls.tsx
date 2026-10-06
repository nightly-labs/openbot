import { Host, Picker, Switch } from "@expo/ui";
import type { SettingsPickerProps, SettingsSwitchProps } from "./settings-controls.types";

export function SettingsPicker<T extends string | number>({
  value,
  options,
  enabled,
  dark,
  onChange,
}: SettingsPickerProps<T>) {
  return (
    <Host matchContents colorScheme={dark ? "dark" : "light"}>
      <Picker selectedValue={value} enabled={enabled} onValueChange={onChange}>
        {options.map((option) => (
          <Picker.Item key={option.value} label={option.label} value={option.value} />
        ))}
      </Picker>
    </Host>
  );
}

export function SettingsSwitch({ value, disabled, label, dark, onValueChange }: SettingsSwitchProps) {
  return (
    <Host matchContents={{ vertical: true }} style={{ width: "100%" }} colorScheme={dark ? "dark" : "light"}>
      <Switch value={value} disabled={disabled} label={label} onValueChange={onValueChange} />
    </Host>
  );
}
