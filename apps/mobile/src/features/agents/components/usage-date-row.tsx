import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { localDate, localDay } from "./usage-date";

/** A calendar day of a usage range. Android opens the date dialog from the row. */
export function UsageDateRow({
  label,
  date,
  max,
  onChange,
}: {
  label: string;
  /** A `YYYY-MM-DD` day in the phone's time zone. */
  date: string;
  max: string;
  onChange: (date: string) => void;
}) {
  const { format } = useText();
  const { theme } = useUniwind();
  const [open, setOpen] = useState(false);
  const picker = (
    <DateTimePicker
      value={localDate(date)}
      maximumDate={localDate(max)}
      mode="date"
      display={isAndroid ? "default" : "compact"}
      themeVariant={theme === "dark" ? "dark" : "light"}
      onDismiss={() => setOpen(false)}
      onChange={(event, next) => {
        setOpen(false);
        if (event.type === "set" && next) onChange(localDay(next));
      }}
    />
  );
  return (
    <>
      <SettingsRow
        disclosure={false}
        onPress={isAndroid ? () => setOpen(true) : undefined}
        trailing={
          isAndroid ? (
            <Typography.Paragraph className="text-grouped-secondary">
              {format.date(localDate(date), { year: "numeric", month: "short", day: "numeric" })}
            </Typography.Paragraph>
          ) : (
            picker
          )
        }
      >
        <Typography.Paragraph>{label}</Typography.Paragraph>
      </SettingsRow>
      {isAndroid && open ? picker : null}
    </>
  );
}
