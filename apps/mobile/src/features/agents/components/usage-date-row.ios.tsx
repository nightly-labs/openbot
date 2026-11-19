import { Host } from "@expo/ui";
import { DatePicker } from "@expo/ui/swift-ui";
import { datePickerStyle, fixedSize, labelsHidden } from "@expo/ui/swift-ui/modifiers";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { localDate, localDay } from "./usage-date";

export function UsageDateRow({
  label,
  date,
  max,
  onChange,
}: {
  label: string;
  date: string;
  max: string;
  onChange: (date: string) => void;
}) {
  const { theme } = useUniwind();
  return (
    <SettingsRow
      trailing={
        <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"} style={{ marginRight: 12 }}>
          <DatePicker
            title={label}
            selection={localDate(date)}
            range={{ end: localDate(max) }}
            displayedComponents={["date"]}
            modifiers={[datePickerStyle("compact"), labelsHidden(), fixedSize()]}
            onDateChange={(value) => onChange(localDay(value))}
          />
        </Host>
      }
    >
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}
