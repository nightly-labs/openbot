import { Switch, type SwitchProps } from "@expo/ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import { useMemo } from "react";
import { useCSSVariable } from "uniwind";

export function AppSwitch({ modifiers, ...props }: SwitchProps) {
  const accent = String(useCSSVariable("--openbot-accent"));
  const tinted = useMemo(() => [tint(accent), ...(modifiers ?? [])], [accent, modifiers]);
  return <Switch {...props} modifiers={tinted} />;
}
