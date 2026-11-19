import { Switch } from "react-native";
import { useCSSVariable } from "uniwind";
import type { RoutineActiveSwitchProps } from "./routine-active-switch.types";

export function RoutineActiveSwitch({ label, value, disabled, onValueChange }: RoutineActiveSwitchProps) {
  const accent = String(useCSSVariable("--openbot-accent"));
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      disabled={disabled}
      trackColor={{ true: accent }}
      onValueChange={onValueChange}
    />
  );
}
