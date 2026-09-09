import { Host } from "@expo/ui";
import { DatePicker } from "@expo/ui/swift-ui";
import { datePickerStyle, disabled as disabledModifier, fixedSize, labelsHidden } from "@expo/ui/swift-ui/modifiers";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { SettingsRow } from "@/features/settings/components/settings-content";

export function RoutineTimePicker({
  time,
  disabled,
  onChange,
}: {
  time: string;
  disabled: boolean;
  onChange: (time: string) => void;
}) {
  const { theme } = useUniwind();
  const [hour, minute] = time.split(":").map(Number);
  return (
    <SettingsRow
      trailing={
        <Host
          matchContents
          colorScheme={theme === "dark" ? "dark" : "light"}
          // Match the trailing inset of the native menu picker arrows.
          style={{ marginRight: 12 }}
        >
          <DatePicker
            title="Time"
            selection={new Date(2000, 0, 1, hour, minute)}
            displayedComponents={["hourAndMinute"]}
            modifiers={[datePickerStyle("compact"), labelsHidden(), fixedSize(), disabledModifier(disabled)]}
            onDateChange={(value) =>
              onChange(`${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`)
            }
          />
        </Host>
      }
    >
      <Typography.Paragraph>Time</Typography.Paragraph>
    </SettingsRow>
  );
}
