import type { SwitchProps } from "@expo/ui";
import { Switch as ComposeSwitch, Row, Text } from "@expo/ui/jetpack-compose";
import {
  defaultMinSize,
  fillMaxWidth,
  IntrinsicSize,
  toggleable,
  weight,
  width,
} from "@expo/ui/jetpack-compose/modifiers";
import { useCSSVariable } from "uniwind";

/** Material's minimum touch target. */
const MIN_INTERACTIVE_SIZE = 48;

/**
 * The Material switch in the accent color, as the sliders and the selection checks. The universal
 * `@expo/ui` switch takes the Material default colors and has no color option, so this is its
 * layout with the colors set. Put it in an `@expo/ui` `Host`.
 */
export function AppSwitch({ value, onValueChange, label, disabled, modifiers }: SwitchProps) {
  const accent = String(useCSSVariable("--openbot-accent"));
  const onAccent = String(useCSSVariable("--openbot-text-on-accent"));
  // A disabled switch that is on keeps the accent at 38% (alpha 0x61), as Material dims a disabled
  // control. A native color reads `#rrggbbaa`, not `color-mix()`.
  const disabledAccent = /^#[0-9a-f]{6}$/i.test(accent) ? `${accent}61` : accent;
  const labeled = label != null;
  const toggle = (
    <ComposeSwitch
      value={value}
      onCheckedChange={labeled ? undefined : onValueChange}
      enabled={!disabled}
      colors={{
        checkedTrackColor: accent,
        checkedBorderColor: accent,
        checkedThumbColor: onAccent,
        disabledCheckedTrackColor: disabledAccent,
        disabledCheckedBorderColor: disabledAccent,
        disabledCheckedThumbColor: onAccent,
      }}
      modifiers={[
        ...(modifiers ?? []),
        ...(labeled ? [defaultMinSize({ minWidth: MIN_INTERACTIVE_SIZE, minHeight: MIN_INTERACTIVE_SIZE })] : []),
      ]}
    />
  );
  if (!labeled) return toggle;
  // The whole row toggles the switch and reads as one switch, as in the universal switch.
  return (
    <Row
      verticalAlignment="center"
      horizontalArrangement={{ spacedBy: 8 }}
      modifiers={[
        fillMaxWidth(),
        width(IntrinsicSize.Max),
        toggleable(value, () => !disabled && onValueChange(!value), { role: "switch", enabled: !disabled }),
      ]}
    >
      <Text modifiers={[weight(1)]}>{label}</Text>
      {toggle}
    </Row>
  );
}
