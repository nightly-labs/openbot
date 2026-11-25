import { Host } from "@expo/ui";
import { DatePicker } from "@expo/ui/swift-ui";
import { datePickerStyle, disabled as disabledModifier, fixedSize, labelsHidden } from "@expo/ui/swift-ui/modifiers";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { localDay } from "@/shared/lib/local-day";
import { useText } from "@/shared/lib/text";
import { localDate } from "./usage-date";

export function RoutineTimePicker({
  time,
  label,
  disabled,
  onChange,
}: {
  time: string;
  label?: string;
  disabled: boolean;
  onChange: (time: string) => void;
}) {
  const { t } = useText();
  const title = label ?? t("mobile.agent.record.time");
  const { theme } = useUniwind();
  const [hour, minute] = time.split(":").map(Number);
  return (
    <SettingsRow
      trailing={
        <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"} style={{ marginRight: 12 }}>
          <DatePicker
            title={title}
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
      <Typography.Paragraph>{title}</Typography.Paragraph>
    </SettingsRow>
  );
}

export function RoutineDatePicker({
  date,
  disabled,
  onChange,
}: {
  date: string;
  disabled: boolean;
  onChange: (date: string) => void;
}) {
  const { t } = useText();
  const title = t("mobile.agent.record.date");
  const { theme } = useUniwind();
  return (
    <SettingsRow
      trailing={
        <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"} style={{ marginRight: 12 }}>
          <DatePicker
            title={title}
            selection={localDate(date)}
            displayedComponents={["date"]}
            modifiers={[datePickerStyle("compact"), labelsHidden(), fixedSize(), disabledModifier(disabled)]}
            onDateChange={(value) => onChange(localDay(value))}
          />
        </Host>
      }
    >
      <Typography.Paragraph>{title}</Typography.Paragraph>
    </SettingsRow>
  );
}
