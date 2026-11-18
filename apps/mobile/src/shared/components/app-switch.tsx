import { Switch, type SwitchProps } from "@expo/ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import { useMemo } from "react";
import { useCSSVariable } from "uniwind";

/**
 * The native switch in the accent color, as the sliders and the selection checks. The system
 * default is green. Put it in an `@expo/ui` `Host`.
 */
export function AppSwitch({ modifiers, ...props }: SwitchProps) {
  const accent = String(useCSSVariable("--openbot-accent"));
  const tinted = useMemo(() => [tint(accent), ...(modifiers ?? [])], [accent, modifiers]);
  return <Switch {...props} modifiers={tinted} />;
}
