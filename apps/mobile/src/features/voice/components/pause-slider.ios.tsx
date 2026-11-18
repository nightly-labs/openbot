import { Host } from "@expo/ui";
import { Slider } from "@expo/ui/swift-ui";
import { accessibilityLabel, disabled as disabledModifier, tint } from "@expo/ui/swift-ui/modifiers";
import { useRef } from "react";
import { useCSSVariable, useUniwind } from "uniwind";
import type { PauseSliderProps } from "./pause-slider.types";

/** iOS: the native SwiftUI slider, with the system material of the iOS version. */
export function PauseSlider({
  value,
  minimum,
  maximum,
  step,
  disabled,
  label,
  onChange,
  onChangeEnd,
}: PauseSliderProps) {
  const { theme } = useUniwind();
  const accent = String(useCSSVariable("--openbot-accent"));
  // The end of a drag reports no value, so it saves the last value of the drag.
  const latest = useRef(value);
  latest.current = value;
  return (
    <Host
      matchContents={{ vertical: true }}
      style={{ width: "100%" }}
      colorScheme={theme === "dark" ? "dark" : "light"}
    >
      <Slider
        value={value}
        min={minimum}
        max={maximum}
        step={step}
        modifiers={[tint(accent), disabledModifier(disabled), accessibilityLabel(label)]}
        onValueChange={(next) => {
          latest.current = next;
          onChange(next);
        }}
        onEditingChanged={(editing) => {
          if (!editing) onChangeEnd(latest.current);
        }}
      />
    </Host>
  );
}
