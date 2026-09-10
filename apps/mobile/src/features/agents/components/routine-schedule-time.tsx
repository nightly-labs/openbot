import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { isAndroid } from "@/shared/lib/platform";

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
  const [open, setOpen] = useState(false);
  const [hour, minute] = time.split(":").map(Number);
  // This is a wall-clock time in the routine's zone, not an instant to convert to the phone's zone.
  const value = new Date(2000, 0, 1, hour, minute);
  const picker = (
    <DateTimePicker
      value={value}
      mode="time"
      display={isAndroid ? "default" : "compact"}
      disabled={disabled}
      themeVariant={theme === "dark" ? "dark" : "light"}
      onDismiss={() => setOpen(false)}
      onChange={(event, next) => {
        setOpen(false);
        if (event.type !== "set" || !next) return;
        onChange(`${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`);
      }}
    />
  );
  return (
    <>
      <SettingsRow
        disabled={disabled}
        disclosure={false}
        onPress={isAndroid ? () => setOpen(true) : undefined}
        trailing={
          isAndroid ? <Typography.Paragraph className="text-grouped-secondary">{time}</Typography.Paragraph> : picker
        }
      >
        <Typography.Paragraph>Time</Typography.Paragraph>
      </SettingsRow>
      {isAndroid && open ? picker : null}
    </>
  );
}
