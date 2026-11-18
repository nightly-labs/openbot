import { Host } from "@expo/ui";
import { fixedSize, labelsHidden } from "@expo/ui/swift-ui/modifiers";
import { useUniwind } from "uniwind";
import { AppSwitch } from "@/shared/components/app-switch";
import type { RoutineActiveSwitchProps } from "./routine-active-switch.types";

const MODIFIERS = [labelsHidden(), fixedSize()];

/** The switch at the end of a routine card. The label names it for VoiceOver and is not shown. */
export function RoutineActiveSwitch({ label, value, disabled, onValueChange }: RoutineActiveSwitchProps) {
  const { theme } = useUniwind();
  return (
    <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
      <AppSwitch label={label} value={value} disabled={disabled} modifiers={MODIFIERS} onValueChange={onValueChange} />
    </Host>
  );
}
