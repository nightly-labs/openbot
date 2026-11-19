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

const MIN_INTERACTIVE_SIZE = 48;

export function AppSwitch({ value, onValueChange, label, disabled, modifiers }: SwitchProps) {
  const accent = String(useCSSVariable("--openbot-accent"));
  const onAccent = String(useCSSVariable("--openbot-text-on-accent"));
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
